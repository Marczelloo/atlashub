# Security Hardening Design

**Date:** 2026-03-02
**Status:** Approved
**Approach:** Layered Security with Environment Awareness

## Executive Summary

Comprehensive security hardening for AtlasHub covering all identified vulnerabilities from the security audit. The approach implements production-grade security while maintaining developer experience through environment-aware configuration.

## Architecture Overview

### Security Middleware Stack

```
Request → Security Headers → CORS → Rate Limit (Auth) → Auth → Route Handler
                ↓
         CSP / X-Frame-Options / etc.
```

### Files to Create/Modify

| File | Action | Purpose |
|------|--------|---------|
| `gateway/src/middleware/security-headers.ts` | Create | CSP, X-Frame-Options, etc. |
| `gateway/src/middleware/auth-rate-limit.ts` | Create | Brute-force protection for auth |
| `gateway/src/utils/identifier-validator.ts` | Create | SQL identifier whitelist |
| `gateway/src/utils/password-validator.ts` | Create | Password complexity |
| `gateway/src/config/env.ts` | Modify | New security config options |
| `gateway/src/app.ts` | Modify | Register new middleware |
| `gateway/src/routes/auth.ts` | Modify | Apply auth rate limit |
| `gateway/src/lib/sql-builder.ts` | Modify | Identifier validation |
| `dashboard/lib/api.ts` | Modify | Remove client-side dev token |
| `dashboard/lib/server-api.ts` | Create | Server-side fetch wrapper |

### New Environment Variables

```env
CORS_ORIGINS              - Required in production (comma-separated)
CSP_REPORT_URI            - Optional: CSP violation reporting
AUTH_RATE_LIMIT_MAX       - Max auth attempts (default: 5)
AUTH_RATE_LIMIT_WINDOW_MS - Window for auth attempts (default: 300000)
ADMIN_RATE_LIMIT_FLOOR    - Minimum rate limit for admins (default: 1000)
```

## Security Components

### 1. Security Headers & CSP

**File:** `gateway/src/middleware/security-headers.ts`

**CSP Directives:**

Production:
- `default-src: 'self'`
- `script-src: 'self'`
- `style-src: 'self' 'unsafe-inline'` (Next.js requires)
- `img-src: 'self' data: blob:`
- `frame-ancestors: 'none'`
- `form-action: 'self'`
- `base-uri: 'self'`

Development (relaxed):
- `default-src: 'self' 'unsafe-inline' 'unsafe-eval'`
- `connect-src: 'self' http://localhost:* ws://localhost:*`

**Additional Headers:**
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: strict-origin-when-cross-origin`
- `Permissions-Policy: accelerometer=(), camera=(), geolocation=(), microphone=()`

### 2. CORS Configuration

**Changes to:** `gateway/src/config/env.ts`, `gateway/src/app.ts`

- Development: Wildcard (`*`) allowed
- Production: Must specify explicit origins
- App fails to start in production if `CORS_ORIGINS=*`

### 3. Dev Token Security

**Current (insecure):**
```typescript
// dashboard/lib/api.ts - runs in browser
const devToken = process.env.NEXT_PUBLIC_DEV_ADMIN_TOKEN;
```

**New (secure):**
- Remove `NEXT_PUBLIC_DEV_ADMIN_TOKEN` from client-side code
- Create `dashboard/lib/server-api.ts` for server-side operations
- Server-side API routes use `DEV_ADMIN_TOKEN` (no NEXT_PUBLIC_)
- Client components rely on cookie-based auth only

### 4. Auth Rate Limiting

**File:** `gateway/src/middleware/auth-rate-limit.ts`

**Configuration:**
- `AUTH_RATE_LIMIT_MAX`: 5 (default) - failed attempts
- `AUTH_RATE_LIMIT_WINDOW_MS`: 300000 (5 minutes)

**Behavior:**
- Key: `${ip}:${email.toLowerCase()}`
- Applies to: `/auth/login`, `/auth/register`, `/auth/setup`
- Resets on successful login
- Logs suspicious patterns

### 5. SQL Identifier Validation

**File:** `gateway/src/utils/identifier-validator.ts`

**Rules:**
- Max length: 63 characters (PostgreSQL limit)
- Format: `[a-zA-Z_][a-zA-Z0-9_]*`
- Reserved words blocked (SELECT, INSERT, DROP, etc.)

**Applied in:** `gateway/src/lib/sql-builder.ts`

### 6. Admin Rate Limit Floor

**Changes to:** `gateway/src/app.ts`

- Current: Admins get unlimited (max: 0)
- New: Admins get elevated but limited (floor: 1000 req/min)
- `ADMIN_RATE_LIMIT_FLOOR` configurable via env

### 7. Error Sanitization

**Changes to:** `gateway/src/lib/errors.ts`

- Production: Sanitize all error messages
- Remove SQL fragments, stack traces, internal details
- Log full error server-side, send sanitized to client

### 8. Password Validation

**File:** `gateway/src/utils/password-validator.ts`

**Requirements:**
- Minimum 12 characters
- Uppercase letter required
- Lowercase letter required
- Number required
- Special character required
- Blocked patterns: common passwords, sequences

**Applied in:** `gateway/src/routes/auth.ts` (register, setup, password change)

## Issues Addressed

| # | Issue | Severity | Fix Location |
|---|-------|----------|--------------|
| 1 | CSP disabled | Critical | `middleware/security-headers.ts` |
| 2 | CORS wildcard | Critical | `config/env.ts`, `app.ts` |
| 3 | Dev token in browser | Critical | `dashboard/lib/api.ts`, `server-api.ts` |
| 4 | No auth rate limit | High | `middleware/auth-rate-limit.ts` |
| 5 | SQL identifier validation | High | `utils/identifier-validator.ts` |
| 6 | Admin rate limit bypass | Medium | `app.ts` |
| 7 | Verbose errors | Medium | `lib/errors.ts` |
| 8 | Password complexity | Medium | `utils/password-validator.ts` |
| 9 | Security headers | Low | `middleware/security-headers.ts` |

## Implementation Order

1. Security headers & CSP (foundation)
2. CORS configuration (blocks wildcard in production)
3. Dev token fix (removes client exposure)
4. Auth rate limiting (brute-force protection)
5. SQL identifier validation (injection prevention)
6. Admin rate limit floor (abuse prevention)
7. Error sanitization (info disclosure prevention)
8. Password validation (weak password prevention)

## Breaking Changes

None for:
- Existing API contracts
- Database schema
- Client-side code behavior (except dev token removal in browser)

## Testing Strategy

- Unit tests for validators (identifier, password)
- Integration tests for auth rate limiting
- Manual testing for CSP (check console for violations)
- Error sanitization verification in production mode
