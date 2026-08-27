const ApiError = require('../utils/ApiError');

const validate = (schema) => {
  return (req, res, next) => {
    if (schema.body) {
      const { error, value } = schema.body.validate(req.body, {
        abortEarly: false,
        allowUnknown: true,
        stripUnknown: true,
      });

      if (error) {
        const details = error.details.map((detail) => ({
          field: detail.path.join('.'),
          message: detail.message,
        }));
        return next(new ApiError(400, 'Validation Failed', details));
      } else {
        req.body = value;
      }
    }

    return next();
  };
};

module.exports = validate;
