const Category = require('../models/category');
const Vendor = require('../models/vendor');
const VendorRegistration = require('../models/vendorregistration');
const otpService = require('./otp');
const sessionService = require('./session');
const ApiError = require('../utils/ApiError');
const clock = require('../utils/clock');
const logger = require('../utils/logger');
const { ERROR_CODES } = require('../utils/errorCodes');
const { maskPhoneForLog } = require('../utils/phone');

const { OTP_PURPOSES, invalidCodeError } = otpService;

// Vendor onboarding and sign in by one-time code (Phase 5 contract §1, owner decision 28/11/2026,
// which removes the permanent auth code of PROJECT_BIBLE.md section 7A.2):
//
//   register → one-time code to the phone → verify → Vendor created ACTIVE + APPROVED → session
//   returning vendor: phone → one-time code → verify → session
//
// There is no administrator approval step (section 29 is superseded) and no standing credential:
// every sign in proves the phone again, exactly as a customer's does. The `authCodeHash` older
// vendors still hold is neither read nor written here any more.
//
// ⚠️ Asking for a sign-in code answers the same for every well-formed number — a vendor's,
// nobody's, a suspended vendor's. An unknown number gets a decoy challenge (services/otp.js), so
// every later answer matches a wrong code's too; suspension is revealed only after a right code.
// Only a vendor whose phone was proved signs in this way: an email sign-up that merely named the
// number is taken over through registration (claimUnprovenAccount), never through sign in.

const REGISTRATION_TTL_HOURS = 24;

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
    });

    if (!registration) {
      throw registrationNotFound();
    }
    return registration;
  }

  // Only a proven phone blocks a registration (requests contract §8): an email sign-up that named
  // this number without proving it is taken over at verification instead (claimUnprovenAccount).
  async assertPhoneFree(phone) {
    if (await Vendor.exists({ phone, isDeleted: { $ne: true }, phoneVerifiedAt: { $ne: null } })) {
      throw phoneAlreadyRegistered();
    }
  }

  // The vendor a sign-in code may be issued to and accepted for: not deleted, phone proved.
  // Status is not filtered here, so a suspended vendor gets a real code and then 403.
  async findSignInVendor(phone) {
    return Vendor.findOne({ phone, isDeleted: { $ne: true }, phoneVerifiedAt: { $ne: null } });
  }

  // The registration's details, applied to the vendor account it creates or claims.
  accountFields(registration, now) {
    return {
      businessName: registration.businessName,
      ownerName: `${registration.ownerFirstName} ${registration.ownerLastName}`.trim(),
      ownerFirstName: registration.ownerFirstName,
      ownerLastName: registration.ownerLastName,
      categoryIds: registration.serviceCategoryIds,
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

    let challenge;
    try {
      challenge = await otpService.issue({
        purpose: OTP_PURPOSES.VENDOR_REGISTRATION,
        phone,
        registrationId: registration._id,
      });
    } catch (error) {
      // No code went out (the provider refused it, or a parallel request won the resend wait),
      // and the caller never learns this id, so the registration would only be an orphan.
      await VendorRegistration.deleteOne({ _id: registration._id });
      throw error;
    }

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

  // The proved phone completes the registration: the vendor is created (or an unproven sign-up of
  // the number is taken over) ACTIVE + APPROVED, and signed in.
  async verifyOtp({ registrationId, code }) {
    const registration = await this.findLiveRegistration(registrationId);

    await otpService.verify({
      purpose: OTP_PURPOSES.VENDOR_REGISTRATION,
      phone: registration.phone,
      registrationId: registration._id,
      code,
    });

    // Another registration for this number may have finished meanwhile.
    await this.assertPhoneFree(registration.phone);

    // Claimed before the account is created: a registration completes once, so a double tap (or
    // two codes verified at once) cannot create two vendors.
    const claimed = await VendorRegistration.findOneAndUpdate(
      { _id: registration._id, state: { $ne: 'COMPLETED' } },
      { $set: { state: 'COMPLETED' } }
    );
    if (!claimed) {
      throw registrationNotFound();
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
      // Handed back, so a fresh code can still finish it once the clash is gone.
      await VendorRegistration.updateOne(
        { _id: registration._id, state: 'COMPLETED', vendorId: null },
        { $set: { state: claimed.state } }
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

    logger.info(`vendor registered and signed in for ${maskPhoneForLog(vendor.phone)}`);

    return sessionService.createSession(vendor, 'VENDOR');
  }

  async requestSignInOtp({ phone }) {
    const vendor = await this.findSignInVendor(phone);
    if (!vendor) {
      logger.info(`vendor sign-in code asked for ${maskPhoneForLog(phone)}: no vendor account, none sent`);
    }
    return otpService.issue({ purpose: OTP_PURPOSES.VENDOR_SIGN_IN, phone, decoy: !vendor });
  }

  async verifySignInOtp({ phone, code }) {
    await otpService.verify({ purpose: OTP_PURPOSES.VENDOR_SIGN_IN, phone, code });

    // Nobody knows a decoy's code, so this is reached without a vendor only when the account was
    // deleted after its code was sent: refused as a wrong code, which reveals nothing.
    const vendor = await this.findSignInVendor(phone);
    if (!vendor) {
      throw invalidCodeError();
    }

    if (vendor.status !== 'ACTIVE') {
      throw accountSuspended();
    }

    logger.info(`vendor signed in for ${maskPhoneForLog(vendor.phone)}`);

    return sessionService.createSession(vendor, 'VENDOR');
  }
}

module.exports = new VendorAuthService();
