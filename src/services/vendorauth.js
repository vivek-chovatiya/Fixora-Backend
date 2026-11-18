const mongoose = require('mongoose');
const Category = require('../models/category');
const Vendor = require('../models/vendor');
const VendorRegistration = require('../models/vendorregistration');
const otpService = require('./otp');
const sessionService = require('./session');
const signInThrottle = require('./signinthrottle');
const ApiError = require('../utils/ApiError');
const clock = require('../utils/clock');
const logger = require('../utils/logger');
const secretCode = require('../utils/secretCode');
const { ERROR_CODES } = require('../utils/errorCodes');
const { maskPhoneForLog } = require('../utils/phone');

const { OTP_PURPOSES } = otpService;

// Vendor onboarding and sign in (PROJECT_BIBLE.md section 7A.2, amended 21/10/2026):
//
//   register → one-time code to the phone → verify → permanent 6-digit auth code, shown once
//            → vendor types it back (confirm) → Vendor created ACTIVE + APPROVED → session
//   returning vendor: phone + auth code → session
//
// There is no administrator approval step (section 29 is superseded). Verifying the phone does
// not sign the vendor in; only confirming the auth code does.
//
// ⚠️ The auth code is a standing credential that never expires. It is generated here, returned
// exactly once in the response that issues it, stored only as a bcrypt hash, and never logged or
// put in an error. A wrong code, an unknown phone and a revoked code are refused identically on
// sign in — telling them apart would reveal which numbers have accounts.

const REGISTRATION_TTL_HOURS = 24;
// Same limit as a one-time code: five wrong typed-back codes and the code must be regenerated.
const CONFIRM_MAX_WRONG_ATTEMPTS = 5;

const registrationNotFound = () =>
  new ApiError(
    404,
    'This registration is no longer available. Please start again.',
    null,
    ERROR_CODES.REGISTRATION_NOT_FOUND
  );

const phoneAlreadyRegistered = () =>
  new ApiError(
    409,
    'An account already exists for this number. Try signing in instead.',
    null,
    ERROR_CODES.PHONE_ALREADY_REGISTERED
  );

const authCodeInvalid = () =>
  new ApiError(
    401,
    'Those sign-in details were not recognised.',
    null,
    ERROR_CODES.AUTH_CODE_INVALID
  );

// Confirmation is not a sign in — the vendor holds no session yet — so a mismatch is a 400, never
// a 401 the app could mistake for an expired session (lead's contract clarification, 17/11/2026).
const confirmCodeInvalid = () =>
  new ApiError(
    400,
    'That code does not match the one shown.',
    null,
    ERROR_CODES.AUTH_CODE_INVALID
  );

const confirmTooManyAttempts = () =>
  new ApiError(
    429,
    'Too many incorrect codes. Please generate a new auth code.',
    null,
    ERROR_CODES.OTP_TOO_MANY_ATTEMPTS
  );

const accountSuspended = () =>
  new ApiError(403, 'This account is not active.', null, ERROR_CODES.ACCOUNT_SUSPENDED);

// The contract has no conflict code for an email or category, so they are field errors.
const fieldInvalid = (field, message) =>
  new ApiError(400, 'Validation Failed', [{ field, message }], ERROR_CODES.VALIDATION_FAILED);

const emailInUse = () => fieldInvalid('email', 'This email is already used by another account.');

const OBJECT_ID = /^[a-f0-9]{24}$/i;

class VendorAuthService {
  // A live registration, or REGISTRATION_NOT_FOUND for an unknown, lapsed or finished one.
  async findLiveRegistration(registrationId) {
    if (typeof registrationId !== 'string' || !OBJECT_ID.test(registrationId)) {
      throw registrationNotFound();
    }

    const registration = await VendorRegistration.findOne({
      _id: registrationId,
      state: { $ne: 'COMPLETED' },
      expiresAt: { $gt: clock.now() },
    }).select('+authCodeHash');

    if (!registration) {
      throw registrationNotFound();
    }
    return registration;
  }

  // Only a proven phone blocks a registration (requests contract §8): an email sign-up that named
  // this number without proving it is taken over at confirmation instead (confirmAuthCode).
  async assertPhoneFree(phone) {
    if (await Vendor.exists({ phone, isDeleted: { $ne: true }, phoneVerifiedAt: { $ne: null } })) {
      throw phoneAlreadyRegistered();
    }
  }

  // The registration's details and auth code, applied to the vendor account it creates or claims.
  accountFields(registration, now) {
    return {
      businessName: registration.businessName,
      ownerName: `${registration.ownerFirstName} ${registration.ownerLastName}`.trim(),
      ownerFirstName: registration.ownerFirstName,
      ownerLastName: registration.ownerLastName,
      categoryIds: registration.serviceCategoryIds,
      authCodeHash: registration.authCodeHash,
      authCodeIssuedAt: registration.authCodeIssuedAt,
      phoneVerifiedAt: now,
      approvalStatus: 'APPROVED',
      availability: true,
    };
  }

  // A vendor account that holds this phone without having proved it (an email sign-up). The
  // registrant has just proved the phone, so they take the account over: its unproven email and
  // password go, every session opened with them ends, and the registration's details apply. A
  // blocked account stays blocked.
  async claimUnprovenAccount(registration, now) {
    const holder = await Vendor.findOne({
      phone: registration.phone,
      isDeleted: { $ne: true },
      phoneVerifiedAt: null,
    });
    if (!holder) return null;

    const unset = { password: '' };
    const set = { ...this.accountFields(registration, now) };
    if (registration.email) set.email = registration.email;
    else unset.email = '';
    if (holder.status === 'ACTIVE') set.status = 'ACTIVE';

    const claimed = await Vendor.findOneAndUpdate(
      { _id: holder._id, phoneVerifiedAt: null },
      { $set: set, $unset: unset, $inc: { tokenVersion: 1 } },
      { new: true }
    );
    if (claimed) {
      logger.warn(
        `unproven vendor sign-up on ${maskPhoneForLog(registration.phone)} taken over by the phone's owner`
      );
    }
    return claimed;
  }

  // A fresh code that differs from the one it replaces: a "regenerated" code equal to the revoked
  // one would revoke nothing, and six random digits do repeat one time in a million.
  async issueFreshAuthCode(previousHash) {
    let code = secretCode.generateNumericCode();
    for (let tries = 0; previousHash && tries < 3; tries += 1) {
      if (!(await secretCode.compareCode(code, previousHash))) break;
      code = secretCode.generateNumericCode();
    }
    return { code, codeHash: await secretCode.hashCode(code), issuedAt: clock.now() };
  }

  async register(details) {
    const { businessName, ownerFirstName, ownerLastName, phone, email, serviceCategoryIds } =
      details;

    await this.assertPhoneFree(phone);

    if (email && (await Vendor.exists({ email, isDeleted: { $ne: true } }))) {
      throw emailInUse();
    }

    const liveCategories = await Category.countDocuments({
      _id: { $in: serviceCategoryIds },
      status: 'ACTIVE',
      isDeleted: { $ne: true },
    });
    if (liveCategories !== serviceCategoryIds.length) {
      throw fieldInvalid('serviceCategoryIds', 'One or more selected services are not available.');
    }

    // Before creating anything, so a throttled request leaves no orphan registration behind.
    await otpService.assertCanSend({ purpose: OTP_PURPOSES.VENDOR_REGISTRATION, phone });

    const now = clock.now();
    const registration = await VendorRegistration.create({
      businessName,
      ownerFirstName,
      ownerLastName,
      phone,
      email,
      serviceCategoryIds,
      expiresAt: new Date(now.getTime() + REGISTRATION_TTL_HOURS * 60 * 60 * 1000),
    });

    const challenge = await otpService.issue({
      purpose: OTP_PURPOSES.VENDOR_REGISTRATION,
      phone,
      registrationId: registration._id,
    });

    logger.info(`vendor registration started for ${maskPhoneForLog(phone)}`);

    return { registrationId: String(registration._id), challenge };
  }

  async requestOtp({ registrationId }) {
    const registration = await this.findLiveRegistration(registrationId);
    return otpService.issue({
      purpose: OTP_PURPOSES.VENDOR_REGISTRATION,
      phone: registration.phone,
      registrationId: registration._id,
    });
  }

  async verifyOtp({ registrationId, code }) {
    const registration = await this.findLiveRegistration(registrationId);

    await otpService.verify({
      purpose: OTP_PURPOSES.VENDOR_REGISTRATION,
      phone: registration.phone,
      registrationId: registration._id,
      code,
    });

    // Another registration for this number may have finished meanwhile; say so now rather than
    // show a code that can never be confirmed.
    await this.assertPhoneFree(registration.phone);

    const issued = await this.issueFreshAuthCode(registration.authCodeHash);
    const updated = await VendorRegistration.findOneAndUpdate(
      { _id: registration._id, state: { $ne: 'COMPLETED' } },
      {
        $set: {
          state: 'CODE_ISSUED',
          authCodeHash: issued.codeHash,
          authCodeIssuedAt: issued.issuedAt,
          confirmAttempts: 0,
        },
      }
    );
    if (!updated) {
      throw registrationNotFound();
    }

    logger.info(`vendor auth code issued for ${maskPhoneForLog(registration.phone)}`);

    return { code: issued.code, issuedAt: issued.issuedAt.toISOString() };
  }

  async regenerateAuthCode({ registrationId }) {
    const registration = await this.findLiveRegistration(registrationId);

    // Before the phone is verified there is no code to replace, and issuing one would hand out
    // a credential for a number nobody has proved.
    if (registration.state !== 'CODE_ISSUED') {
      throw registrationNotFound();
    }

    const issued = await this.issueFreshAuthCode(registration.authCodeHash);
    const updated = await VendorRegistration.findOneAndUpdate(
      { _id: registration._id, state: 'CODE_ISSUED' },
      {
        $set: {
          authCodeHash: issued.codeHash,
          authCodeIssuedAt: issued.issuedAt,
          confirmAttempts: 0,
        },
      }
    );
    if (!updated) {
      throw registrationNotFound();
    }

    logger.info(`vendor auth code regenerated for ${maskPhoneForLog(registration.phone)}`);

    return { code: issued.code, issuedAt: issued.issuedAt.toISOString() };
  }

  async confirmAuthCode({ registrationId, authCode }) {
    const registration = await this.findLiveRegistration(registrationId);

    // Before the phone is verified no code exists, so nothing typed can match.
    if (registration.state !== 'CODE_ISSUED' || !registration.authCodeHash) {
      await secretCode.compareCode(authCode, null);
      throw confirmCodeInvalid();
    }
    if (registration.confirmAttempts >= CONFIRM_MAX_WRONG_ATTEMPTS) {
      throw confirmTooManyAttempts();
    }

    // Counted before the comparison, conditioned on the current hash, exactly as one-time codes
    // are (services/otp.js): parallel guesses cannot pass the limit, and a code regenerated
    // mid-request stays revoked.
    const live = {
      _id: registration._id,
      state: 'CODE_ISSUED',
      authCodeHash: registration.authCodeHash,
    };
    // `$not: { $gte }` rather than `$lt` so a registration saved before this counter existed (no
    // field at all) still matches.
    const reserved = await VendorRegistration.findOneAndUpdate(
      { ...live, confirmAttempts: { $not: { $gte: CONFIRM_MAX_WRONG_ATTEMPTS } } },
      { $inc: { confirmAttempts: 1 } },
      { new: true }
    );
    if (!reserved) {
      const current = await VendorRegistration.findOne({
        _id: registration._id,
        state: 'CODE_ISSUED',
      }).select('+authCodeHash');
      if (!current) throw registrationNotFound();
      if (current.authCodeHash === registration.authCodeHash) throw confirmTooManyAttempts();
      throw confirmCodeInvalid();
    }

    const matches = await secretCode.compareCode(authCode, registration.authCodeHash);
    if (!matches) {
      if (reserved.confirmAttempts >= CONFIRM_MAX_WRONG_ATTEMPTS) {
        throw confirmTooManyAttempts();
      }
      throw confirmCodeInvalid();
    }

    await this.assertPhoneFree(registration.phone);

    // Claim the registration before creating the account, conditioned on the hash just compared:
    // a double tap cannot create two vendors, and a code regenerated mid-request stays revoked.
    const claimed = await VendorRegistration.findOneAndUpdate(
      { _id: registration._id, state: 'CODE_ISSUED', authCodeHash: registration.authCodeHash },
      { $set: { state: 'COMPLETED' } }
    );
    if (!claimed) {
      const current = await VendorRegistration.findOne({
        _id: registration._id,
        state: 'CODE_ISSUED',
      });
      throw current ? confirmCodeInvalid() : registrationNotFound();
    }

    let vendor;
    try {
      const now = clock.now();
      vendor =
        (await this.claimUnprovenAccount(registration, now)) ||
        (await Vendor.create({
          ...this.accountFields(registration, now),
          phone: registration.phone,
          email: registration.email,
          status: 'ACTIVE',
        }));
    } catch (error) {
      await VendorRegistration.updateOne(
        { _id: registration._id, state: 'COMPLETED', vendorId: null },
        { $set: { state: 'CODE_ISSUED' } }
      );
      if (error.code === 11000 && error.keyPattern && error.keyPattern.phone) {
        throw phoneAlreadyRegistered();
      }
      if (error.code === 11000 && error.keyPattern && error.keyPattern.email) {
        throw emailInUse();
      }
      throw error;
    }

    await VendorRegistration.updateOne({ _id: registration._id }, { $set: { vendorId: vendor._id } });

    if (vendor.status !== 'ACTIVE') {
      throw accountSuspended();
    }

    logger.info(`vendor activated and signed in for ${maskPhoneForLog(vendor.phone)}`);

    return sessionService.createSession(vendor, 'VENDOR');
  }

  async signIn({ phone, authCode }) {
    // Before anything is looked up, and for any phone: a lock only real accounts could reach would
    // itself reveal which numbers have one.
    const attempt = await signInThrottle.reserve(phone);

    const vendor = await Vendor.findOne({ phone, isDeleted: { $ne: true } }).select(
      '+authCodeHash'
    );

    // compareCode spends a full bcrypt comparison even without a hash, so an unknown number takes
    // as long to refuse as a wrong code.
    const matches = await secretCode.compareCode(authCode, vendor ? vendor.authCodeHash : null);
    if (!vendor || !matches) {
      await signInThrottle.recordFailure(attempt);
      throw authCodeInvalid();
    }

    if (vendor.status !== 'ACTIVE') {
      await signInThrottle.release(attempt);
      throw accountSuspended();
    }

    await signInThrottle.clear(phone);

    logger.info(`vendor signed in for ${maskPhoneForLog(vendor.phone)}`);

    return sessionService.createSession(vendor, 'VENDOR');
  }

  // Administrator reissue (section 7A.2 amendment): the old code stops working at once.
  async reissueAuthCode(vendorId) {
    if (!mongoose.isValidObjectId(vendorId)) {
      throw new ApiError(404, 'Vendor not found.');
    }

    const vendor = await Vendor.findOne({ _id: vendorId, isDeleted: { $ne: true } }).select(
      '+authCodeHash'
    );
    if (!vendor) {
      throw new ApiError(404, 'Vendor not found.');
    }

    const issued = await this.issueFreshAuthCode(vendor.authCodeHash);
    // The old code dies now, and so does every session opened with it (requests contract §8).
    await Vendor.updateOne(
      { _id: vendor._id },
      {
        $set: { authCodeHash: issued.codeHash, authCodeIssuedAt: issued.issuedAt },
        $inc: { tokenVersion: 1 },
      }
    );

    logger.info(`vendor auth code reissued by an administrator for vendor ${vendor._id}`);

    return { code: issued.code, issuedAt: issued.issuedAt.toISOString() };
  }
}

module.exports = new VendorAuthService();
