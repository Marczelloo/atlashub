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
import { registerSecurityHeaders } from './middleware/security-headers.js';
import { setValidator } from './lib/sql-builder.js';
import { validateIdentifier } from './utils/identifier-validator.js';
import { parseRateLimitOverrides, projectRateLimit } from './lib/rate-limit-overrides.js';
import { devAdminTokenProblem, isValidDevAdminToken } from './lib/dev-admin-token.js';

const COOKIE_NAME = 'atlashub_session';

// A deployment accidentally left in development mode relaxes CORS, shows raw
// database errors and may accept the dev admin token. Say so loudly at startup.
if (!config.isProduction) {
  console.warn(
    `WARNING: NODE_ENV is not "production". Use NODE_ENV=production for any deployment ` +
      `reachable from other machines.`
  );
}
if (config.security.devAdminToken) {
  const problem = devAdminTokenProblem({ isDev: config.isDev, token: config.security.devAdminToken });
  console.warn(
    problem
      ? `DEV_ADMIN_TOKEN is set but ignored (${problem}).`
      : 'WARNING: DEV_ADMIN_TOKEN admin bypass is ENABLED. Never use this outside local development.'
  );
}

const rateLimitOverrides = parseRateLimitOverrides(config.rateLimitProjectOverrides);
if (rateLimitOverrides.invalid.length > 0) {
  console.warn(
    `Ignoring invalid RATE_LIMIT_PROJECT_OVERRIDES entries: ${rateLimitOverrides.invalid.join(', ')}`
  );
}

// Cache for verified admin sessions to avoid re-verifying on every request
const adminSessionCache = new Map<string, { isAdmin: boolean; expiresAt: number }>();
const SESSION_CACHE_TTL_MS = 60000; // Cache admin status for 1 minute

/**
 * Populate admin session cache for rate limiting decisions.
 * This hook runs before rate limiting so the cache is available.
 */
async function populateAdminCache(request: {
  cookies: Record<string, string | undefined>;
  headers: Record<string, string | unknown>;
}): Promise<void> {
  const token = request.cookies[COOKIE_NAME];
  if (!token) return;

  // Check if already cached and valid
  const cached = adminSessionCache.get(token);
  if (cached && cached.expiresAt > Date.now()) return;

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
  } catch {
    // Invalid session - cache as non-admin
    adminSessionCache.set(token, {
      isAdmin: false,
      expiresAt: Date.now() + SESSION_CACHE_TTL_MS,
    });
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
    // Only proxies from TRUST_PROXY may set the client IP. Trusting every hop let
    // clients pick their own IP and bypass per-IP login and rate limits.
    trustProxy: config.trustProxy,
    bodyLimit: config.bodyLimitBytes,
  });

  // Global error handler
  app.setErrorHandler(errorHandler);

  // Security headers via Helmet (CSP handled by our middleware)
  await app.register(helmet, {
    contentSecurityPolicy: false, // We handle CSP in our middleware
    hsts: {
      maxAge: 31536000,
      includeSubDomains: true,
      preload: true,
    },
  });

  // Security headers (CSP, X-Frame-Options, etc.)
  await registerSecurityHeaders(app);

  // Set SQL identifier validator
  setValidator(validateIdentifier);

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

  // Populate admin cache before rate limiting
  app.addHook('onRequest', async (request) => {
    await populateAdminCache(request);
  });

  // Rate limiting with dynamic max value and admin bypass
  // Note: timeWindow must be a number (not function) - changes require restart
  // max can be a function and is evaluated per-request
  await app.register(rateLimit, {
    max: (request) => {
      const token = request.cookies[COOKIE_NAME];
      if (token) {
        const cached = adminSessionCache.get(token);
        if (cached && cached.expiresAt > Date.now() && cached.isAdmin) {
          // Admins get elevated limits, but not unlimited
          return Math.max(config.security.adminRateLimitFloor, runtimeSettings.getRateLimitMax());
        }
      }
      // Dev admin token bypass (development only)
      if (config.isDev && config.security.devAdminToken) {
        const devToken = request.headers['x-dev-admin-token'];
        if (isValidDevAdminToken(devToken, { isDev: config.isDev, token: config.security.devAdminToken })) {
          return Math.max(config.security.adminRateLimitFloor, runtimeSettings.getRateLimitMax());
        }
      }
      // Per-project override. projectContext is already set here: the rate-limit
      // hook is attached to each route and runs after the public auth hook.
      const projectLimit = projectRateLimit(
        rateLimitOverrides,
        (request as unknown as { projectContext?: { projectId: string } }).projectContext?.projectId
      );
      if (projectLimit !== undefined) {
        return projectLimit;
      }
      return runtimeSettings.getRateLimitMax();
    },
    timeWindow: config.rateLimitWindowMs,
    keyGenerator: (request) => {
      const projectId = (request as unknown as { projectContext?: { projectId: string } })
        .projectContext?.projectId;
      return projectId || request.ip;
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
