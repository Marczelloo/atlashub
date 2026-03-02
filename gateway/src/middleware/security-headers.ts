// gateway/src/middleware/security-headers.ts
import type { FastifyInstance } from 'fastify';

interface CSPDirectives {
  [key: string]: string[];
}

function buildCSPDirectiveString(directives: CSPDirectives): string {
  return Object.entries(directives)
    .map(([key, values]) => `${key} ${values.join(' ')}`)
    .join('; ');
}

export function buildCSPDirectives(isDev: boolean): string {
  if (isDev) {
    const devDirectives: CSPDirectives = {
      'default-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      'script-src': ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'data:', 'blob:', 'http:', 'https:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'", 'http://localhost:*', 'ws://localhost:*', 'https:'],
      'frame-ancestors': ["'none'"],
      'form-action': ["'self'"],
      'base-uri': ["'self'"],
    };
    return buildCSPDirectiveString(devDirectives);
  }

  const prodDirectives: CSPDirectives = {
    'default-src': ["'self'"],
    'script-src': ["'self'"],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:'],
    'font-src': ["'self'"],
    'connect-src': ["'self'"],
    'frame-ancestors': ["'none'"],
    'form-action': ["'self'"],
    'base-uri': ["'self'"],
  };

  return buildCSPDirectiveString(prodDirectives);
}

export function buildSecurityHeaders(isDev: boolean): Record<string, string> {
  const headers: Record<string, string> = {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()',
    // Always set CSP - use relaxed directives in dev, strict in prod
    'Content-Security-Policy': buildCSPDirectives(isDev),
  };

  return headers;
}

export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  // Dynamic import to avoid loading config during tests for pure functions
  const { config } = await import('../config/env.js');
  const headers = buildSecurityHeaders(config.isDev);

  app.addHook('onRequest', async (_request, reply) => {
    for (const [key, value] of Object.entries(headers)) {
      reply.header(key, value);
    }
  });
}
