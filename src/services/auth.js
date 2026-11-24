const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const Customer = require('../models/customer');
const Vendor = require('../models/vendor');
const Admin = require('../models/admin');
const customerService = require('./customer');
const vendorService = require('./vendor');
const adminService = require('./admin');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const config = require('../config');
const { comparePassword, hashPassword } = require('../utils/password');
const { normalizePhone } = require('../utils/phone');
const { ROLE, RECORD_STATUS, ERROR_CODE } = require('../constants');

const MODEL_BY_ROLE = Object.freeze({
  [ROLE.CUSTOMER]: Customer,
  [ROLE.VENDOR]: Vendor,
  [ROLE.ADMIN]: Admin,
});

const generateToken = (payload) =>
  jwt.sign(payload, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

/** Login accepts either an email or a phone number (App PROJECT_BIBLE §8). */
const identifierFilter = (identifier) => {
  const value = String(identifier).trim();
  if (value.includes('@')) return { email: value.toLowerCase() };
  return { phone: normalizePhone(value) || value };
};

const hashResetCode = (code) => crypto.createHash('sha256').update(String(code)).digest('hex');

class AuthService {
  async getProfile(id, role) {
    if (role === ROLE.CUSTOMER) return customerService.getCustomerById(id);
    if (role === ROLE.VENDOR) return vendorService.getVendorById(id);
    if (role === ROLE.ADMIN) return adminService.getAdminById(id);
    throw new ApiError(400, 'Invalid user role.');
  }

  async login({ identifier, email, password, role }) {
    const Model = MODEL_BY_ROLE[role];
    const lookup = identifier || email;

    const user = await Model.findOne({ ...identifierFilter(lookup), isDeleted: { $ne: true } }).select(
      '+password'
    );

    const isMatch = user ? await comparePassword(password, user.password) : false;
    if (!user || !isMatch) {
      throw new ApiError(
        401,
        'Invalid email/phone or password.',
        null,
        ERROR_CODE.INVALID_CREDENTIALS
      );
    }

    if (user.status !== RECORD_STATUS.ACTIVE) {
      throw new ApiError(
        403,
        'Your account is inactive or suspended. Please contact support.',
        null,
        ERROR_CODE.ACCOUNT_INACTIVE
      );
    }

    if (role !== ROLE.ADMIN) {
      await Model.findByIdAndUpdate(user._id, { lastLogin: new Date() });
    }

    logger.info(`Login: ${role} ${user._id}`);

    const token = generateToken({ id: user._id, email: user.email, role });
    return { token, role, user: await this.getProfile(user._id, role) };
  }

  async registerCustomer(payload) {
    const customer = await customerService.createCustomer(payload);
    logger.info(`Customer registered: ${customer.id}`);
    const token = generateToken({ id: customer.id, email: customer.email, role: ROLE.CUSTOMER });
    return { token, role: ROLE.CUSTOMER, user: customer };
  }

  async registerVendor(payload) {
    const vendor = await vendorService.createVendor(payload);
    logger.info(`Vendor registered (pending approval): ${vendor.id}`);
    await adminService.notifyAdmins({
      title: 'New vendor registration',
      message: `${vendor.businessName} has registered and is awaiting approval.`,
      referenceId: vendor.id,
    });
    const token = generateToken({ id: vendor.id, email: vendor.email, role: ROLE.VENDOR });
    return { token, role: ROLE.VENDOR, user: vendor };
  }

  async getCurrentUser({ id, role }) {
    return this.getProfile(id, role);
  }

  /**
   * Issues a 6-digit reset code. The response is identical whether or not the
   * account exists, so this endpoint cannot be used to discover accounts.
   *
   * Phase 1 has no email/SMS provider. Outside production the code is returned
   * in the response so the flow can be exercised; in production it is only logged
   * at debug level until a delivery provider is plugged in here.
   */
  async forgotPassword({ identifier, role }) {
    const Model = MODEL_BY_ROLE[role];
    const user = await Model.findOne({ ...identifierFilter(identifier), isDeleted: { $ne: true } });

    const result = { message: 'If an account exists, a reset code has been sent.' };
    if (!user) return result;

    const code = String(crypto.randomInt(100000, 1000000));
    const expiresAt = new Date(Date.now() + config.passwordReset.codeTtlMinutes * 60 * 1000);
    await Model.findByIdAndUpdate(user._id, {
      resetCodeHash: hashResetCode(code),
      resetCodeExpiresAt: expiresAt,
    });

    logger.info(`Password reset requested: ${role} ${user._id}`);

    if (!config.isProduction) {
      result.devResetCode = code;
    }
    return result;
  }

  async resetPassword({ identifier, role, code, newPassword }) {
    const Model = MODEL_BY_ROLE[role];
    const user = await Model.findOne({
      ...identifierFilter(identifier),
      isDeleted: { $ne: true },
    }).select('+resetCodeHash +resetCodeExpiresAt');

    const valid =
      user &&
      user.resetCodeHash &&
      user.resetCodeExpiresAt &&
      user.resetCodeExpiresAt.getTime() > Date.now() &&
      user.resetCodeHash === hashResetCode(code);

    if (!valid) {
      throw new ApiError(
        400,
        'The reset code is invalid or has expired.',
        [{ field: 'code', message: 'The reset code is invalid or has expired.' }],
        ERROR_CODE.INVALID_RESET_CODE
      );
    }

    await Model.findByIdAndUpdate(user._id, {
      password: await hashPassword(newPassword),
      resetCodeHash: null,
      resetCodeExpiresAt: null,
    });
    logger.info(`Password reset completed: ${role} ${user._id}`);
    return true;
  }

  async changePassword({ id, role }, { currentPassword, newPassword }) {
    const Model = MODEL_BY_ROLE[role];
    const user = await Model.findOne({ _id: id, isDeleted: { $ne: true } }).select('+password');
    if (!user || !(await comparePassword(currentPassword, user.password))) {
      throw new ApiError(400, 'Current password is incorrect.', [
        { field: 'currentPassword', message: 'Current password is incorrect.' },
      ]);
    }
    await Model.findByIdAndUpdate(id, { password: await hashPassword(newPassword) });
    return true;
  }
}

module.exports = new AuthService();
