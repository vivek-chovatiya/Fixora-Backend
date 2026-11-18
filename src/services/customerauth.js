const Customer = require('../models/customer');
const otpService = require('./otp');
const sessionService = require('./session');
const ApiError = require('../utils/ApiError');
const clock = require('../utils/clock');
const logger = require('../utils/logger');
const { ERROR_CODES } = require('../utils/errorCodes');
const { maskPhoneForLog } = require('../utils/phone');

const { OTP_PURPOSES } = otpService;

// Customer sign in by phone + one-time code (PROJECT_BIBLE.md section 7A.1). There is no separate
// customer sign up: the first successful verification creates the account, nameless until the
// profile is filled in, and the session says so with `isNewAccount`.
//
// ⚠️ Requesting a code answers the same whether or not the number has an account — anything else
// lets anyone enumerate customers. Suspension is only revealed after the code is proved.
class CustomerAuthService {
  async requestOtp({ phone }) {
    return otpService.issue({ purpose: OTP_PURPOSES.CUSTOMER_SIGN_IN, phone });
  }

  async verifyOtp({ phone, code }) {
    await otpService.verify({ purpose: OTP_PURPOSES.CUSTOMER_SIGN_IN, phone, code });

    const now = clock.now();
    let customer = await Customer.findOne({ phone, isDeleted: { $ne: true } });
    let isNewAccount = false;

    if (!customer) {
      try {
        customer = await Customer.create({ phone, isVerified: true, phoneVerifiedAt: now });
        isNewAccount = true;
      } catch (error) {
        // Two first verifications for one number at once: the other request created it.
        if (error.code !== 11000) throw error;
        customer = await Customer.findOne({ phone, isDeleted: { $ne: true } });
        if (!customer) throw error;
      }
    }

    // Pre-hijack guard (requests contract §8): an email sign-up can name any phone without proving
    // it. The first person to prove the phone owns the account: the unproven email and password
    // are removed and every session opened with them ends, so whoever set them is locked out and
    // sees nothing of the owner's.
    if (!customer.phoneVerifiedAt) {
      const claimed = await Customer.findOneAndUpdate(
        { _id: customer._id, phoneVerifiedAt: null },
        {
          $set: { phoneVerifiedAt: now, isVerified: true },
          $unset: { email: '', password: '' },
          $inc: { tokenVersion: 1 },
        },
        { new: true }
      );
      customer = claimed || (await Customer.findById(customer._id));
      if (claimed) {
        logger.warn(`unproven sign-up on ${maskPhoneForLog(phone)} taken over by the phone's owner`);
      }
    }

    if (customer.status !== 'ACTIVE') {
      throw new ApiError(403, 'This account is not active.', null, ERROR_CODES.ACCOUNT_SUSPENDED);
    }

    customer.lastLogin = now;
    await customer.save();

    logger.info(
      `customer ${isNewAccount ? 'account created and ' : ''}signed in for ${maskPhoneForLog(phone)}`
    );

    return { ...sessionService.createSession(customer, 'CUSTOMER'), isNewAccount };
  }
}

module.exports = new CustomerAuthService();
