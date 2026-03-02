// gateway/src/middleware/security-headers.test.ts
import { describe, it, expect } from 'vitest';
import { buildSecurityHeaders, buildCSPDirectives } from './security-headers.js';

describe('security-headers', () => {
  describe('buildCSPDirectives', () => {
    it('should return strict CSP for production', () => {
      const csp = buildCSPDirectives(false); // isDev = false

      expect(csp).toContain("default-src 'self'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(csp).toContain("form-action 'self'");
      expect(csp).not.toContain('unsafe-eval');
    });

    it('should return relaxed CSP for development', () => {
      const csp = buildCSPDirectives(true); // isDev = true

      expect(csp).toContain('localhost');
      expect(csp).toContain('unsafe-eval');
    });
  });

  describe('buildSecurityHeaders', () => {
    it('should return all security headers', () => {
      const headers = buildSecurityHeaders(false);

      expect(headers['X-Content-Type-Options']).toBe('nosniff');
      expect(headers['X-Frame-Options']).toBe('DENY');
      expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
      expect(headers['Permissions-Policy']).toBeDefined();
    });
  });
});
