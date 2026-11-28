const OtpChallenge = require('../models/otpchallenge');
const otpDelivery = require('./otpdelivery');
const rateBudget = require('./ratebudget');
const ApiError = require('../utils/ApiError');
const clock = require('../utils/clock');
const logger = require('../utils/logger');
const secretCode = require('../utils/secretCode');
const { ERROR_CODES } = require('../utils/errorCodes');
const { maskPhone } = require('../utils/phone');

// One-time codes for customer sign in, vendor sign in and vendor phone verification, to the shared
// contract (owner decision 17/11/2026; vendor sign in by code since Phase 5 contract §1,
// 28/11/2026): 6 digits, valid 5 minutes, a new one no sooner than 30 seconds after the last, at
// most 5 wrong entries per code. When OTP_STATIC_CODE is set (development: 123456) every code is
// that value; otherwise it is crypto-random. Either way only a bcrypt hash is stored, and the code
// is never returned or logged — otpdelivery.js is the only place it goes.
//
// A *decoy* challenge (vendor sign in for a number with no vendor account) goes through every
// check, limit and write a real one does and answers the same, but its code is random even when
// OTP_STATIC_CODE is set and is never sent: nobody can know it, so it can only be refused.
//
// A code the provider did not accept (503 OTP_DELIVERY_FAILED) is not counted as sent: its
// challenge is removed and the day's send handed back, so the user can ask again at once. It is
// counted instead against a budget of its own — refused sends per phone per 24 hours (review fix
// 28/11/2026) — because with the day's send handed back, a failing provider would otherwise let
// anyone make us call it for someone's number without end (only the per-IP /auth limit applies).
//
// ⚠️ Four rules are easy to break when editing:
// - A wrong entry is counted *before* the comparison, with a conditional update, so parallel
//   guesses cannot get past the limit.
// - A send is counted as refused *before* the provider is called and handed back once it went
//   out, for the same reason: parallel sends to a failing provider cannot get past the limit.
// - Every write is conditioned on the hash read at the start, so a code replaced by a resend
//   mid-request cannot still be accepted.
// - A decoy must stay indistinguishable from a real challenge in everything the caller sees:
//   status, body, limits and the `deliveryChannel` it reports. So it goes through the refused-send
//   budget too: a number whose budget is spent (by customer codes, say) answers 429 whether or not
//   it has a vendor account.

const OTP_PURPOSES = Object.freeze({
  CUSTOMER_SIGN_IN: 'CUSTOMER_SIGN_IN',
  VENDOR_SIGN_IN: 'VENDOR_SIGN_IN',
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

// Per phone, whatever the purpose: sends the provider refused or timed out on, per 24 hours.
// Kept apart from SEND_BUDGET so a refused send can still be handed back to the user's day.
const OTP_FAILED_SENDS_PER_DAY = 10;
const FAILED_SEND_BUDGET = { limit: OTP_FAILED_SENDS_PER_DAY, windowSeconds: 24 * 60 * 60 };
const failedSendKey = (phone) => `otp-send-failed:${phone}`;

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

  // The resend wait, the daily cap, the refused-send cap and a usable delivery channel, without
  // using anything: for a caller that must know a code can go out before it creates something (a
  // vendor registration).
  async assertCanSend({ purpose, phone }) {
    await this.assertResendAllowed({ purpose, phone });
    otpDelivery.channelFor(phone);
    const budget = await rateBudget.peek(sendKey(phone), SEND_BUDGET);
    if (!budget.allowed) throw rateLimited(budget.retryAfterSeconds);
    const failedSends = await rateBudget.peek(failedSendKey(phone), FAILED_SEND_BUDGET);
    if (!failedSends.allowed) throw rateLimited(failedSends.retryAfterSeconds);
  }

  async issue({ purpose, phone, registrationId = null, decoy = false }) {
    await this.assertResendAllowed({ purpose, phone });

    // Before the day's budget is touched: a channel that cannot deliver costs the user nothing.
    const deliveryChannel = otpDelivery.channelFor(phone);

    const budget = await rateBudget.consume(sendKey(phone), SEND_BUDGET);
    if (!budget.allowed) throw rateLimited(budget.retryAfterSeconds);

    // Counted as refused until it is known to have gone out (handed back below). Spent, the
    // provider is not called at all, and the day's send just taken is given back: nothing went.
    const failedSends = await rateBudget.consume(failedSendKey(phone), FAILED_SEND_BUDGET);
    if (!failedSends.allowed) {
      await rateBudget.refund(sendKey(phone));
      throw rateLimited(failedSends.retryAfterSeconds);
    }

    const now = clock.now();
    const code = decoy ? secretCode.generateNumericCode() : this.codeToIssue();
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
      // Nothing was sent, so it counts against neither the day nor the refused sends.
      await rateBudget.refund(sendKey(phone));
      await rateBudget.refund(failedSendKey(phone));
      if (error.code === 11000) {
        throw resendTooSoon();
      }
      throw error;
    }

    if (!decoy) {
      try {
        await otpDelivery.deliver({ phone, code, purpose });
      } catch (error) {
        // Not a send (the user may ask again at once), but a refused one: that unit is kept.
        await OtpChallenge.deleteOne({ purpose, phone, registrationId, codeHash });
        await rateBudget.refund(sendKey(phone));
        throw error;
      }
    }

    // It went out (or, for a decoy, there was nothing to send): not a refused send.
    await rateBudget.refund(failedSendKey(phone));

    return {
      maskedDestination: maskPhone(phone),
      expiresAt: expiresAt.toISOString(),
      resendAfterSeconds: OTP_RESEND_AFTER_SECONDS,
      deliveryChannel,
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
// For a caller that must refuse exactly as a wrong code is refused (vendor sign in, unknown number).
module.exports.invalidCodeError = invalid;
module.exports.OTP_TTL_SECONDS = OTP_TTL_SECONDS;
module.exports.OTP_RESEND_AFTER_SECONDS = OTP_RESEND_AFTER_SECONDS;
module.exports.OTP_MAX_WRONG_ATTEMPTS = OTP_MAX_WRONG_ATTEMPTS;
module.exports.OTP_SENDS_PER_DAY = OTP_SENDS_PER_DAY;
module.exports.OTP_FAILED_SENDS_PER_DAY = OTP_FAILED_SENDS_PER_DAY;
module.exports.STATIC_CODE_ENVIRONMENTS = STATIC_CODE_ENVIRONMENTS;
module.exports.OTP_WRONG_GUESSES_PER_HOUR = OTP_WRONG_GUESSES_PER_HOUR;
