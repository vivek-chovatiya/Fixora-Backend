const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const Customer = require('../models/customer');
const Vendor = require('../models/vendor');
const Admin = require('../models/admin');
const customerService = require('./customer');
const vendorService = require('./vendor');
const ApiError = require('../utils/ApiError');

const generateToken = (payload) => {
  const jwtSecret = process.env.JWT_SECRET || 'fixora_secret_key_change_in_production';
  const jwtExpires = process.env.JWT_EXPIRES || '7d';
  return jwt.sign(payload, jwtSecret, { expiresIn: jwtExpires });
};

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

    if (!user) {
      throw new ApiError(401, 'Invalid email or password.');
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      throw new ApiError(401, 'Invalid email or password.');
    }

    if (user.status !== 'ACTIVE') {
      throw new ApiError(403, 'Account is inactive or suspended.');
    }

    const token = generateToken({ id: user._id, email: user.email, role });

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

  async getCurrentUser(userContext) {
    const { id, role } = userContext;
    if (role === 'CUSTOMER') return customerService.getCustomerById(id);
    if (role === 'VENDOR') return vendorService.getVendorById(id);
    if (role === 'ADMIN') return require('./admin').getAdminById(id);

    throw new ApiError(400, 'Invalid user role.');
  }
}

module.exports = new AuthService();
