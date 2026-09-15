import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';

vi.mock('../config/env.js', () => ({
  config: {
    isProduction: false,
    cookieDomain: undefined,
    security: { sessionExpiryHours: 24 },
  },
}));

const validateCredentials = vi.fn();
vi.mock('../services/auth.js', () => ({
  authService: {
    validateCredentials: (...args: unknown[]) => validateCredentials(...args),
    generateToken: vi.fn().mockResolvedValue('jwt'),
  },
}));

import { authRoutes } from './auth.js';
import { errorHandler, UnauthorizedError } from '../lib/errors.js';

let app: FastifyInstance;

beforeAll(async () => {
  app = Fastify();
  app.setErrorHandler(errorHandler);
  await app.register(cookie);
  await app.register(authRoutes, { prefix: '/auth' });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

function login(email: string, remoteAddress: string) {
  return app.inject({
    method: 'POST',
    url: '/auth/login',
    remoteAddress,
    payload: { email, password: 'wrong-password' },
  });
}

describe('login rate limits', () => {
  it('stops password guessing spread over many IP addresses', async () => {
    validateCredentials.mockRejectedValue(new UnauthorizedError('Invalid email or password'));

    const statuses: number[] = [];
    for (let i = 0; i < 25; i++) {
      // A new address for every attempt: the per-IP limit alone never triggers.
      statuses.push((await login('admin@example.com', `203.0.113.${i + 1}`)).statusCode);
    }

    expect(statuses.slice(0, 20).every((status) => status === 401)).toBe(true);
    expect(statuses.slice(20).every((status) => status === 429)).toBe(true);
    // Blocked attempts never reach the password check.
    expect(validateCredentials).toHaveBeenCalledTimes(20);
  });

  it('limits other accounts independently', async () => {
    validateCredentials.mockRejectedValue(new UnauthorizedError('Invalid email or password'));
    expect((await login('someone-else@example.com', '198.51.100.1')).statusCode).toBe(401);
  });
});
