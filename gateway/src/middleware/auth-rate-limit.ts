export interface AuthRateLimitConfig {
  maxAttempts: number;
  windowMs: number;
}

interface AttemptRecord {
  count: number;
  firstAttempt: number;
}

/**
 * Error thrown when rate limit is exceeded
 */
export class TooManyAttemptsError extends Error {
  public readonly statusCode = 429;
  public readonly error = 'TOO_MANY_REQUESTS';

  constructor(message: string) {
    super(message);
    this.name = 'TooManyAttemptsError';
  }
}

export class AuthRateLimiter {
  private attempts = new Map<string, AttemptRecord>();
  private config: AuthRateLimitConfig;

  constructor(config: AuthRateLimitConfig) {
    this.config = config;
    setInterval(() => this.cleanup(), 60000);
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, record] of this.attempts) {
      if (now - record.firstAttempt > this.config.windowMs) {
        this.attempts.delete(key);
      }
    }
  }

  checkLimit(ip: string, email: string): void;
  checkLimit(key: string): void;
  checkLimit(ipOrKey: string, email?: string): void {
    const key = email ? `${ipOrKey}:${email.toLowerCase()}` : ipOrKey;
    const now = Date.now();
    const record = this.attempts.get(key);

    if (!record) {
      this.attempts.set(key, { count: 1, firstAttempt: now });
      return;
    }

    if (now - record.firstAttempt > this.config.windowMs) {
      this.attempts.set(key, { count: 1, firstAttempt: now });
      return;
    }

    if (record.count >= this.config.maxAttempts) {
      const retryAfter = Math.ceil((record.firstAttempt + this.config.windowMs - now) / 1000);
      throw new TooManyAttemptsError(
        `Too many failed login attempts. Please try again in ${retryAfter} seconds.`
      );
    }

    record.count++;
  }

  resetAttempts(ip: string, email: string): void;
  resetAttempts(key: string): void;
  resetAttempts(ipOrKey: string, email?: string): void {
    const key = email ? `${ipOrKey}:${email.toLowerCase()}` : ipOrKey;
    this.attempts.delete(key);
  }

  getRemainingAttempts(ip: string, email: string): number;
  getRemainingAttempts(key: string): number;
  getRemainingAttempts(ipOrKey: string, email?: string): number {
    const key = email ? `${ipOrKey}:${email.toLowerCase()}` : ipOrKey;
    const record = this.attempts.get(key);

    if (!record) return this.config.maxAttempts;

    const now = Date.now();
    if (now - record.firstAttempt > this.config.windowMs) return this.config.maxAttempts;

    return Math.max(0, this.config.maxAttempts - record.count);
  }
}

let instance: AuthRateLimiter | null = null;

export function getAuthRateLimiter(): AuthRateLimiter {
  if (!instance) {
    instance = new AuthRateLimiter({
      maxAttempts: parseInt(process.env.AUTH_RATE_LIMIT_MAX || '5', 10),
      windowMs: parseInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS || '300000', 10),
    });
  }
  return instance;
}
