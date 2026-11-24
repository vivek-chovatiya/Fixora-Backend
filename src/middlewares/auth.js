const jwt = require('jsonwebtoken');
const ApiError = require('../utils/ApiError');
const config = require('../config');
const { ERROR_CODE } = require('../constants');

const authenticate = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(
      new ApiError(401, 'Authentication token missing or invalid.', null, ERROR_CODE.AUTH_REQUIRED)
    );
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.jwt.secret);
    req.user = { id: decoded.id, email: decoded.email, role: decoded.role };
    return next();
  } catch (error) {
    const code =
      error.name === 'TokenExpiredError' ? ERROR_CODE.TOKEN_EXPIRED : ERROR_CODE.AUTH_REQUIRED;
    return next(new ApiError(401, 'Invalid or expired authentication token.', null, code));
  }
};

module.exports = authenticate;
