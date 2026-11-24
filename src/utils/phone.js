const config = require('../config');

const LOCAL_NUMBER_LENGTH = 10;

/**
 * Converts any accepted phone format into one canonical E.164 string (`+<code><number>`),
 * so "98250 11223", "09825011223", "919825011223" and "+91 98250-11223" are the same account.
 *
 * Returns `null` when the input cannot be a phone number; callers decide how to report that.
 */
const normalizePhone = (value) => {
  if (value === null || value === undefined) return null;
  let digits = String(value).trim().replace(/[\s().-]/g, '');
  if (!digits) return null;

  const code = config.defaultCallingCode;
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;

  if (digits.startsWith('+')) {
    return /^\+[0-9]{10,15}$/.test(digits) ? digits : null;
  }
  if (!/^[0-9]+$/.test(digits)) return null;

  if (digits.length === LOCAL_NUMBER_LENGTH) return `+${code}${digits}`;
  if (digits.length === LOCAL_NUMBER_LENGTH + 1 && digits.startsWith('0')) return `+${code}${digits.slice(1)}`;
  if (digits.length === LOCAL_NUMBER_LENGTH + code.length && digits.startsWith(code)) return `+${digits}`;
  return digits.length >= 10 && digits.length <= 15 ? `+${digits}` : null;
};

module.exports = { normalizePhone };
