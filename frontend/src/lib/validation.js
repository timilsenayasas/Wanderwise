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

/**
 * Validate the New Trip form.
 * Returns an object containing an error message for each invalid field.
 */
export function validateTrip(values) {
  const errors = {};

  if (!values.origin || !values.origin.trim()) {
    errors.origin = 'Enter your starting location';
  }

  if (!values.destination || !values.destination.trim()) {
    errors.destination = 'Enter your destination';
  }

  if (!values.startDate) {
    errors.startDate = 'Choose a start date';
  }

  if (!values.endDate) {
    errors.endDate = 'Choose an end date';
  }

  if (
    values.startDate &&
    values.endDate &&
    values.endDate < values.startDate
  ) {
    errors.endDate = 'End date must be on or after the start date';
  }

  const travelers = Number(values.travelers);

  if (!values.travelers || !Number.isInteger(travelers) || travelers < 1) {
    errors.travelers = 'Enter at least 1 traveler';
  }

  if (values.budget === '' || values.budget == null) {
    errors.budget = 'Enter a budget';
  } else if (Number.isNaN(Number(values.budget)) || Number(values.budget) < 0) {
    errors.budget = 'Enter a valid budget';
  }

  if (!values.interests || !values.interests.trim()) {
    errors.interests = 'Enter at least one interest';
  }

  return errors;
}