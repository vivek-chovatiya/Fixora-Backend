const rateLimit = require('express-rate-limit');
const ApiError = require('../utils/ApiError');
const { ERROR_CODES } = require('../utils/errorCodes');

// Per-IP limit on every /auth/* route (requests contract §8): a client that keeps going past it
// gets 429 RATE_LIMITED with Retry-After, in the usual envelope. In memory, so it resets on a
// restart and is per server process — the per-phone caps (services/otp.js) are the durable ones.
//
// The limit is read on every request (AUTH_RATE_LIMIT_MAX, default 100 per 15 minutes) so a test
// can lower it. Behind a proxy, set Express `trust proxy` or every caller shares the proxy's IP.
const WINDOW_MS = 15 * 60 * 1000;

const authRateLimit = rateLimit({
  windowMs: WINDOW_MS,
  limit: () => Number(process.env.AUTH_RATE_LIMIT_MAX) || 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  handler: (req, res, next) => {
    const resetTime = req.rateLimit && req.rateLimit.resetTime;
    const seconds = resetTime
      ? Math.max(1, Math.ceil((resetTime.getTime() - Date.now()) / 1000))
      : WINDOW_MS / 1000;
    const error = new ApiError(
      429,
      'Too many requests. Please try again later.',
      null,
      ERROR_CODES.RATE_LIMITED
    );
    error.headers = { 'Retry-After': String(seconds) };
    next(error);
  },
});

module.exports = authRateLimit;
