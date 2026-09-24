/**
 * Client-side validation helpers. The server validates too — these just give
 * faster, friendlier feedback. Each returns an error string or '' if valid.
 */

// Deliberately simple: something@something.tld. The server does strict checks.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const MIN_PASSWORD_LENGTH = 8;

export function validateEmail(value) {
  const v = value.trim();
  if (!v) return 'Enter your email address';
  if (!EMAIL_RE.test(v)) return 'Enter a valid email, like name@example.com';
  return '';
}

export function validatePassword(value, { checkLength = true } = {}) {
  if (!value) return 'Enter your password';
  if (checkLength && value.length < MIN_PASSWORD_LENGTH) {
    return `Password must be at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (value.length > 128) return 'Password must be 128 characters or fewer';
  return '';
}

export function validateName(value) {
  const v = value.trim();
  if (!v) return 'Enter your name';
  if (v.length > 100) return 'Name must be 100 characters or fewer';
  return '';
}

/**
 * Rough password strength, 0–4. Rewards length and character variety.
 * Returns { score, label }.
 */
export function passwordStrength(pw) {
  if (!pw) return { score: 0, label: '' };
  if (pw.length < MIN_PASSWORD_LENGTH) return { score: 0, label: 'Too short' };

  let variety = 0;
  if (/[a-z]/.test(pw)) variety++;
  if (/[A-Z]/.test(pw)) variety++;
  if (/\d/.test(pw)) variety++;
  if (/[^A-Za-z0-9]/.test(pw)) variety++;

  let score = 1;
  if (pw.length >= 12) score++;
  if (variety >= 3) score++;
  if (pw.length >= 16 || (pw.length >= 12 && variety === 4)) score++;
  // Very repetitive passwords ("aaaaaaaa") stay weak.
  if (new Set(pw).size <= 3) score = 1;

  score = Math.min(score, 4);
  const labels = ['Too short', 'Weak', 'Fair', 'Good', 'Strong'];
  return { score, label: labels[score] };
}
