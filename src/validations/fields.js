const Joi = require('joi');
const { PHONE_MIN_DIGITS, PHONE_MAX_DIGITS } = require('../utils/phone');

// Field rules shared by more than one validation file.
//
// ⚠️ Joi's default pattern message quotes the rejected value ('"code" with value "12345a" fails
// to match...'), and that message reaches both the response and the warning log. Every pattern
// here therefore carries its own message. Keep it that way for anything that can hold a code.

// Normalised to digits by stripping spaces, '+', '-' and brackets (the contract's rule); anything
// else left over, such as a letter, is rejected rather than silently dropped.
const phone = Joi.string()
  .trim()
  .replace(/[\s()+-]/g, '')
  .pattern(new RegExp(`^\\d{${PHONE_MIN_DIGITS},${PHONE_MAX_DIGITS}}$`))
  .messages({
    'string.pattern.base': `{{#label}} must contain ${PHONE_MIN_DIGITS} to ${PHONE_MAX_DIGITS} digits.`,
  });

// A one-time code or a vendor auth code: exactly six digits, as a string. Spaces and hyphens a
// person may type or paste are removed first.
const sixDigitCode = Joi.string()
  .trim()
  .replace(/[\s-]/g, '')
  .pattern(/^\d{6}$/)
  .messages({
    'string.pattern.base': '{{#label}} must be exactly 6 digits.',
  });

module.exports = {
  phone,
  sixDigitCode,
};
