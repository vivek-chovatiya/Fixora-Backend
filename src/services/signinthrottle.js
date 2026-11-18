const SignInAttempt = require('../models/signinattempt');
const ApiError = require('../utils/ApiError');
const clock = require('../utils/clock');
const logger = require('../utils/logger');
const { ERROR_CODES } = require('../utils/errorCodes');
const { maskPhoneForLog } = require('../utils/phone');

// Vendor sign-in lockout (lead decision 17/11/2026, contract error table): 5 failed attempts for a
// phone within 15 minutes → 429 SIGNIN_TOO_MANY_ATTEMPTS with Retry-After, until 15 minutes after
// the 5th failure. Even a correct code is refused while locked. A successful sign in clears the
// count. Without this a 6-digit standing credential is brute-forceable.
//
// ⚠️ Three rules are easy to break when editing:
// - Count for EVERY phone, known or unknown — counting only real accounts would let the lock itself
//   reveal which numbers have one.
// - An attempt is reserved *before* the code is compared, with a conditional update, so a burst of
//   parallel guesses cannot get past the limit (the same pattern as services/otp.js).
// - Never store or log the attempted code. This module never receives it.

const SIGNIN_MAX_FAILURES = 5;
const SIGNIN_WINDOW_SECONDS = 15 * 60;
const SIGNIN_LOCK_SECONDS = 15 * 60;

const locked = (lockedUntil, now) => {
  const error = new ApiError(
    429,
    'Too many sign-in attempts. Please try again later.',
    null,
    ERROR_CODES.SIGNIN_TOO_MANY_ATTEMPTS
  );
  const seconds = Math.max(1, Math.ceil((lockedUntil.getTime() - now.getTime()) / 1000));
  error.headers = { 'Retry-After': String(seconds) };
  return error;
};

const after = (date, seconds) => new Date(date.getTime() + seconds * 1000);

class SignInThrottleService {
  // Counts this attempt, or refuses it with 429 when the phone is locked. Answers the record, which
  // `recordFailure` / `release` / `clear` then settle once the code has been compared.
  async reserve(phone) {
    const now = clock.now();

    // A lapsed window, or a lock that has run out, starts again from nothing.
    await SignInAttempt.updateOne(
      {
        phone,
        $or: [
          { lockedUntil: null, windowStartedAt: { $lte: after(now, -SIGNIN_WINDOW_SECONDS) } },
          { lockedUntil: { $ne: null, $lte: now } },
        ],
      },
      { $set: { failures: 0, windowStartedAt: now, lockedUntil: null } }
    );

    const open = { phone, lockedUntil: null, failures: { $lt: SIGNIN_MAX_FAILURES } };
    const count = {
      $inc: { failures: 1 },
      $set: { expiresAt: after(now, SIGNIN_WINDOW_SECONDS + SIGNIN_LOCK_SECONDS) },
    };

    let reserved = null;
    try {
      reserved = await SignInAttempt.findOneAndUpdate(
        open,
        { ...count, $setOnInsert: { windowStartedAt: now } },
        { upsert: true, new: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      // The record exists but did not match — locked or full — or a parallel first attempt
      // created it a moment ago. Counting once more without upsert tells the two apart.
      reserved = await SignInAttempt.findOneAndUpdate(open, count, { new: true });
    }

    if (!reserved) {
      const current = await SignInAttempt.findOne({ phone });
      const lockedUntil =
        current && current.lockedUntil && current.lockedUntil > now
          ? current.lockedUntil
          : after(now, SIGNIN_LOCK_SECONDS);
      throw locked(lockedUntil, now);
    }

    return reserved;
  }

  // The attempt failed. The failure that reaches the limit starts the lock and answers it at once,
  // as the fifth wrong one-time code does.
  async recordFailure(reserved) {
    if (reserved.failures < SIGNIN_MAX_FAILURES) return;

    const now = clock.now();
    const lockedUntil = after(now, SIGNIN_LOCK_SECONDS);
    await SignInAttempt.updateOne(
      { _id: reserved._id },
      { $set: { lockedUntil, expiresAt: after(lockedUntil, SIGNIN_WINDOW_SECONDS) } }
    );
    logger.warn(`vendor sign in locked for ${maskPhoneForLog(reserved.phone)}`);
    throw locked(lockedUntil, now);
  }

  // The code was right but the attempt did not sign in (suspended account): neither a failure nor
  // a success, so the reservation is handed back.
  async release(reserved) {
    await SignInAttempt.updateOne(
      { _id: reserved._id, failures: { $gt: 0 } },
      { $inc: { failures: -1 } }
    );
  }

  async clear(phone) {
    await SignInAttempt.deleteOne({ phone });
  }
}

const signInThrottle = new SignInThrottleService();

module.exports = signInThrottle;
module.exports.SIGNIN_MAX_FAILURES = SIGNIN_MAX_FAILURES;
module.exports.SIGNIN_WINDOW_SECONDS = SIGNIN_WINDOW_SECONDS;
module.exports.SIGNIN_LOCK_SECONDS = SIGNIN_LOCK_SECONDS;
