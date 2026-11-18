// Checks the environment before the server starts (requests contract §8, review fixes 17/11/2026).
//
//   JWT_SECRET missing              → refuse to start: there is no built-in fallback secret.
//   OTP_STATIC_CODE outside dev/test → ignored by services/otp.js; logged here as an error.
//                                     "Outside" includes NODE_ENV unset, staging and production.
//   OTP_STATIC_CODE in dev/test      → a warning, so nobody forgets it is on.
//
// ⚠️ Never log the values themselves.
const STATIC_CODE_ENVIRONMENTS = ['development', 'test'];

const checkEnvironment = (env, logger) => {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set. Refusing to start without it.');
  }

  if (env.OTP_STATIC_CODE) {
    if (!STATIC_CODE_ENVIRONMENTS.includes(env.NODE_ENV)) {
      logger.error(
        `OTP_STATIC_CODE is set but ignored: NODE_ENV is "${env.NODE_ENV || 'unset'}", and it only applies in development or test. One-time codes are random. Remove it.`
      );
    } else {
      logger.warn(
        'OTP_STATIC_CODE is set: every one-time code is the static development code. Never set it in production.'
      );
    }
  }
};

module.exports = checkEnvironment;
