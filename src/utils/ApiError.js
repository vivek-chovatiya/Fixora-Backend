const { ERROR_CODE } = require('../constants');

const DEFAULT_CODE_BY_STATUS = {
  400: ERROR_CODE.VALIDATION_FAILED,
  401: ERROR_CODE.AUTH_REQUIRED,
  403: ERROR_CODE.PERMISSION_DENIED,
  404: ERROR_CODE.RESOURCE_NOT_FOUND,
  409: ERROR_CODE.DUPLICATE_RECORD,
  422: ERROR_CODE.VALIDATION_FAILED,
  429: ERROR_CODE.RATE_LIMITED,
};

class ApiError extends Error {
  /**
   * @param {number} statusCode HTTP status
   * @param {string} message Human readable, safe-to-display message
   * @param {Array|null} errors Field level errors: [{ field, message }]
   * @param {string} [code] Machine readable ERROR_CODE
   */
  constructor(statusCode, message, errors = null, code = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.success = false;
    this.errors = errors;
    this.code = code || DEFAULT_CODE_BY_STATUS[statusCode] || ERROR_CODE.SERVER_ERROR;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
