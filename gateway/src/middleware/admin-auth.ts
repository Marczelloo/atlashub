import type { FastifyRequest, FastifyReply } from 'fastify';
import { authService, type User } from '../services/auth.js';
import { config } from '../config/env.js';
import { UnauthorizedError, ForbiddenError } from '../lib/errors.js';
import { isValidDevAdminToken } from '../lib/dev-admin-token.js';

const COOKIE_NAME = 'atlashub_session';

declare module 'fastify' {
  interface FastifyRequest {
    user?: User;
  }
}

/**
 * Middleware that checks for valid session cookie and sets request.user
 * Allows all authenticated users (both admin and regular users)
 */
export async function sessionAuthMiddleware(request: FastifyRequest, _reply: FastifyReply) {
  // Development fallback: allow dev admin token (development only, strong token only)
  if (config.isDev && config.security.devAdminToken) {
    const devToken = request.headers['x-dev-admin-token'];
    if (isValidDevAdminToken(devToken, { isDev: config.isDev, token: config.security.devAdminToken })) {
      // Create a mock admin user for dev
      request.user = {
        id: 'dev-admin',
        email: 'dev@localhost',
        role: 'admin',
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      return;
    }
  }

  // Get session cookie
  const token = request.cookies[COOKIE_NAME];

  if (!token) {
    throw new UnauthorizedError('Authentication required');
  }

  try {
    const payload = await authService.verifyToken(token);
    const user = await authService.getUserById(payload.userId);

    if (!user) {
      throw new UnauthorizedError('User not found');
    }

    request.user = user;
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      throw error;
    }
    throw new UnauthorizedError('Invalid or expired session');
  }
}

/**
 * Middleware that requires admin role (must be used after sessionAuthMiddleware)
 */
export async function adminOnlyMiddleware(request: FastifyRequest, _reply: FastifyReply) {
  if (!request.user) {
    throw new UnauthorizedError('Authentication required');
  }

  if (request.user.role !== 'admin') {
    throw new ForbiddenError('Admin access required');
  }
}

/**
 * Combined middleware: session auth + admin role check
 */
export async function adminAuthMiddleware(request: FastifyRequest, reply: FastifyReply) {
  await sessionAuthMiddleware(request, reply);
  await adminOnlyMiddleware(request, reply);
}
