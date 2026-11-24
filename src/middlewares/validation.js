const ApiError = require('../utils/ApiError');
const { ERROR_CODE } = require('../constants');

const SEGMENTS = ['params', 'query', 'body'];

/**
 * Validates body, params and query against Joi schemas before the controller runs.
 * Unknown keys are stripped so controllers never receive unvalidated fields.
 */
const validate = (schema) => {
  return (req, res, next) => {
    const errors = [];

    SEGMENTS.forEach((segment) => {
      if (!schema[segment]) return;
      const { error, value } = schema[segment].validate(req[segment] || {}, {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
      });

      if (error) {
        error.details.forEach((detail) => {
          errors.push({ field: detail.path.join('.'), message: detail.message.replace(/"/g, '') });
        });
        return;
      }

      if (segment === 'query') {
        // Express 4 exposes req.query as a getter-backed object; replace keys in place.
        Object.keys(req.query).forEach((key) => delete req.query[key]);
        Object.assign(req.query, value);
      } else {
        req[segment] = value;
      }
    });

    if (errors.length) {
      return next(new ApiError(400, 'Validation Failed', errors, ERROR_CODE.VALIDATION_FAILED));
    }

    return next();
  };
};

module.exports = validate;
