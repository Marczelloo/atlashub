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
