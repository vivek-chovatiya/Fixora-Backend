/**
 * Phone numbers, normalised one way everywhere.
 *
 * Phone is the identifier for both mobile roles (both sign in by one-time code), so
 * '+91 98765-43210', '919876543210' and '(919) 876 543 210' must be one number. The contract fixes
 * the rule: digits only after stripping spaces, '+', '-' and brackets; 7 to 15 digits. Accounts
 * store and compare the normalised value, and uniqueness is per role on that value.
 *
 * ⚠️ A full number never goes into a log line. Logs use `maskPhoneForLog` ("••••3210"); responses
 * use `maskPhone` ("••••••3210"), which is what the app shows on its verification step.
 */

const PHONE_MIN_DIGITS = 7;
const PHONE_MAX_DIGITS = 15;

/** Digits only. Non-strings pass through untouched so Mongoose casting can still reject them. */
const normalisePhone = (value) => (typeof value === 'string' ? value.replace(/\D/g, '') : value);

/** Every digit but the last four replaced, e.g. "••••••3210" for a ten-digit number. */
const maskPhone = (phone) => {
  const digits = normalisePhone(String(phone || ''));
  if (digits.length <= 4) return digits;
  return `${'•'.repeat(digits.length - 4)}${digits.slice(-4)}`;
};

/** A fixed-width mask for logs, so a log line does not even reveal the number's length. */
const maskPhoneForLog = (phone) => `••••${normalisePhone(String(phone || '')).slice(-4)}`;

module.exports = {
  PHONE_MIN_DIGITS,
  PHONE_MAX_DIGITS,
  normalisePhone,
  maskPhone,
  maskPhoneForLog,
};
