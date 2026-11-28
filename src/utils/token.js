/**
 * Signs and verifies session tokens.
 *
 * Moved out of services/auth.js so the email login and the phone sign-in flows sign tokens one way.
 * The lifetime comes from `JWT_EXPIRES` (7d for now — an open item: the owner may want a longer
 * life or refresh tokens later, now that every sign in needs a one-time code).
 *
 * Every token carries `v`, the account's `tokenVersion`; middlewares/auth.js refuses a token whose
 * version is behind the account's, which is how sessions end on suspension, deletion or a
 * phone-ownership take-over (requests contract §8).
 *
 * ⚠️ There is no fallback secret (review fix, 17/11/2026): the server refuses to start without
 * JWT_SECRET (config/startupChecks.js), and signing or verifying without one throws.
 */

const jwt = require('jsonwebtoken');

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error('JWT_SECRET is not set.');
  }
  return secret;
};

const generateToken = (payload) => {
  const jwtExpires = process.env.JWT_EXPIRES || '7d';
  return jwt.sign(payload, getJwtSecret(), { expiresIn: jwtExpires });
};

const verifyToken = (token) => jwt.verify(token, getJwtSecret());

module.exports = {
  getJwtSecret,
  generateToken,
  verifyToken,
};
