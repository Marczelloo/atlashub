import { describe, it, expect, beforeEach } from 'vitest';
import { AuthRateLimiter } from './auth-rate-limit.js';

describe('auth-rate-limit', () => {
  let limiter: AuthRateLimiter;

  beforeEach(() => {
    limiter = new AuthRateLimiter({
      maxAttempts: 3,
      windowMs: 60000,
    });
  });

  describe('checkLimit', () => {
    it('should allow requests under the limit', () => {
      const key = '192.168.1.1:user@test.com';
      expect(() => limiter.checkLimit(key)).not.toThrow();
      expect(() => limiter.checkLimit(key)).not.toThrow();
      expect(() => limiter.checkLimit(key)).not.toThrow();
    });

    it('should throw when limit exceeded', () => {
      const key = '192.168.1.1:user@test.com';
      limiter.checkLimit(key);
      limiter.checkLimit(key);
      limiter.checkLimit(key);

      expect(() => limiter.checkLimit(key)).toThrow('Too many failed login attempts');
    });

    it('should track different keys separately', () => {
      const key1 = '192.168.1.1:user1@test.com';
      const key2 = '192.168.1.1:user2@test.com';

      limiter.checkLimit(key1);
      limiter.checkLimit(key1);
      limiter.checkLimit(key1);

      expect(() => limiter.checkLimit(key2)).not.toThrow();
    });

    it('should reset attempts on success', () => {
      const key = '192.168.1.1:user@test.com';
      limiter.checkLimit(key);
      limiter.checkLimit(key);
      limiter.resetAttempts(key);
      limiter.checkLimit(key);
      limiter.checkLimit(key);
      limiter.checkLimit(key);

      expect(() => limiter.checkLimit(key)).toThrow('Too many failed login attempts');
    });

    it('should return remaining attempts', () => {
      const key = '192.168.1.1:user@test.com';
      expect(limiter.getRemainingAttempts(key)).toBe(3);
      limiter.checkLimit(key);
      expect(limiter.getRemainingAttempts(key)).toBe(2);
    });
  });
});
