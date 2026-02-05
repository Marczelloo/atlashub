import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import { config } from './config/env.js';
import { adminRoutes } from './routes/admin/index.js';
import { publicRoutes } from './routes/public/index.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { errorHandler } from './lib/errors.js';
import { runtimeSettings } from './services/runtime-settings.js';
import { authService } from './services/auth.js';

const COOKIE_NAME = 'atlashub_session';

// Cache for verified admin sessions to avoid re-verifying on every request
const adminSessionCache = new Map<string, { isAdmin: boolean; expiresAt: number }>();
const SESSION_CACHE_TTL_MS = 60000; // Cache admin status for 1 minute

/**
 * Check if request is from an admin user (for rate limit bypass)
 * Uses caching to avoid JWT verification on every request
 */
async function isAdminRequest(request: {
  cookies: Record<string, string | undefined>;
  headers: Record<string, string | unknown>;
}): Promise<boolean> {
  // Dev mode: check for dev admin token
  if (config.isDev && config.security.devAdminToken) {
    const devToken = request.headers['x-dev-admin-token'];
    if (devToken === config.security.devAdminToken) {
      return true;
    }
  }

  // Check for admin session cookie
  const token = request.cookies[COOKIE_NAME];
  if (!token) {
    return false;
  }

  // Check cache first
  const cached = adminSessionCache.get(token);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.isAdmin;
  }

  // Verify session and check admin status
  try {
    const payload = await authService.verifyToken(token);
    const user = await authService.getUserById(payload.userId);
    const isAdmin = user?.role === 'admin';

    // Cache the result
    adminSessionCache.set(token, {
      isAdmin,
      expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
    });

    // Cleanup old cache entries periodically
    if (adminSessionCache.size > 1000) {
      const now = Date.now();
      for (const [key, value] of adminSessionCache) {
        if (value.expiresAt <= now) {
          adminSessionCache.delete(key);
        }
      }
    }

    return isAdmin;
  } catch {
    // Invalid session - cache as non-admin
    adminSessionCache.set(token, {
      isAdmin: false,
      expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
    });
    return false;
  }
}

export async function buildApp() {
  // Initialize runtime settings from config
  const minioProtocol = config.minio.useSSL ? 'https' : 'http';
  const minioPublicUrl = `${minioProtocol}://${config.minio.endpoint}:${config.minio.port}`;

  runtimeSettings.init({
    rateLimitMax: config.rateLimitMax,
    rateLimitWindowMs: config.rateLimitWindowMs,
    sqlMaxRows: config.query.maxRowsPerQuery,
    sqlStatementTimeoutMs: config.query.statementTimeoutMs,
    minioPublicUrl,
  });

  const app = Fastify({
    logger: {
      level: config.logLevel,
      transport: config.isDev
        ? {
            target: 'pino-pretty',
            options: { colorize: true },
          }
        : undefined,
    },
    requestIdHeader: 'x-request-id',
    trustProxy: true,
    bodyLimit: config.bodyLimitBytes,
  });

  // Global error handler
  app.setErrorHandler(errorHandler);

  // Security headers
  await app.register(helmet, {
    contentSecurityPolicy: false,
  });

  // CORS for public API
  await app.register(cors, {
    origin: config.corsOrigins,
    credentials: true, // Allow cookies
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'x-api-key',
      'x-dev-admin-token',
      'x-request-id',
      'cf-access-jwt-assertion',
    ],
  });

  // Cookie support
  await app.register(cookie);

  // Rate limiting with dynamic max value and admin bypass
  // Note: timeWindow must be a number (not function) - changes require restart
  // max can be a function and is evaluated per-request
  await app.register(rateLimit, {
    max: (request) => {
      // Check admin bypass (sync wrapper for cached results)
      const token = request.cookies[COOKIE_NAME];
      if (token) {
        const cached = adminSessionCache.get(token);
        if (cached && cached.expiresAt > Date.now() && cached.isAdmin) {
          return 0; // 0 = unlimited for admins
        }
      }
      // Dev admin token bypass
      if (config.isDev && config.security.devAdminToken) {
        const devToken = request.headers['x-dev-admin-token'];
        if (devToken === config.security.devAdminToken) {
          return 0; // Unlimited for dev admin
        }
      }
      return runtimeSettings.getRateLimitMax();
    },
    timeWindow: config.rateLimitWindowMs, // Fixed at startup (changes require restart)
    keyGenerator: (request) => {
      // Use project ID from context if available, otherwise IP
      const projectId = (request as unknown as { projectContext?: { projectId: string } })
        .projectContext?.projectId;
      return projectId || request.ip;
    },
    allowList: async (request) => {
      // Allow admins to bypass rate limiting entirely
      return isAdminRequest(request);
    },
  });

  // Request ID is already available via request.id

  // Register routes
  await app.register(healthRoutes, { prefix: '/health' });
  await app.register(authRoutes, { prefix: '/auth' });
  await app.register(adminRoutes, { prefix: '/admin' });
  await app.register(publicRoutes, { prefix: '/v1' });

  return app;
}
