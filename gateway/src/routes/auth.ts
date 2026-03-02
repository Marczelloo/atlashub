import type { FastifyPluginAsync, FastifyInstance } from 'fastify';
import { z } from 'zod';
import { authService } from '../services/auth.js';
import { config } from '../config/env.js';
import { BadRequestError, TooManyRequestsError } from '../lib/errors.js';
import { getAuthRateLimiter } from '../middleware/auth-rate-limit.js';
import { validatePassword } from '../utils/password-validator.js';

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
    // Secure must be true when sameSite='none' - required for cross-subdomain cookies
    secure: config.isProduction || !!config.cookieDomain,
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
    const ip = request.ip;
    const rateLimiter = getAuthRateLimiter();

    // Check rate limit before attempting login
    try {
      rateLimiter.checkLimit(ip, email);
    } catch {
      throw new TooManyRequestsError('Too many failed login attempts. Please try again later.');
    }

    try {
      const user = await authService.validateCredentials(email, password);

      // Reset rate limit on successful login
      rateLimiter.resetAttempts(ip, email);

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
    } catch (error) {
      // Don't reset rate limit on failure
      throw error;
    }
  });

  // Register (requires invite key)
  fastify.post('/register', async (request, reply) => {
    const parsed = registerSchema.safeParse(request.body);
    if (!parsed.success) {
      throw new BadRequestError('Invalid request body', parsed.error.flatten().fieldErrors);
    }

    const { email, password, inviteKey } = parsed.data;

    // Validate password strength
    const passwordResult = validatePassword(password);
    if (!passwordResult.valid) {
      throw new BadRequestError(
        'Password does not meet requirements',
        passwordResult.errors
      );
    }

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

    // Validate password strength
    const passwordResult = validatePassword(password);
    if (!passwordResult.valid) {
      throw new BadRequestError(
        'Password does not meet requirements',
        passwordResult.errors
      );
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
