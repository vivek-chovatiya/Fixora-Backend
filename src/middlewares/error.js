const multer = require('multer');
const logger = require('../utils/logger');
const ApiError = require('../utils/ApiError');
const CoreApiError = require('../core/errors/ApiError');
const { ERROR_CODES, codeForStatus } = require('../utils/errorCodes');

// Every failure leaves here as { success, message, code, errors, data }. Only errors this codebase
// raised on purpose (ApiError, Joi) keep their own message; anything else is an internal fault and
// answers a generic 500 INTERNAL_ERROR whatever NODE_ENV says, because a driver or library message
// can quote the request (a malformed JSON body's parse error quotes the body, codes included).
//
// A malformed id or a model validation failure is the caller's input, not a fault: 400
// VALIDATION_FAILED naming the field (requests contract §8), never the value.
//
// A 5xx this codebase raised on purpose with its own contract code (503 OTP_DELIVERY_FAILED, Phase
// 5 contract §2) is an outage the client is told about, not a fault: it keeps its message and is
// logged as one line, without a stack.
//
// ⚠️ Logs carry field names only. A Joi or Mongoose message can quote the rejected value, and that
// value can be a one-time code. For a 500, the error's name and stack frames are logged without
// its message line, for the same reason.

const invalidInput = (fields) => ({
  statusCode: 400,
  message: 'Validation Failed',
  code: ERROR_CODES.VALIDATION_FAILED,
  errors: fields.map((field) => ({ field, message: `"${field}" is not valid.` })),
});

// Multer's limits on POST /uploads (Phase 4B contract §1) are the caller's input, never a 500.
// Only the field name is named: never the client's file name.
const classifyUpload = (err) => {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return {
      statusCode: 413,
      message: 'An image is larger than 5 MB.',
      code: ERROR_CODES.FILE_TOO_LARGE,
      errors: [{ field: 'files', message: '"files" may each be at most 5 MB.' }],
    };
  }
  if (
    err.code === 'LIMIT_FILE_COUNT' ||
    (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field === 'files')
  ) {
    return {
      statusCode: 400,
      message: 'At most 5 images can be uploaded at once.',
      code: ERROR_CODES.TOO_MANY_FILES,
      errors: [{ field: 'files', message: '"files" may hold at most 5 images.' }],
    };
  }
  return {
    statusCode: 400,
    message: 'Validation Failed',
    code: ERROR_CODES.VALIDATION_FAILED,
    errors: err.field
      ? [{ field: err.field, message: `"${err.field}" is not allowed here.` }]
      : null,
  };
};

const classify = (err) => {
  if (err instanceof multer.MulterError) {
    return classifyUpload(err);
  }
  if (err.isJoi) {
    return {
      statusCode: 400,
      message: 'Validation Failed',
      code: ERROR_CODES.VALIDATION_FAILED,
      errors: err.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message,
      })),
    };
  }
  if (err instanceof ApiError || err instanceof CoreApiError) {
    const statusCode = err.statusCode || 500;
    return {
      statusCode,
      message: err.message,
      code: err.code || codeForStatus(statusCode),
      errors: err.errors || null,
      // e.g. Retry-After on a lockout or rate limit.
      headers: err.headers || null,
    };
  }
  if (err.name === 'CastError') {
    return invalidInput([err.path || 'id']);
  }
  if (err.name === 'ValidationError' && err.errors) {
    return invalidInput(Object.keys(err.errors));
  }
  if (err.name === 'BSONError') {
    return invalidInput(['id']);
  }
  if (err.type && err.status >= 400 && err.status < 500) {
    // body-parser (express.json) failures: malformed JSON, body too large, bad charset.
    return {
      statusCode: err.status,
      message: 'The request body could not be read.',
      code: codeForStatus(err.status),
      errors: null,
    };
  }
  return null;
};

const stackFrames = (err) =>
  String((err && err.stack) || '')
    .split('\n')
    .slice(1)
    .join('\n');

const errorHandler = (err, req, res, next) => {
  const known = classify(err) || {};
  const statusCode = known.statusCode || 500;
  const code = known.code || ERROR_CODES.INTERNAL_ERROR;
  const errors = known.errors || null;
  const deliberate = statusCode >= 500 && Boolean(known.code) && code !== ERROR_CODES.INTERNAL_ERROR;
  const message = statusCode >= 500 && !deliberate ? 'Internal Server Error' : known.message;

  if (deliberate) {
    logger.error(`[Operational Error] ${req.method} ${req.originalUrl}: ${code} ${message}`);
  } else if (statusCode >= 500) {
    logger.error(`[Unhandled Error] ${req.method} ${req.originalUrl}: ${err && err.name}`, {
      code: err && typeof err.code !== 'object' ? err.code : undefined,
      stack: stackFrames(err),
    });
  } else {
    logger.warn(`[Operational Warning] ${req.method} ${req.originalUrl}: ${code} ${message}`, {
      fields: errors ? errors.map((error) => error.field) : [],
    });
  }

  if (known.headers) {
    res.set(known.headers);
  }

  return res.status(statusCode).json({
    success: false,
    message,
    code,
    errors,
    data: null,
  });
};

module.exports = errorHandler;
