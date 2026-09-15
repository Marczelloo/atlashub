import { createHash, timingSafeEqual } from 'node:crypto';

/** Values shipped in examples and docs. A token equal to one of them is public knowledge. */
const PLACEHOLDER_TOKENS = new Set(['your-secure-dev-token', 'dev-token', 'changeme', 'change-me']);

export const MIN_DEV_ADMIN_TOKEN_LENGTH = 32;

export interface DevAdminTokenSettings {
  isDev: boolean;
  token: string | undefined;
}

/**
 * Why the dev admin bypass is off, or null when it is usable.
 * The bypass grants full admin rights, including the SQL editor, so it only
 * works in development and only with a long, non-example token.
 */
export function devAdminTokenProblem(settings: DevAdminTokenSettings): string | null {
  if (!settings.token) return 'not set';
  if (!settings.isDev) return 'NODE_ENV is not development';
  if (PLACEHOLDER_TOKENS.has(settings.token.toLowerCase())) return 'token is an example value';
  if (settings.token.length < MIN_DEV_ADMIN_TOKEN_LENGTH) {
    return `token is shorter than ${MIN_DEV_ADMIN_TOKEN_LENGTH} characters`;
  }
  return null;
}

/** Constant-time check of a request header against the configured dev admin token. */
export function isValidDevAdminToken(header: unknown, settings: DevAdminTokenSettings): boolean {
  if (typeof header !== 'string' || devAdminTokenProblem(settings) !== null) return false;
  const expected = createHash('sha256').update(settings.token as string).digest();
  const actual = createHash('sha256').update(header).digest();
  return timingSafeEqual(expected, actual);
}
