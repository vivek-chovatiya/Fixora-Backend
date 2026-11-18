/**
 * Machine-readable error codes.
 *
 * Every failure response carries one of these in `code`, beside the English `message`. The mobile
 * app maps `code` to its own copy and never shows `message` raw, so a code is a contract: renaming
 * one breaks the app silently. The auth codes and their HTTP statuses are fixed by the shared
 * phone sign-in contract (owner decision 17/11/2026).
 *
 * Errors the contract does not name get a generic code derived from their HTTP status, so callers
 * that throw `new ApiError(404, '...')` keep working and still produce a code.
 *
 * ⚠️ Add a code here only when a client genuinely needs to tell the case apart. A code is never a
 * place to carry detail — no ids, no values, and never a one-time or vendor auth code.
 */

const ERROR_CODES = Object.freeze({
  // Named by the phone sign-in contract.
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  OTP_INVALID: 'OTP_INVALID',
  OTP_EXPIRED: 'OTP_EXPIRED',
  OTP_TOO_MANY_ATTEMPTS: 'OTP_TOO_MANY_ATTEMPTS',
  OTP_RESEND_TOO_SOON: 'OTP_RESEND_TOO_SOON',
  REGISTRATION_NOT_FOUND: 'REGISTRATION_NOT_FOUND',
  PHONE_ALREADY_REGISTERED: 'PHONE_ALREADY_REGISTERED',
  AUTH_CODE_INVALID: 'AUTH_CODE_INVALID',
  SIGNIN_TOO_MANY_ATTEMPTS: 'SIGNIN_TOO_MANY_ATTEMPTS',
  ACCOUNT_SUSPENDED: 'ACCOUNT_SUSPENDED',
  UNAUTHORIZED: 'UNAUTHORIZED',

  // Named by the requests contract (lead, 17/11/2026).
  REQUEST_NOT_FOUND: 'REQUEST_NOT_FOUND',
  REQUEST_ALREADY_TAKEN: 'REQUEST_ALREADY_TAKEN',
  REQUEST_NOT_PENDING: 'REQUEST_NOT_PENDING',
  INVALID_TRANSITION: 'INVALID_TRANSITION',
  REQUEST_NOT_CANCELLABLE: 'REQUEST_NOT_CANCELLABLE',

  // Requests contract §8 (review fixes, lead 17/11/2026).
  RATE_LIMITED: 'RATE_LIMITED',
  REVIEW_NOT_FOUND: 'REVIEW_NOT_FOUND',

  // Generic, by HTTP status, for everything the contract does not name.
  BAD_REQUEST: 'BAD_REQUEST',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  PAYLOAD_TOO_LARGE: 'PAYLOAD_TOO_LARGE',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
});

const CODE_BY_STATUS = Object.freeze({
  400: ERROR_CODES.BAD_REQUEST,
  401: ERROR_CODES.UNAUTHORIZED,
  403: ERROR_CODES.FORBIDDEN,
  404: ERROR_CODES.NOT_FOUND,
  409: ERROR_CODES.CONFLICT,
  413: ERROR_CODES.PAYLOAD_TOO_LARGE,
  429: ERROR_CODES.TOO_MANY_REQUESTS,
});

const codeForStatus = (statusCode) => {
  if (CODE_BY_STATUS[statusCode]) return CODE_BY_STATUS[statusCode];
  return statusCode >= 500 ? ERROR_CODES.INTERNAL_ERROR : ERROR_CODES.BAD_REQUEST;
};

module.exports = {
  ERROR_CODES,
  codeForStatus,
};
