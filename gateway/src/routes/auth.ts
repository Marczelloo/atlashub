import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authService } from '../services/auth.js';
import { config } from '../config/env.js';
import { BadRequestError } from '../lib/errors.js';

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  inviteKey: z.string().min(1),
});

const COOKIE_NAME = 'atlashub_session';

function getCookieOptions() {
  const options: {
    path: string;
    httpOnly: boolean;
    secure: boolean;
    sameSite: 'strict' | 'lax' | 'none';
    maxAge: number;
    domain?: string;
  } = {
    path: '/',
    httpOnly: true,
    secure: config.isProduction,
    sameSite: config.cookieDomain ? 'none' : 'lax', // 'none' required for cross-subdomain with credentials
    maxAge: config.security.sessionExpiryHours * 60 * 60, // in seconds
  };

  if (config.cookieDomain) {
    options.domain = config.cookieDomain;
  }

  return options;
}

export const authRoutes: FastifyPluginAsync = async (fastify: FastifyInstance) => {
  // Login
  fastify.post('/login', async (request, reply) => {
    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body');
    }

    const { email, password } = parsed.data;
    const user = await authService.validateCredentials(email, password);
    const token = await authService.generateToken(user);

    reply.setCookie(COOKIE_NAME, token, getCookieOptions());

    return reply.send({
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      },
    });
  });

  // Register (requires invite key)
  fastify.post('/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const { email, password, inviteKey } = parsed.data;

    // Validate invite key
    const invite = await authService.validateInviteKey(inviteKey);

    // Create user
    const user = await authService.createUser(email, password, 'user');

    // Mark invite key as used
    await authService.useInviteKey(invite.id, user.id);

    // Generate token
    const token = await authService.generateToken(user);

    reply.setCookie(COOKIE_NAME, token, getCookieOptions());

    return reply.send({
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      },
    });
  });

  // Logout
  fastify.post('/logout', async (_request, reply) => {
    reply.clearCookie(COOKIE_NAME, { path: '/' });
    return reply.send({ data: { success: true } });
  });

  // Get current user (from token)
  fastify.get('/me', async (request, reply) => {
    const token = request.cookies[COOKIE_NAME];

    if (!token) {
      return reply.send({ data: null });
    }

    try {
      const payload = await authService.verifyToken(token);
      const user = await authService.getUserById(payload.userId);

      if (!user) {
        reply.clearCookie(COOKIE_NAME, { path: '/' });
        return reply.send({ data: null });
      }

      return reply.send({
        data: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      });
    } catch {
      reply.clearCookie(COOKIE_NAME, { path: '/' });
      return reply.send({ data: null });
    }
  });

  // Check if setup is needed (no users yet)
  fastify.get('/setup-status', async (_request, reply) => {
    const hasUsers = await authService.hasAnyUser();
    return reply.send({
      data: {
        setupRequired: !hasUsers,
      },
    });
  });

  // Initial admin setup (only works if no users exist)
  fastify.post('/setup', async (request, reply) => {
    const hasUsers = await authService.hasAnyUser();

    if (hasUsers) {
      throw new BadRequestError('Setup has already been completed');
    }

    const parsed = loginSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body');
    }

    const { email, password } = parsed.data;

    if (password.length < 8) {
      throw new BadRequestError('Password must be at least 8 characters');
    }

    const user = await authService.createUser(email, password, 'admin');
    const token = await authService.generateToken(user);

    reply.setCookie(COOKIE_NAME, token, getCookieOptions());

    return reply.send({
      data: {
        user: {
          id: user.id,
          email: user.email,
          role: user.role,
        },
      },
    });
  });
};
