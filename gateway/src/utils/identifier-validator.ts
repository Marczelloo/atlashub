// gateway/src/utils/identifier-validator.ts

/**
 * Custom error for invalid SQL identifiers.
 * This is a standalone class to avoid importing from lib/errors.js which triggers env validation.
 */
export class InvalidIdentifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidIdentifierError';
  }
}

const MAX_IDENTIFIER_LENGTH = 63; // PostgreSQL limit
const VALID_IDENTIFIER_REGEX = /^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/;

// Note: We don't block reserved words because we always quote identifiers in SQL.
// PostgreSQL allows reserved words as identifiers when properly quoted (e.g., "key", "order").
// Only truly dangerous patterns should be blocked.
const DANGEROUS_PATTERNS = new Set([
  // These could cause issues even when quoted or are commonly used in SQL injection
  'pg_catalog', 'information_schema', 'pg_toast', 'pg_temp',
]);

export function validateIdentifier(name: string, type: 'table' | 'column'): void {
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new InvalidIdentifierError(`Invalid ${type} name: name is too long (max ${MAX_IDENTIFIER_LENGTH} characters)`);
  }

  if (!VALID_IDENTIFIER_REGEX.test(name)) {
    throw new InvalidIdentifierError(`Invalid ${type} name: contains invalid characters`);
  }

  // Only block dangerous patterns, not general reserved words
  // Reserved words are safe when quoted, which we always do in SQL generation
  if (DANGEROUS_PATTERNS.has(name.toLowerCase())) {
    throw new InvalidIdentifierError(`Invalid ${type} name: "${name}" is not allowed`);
  }
}

export function isValidIdentifier(name: string): boolean {
  if (name.length > MAX_IDENTIFIER_LENGTH) return false;
  if (!VALID_IDENTIFIER_REGEX.test(name)) return false;
  if (DANGEROUS_PATTERNS.has(name.toLowerCase())) return false;
  return true;
}
