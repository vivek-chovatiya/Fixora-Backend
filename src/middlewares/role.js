const ApiError = require('../utils/ApiError');

const authorize = (allowedRoles = []) => {
  return (req, res, next) => {
    if (!req.user || !req.user.role) {
      return next(new ApiError(401, 'User context not found. Authentication required.'));
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(req.user.role)) {
      return next(new ApiError(403, 'Permission denied. Access restricted for this role.'));
    }

    return next();
  };
};

module.exports = authorize;
