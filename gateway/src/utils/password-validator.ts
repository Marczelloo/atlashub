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

  if (password.length < MIN_LENGTH) {
    errors.push(`Password must be at least ${MIN_LENGTH} characters long`);
  }

  if (!/[A-Z]/.test(password)) {
    errors.push('Password must contain at least one uppercase letter');
  }

  if (!/[a-z]/.test(password)) {
    errors.push('Password must contain at least one lowercase letter');
  }

  if (!/[0-9]/.test(password)) {
    errors.push('Password must contain at least one number');
  }

  if (!/[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>\/?]/.test(password)) {
    errors.push('Password must contain at least one special character');
  }

  const lowerPassword = password.toLowerCase();
  for (const pattern of BLOCKED_PATTERNS) {
    if (lowerPassword.includes(pattern)) {
      errors.push('Password contains a blocked pattern (common password or platform name)');
      break;
    }
  }

  const strength = calculateStrength(password, errors.length);

  return { valid: errors.length === 0, errors, strength };
}

function calculateStrength(_password: string, errorCount: number): PasswordStrength {
  if (errorCount > 2) return 'weak';
  if (errorCount > 0) return 'medium';
  // Valid passwords with no errors - consider them strong if they meet minimum requirements
  return 'strong';
}
