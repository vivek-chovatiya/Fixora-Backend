const bcrypt = require('bcryptjs');
const Customer = require('../models/customer');
const Address = require('../models/address');
const ApiError = require('../utils/ApiError');
const { escapeRegex } = require('../utils/regex');
const { ERROR_CODES } = require('../utils/errorCodes');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');

const customerMapper = (customer) => {
  if (!customer) return null;
  return {
    id: customer._id,
    firstName: customer.firstName,
    lastName: customer.lastName,
    fullName: `${customer.firstName} ${customer.lastName || ''}`.trim(),
    email: customer.email,
    phone: customer.phone,
    profileImage: customer.profileImage,
    defaultAddress: customer.defaultAddress,
    isVerified: customer.isVerified,
    lastLogin: customer.lastLogin,
    status: customer.status,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
};

class CustomerService {
  async createCustomer(payload) {
    const existingEmail = await Customer.findOne({
      email: payload.email.toLowerCase(),
      isDeleted: { $ne: true },
    });
    if (existingEmail) {
      throw new ApiError(409, 'Customer with this email already exists.');
    }

    const existingPhone = await Customer.findOne({
      phone: payload.phone,
      isDeleted: { $ne: true },
    });
    if (existingPhone) {
      throw new ApiError(409, 'Customer with this phone number already exists.');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(payload.password, salt);

    const customer = await Customer.create({
      ...payload,
      password: hashedPassword,
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
      filter.$or = [
        { firstName: { $regex: escapeRegex(body.search), $options: 'i' } },
        { lastName: { $regex: escapeRegex(body.search), $options: 'i' } },
        { email: { $regex: escapeRegex(body.search), $options: 'i' } },
        { phone: { $regex: escapeRegex(body.search), $options: 'i' } },
      ];
    }

    if (body.status) {
      filter.status = body.status;
    }

    const [customers, total] = await Promise.all([
      Customer.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Customer.countDocuments(filter),
    ]);

    const mapped = customers.map(customerMapper);
    const meta = getPaginationMetadata(total, page, limit);

    return { data: mapped, meta };
  }

  async updateCustomer(id, payload) {
    const customer = await Customer.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!customer) {
      throw new ApiError(404, 'Customer not found.');
    }

    if (payload.email && payload.email !== customer.email) {
      const existingEmail = await Customer.findOne({
        email: payload.email.toLowerCase(),
        isDeleted: { $ne: true },
      });
      if (existingEmail) {
        throw new ApiError(409, 'Customer with this email already exists.');
      }
    }

    // The sign-in phone is identity (requests contract §2, lead 17/11/2026): changing it will be
    // its own verified flow. The unchanged value is accepted, so a client can send the whole form.
    if (payload.phone !== undefined && payload.phone !== customer.phone) {
      throw new ApiError(
        400,
        'Validation Failed',
        [{ field: 'phone', message: 'The sign-in phone number cannot be changed here.' }],
        ERROR_CODES.VALIDATION_FAILED
      );
    }

    // The default address must be one of this customer's own: /auth/me populates it, so another
    // customer's address id here would hand their address out.
    if (payload.defaultAddress) {
      const owned = await Address.exists({
        _id: payload.defaultAddress,
        customerId: id,
        isDeleted: { $ne: true },
      });
      if (!owned) {
        throw new ApiError(
          400,
          'Validation Failed',
          [{ field: 'defaultAddress', message: 'This address is not in your address book.' }],
          ERROR_CODES.VALIDATION_FAILED
        );
      }
    }

    // Suspending ends every session at once (requests contract §8); reactivating does not bring
    // the old ones back.
    const suspending = payload.status && payload.status !== 'ACTIVE' && payload.status !== customer.status;
    const changes = suspending ? { ...payload, $inc: { tokenVersion: 1 } } : payload;

    const updated = await Customer.findByIdAndUpdate(id, changes, { new: true });
    return customerMapper(updated);
  }

  async deleteCustomer(id) {
    const customer = await Customer.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!customer) {
      throw new ApiError(404, 'Customer not found.');
    }
    await Customer.findByIdAndUpdate(id, {
      isDeleted: true,
      deletedAt: new Date(),
      $inc: { tokenVersion: 1 },
    });
    return true;
  }
}

module.exports = new CustomerService();
