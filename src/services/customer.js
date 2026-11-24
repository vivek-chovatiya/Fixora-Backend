const Customer = require('../models/customer');
const ApiError = require('../utils/ApiError');
const { ROLE } = require('../constants');
const { hashPassword } = require('../utils/password');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');
const { escapeRegex, fullName } = require('../utils/text');
const { addressMapper } = require('./address');

const customerMapper = (customer) => {
  if (!customer) return null;
  const defaultAddress =
    customer.defaultAddress && customer.defaultAddress._id
      ? addressMapper(customer.defaultAddress)
      : null;
  return {
    id: customer._id,
    role: ROLE.CUSTOMER,
    firstName: customer.firstName,
    lastName: customer.lastName,
    fullName: fullName(customer.firstName, customer.lastName),
    email: customer.email,
    phone: customer.phone,
    profileImage: customer.profileImage,
    defaultAddressId: defaultAddress ? defaultAddress.id : customer.defaultAddress,
    defaultAddress,
    isVerified: customer.isVerified,
    lastLogin: customer.lastLogin,
    status: customer.status,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
};

/** Fields a customer may change about themselves (PROJECT_BIBLE §11.2). */
const SELF_EDITABLE_FIELDS = ['firstName', 'lastName', 'phone', 'profileImage'];
const ADMIN_EDITABLE_FIELDS = [...SELF_EDITABLE_FIELDS, 'email', 'status'];

const pick = (source, keys) =>
  keys.reduce((acc, key) => {
    if (source[key] !== undefined) acc[key] = source[key];
    return acc;
  }, {});

class CustomerService {
  async createCustomer(payload) {
    const email = payload.email.toLowerCase();
    const [existingEmail, existingPhone] = await Promise.all([
      Customer.findOne({ email, isDeleted: { $ne: true } }),
      Customer.findOne({ phone: payload.phone, isDeleted: { $ne: true } }),
    ]);
    if (existingEmail) {
      throw new ApiError(409, 'An account with this email already exists.', [
        { field: 'email', message: 'An account with this email already exists.' },
      ]);
    }
    if (existingPhone) {
      throw new ApiError(409, 'An account with this phone number already exists.', [
        { field: 'phone', message: 'An account with this phone number already exists.' },
      ]);
    }

    const customer = await Customer.create({
      firstName: payload.firstName,
      lastName: payload.lastName || '',
      email,
      phone: payload.phone,
      password: await hashPassword(payload.password),
    });

    return customerMapper(customer);
  }

  async getCustomerById(id) {
    const customer = await Customer.findOne({ _id: id, isDeleted: { $ne: true } }).populate(
      'defaultAddress'
    );
    if (!customer) {
      throw new ApiError(404, 'Customer not found.');
    }
    return customerMapper(customer);
  }

  async getAllCustomers(body = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = { isDeleted: { $ne: true } };

    if (body.search) {
      const term = { $regex: escapeRegex(body.search), $options: 'i' };
      filter.$or = [{ firstName: term }, { lastName: term }, { email: term }, { phone: term }];
    }

    if (body.status) {
      filter.status = body.status;
    }

    const [customers, total] = await Promise.all([
      Customer.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Customer.countDocuments(filter),
    ]);

    return { data: customers.map(customerMapper), meta: getPaginationMetadata(total, page, limit) };
  }

  /**
   * Customers may only edit their own profile; admins may edit any customer.
   */
  async updateCustomer(actor, payload) {
    const isAdmin = actor.role === ROLE.ADMIN;
    const targetId = isAdmin && payload.id ? payload.id : actor.id;

    if (!isAdmin && payload.id && payload.id.toString() !== actor.id.toString()) {
      throw new ApiError(403, 'You can only update your own profile.');
    }

    const customer = await Customer.findOne({ _id: targetId, isDeleted: { $ne: true } });
    if (!customer) {
      throw new ApiError(404, 'Customer not found.');
    }

    const update = pick(payload, isAdmin ? ADMIN_EDITABLE_FIELDS : SELF_EDITABLE_FIELDS);

    if (update.email && update.email !== customer.email) {
      const existingEmail = await Customer.findOne({
        email: update.email.toLowerCase(),
        isDeleted: { $ne: true },
      });
      if (existingEmail) {
        throw new ApiError(409, 'An account with this email already exists.', [
          { field: 'email', message: 'An account with this email already exists.' },
        ]);
      }
    }

    if (update.phone && update.phone !== customer.phone) {
      const existingPhone = await Customer.findOne({
        phone: update.phone,
        isDeleted: { $ne: true },
      });
      if (existingPhone) {
        throw new ApiError(409, 'An account with this phone number already exists.', [
          { field: 'phone', message: 'An account with this phone number already exists.' },
        ]);
      }
    }

    await Customer.findByIdAndUpdate(targetId, update);
    return this.getCustomerById(targetId);
  }

  async deleteCustomer(id) {
    const customer = await Customer.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!customer) {
      throw new ApiError(404, 'Customer not found.');
    }
    await Customer.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() });
    return true;
  }

  /** Minimal shape shown to vendors on a request. */
  toRequestParty(customer, { includeContact }) {
    if (!customer || !customer._id) return null;
    return {
      id: customer._id,
      name: fullName(customer.firstName, customer.lastName),
      phone: includeContact ? customer.phone : null,
      profileImage: customer.profileImage || null,
    };
  }
}

module.exports = new CustomerService();
module.exports.customerMapper = customerMapper;
