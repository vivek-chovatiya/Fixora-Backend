const bcrypt = require('bcryptjs');
const Customer = require('../models/customer');
const Vendor = require('../models/vendor');
const Admin = require('../models/admin');
const customerService = require('./customer');
const vendorService = require('./vendor');
const { toSessionUser } = require('./session');
const ApiError = require('../utils/ApiError');
const { generateToken } = require('../utils/token');

class AuthService {
  async login(payload) {
    const { email, password, role } = payload;
    let user = null;

    if (role === 'CUSTOMER') {
      user = await Customer.findOne({
        email: email.toLowerCase(),
        isDeleted: { $ne: true },
      }).select('+password');
    } else if (role === 'VENDOR') {
      user = await Vendor.findOne({ email: email.toLowerCase(), isDeleted: { $ne: true } }).select(
        '+password'
      );
    } else if (role === 'ADMIN') {
      user = await Admin.findOne({ email: email.toLowerCase(), isDeleted: { $ne: true } }).select(
        '+password'
      );
    }

    // Phone-registered accounts have no password; they are refused like an unknown email.
    if (!user || !user.password) {
      throw new ApiError(401, 'Invalid email or password.');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new ApiError(401, 'Invalid email or password.');
    }

    if (user.status !== 'ACTIVE') {
      throw new ApiError(403, 'Account is inactive or suspended.');
    }

    const token = generateToken({
      id: user._id,
      email: user.email,
      role,
      v: user.tokenVersion || 0,
    });

    return {
      user: {
        id: user._id,
        email: user.email,
        name: user.firstName || user.businessName || user.name,
      },
      role,
      token,
    };
  }

  async registerCustomer(payload) {
    const customer = await customerService.createCustomer(payload);
    const token = generateToken({ id: customer.id, email: customer.email, role: 'CUSTOMER' });

    return {
      user: customer,
      role: 'CUSTOMER',
      token,
    };
  }

  async registerVendor(payload) {
    const vendor = await vendorService.createVendor(payload);
    const token = generateToken({ id: vendor.id, email: vendor.email, role: 'VENDOR' });

    return {
      user: vendor,
      role: 'VENDOR',
      token,
    };
  }

  // The existing profile fields (which the web views read) plus the mobile session user's fields
  // on top, so /auth/me returns the same `user` shape as a phone sign-in session for both roles.
  async getCurrentUser(userContext) {
    const { id, role } = userContext;
    if (role === 'CUSTOMER') {
      const profile = await customerService.getCustomerById(id);
      return { ...profile, ...toSessionUser(profile, 'CUSTOMER') };
    }
    if (role === 'VENDOR') {
      const profile = await vendorService.getVendorById(id);
      return { ...profile, ...toSessionUser(profile, 'VENDOR') };
    }
    if (role === 'ADMIN') return require('./admin').getAdminById(id);

    throw new ApiError(400, 'Invalid user role.');
  }
}

module.exports = new AuthService();
