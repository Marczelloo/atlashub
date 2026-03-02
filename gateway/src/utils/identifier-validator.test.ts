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
      expect(() => validateIdentifier('select', 'table')).toThrow('reserved SQL keyword');
      expect(() => validateIdentifier('DROP', 'table')).toThrow('reserved SQL keyword');
      expect(() => validateIdentifier('Insert', 'table')).toThrow('reserved SQL keyword');
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
