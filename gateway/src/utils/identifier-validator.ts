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

// Quoting makes these values syntactically safe, but allowing SQL keywords as
// user-controlled table/column names makes the API and SQL editor needlessly
// ambiguous. Keep the public identifier surface conservative.
const RESERVED_SQL_KEYWORDS = new Set([
  'all',
  'alter',
  'and',
  'as',
  'by',
  'create',
  'delete',
  'drop',
  'from',
  'group',
  'insert',
  'into',
  'join',
  'limit',
  'null',
  'offset',
  'or',
  'order',
  'returning',
  'select',
  'set',
  'table',
  'truncate',
  'union',
  'update',
  'user',
  'values',
  'where',
]);

const DANGEROUS_PATTERNS = new Set([
  // These could cause issues even when quoted or are commonly used in SQL injection
  'pg_catalog',
  'information_schema',
  'pg_toast',
  'pg_temp',
]);

export function validateIdentifier(name: string, type: 'table' | 'column'): void {
  if (name.length > MAX_IDENTIFIER_LENGTH) {
    throw new InvalidIdentifierError(
      `Invalid ${type} name: name is too long (max ${MAX_IDENTIFIER_LENGTH} characters)`
    );
  }

  if (!VALID_IDENTIFIER_REGEX.test(name)) {
    throw new InvalidIdentifierError(`Invalid ${type} name: contains invalid characters`);
  }

  if (RESERVED_SQL_KEYWORDS.has(name.toLowerCase())) {
    throw new InvalidIdentifierError(`Invalid ${type} name: reserved SQL keyword`);
  }

  if (DANGEROUS_PATTERNS.has(name.toLowerCase())) {
    throw new InvalidIdentifierError(`Invalid ${type} name: "${name}" is not allowed`);
  }
}

export function isValidIdentifier(name: string): boolean {
  if (name.length > MAX_IDENTIFIER_LENGTH) return false;
  if (!VALID_IDENTIFIER_REGEX.test(name)) return false;
  if (RESERVED_SQL_KEYWORDS.has(name.toLowerCase())) return false;
  if (DANGEROUS_PATTERNS.has(name.toLowerCase())) return false;
  return true;
}
