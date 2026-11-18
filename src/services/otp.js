const OtpChallenge = require('../models/otpchallenge');
const otpDelivery = require('./otpdelivery');
const rateBudget = require('./ratebudget');
const ApiError = require('../utils/ApiError');
const clock = require('../utils/clock');
const logger = require('../utils/logger');
const secretCode = require('../utils/secretCode');
const { ERROR_CODES } = require('../utils/errorCodes');
const { maskPhone } = require('../utils/phone');

// One-time codes for customer sign in and vendor phone verification, to the shared contract
// (owner decision 17/11/2026): 6 digits, valid 5 minutes, a new one no sooner than 30 seconds
// after the last, at most 5 wrong entries per code. When OTP_STATIC_CODE is set (development:
// 123456) every code is that value; otherwise it is crypto-random. Either way only a bcrypt hash
// is stored, and the code is never returned or logged — otpdelivery.js is the only place it goes.
//
// ⚠️ Two rules are easy to break when editing:
// - A wrong entry is counted *before* the comparison, with a conditional update, so parallel
//   guesses cannot get past the limit.
// - Every write is conditioned on the hash read at the start, so a code replaced by a resend
//   mid-request cannot still be accepted.

const OTP_PURPOSES = Object.freeze({
  CUSTOMER_SIGN_IN: 'CUSTOMER_SIGN_IN',
  VENDOR_REGISTRATION: 'VENDOR_REGISTRATION',
});

// The only environments where OTP_STATIC_CODE is honoured (config/startupChecks.js agrees).
const STATIC_CODE_ENVIRONMENTS = Object.freeze(['development', 'test']);

const OTP_TTL_SECONDS = 5 * 60;
const OTP_RESEND_AFTER_SECONDS = 30;
const OTP_MAX_WRONG_ATTEMPTS = 5;

// Per phone, whatever the purpose (requests contract §8): codes sent per 24 hours, and wrong
// guesses per hour across resends — a resend no longer resets this budget.
const OTP_SENDS_PER_DAY = 10;
const OTP_WRONG_GUESSES_PER_HOUR = 10;
const SEND_BUDGET = { limit: OTP_SENDS_PER_DAY, windowSeconds: 24 * 60 * 60 };
const GUESS_BUDGET = { limit: OTP_WRONG_GUESSES_PER_HOUR, windowSeconds: 60 * 60 };
const sendKey = (phone) => `otp-send:${phone}`;
const guessKey = (phone) => `otp-guess:${phone}`;

const withRetryAfter = (error, seconds) => {
  error.headers = { 'Retry-After': String(seconds) };
  return error;
};

const rateLimited = (seconds) =>
  withRetryAfter(
    new ApiError(
      429,
      'Too many codes requested for this number. Please try again later.',
      null,
      ERROR_CODES.RATE_LIMITED
    ),
    seconds
  );

const resendTooSoon = () =>
  new ApiError(
    429,
    'Please wait before requesting another code.',
    null,
    ERROR_CODES.OTP_RESEND_TOO_SOON
  );

const expired = () =>
  new ApiError(
    400,
    'This code has expired. Please request a new one.',
    null,
    ERROR_CODES.OTP_EXPIRED
  );

const invalid = () =>
  new ApiError(400, 'The code entered is not correct.', null, ERROR_CODES.OTP_INVALID);

const tooManyAttempts = () =>
  new ApiError(
    429,
    'Too many incorrect codes. Please request a new one.',
    null,
    ERROR_CODES.OTP_TOO_MANY_ATTEMPTS
  );

class OtpService {
  // The static code applies only when NODE_ENV is exactly 'development' or 'test' (lead decision
  // 17/11/2026): unset, staging or production all ignore it, because a fixed code anywhere real
  // would let anyone sign in as anyone.
  codeToIssue() {
    const staticCode = STATIC_CODE_ENVIRONMENTS.includes(process.env.NODE_ENV)
      ? process.env.OTP_STATIC_CODE
      : '';
    if (staticCode && /^\d{6}$/.test(staticCode)) {
      return staticCode;
    }
    if (staticCode) {
      logger.warn('OTP_STATIC_CODE is set but is not 6 digits; issuing a random code instead.');
    }
    return secretCode.generateNumericCode();
  }

  // Throttles by phone and purpose, not just by challenge, so registering again for the same
  // number cannot send codes faster than a resend would.
  async assertResendAllowed({ purpose, phone }) {
    const blocking = await OtpChallenge.exists({
      purpose,
      phone,
      consumedAt: null,
      resendAfter: { $gt: clock.now() },
    });
    if (blocking) {
      throw resendTooSoon();
    }
  }

  // The resend wait and the daily cap, without using anything: for a caller that must know a code
  // can go out before it creates something (a vendor registration).
  async assertCanSend({ purpose, phone }) {
    await this.assertResendAllowed({ purpose, phone });
    const budget = await rateBudget.peek(sendKey(phone), SEND_BUDGET);
    if (!budget.allowed) throw rateLimited(budget.retryAfterSeconds);
  }

  async issue({ purpose, phone, registrationId = null }) {
    await this.assertResendAllowed({ purpose, phone });

    const budget = await rateBudget.consume(sendKey(phone), SEND_BUDGET);
    if (!budget.allowed) throw rateLimited(budget.retryAfterSeconds);

    const now = clock.now();
    const code = this.codeToIssue();
    const codeHash = await secretCode.hashCode(code);
    const expiresAt = new Date(now.getTime() + OTP_TTL_SECONDS * 1000);
    const resendAfter = new Date(now.getTime() + OTP_RESEND_AFTER_SECONDS * 1000);

    // One document per key, rewritten in place: the old code stops working the moment this lands.
    // The filter only matches a challenge that may be replaced, so a request racing past the check
    // above meets the unique key index instead and gets the same answer.
    try {
      await OtpChallenge.findOneAndUpdate(
        {
          purpose,
          phone,
          registrationId,
          $or: [{ resendAfter: { $lte: now } }, { consumedAt: { $ne: null } }],
        },
        { $set: { codeHash, expiresAt, resendAfter, attempts: 0, consumedAt: null } },
        { upsert: true }
      );
    } catch (error) {
      // Nothing was sent, so it does not count against the day.
      await rateBudget.refund(sendKey(phone));
      if (error.code === 11000) {
        throw resendTooSoon();
      }
      throw error;
    }

    await otpDelivery.deliver({ phone, code, purpose });

    return {
      maskedDestination: maskPhone(phone),
      expiresAt: expiresAt.toISOString(),
      resendAfterSeconds: OTP_RESEND_AFTER_SECONDS,
    };
  }

  async verify({ purpose, phone, registrationId = null, code }) {
    const challenge = await OtpChallenge.findOne({
      purpose,
      phone,
      registrationId,
      consumedAt: null,
    }).select('+codeHash');

    if (!challenge) {
      throw expired();
    }
    if (challenge.attempts >= OTP_MAX_WRONG_ATTEMPTS) {
      throw tooManyAttempts();
    }
    if (challenge.expiresAt.getTime() <= clock.now().getTime()) {
      throw expired();
    }

    const live = { _id: challenge._id, codeHash: challenge.codeHash, consumedAt: null };

    // The phone's hourly guess budget first, across every resend (requests contract §8), then the
    // challenge's own five. A guess that turns out not to count is handed back.
    const guess = await rateBudget.consume(guessKey(phone), GUESS_BUDGET);
    if (!guess.allowed) {
      throw withRetryAfter(tooManyAttempts(), guess.retryAfterSeconds);
    }

    const reserved = await OtpChallenge.findOneAndUpdate(
      { ...live, attempts: { $lt: OTP_MAX_WRONG_ATTEMPTS } },
      { $inc: { attempts: 1 } },
      { new: true }
    );

    if (!reserved) {
      await rateBudget.refund(guessKey(phone));
      // Lost a race: either parallel wrong guesses used up the attempts, or the code was used or
      // replaced meanwhile.
      const current = await OtpChallenge.findOne(live);
      if (current && current.attempts >= OTP_MAX_WRONG_ATTEMPTS) {
        throw tooManyAttempts();
      }
      throw expired();
    }

    const matches = await secretCode.compareCode(code, challenge.codeHash);
    if (!matches) {
      if (reserved.attempts >= OTP_MAX_WRONG_ATTEMPTS) {
        throw tooManyAttempts();
      }
      throw invalid();
    }

    // A right code is not a wrong guess.
    await rateBudget.refund(guessKey(phone));

    // One code, one sign in.
    const consumed = await OtpChallenge.findOneAndUpdate(live, { $set: { consumedAt: clock.now() } });
    if (!consumed) {
      throw expired();
    }
  }
}

const otpService = new OtpService();

module.exports = otpService;
module.exports.OTP_PURPOSES = OTP_PURPOSES;
module.exports.OTP_TTL_SECONDS = OTP_TTL_SECONDS;
module.exports.OTP_RESEND_AFTER_SECONDS = OTP_RESEND_AFTER_SECONDS;
module.exports.OTP_MAX_WRONG_ATTEMPTS = OTP_MAX_WRONG_ATTEMPTS;
module.exports.OTP_SENDS_PER_DAY = OTP_SENDS_PER_DAY;
module.exports.STATIC_CODE_ENVIRONMENTS = STATIC_CODE_ENVIRONMENTS;
module.exports.OTP_WRONG_GUESSES_PER_HOUR = OTP_WRONG_GUESSES_PER_HOUR;
