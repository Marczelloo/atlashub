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

const RESERVED_WORDS = new Set([
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
    throw new InvalidIdentifierError(`Invalid ${type} name: name is too long (max ${MAX_IDENTIFIER_LENGTH} characters)`);
  }

  if (!VALID_IDENTIFIER_REGEX.test(name)) {
    throw new InvalidIdentifierError(`Invalid ${type} name: contains invalid characters`);
  }

  if (RESERVED_WORDS.has(name.toLowerCase())) {
    throw new InvalidIdentifierError(`Invalid ${type} name: "${name}" is a reserved SQL keyword`);
  }
}

export function isValidIdentifier(name: string): boolean {
  if (name.length > MAX_IDENTIFIER_LENGTH) return false;
  if (!VALID_IDENTIFIER_REGEX.test(name)) return false;
  if (RESERVED_WORDS.has(name.toLowerCase())) return false;
  return true;
}
