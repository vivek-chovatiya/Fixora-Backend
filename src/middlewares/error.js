const multer = require('multer');
const logger = require('../utils/logger');
const config = require('../config');
const { ERROR_CODE } = require('../constants');

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  let statusCode = err.statusCode || 500;
  let message = err.message || 'Internal Server Error';
  let errors = err.errors || null;
  let code = err.code || ERROR_CODE.SERVER_ERROR;

  if (err.isJoi) {
    statusCode = 400;
    message = 'Validation Failed';
    code = ERROR_CODE.VALIDATION_FAILED;
    errors = err.details.map((detail) => ({
      field: detail.path.join('.'),
      message: detail.message,
    }));
  }

  if (err instanceof multer.MulterError) {
    statusCode = 400;
    code = ERROR_CODE.VALIDATION_FAILED;
    message =
      err.code === 'LIMIT_FILE_SIZE'
        ? 'File is too large.'
        : err.code === 'LIMIT_FILE_COUNT' || err.code === 'LIMIT_UNEXPECTED_FILE'
          ? 'Too many files uploaded.'
          : 'File upload failed.';
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    statusCode = 409;
    code = ERROR_CODE.DUPLICATE_RECORD;
    const field = Object.keys(err.keyValue || {})[0] || 'record';
    message = `A record with this ${field} already exists.`;
    errors = [{ field, message }];
  }

  // Mongoose cast errors (bad ObjectId etc.)
  if (err.name === 'CastError') {
    statusCode = 400;
    code = ERROR_CODE.VALIDATION_FAILED;
    message = `Invalid value for ${err.path}.`;
  }

  // Malformed JSON body
  if (err.type === 'entity.parse.failed') {
    statusCode = 400;
    code = ERROR_CODE.VALIDATION_FAILED;
    message = 'Malformed JSON body.';
  }

  if (statusCode >= 500) {
    code = ERROR_CODE.SERVER_ERROR;
    logger.error(`[Unhandled Error] ${req.method} ${req.originalUrl}: ${err.message}`, {
      stack: err.stack,
    });
  } else {
    logger.warn(`[Operational] ${req.method} ${req.originalUrl}: ${message}`);
  }

  return res.status(statusCode).json({
    success: false,
    message: statusCode >= 500 && config.isProduction ? 'Internal Server Error' : message,
    code,
    data: null,
    meta: {},
    errors,
  });
};

module.exports = errorHandler;
