const Admin = require('../models/admin');
const Customer = require('../models/customer');
const Vendor = require('../models/vendor');
const ServiceRequest = require('../models/servicerequest');
const ApiError = require('../utils/ApiError');
const notificationService = require('./notification');
const { hashPassword } = require('../utils/password');
const { ROLE, APPROVAL_STATUS, REQUEST_STATUS, NOTIFICATION_TYPE } = require('../constants');

const adminMapper = (admin) => {
  if (!admin) return null;
  return {
    id: admin._id,
    role: ROLE.ADMIN,
    name: admin.name,
    fullName: admin.name,
    email: admin.email,
    phone: admin.phone,
    status: admin.status,
    createdAt: admin.createdAt,
    updatedAt: admin.updatedAt,
  };
};

const startOfToday = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

class AdminService {
  async createAdmin(payload) {
    const email = payload.email.toLowerCase();
    const [existingEmail, existingPhone] = await Promise.all([
      Admin.findOne({ email, isDeleted: { $ne: true } }),
      Admin.findOne({ phone: payload.phone, isDeleted: { $ne: true } }),
    ]);
    if (existingEmail) {
      throw new ApiError(409, 'Admin user with this email already exists.');
    }
    if (existingPhone) {
      throw new ApiError(409, 'Admin user with this phone number already exists.');
    }

    const admin = await Admin.create({
      name: payload.name,
      email,
      phone: payload.phone,
      password: await hashPassword(payload.password),
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

  async notifyAdmins({ title, message, referenceId }) {
    const admins = await Admin.find({ isDeleted: { $ne: true } }, { _id: 1 });
    return notificationService.notifyMany(
      admins.map((a) => a._id),
      { userRole: ROLE.ADMIN, title, message, referenceId, type: NOTIFICATION_TYPE.ACCOUNT }
    );
  }

  async getDashboardMetrics() {
    const notDeleted = { isDeleted: { $ne: true } };
    const [
      totalCustomers,
      totalVendors,
      pendingVendors,
      approvedVendors,
      totalRequests,
      todayRequests,
      openRequests,
      activeRequests,
      completedRequests,
    ] = await Promise.all([
      Customer.countDocuments(notDeleted),
      Vendor.countDocuments(notDeleted),
      Vendor.countDocuments({ ...notDeleted, approvalStatus: APPROVAL_STATUS.PENDING }),
      Vendor.countDocuments({ ...notDeleted, approvalStatus: APPROVAL_STATUS.APPROVED }),
      ServiceRequest.countDocuments(notDeleted),
      ServiceRequest.countDocuments({ ...notDeleted, createdAt: { $gte: startOfToday() } }),
      ServiceRequest.countDocuments({ ...notDeleted, status: REQUEST_STATUS.PENDING_VENDOR }),
      ServiceRequest.countDocuments({
        ...notDeleted,
        status: { $in: [REQUEST_STATUS.ACCEPTED, REQUEST_STATUS.IN_PROGRESS] },
      }),
      ServiceRequest.countDocuments({
        ...notDeleted,
        status: { $in: [REQUEST_STATUS.COMPLETED, REQUEST_STATUS.CLOSED] },
      }),
    ]);

    return {
      totalCustomers,
      totalVendors,
      pendingVendors,
      approvedVendors,
      totalRequests,
      todayRequests,
      openRequests,
      activeRequests,
      completedRequests,
    };
  }
}

module.exports = new AdminService();
