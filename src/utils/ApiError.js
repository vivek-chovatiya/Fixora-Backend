const { codeForStatus } = require('./errorCodes');

// `code` is the machine-readable value the app maps to its own copy (see utils/errorCodes.js).
// When a caller does not pass one it is derived from the status, so `new ApiError(404, '...')`
// keeps working unchanged. `message` and `errors` reach the client: never put a one-time code
// or any other secret in either.
class ApiError extends Error {
  constructor(statusCode, message, errors = null, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.success = false;
    this.errors = errors;
    this.code = code || codeForStatus(statusCode);

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
