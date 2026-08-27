const bcrypt = require('bcryptjs');
const Admin = require('../models/admin');
const Customer = require('../models/customer');
const Vendor = require('../models/vendor');
const ApiError = require('../utils/ApiError');

const adminMapper = (admin) => {
  if (!admin) return null;
  return {
    id: admin._id,
    name: admin.name,
    email: admin.email,
    phone: admin.phone,
    role: admin.role,
    status: admin.status,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
};

class AdminService {
  async createAdmin(payload) {
    const existingEmail = await Admin.findOne({
      email: payload.email.toLowerCase(),
      isDeleted: { $ne: true },
    });
    if (existingEmail) {
      throw new ApiError(409, 'Admin user with this email already exists.');
    }

    const existingPhone = await Admin.findOne({ phone: payload.phone, isDeleted: { $ne: true } });
    if (existingPhone) {
      throw new ApiError(409, 'Admin user with this phone number already exists.');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(payload.password, salt);

    const admin = await Admin.create({
      ...payload,
      password: hashedPassword,
    });

    return adminMapper(admin);
  }

  async getAdminById(id) {
    const admin = await Admin.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!admin) {
      throw new ApiError(404, 'Admin user not found.');
    }
    return adminMapper(admin);
  }

  async getDashboardMetrics() {
    const [totalCustomers, totalVendors, pendingVendors] = await Promise.all([
      Customer.countDocuments({ isDeleted: { $ne: true } }),
      Vendor.countDocuments({ isDeleted: { $ne: true } }),
      Vendor.countDocuments({ approvalStatus: 'PENDING', isDeleted: { $ne: true } }),
    ]);

    return {
      totalCustomers,
      totalVendors,
      pendingVendors,
    };
  }
}

module.exports = new AdminService();
