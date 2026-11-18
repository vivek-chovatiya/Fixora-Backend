const mongoose = require('mongoose');
const ApiError = require('../utils/ApiError');
const { verifyToken } = require('../utils/token');
const { findUsableAccount } = require('../services/tokenaccount');

// A valid signature is not enough (requests contract §8): the account must still exist, be
// ACTIVE, and the token must carry its current version. One small read per request.
const authenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next(new ApiError(401, 'Authentication token missing or invalid.'));
  }

  let decoded;
  try {
    decoded = verifyToken(authHeader.split(' ')[1]);
  } catch (error) {
    return next(new ApiError(401, 'Invalid or expired authentication token.'));
  }

  if (!mongoose.isValidObjectId(decoded.id)) {
    return next(new ApiError(401, 'Invalid or expired authentication token.'));
  }

  try {
    const account = await findUsableAccount(decoded);
    if (!account) {
      return next(new ApiError(401, 'Invalid or expired authentication token.'));
    }
  } catch (error) {
    return next(error);
  }

  req.user = decoded;
  return next();
};

module.exports = authenticate;
