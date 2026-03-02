# Security Hardening Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement comprehensive security hardening for AtlasHub covering CSP, CORS, auth rate limiting, SQL validation, password requirements, and error sanitization.

**Architecture:** Layered security middleware with environment-aware configuration. Security headers applied globally, auth rate limiting on authentication endpoints, SQL identifier validation in the query builder, and server-side only dev admin tokens.

**Tech Stack:** Fastify middleware, TypeScript, Zod validation, bcrypt, Next.js server components

---

## Task 1: Create SQL Identifier Validator

**Files:**
- Create: `gateway/src/utils/identifier-validator.ts`
- Create: `gateway/src/utils/identifier-validator.test.ts`

**Step 1: Write the failing test**

```typescript
// gateway/src/utils/identifier-validator.test.ts
import { describe, it, expect } from 'vitest';
import { validateIdentifier, isValidIdentifier } from './identifier-validator.js';

describe('identifier-validator', () => {
  describe('validateIdentifier', () => {
    it('should accept valid table names', () => {
      expect(() => validateIdentifier('users', 'table')).not.toThrow();
      expect(() => validateIdentifier('user_profiles', 'table')).not.toThrow();
      expect(() => validateIdentifier('tbl123', 'table')).not.toThrow();
    });

    it('should reject names that are too long', () => {
      const longName = 'a'.repeat(64);
      expect(() => validateIdentifier(longName, 'table')).toThrow('too long');
    });

    it('should reject names starting with a number', () => {
      expect(() => validateIdentifier('123users', 'table')).toThrow('invalid characters');
    });

    it('should reject names with special characters', () => {
      expect(() => validateIdentifier('user-name', 'table')).toThrow('invalid characters');
      expect(() => validateIdentifier('user.name', 'table')).toThrow('invalid characters');
      expect(() => validateIdentifier('user;drop', 'table')).toThrow('invalid characters');
    });

    it('should reject SQL reserved words', () => {
      expect(() => validateIdentifier('select', 'table')).toThrow('reserved word');
      expect(() => validateIdentifier('DROP', 'table')).toThrow('reserved word');
      expect(() => validateIdentifier('Insert', 'table')).toThrow('reserved word');
    });
  });

  describe('isValidIdentifier', () => {
    it('should return true for valid identifiers', () => {
      expect(isValidIdentifier('users')).toBe(true);
      expect(isValidIdentifier('user_id')).toBe(true);
    });

    it('should return false for invalid identifiers', () => {
      expect(isValidIdentifier('123users')).toBe(false);
      expect(isValidIdentifier('select')).toBe(false);
      expect(isValidIdentifier('a'.repeat(64))).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd gateway && npm test -- identifier-validator.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// gateway/src/utils/identifier-validator.ts
import { BadRequestError } from '../lib/errors.js';

const MAX_IDENTIFIER_LENGTH = 63; // PostgreSQL limit
const VALID_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

const RESERVED_WORDS = new Set([
  // SQL keywords
  'select', 'insert', 'update', 'delete', 'drop', 'create', 'alter',
  'truncate', 'union', 'where', 'from', 'join', 'on', 'and', 'or',
  'not', 'null', 'true', 'false', 'in', 'is', 'like', 'between',
  'exists', 'case', 'when', 'then', 'else', 'end', 'as', 'order',
  'by', 'asc', 'desc', 'limit', 'offset', 'group', 'having',
  'distinct', 'count', 'sum', 'avg', 'min', 'max', 'into', 'values',
  'set', 'table', 'index', 'view', 'database', 'schema', 'grant',
  'revoke', 'commit', 'rollback', 'transaction', 'primary', 'foreign',
  'key', 'references', 'unique', 'check', 'default', 'constraint',
  'cascade', 'restrict', 'using', 'inner', 'left', 'right', 'outer',
  'full', 'cross', 'natural', 'with', 'recursive', 'returning',
  'all', 'any', 'some', 'cast', 'extract', 'coalesce', 'nullif',
  'timestamp', 'date', 'time', 'interval', 'boolean', 'integer',
  'bigint', 'smallint', 'decimal', 'numeric', 'real', 'double',
  'precision', 'varchar', 'char', 'text', 'blob', 'clob', 'array',
  'json', 'jsonb', 'uuid', 'serial', 'bigserial', 'identity',
]);

export function validateIdentifier(name: string, type: 'table' | 'column'): void {
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new BadRequestError(`Invalid ${type} name: exceeds maximum length of ${MAX_IDENTIFIER_LENGTH} characters`);
  }

  if (!VALID_IDENTIFIER_REGEX.test(name)) {
    throw new BadRequestError(`Invalid ${type} name: must contain only alphanumeric characters and underscores, and cannot start with a digit`);
  }

  if (RESERVED_WORDS.has(name.toLowerCase())) {
    throw new BadRequestError(`Invalid ${type} name: "${name}" is a reserved SQL keyword`);
  }
}

export function isValidIdentifier(name: string): boolean {
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    return false;
  }

  if (!VALID_IDENTIFIER_REGEX.test(name)) {
    return false;
  }

  if (RESERVED_WORDS.has(name.toLowerCase())) {
    return false;
  }

  return true;
}
```

**Step 4: Run test to verify it passes**

Run: `cd gateway && npm test -- identifier-validator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add gateway/src/utils/identifier-validator.ts gateway/src/utils/identifier-validator.test.ts
git commit -m "feat(security): add SQL identifier validator"
```

---

## Task 2: Create Password Validator

**Files:**
- Create: `gateway/src/utils/password-validator.ts`
- Create: `gateway/src/utils/password-validator.test.ts`

**Step 1: Write the failing test**

```typescript
// gateway/src/utils/password-validator.test.ts
import { describe, it, expect } from 'vitest';
import { validatePassword, PasswordStrength } from './password-validator.js';

describe('password-validator', () => {
  describe('validatePassword', () => {
    it('should accept strong passwords', () => {
      const result = validatePassword('MyStr0ng!Pass');
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.strength).toBe('strong');
    });

    it('should reject passwords shorter than 12 characters', () => {
      const result = validatePassword('Short1!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('12 characters'));
    });

    it('should reject passwords without uppercase', () => {
      const result = validatePassword('alllowercase1!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('uppercase'));
    });

    it('should reject passwords without lowercase', () => {
      const result = validatePassword('ALLUPPERCASE1!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('lowercase'));
    });

    it('should reject passwords without numbers', () => {
      const result = validatePassword('NoNumbersHere!');
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('number'));
    });

    it('should reject passwords without special characters', () => {
      const result = validatePassword('NoSpecialChars12');
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('special'));
    });

    it('should reject passwords with blocked patterns', () => {
      const result = validatePassword('Password123!@#');
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.stringContaining('blocked'));
    });

    it('should return all errors at once', () => {
      const result = validatePassword('weak');
      expect(result.errors.length).toBeGreaterThan(3);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd gateway && npm test -- password-validator.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// gateway/src/utils/password-validator.ts
export type PasswordStrength = 'weak' | 'medium' | 'strong';

export interface PasswordValidationResult {
  valid: boolean;
  errors: string[];
  strength: PasswordStrength;
}

const MIN_LENGTH = 12;
const BLOCKED_PATTERNS = [
  'password', 'passwd', '123456', 'qwerty', 'admin', 'atlashub',
  'letmein', 'welcome', 'monkey', 'dragon', 'master', 'login',
  'abc123', 'iloveyou', 'trustno1', 'sunshine', 'princess',
];

export function validatePassword(password: string): PasswordValidationResult {
  const errors: string[] = [];

  // Length check
  if (password.length < MIN_LENGTH) {
    errors.push(`Password must be at least ${MIN_LENGTH} characters long`);
  }

  // Uppercase check
  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  // Lowercase check
  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  // Number check
  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  // Special character check
  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  // Blocked patterns check
  const lowerPassword = password.toLowerCase();
  for (const pattern of BLOCKED_PATTERNS) {
    if (lowerPassword.includes(pattern)) {
      errors.push('Password contains a blocked pattern (common password or platform name)');
      break;
    }
  }

  // Calculate strength
  const strength = calculateStrength(password, errors.length);

  return {
    valid: errors.length === 0,
    errors,
    strength,
  };
}

function calculateStrength(password: string, errorCount: number): PasswordStrength {
  if (errorCount > 2) return 'weak';
  if (errorCount > 0) return 'medium';

  // Strong if passes all checks and has extra length
  if (password.length >= 16) return 'strong';
  return 'medium';
}
```

**Step 4: Run test to verify it passes**

Run: `cd gateway && npm test -- password-validator.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add gateway/src/utils/password-validator.ts gateway/src/utils/password-validator.test.ts
git commit -m "feat(security): add password complexity validator"
```

---

## Task 3: Create Security Headers Middleware

**Files:**
- Create: `gateway/src/middleware/security-headers.ts`
- Create: `gateway/src/middleware/security-headers.test.ts`

**Step 1: Write the failing test**

```typescript
// gateway/src/middleware/security-headers.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
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
```

**Step 2: Run test to verify it fails**

Run: `cd gateway && npm test -- security-headers.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// gateway/src/middleware/security-headers.ts
import type { FastifyInstance } from 'fastify';
import { config } from '../config/env.js';

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
    'style-src': ["'self'", "'unsafe-inline'"], // Next.js requires unsafe-inline for CSS
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
  };

  if (!isDev) {
    headers['Content-Security-Policy'] = buildCSPDirectives(false);
  }

  return headers;
}

export async function registerSecurityHeaders(app: FastifyInstance): Promise<void> {
  const headers = buildSecurityHeaders(config.isDev);

  app.addHook('onRequest', async (_request, reply) => {
    for (const [key, value] of Object.entries(headers)) {
      reply.header(key, value);
    }
  });
}
```

**Step 4: Run test to verify it passes**

Run: `cd gateway && npm test -- security-headers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add gateway/src/middleware/security-headers.ts gateway/src/middleware/security-headers.test.ts
git commit -m "feat(security): add security headers middleware with CSP"
```

---

## Task 4: Create Auth Rate Limit Middleware

**Files:**
- Create: `gateway/src/middleware/auth-rate-limit.ts`
- Create: `gateway/src/middleware/auth-rate-limit.test.ts`

**Step 1: Write the failing test**

```typescript
// gateway/src/middleware/auth-rate-limit.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
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
```

**Step 2: Run test to verify it fails**

Run: `cd gateway && npm test -- auth-rate-limit.test.ts`
Expected: FAIL - module not found

**Step 3: Write minimal implementation**

```typescript
// gateway/src/middleware/auth-rate-limit.ts
import { TooManyRequestsError } from '../lib/errors.js';

export interface AuthRateLimitConfig {
  maxAttempts: number;
  windowMs: number;
}

interface AttemptRecord {
  count: number;
  firstAttempt: number;
}

export class AuthRateLimiter {
  private attempts = new Map<string, AttemptRecord>();
  private config: AuthRateLimitConfig;

  constructor(config: AuthRateLimitConfig) {
    this.config = config;
    // Clean up expired entries every minute
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

  private getKey(ip: string, email: string): string {
    return `${ip}:${email.toLowerCase()}`;
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

    // Reset if window has passed
    if (now - record.firstAttempt > this.config.windowMs) {
      this.attempts.set(key, { count: 1, firstAttempt: now });
      return;
    }

    // Check if limit exceeded
    if (record.count >= this.config.maxAttempts) {
      const retryAfter = Math.ceil((record.firstAttempt + this.config.windowMs - now) / 1000);
      throw new TooManyRequestsError(
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

    if (!record) {
      return this.config.maxAttempts;
    }

    const now = Date.now();
    if (now - record.firstAttempt > this.config.windowMs) {
      return this.config.maxAttempts;
    }

    return Math.max(0, this.config.maxAttempts - record.count);
  }
}

// Singleton instance for the application
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
```

**Step 4: Run test to verify it passes**

Run: `cd gateway && npm test -- auth-rate-limit.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add gateway/src/middleware/auth-rate-limit.ts gateway/src/middleware/auth-rate-limit.test.ts
git commit -m "feat(security): add auth rate limiting middleware"
```

---

## Task 5: Update Environment Configuration

**Files:**
- Modify: `gateway/src/config/env.ts`

**Step 1: Add new environment variables**

Add to the envSchema in `gateway/src/config/env.ts` after the existing `RATE_LIMIT_*` variables:

```typescript
// In envSchema, add after RATE_LIMIT_WINDOW_MS:

// Auth rate limiting (for brute-force protection)
AUTH_RATE_LIMIT_MAX: z.coerce.number().int().min(1).default(5),
AUTH_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().min(1000).default(300000), // 5 minutes

// Admin rate limit floor (minimum requests even for admins)
ADMIN_RATE_LIMIT_FLOOR: z.coerce.number().int().min(100).default(1000),

// CSP reporting (optional)
CSP_REPORT_URI: z.string().url().optional().or(z.literal('')),
```

**Step 2: Add to exported config**

Add to the security section in the exported config:

```typescript
// In the security object, add:
security: {
  // ... existing fields ...
  authRateLimitMax: env.AUTH_RATE_LIMIT_MAX,
  authRateLimitWindowMs: env.AUTH_RATE_LIMIT_WINDOW_MS,
  adminRateLimitFloor: env.ADMIN_RATE_LIMIT_FLOOR,
  cspReportUri: env.CSP_REPORT_URI || undefined,
},
```

**Step 3: Add CORS validation**

Add a validation function after the envSchema:

```typescript
// Add after parseEnv() function:

function validateCorsConfig(origins: string | true, isProduction: boolean): void {
  if (isProduction && origins === true) {
    console.error('ERROR: CORS_ORIGINS cannot be "*" in production.');
    console.error('Please specify allowed origins (comma-separated), e.g.:');
    console.error('CORS_ORIGINS=https://app.example.com,https://admin.example.com');
    process.exit(1);
  }
}

// Update the parseEnv function to call validation:
function parseEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error('Invalid environment variables:');
    console.error(result.error.flatten().fieldErrors);
    process.exit(1);
  }

  // Validate CORS in production
  const corsOrigins = result.data.CORS_ORIGINS === '*' ? true : result.data.CORS_ORIGINS.split(',');
  validateCorsConfig(corsOrigins, result.data.NODE_ENV === 'production');

  return result.data;
}
```

**Step 4: Run tests to verify no regression**

Run: `cd gateway && npm test`
Expected: PASS (all existing tests still pass)

**Step 5: Commit**

```bash
git add gateway/src/config/env.ts
git commit -m "feat(security): add security-related environment variables"
```

---

## Task 6: Update SQL Builder with Identifier Validation

**Files:**
- Modify: `gateway/src/lib/sql-builder.ts`
- Modify: `gateway/src/lib/sql-builder.test.ts`

**Step 1: Update tests**

Add to `gateway/src/lib/sql-builder.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildWhereClause, buildOrderClause, buildSelectColumns, setValidator } from './sql-builder.js';
import { validateIdentifier } from '../utils/identifier-validator.js';

// Set the validator for tests
setValidator(validateIdentifier);

describe('sql-builder', () => {
  // ... existing tests ...

  describe('security', () => {
    it('should reject malicious column names in where clause', () => {
      expect(() => buildWhereClause([
        { column: 'id; DROP TABLE users--', operator: 'eq', value: 1 }
      ])).toThrow('Invalid column name');
    });

    it('should reject reserved words in order clause', () => {
      expect(() => buildOrderClause({ column: 'select', direction: 'asc' }))
        .toThrow('reserved word');
    });

    it('should reject invalid column names in select', () => {
      expect(() => buildSelectColumns(['id', '1=1;--'], ['id', 'name']))
        .toThrow('Invalid column name');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd gateway && npm test -- sql-builder.test.ts`
Expected: FAIL - setValidator not found

**Step 3: Update implementation**

Modify `gateway/src/lib/sql-builder.ts`:

```typescript
import type { ParsedFilter } from '@atlashub/shared';

// Validator function type
type IdentifierValidator = (name: string, type: 'table' | 'column') => void;

// Default no-op validator (for backwards compatibility)
let validator: IdentifierValidator = () => {};

export function setValidator(fn: IdentifierValidator): void {
  validator = fn;
}

export function buildWhereClause(
  filters: ParsedFilter[],
  startParamIndex = 1
): { clause: string; values: unknown[] } {
  if (filters.length === 0) {
    return { clause: '', values: [] };
  }

  const conditions: string[] = [];
  const values: unknown[] = [];
  let paramIndex = startParamIndex;

  for (const filter of filters) {
    // Validate column name
    validator(filter.column, 'column');

    const quotedColumn = `"${filter.column}"`;

    switch (filter.operator) {
      case 'eq':
        conditions.push(`${quotedColumn} = $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'neq':
        conditions.push(`${quotedColumn} != $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'lt':
        conditions.push(`${quotedColumn} < $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'lte':
        conditions.push(`${quotedColumn} <= $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'gt':
        conditions.push(`${quotedColumn} > $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'gte':
        conditions.push(`${quotedColumn} >= $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'like':
        conditions.push(`${quotedColumn} LIKE $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'ilike':
        conditions.push(`${quotedColumn} ILIKE $${paramIndex}`);
        values.push(filter.value);
        paramIndex++;
        break;
      case 'in':
        if (Array.isArray(filter.value) && filter.value.length > 0) {
          const placeholders = filter.value.map((_, i) => `$${paramIndex + i}`).join(', ');
          conditions.push(`${quotedColumn} IN (${placeholders})`);
          values.push(...filter.value);
          paramIndex += filter.value.length;
        }
        break;
    }
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    values,
  };
}

export function buildOrderClause(
  order: { column: string; direction: 'asc' | 'desc' } | undefined
): string {
  if (!order) return '';

  // Validate column name
  validator(order.column, 'column');

  return `ORDER BY "${order.column}" ${order.direction.toUpperCase()}`;
}

export function buildSelectColumns(select: string[] | '*', allowedColumns: string[]): string {
  if (select === '*') {
    return '*';
  }

  // Validate and quote column names
  for (const col of select) {
    if (allowedColumns.includes(col)) {
      validator(col, 'column');
    }
  }

  const validColumns = select.filter((col) => allowedColumns.includes(col));
  if (validColumns.length === 0) {
    return '*';
  }

  return validColumns.map((col) => `"${col}"`).join(', ');
}
```

**Step 4: Run test to verify it passes**

Run: `cd gateway && npm test -- sql-builder.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add gateway/src/lib/sql-builder.ts gateway/src/lib/sql-builder.test.ts
git commit -m "feat(security): add SQL identifier validation to query builder"
```

---

## Task 7: Update Auth Routes with Rate Limiting and Password Validation

**Files:**
- Modify: `gateway/src/routes/auth.ts`

**Step 1: Add imports and rate limiter**

Add to top of `gateway/src/routes/auth.ts`:

```typescript
import { getAuthRateLimiter } from '../middleware/auth-rate-limit.js';
import { validatePassword } from '../utils/password-validator.js';
```

**Step 2: Update login route**

Replace the login handler:

```typescript
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
```

**Step 3: Update register route**

Replace the register handler:

```typescript
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
```

**Step 4: Update setup route**

Replace the setup handler:

```typescript
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
```

**Step 5: Add import for TooManyRequestsError**

Add to imports:

```typescript
import { BadRequestError, TooManyRequestsError } from '../lib/errors.js';
```

**Step 6: Run tests**

Run: `cd gateway && npm test`
Expected: PASS

**Step 7: Commit**

```bash
git add gateway/src/routes/auth.ts
git commit -m "feat(security): add rate limiting and password validation to auth routes"
```

---

## Task 8: Update Error Handler with Sanitization

**Files:**
- Modify: `gateway/src/lib/errors.ts`

**Step 1: Add error sanitization**

Modify `gateway/src/lib/errors.ts`:

```typescript
import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { config } from '../config/env.js';

// Patterns that indicate sensitive information in error messages
const SENSITIVE_PATTERNS = [
  /sql/i,
  /relation/i,
  /column/i,
  /table/i,
  /database/i,
  /syntax error/i,
  /constraint/i,
  /foreign key/i,
  /primary key/i,
  /unique/i,
  /duplicate/i,
  /insert into/i,
  /select.*from/i,
  /update.*set/i,
  /delete.*from/i,
  /connection/i,
  /timeout/i,
  /pool/i,
  /stack/i,
  /at\s+\w+\.\w+/i, // Stack trace patterns
  /at\s+Object\./i,
  /at\s+Module\./i,
  /\.\w+:\d+:\d+/, // File:line:column
];

function sanitizeErrorMessage(message: string, isProduction: boolean): string {
  if (!isProduction) {
    return message; // Don't sanitize in development
  }

  for (const pattern of SENSITIVE_PATTERNS) {
    if (pattern.test(message)) {
      return 'Invalid request parameters';
    }
  }

  // Truncate very long messages in production
  if (message.length > 200) {
    return message.substring(0, 200) + '...';
  }

  return message;
}

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public error: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = 'AppError';
  }

  toJSON() {
    const result: Record<string, unknown> = {
      error: this.error,
      message: sanitizeErrorMessage(this.message, config.isProduction),
      statusCode: this.statusCode,
    };
    // Only include details in development
    if (this.details && !config.isProduction) {
      result.details = this.details;
    }
    return result;
  }
}

// ... rest of error classes remain the same ...

export function errorHandler(
  error: FastifyError | AppError | ZodError,
  request: FastifyRequest,
  reply: FastifyReply
) {
  // Log full error internally (never expose to client)
  request.log.error({
    error: {
      message: error.message,
      stack: 'stack' in error ? error.stack : undefined,
      statusCode: 'statusCode' in error ? error.statusCode : undefined,
    },
    requestId: request.id,
    path: request.url,
    method: request.method,
  });

  // Handle Zod validation errors
  if (error instanceof ZodError) {
    return reply.status(400).send({
      error: 'VALIDATION_ERROR',
      message: 'Invalid request data',
      statusCode: 400,
      // Only include details in development
      ...(config.isProduction ? {} : { details: error.flatten().fieldErrors }),
    });
  }

  // Handle our custom errors
  if (error instanceof AppError) {
    return reply.status(error.statusCode).send(error.toJSON());
  }

  // Handle Fastify errors (rate limit, etc.)
  if ('statusCode' in error && typeof error.statusCode === 'number') {
    const sanitizedMessage = sanitizeErrorMessage(error.message, config.isProduction);
    return reply.status(error.statusCode).send({
      error: error.code || 'ERROR',
      message: sanitizedMessage,
      statusCode: error.statusCode,
    });
  }

  // Unknown errors - always return generic message in production
  return reply.status(500).send({
    error: 'INTERNAL_ERROR',
    message: config.isProduction ? 'An unexpected error occurred' : error.message,
    statusCode: 500,
  });
}
```

**Step 2: Run tests**

Run: `cd gateway && npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add gateway/src/lib/errors.ts
git commit -m "feat(security): add error message sanitization for production"
```

---

## Task 9: Update App with Security Middleware

**Files:**
- Modify: `gateway/src/app.ts`

**Step 1: Add imports**

Add to imports in `gateway/src/app.ts`:

```typescript
import { registerSecurityHeaders } from './middleware/security-headers.js';
import { setValidator } from './lib/sql-builder.js';
import { validateIdentifier } from './utils/identifier-validator.js';
```

**Step 2: Register security headers and set SQL validator**

Add after the helmet registration:

```typescript
// Security headers (CSP, X-Frame-Options, etc.)
await registerSecurityHeaders(app);

// Set SQL identifier validator
setValidator(validateIdentifier);
```

**Step 3: Update rate limiting with admin floor**

Replace the rate limit configuration:

```typescript
// Rate limiting with dynamic max value and admin bypass
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
      if (devToken === config.security.devAdminToken) {
        return Math.max(config.security.adminRateLimitFloor, runtimeSettings.getRateLimitMax());
      }
    }
    return runtimeSettings.getRateLimitMax();
  },
  timeWindow: config.rateLimitWindowMs,
  keyGenerator: (request) => {
    const projectId = (request as unknown as { projectContext?: { projectId: string } })
      .projectContext?.projectId;
    return projectId || request.ip;
  },
  // Remove the allowList - we handle admin in max() now
});
```

**Step 4: Update helmet configuration**

Change the helmet registration:

```typescript
// Security headers via Helmet (CSP handled by our middleware)
await app.register(helmet, {
  contentSecurityPolicy: false, // We handle CSP in our middleware
  hsts: {
    maxAge: 31536000,
    includeSubdomains: true,
    preload: true,
  },
});
```

**Step 5: Run tests**

Run: `cd gateway && npm test`
Expected: PASS

**Step 6: Commit**

```bash
git add gateway/src/app.ts
git commit -m "feat(security): integrate security middleware into app"
```

---

## Task 10: Fix Dashboard Dev Token (Server-Side Only)

**Files:**
- Modify: `dashboard/lib/api.ts`
- Create: `dashboard/lib/server-api.ts`

**Step 1: Create server-side API helper**

Create `dashboard/lib/server-api.ts`:

```typescript
const GATEWAY_URL = process.env.GATEWAY_INTERNAL_URL || 'http://gateway:3001';

interface ServerFetchOptions extends RequestInit {
  requireAuth?: boolean;
}

/**
 * Server-side API helper for Next.js Server Components and API routes.
 * Uses DEV_ADMIN_TOKEN (not exposed to client) for development convenience.
 */
export async function serverFetch<T>(path: string, options: ServerFetchOptions = {}): Promise<T> {
  const headers: HeadersInit = {
    ...options.headers,
  };

  if (options.body && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // Add dev admin token ONLY on server side (never exposed to browser)
  // This token is NOT prefixed with NEXT_PUBLIC_ so it's only available in Node.js
  const devToken = process.env.DEV_ADMIN_TOKEN;
  if (devToken) {
    headers['x-dev-admin-token'] = devToken;
  }

  const response = await fetch(`${GATEWAY_URL}${path}`, {
    ...options,
    headers,
    // Note: credentials: 'include' doesn't work server-side
    // Server-side requests use the dev token for auth
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

// Export typed API methods for server components
export const serverApi = {
  async getProject(id: string) {
    return serverFetch<{ data: { id: string; name: string; description: string | null } }>(
      `/admin/projects/${id}`
    );
  },

  async listProjects() {
    return serverFetch<{ data: Array<{ id: string; name: string }> }>('/admin/projects');
  },

  // Add other methods as needed for server components
};
```

**Step 2: Update client-side API to remove dev token**

Modify `dashboard/lib/api.ts` - remove the dev token handling:

```typescript
const GATEWAY_URL =
  typeof window !== 'undefined'
    ? process.env.NEXT_PUBLIC_GATEWAY_URL || 'http://localhost:3001'
    : process.env.GATEWAY_INTERNAL_URL || 'http://gateway:3001';

async function fetchApi<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers: HeadersInit = {
    ...options.headers,
  };

  // Only set Content-Type for requests with a body
  if (options.body) {
    (headers as Record<string, string>)['Content-Type'] = 'application/json';
  }

  // DEV ADMIN TOKEN REMOVED FROM CLIENT-SIDE
  // Use server-api.ts for server-side operations with dev token
  // Client-side relies on cookie-based authentication only

  const response = await fetch(`${GATEWAY_URL}${path}`, {
    ...options,
    headers,
    credentials: 'include', // Send cookies for auth
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Request failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }

  // Handle 204 No Content responses
  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}
```

**Step 3: Update exportTable to not use dev token**

Modify the `exportTable` method in `dashboard/lib/api.ts`:

```typescript
async exportTable(
  projectId: string,
  tableName: string,
  format: 'csv' | 'json',
  options?: { limit?: number; columns?: string[] }
): Promise<string> {
  const response = await fetch(`${GATEWAY_URL}/admin/projects/${projectId}/data-tools/export`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      // DEV TOKEN REMOVED - relies on cookie auth
    },
    credentials: 'include',
    body: JSON.stringify({ tableName, format, ...options }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ message: 'Export failed' }));
    throw new Error(error.message || `HTTP ${response.status}`);
  }
  return response.text();
},
```

**Step 4: Update environment documentation**

Add to `.env.example`:

```env
# Dev Admin Token (SERVER-SIDE ONLY - do NOT use NEXT_PUBLIC_ prefix)
# Only used in development for server-side API calls
DEV_ADMIN_TOKEN=your-secure-dev-token-here
```

**Step 5: Run build to verify**

Run: `cd dashboard && npm run build`
Expected: SUCCESS

**Step 6: Commit**

```bash
git add dashboard/lib/api.ts dashboard/lib/server-api.ts .env.example
git commit -m "fix(security): move dev admin token to server-side only"
```

---

## Task 11: Update Environment Example and Documentation

**Files:**
- Modify: `.env.example`
- Modify: `docs/USAGE.md` (if exists)

**Step 1: Update .env.example**

Ensure `.env.example` has all new security variables:

```env
# ===========================================
# AtlasHub Environment Configuration
# ===========================================

# Server
NODE_ENV=development
PORT=3001
HOST=0.0.0.0
LOG_LEVEL=info

# CORS - REQUIRED in production (comma-separated origins)
# Development allows '*', production MUST specify origins
CORS_ORIGINS=*

# Cookie domain (for cross-subdomain auth, e.g., '.example.com')
COOKIE_DOMAIN=

# Rate limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW_MS=60000

# Auth rate limiting (brute-force protection)
AUTH_RATE_LIMIT_MAX=5
AUTH_RATE_LIMIT_WINDOW_MS=300000

# Admin rate limit floor (minimum requests for admins)
ADMIN_RATE_LIMIT_FLOOR=1000

# Body limits
BODY_LIMIT_BYTES=2097152

# Postgres - Platform DB
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=platform
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your-secure-password
POSTGRES_MAX_POOL_SIZE=5
POSTGRES_IDLE_TIMEOUT_MS=30000
POSTGRES_CONNECTION_TIMEOUT_MS=5000

# MinIO
MINIO_ENDPOINT=localhost
MINIO_PORT=9000
MINIO_USE_SSL=false
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_REGION=us-east-1

# Security - MUST be 32+ characters
PLATFORM_MASTER_KEY=your-32-character-platform-master-key
JWT_SECRET=your-32-character-jwt-secret-key
SESSION_EXPIRY_HOURS=24

# Dev Admin Token (SERVER-SIDE ONLY - never expose to browser)
# Remove NEXT_PUBLIC_ prefix - this should NOT be accessible in browser
DEV_ADMIN_TOKEN=your-secure-dev-token

# CSP Reporting (optional)
CSP_REPORT_URI=

# Initial admin setup (first run only)
ADMIN_EMAIL=
ADMIN_PASSWORD=

# Cloudflare Access (optional)
CF_ACCESS_TEAM_DOMAIN=
CF_ACCESS_AUDIENCE=

# Query limits
STATEMENT_TIMEOUT_MS=5000
MAX_ROWS_PER_QUERY=1000
DEFAULT_ROWS_LIMIT=100

# Storage
PRESIGNED_URL_EXPIRY_SECONDS=3600
MAX_UPLOAD_SIZE_BYTES=104857600
```

**Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: update .env.example with security configuration"
```

---

## Task 12: Run Full Test Suite and Final Verification

**Step 1: Run all gateway tests**

Run: `cd gateway && npm test`
Expected: All tests PASS

**Step 2: Run all dashboard tests (if any)**

Run: `cd dashboard && npm test`
Expected: All tests PASS (or no tests)

**Step 3: Build dashboard**

Run: `cd dashboard && npm run build`
Expected: SUCCESS

**Step 4: Build gateway**

Run: `cd gateway && npm run build`
Expected: SUCCESS

**Step 5: Manual verification - Start services**

Run: `docker-compose up -d` (or local dev setup)
Verify: App starts without errors

**Step 6: Manual verification - Test CORS rejection**

Run with production env:
```bash
NODE_ENV=production CORS_ORIGINS=* npm run start
```
Expected: App fails to start with CORS error message

**Step 7: Manual verification - Test CSP headers**

Run: `curl -I http://localhost:3001/health`
Expected: Response includes `Content-Security-Policy` header

**Step 8: Final commit**

```bash
git add -A
git commit -m "chore: verify security hardening implementation"
```

---

## Summary

This plan implements comprehensive security hardening for AtlasHub:

1. **SQL Injection Prevention** - Identifier validation in query builder
2. **Password Security** - Strong password requirements (12+ chars, mixed case, numbers, special)
3. **Security Headers** - CSP, X-Frame-Options, Referrer-Policy, Permissions-Policy
4. **CORS Hardening** - Production blocks wildcard origins
5. **Auth Rate Limiting** - Brute-force protection on login/register
6. **Admin Rate Limit Floor** - Even admins have limits
7. **Error Sanitization** - No sensitive info in production errors
8. **Dev Token Security** - Moved to server-side only

All changes maintain backwards compatibility with existing API contracts and database schema.
