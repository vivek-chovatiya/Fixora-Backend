const mongoose = require('mongoose');
const { verifyToken } = require('../utils/token');
const { findUsableAccount } = require('../services/tokenaccount');

// For public routes that answer more to an administrator: a token that `authenticate` would
// accept sets `req.user` the same way; no token, or one it would refuse (bad signature, expired,
// revoked, suspended account), leaves the caller anonymous rather than refusing them.
//
// ⚠️ Never use this on a route that must be signed in — use `authenticate` there.
const optionalAuthenticate = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) return next();

  try {
    const decoded = verifyToken(authHeader.split(' ')[1]);
    if (mongoose.isValidObjectId(decoded.id) && (await findUsableAccount(decoded))) {
      req.user = decoded;
    }
  } catch (error) {
    req.user = undefined;
  }
  return next();
};

module.exports = optionalAuthenticate;
