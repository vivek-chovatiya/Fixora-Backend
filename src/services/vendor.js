const bcrypt = require('bcryptjs');
const Vendor = require('../models/vendor');
const ApiError = require('../utils/ApiError');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');

const vendorMapper = (vendor) => {
  if (!vendor) return null;
  return {
    id: vendor._id,
    businessName: vendor.businessName,
    ownerName: vendor.ownerName,
    email: vendor.email,
    phone: vendor.phone,
    categoryIds: vendor.categoryIds,
    address: vendor.address,
    description: vendor.description,
    profileImage: vendor.profileImage,
    shopImages: vendor.shopImages || [],
    documents: vendor.documents || [],
    averageRating: vendor.averageRating,
    totalReviews: vendor.totalReviews,
    approvalStatus: vendor.approvalStatus,
    availability: vendor.availability,
    status: vendor.status,
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt,
  };
};

class VendorService {
  async createVendor(payload) {
    const existingEmail = await Vendor.findOne({
      email: payload.email.toLowerCase(),
      isDeleted: { $ne: true },
    });
    if (existingEmail) {
      throw new ApiError(409, 'Vendor with this email already exists.');
    }

    const existingPhone = await Vendor.findOne({ phone: payload.phone, isDeleted: { $ne: true } });
    if (existingPhone) {
      throw new ApiError(409, 'Vendor with this phone number already exists.');
    }

    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(payload.password, salt);

    const vendor = await Vendor.create({
      ...payload,
      password: hashedPassword,
    });

    return vendorMapper(vendor);
  }

  async getVendorById(id) {
    const vendor = await Vendor.findOne({ _id: id, isDeleted: { $ne: true } }).populate(
      'categoryIds'
    );
    if (!vendor) {
      throw new ApiError(404, 'Vendor not found.');
    }
    return vendorMapper(vendor);
  }

  async getAllVendors(body = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = { isDeleted: { $ne: true } };

    if (body.search) {
      filter.$or = [
        { businessName: { $regex: body.search, $options: 'i' } },
        { ownerName: { $regex: body.search, $options: 'i' } },
        { email: { $regex: body.search, $options: 'i' } },
        { phone: { $regex: body.search, $options: 'i' } },
      ];
    }

    if (body.approvalStatus) {
      filter.approvalStatus = body.approvalStatus;
    }

    if (body.status) {
      filter.status = body.status;
    }

    if (body.categoryId) {
      filter.categoryIds = body.categoryId;
    }

    const [vendors, total] = await Promise.all([
      Vendor.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Vendor.countDocuments(filter),
    ]);

    const mapped = vendors.map(vendorMapper);
    const meta = getPaginationMetadata(total, page, limit);

    return { data: mapped, meta };
  }

  async updateVendor(id, payload) {
    const vendor = await Vendor.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!vendor) {
      throw new ApiError(404, 'Vendor not found.');
    }

    if (payload.email && payload.email !== vendor.email) {
      const existingEmail = await Vendor.findOne({
        email: payload.email.toLowerCase(),
        isDeleted: { $ne: true },
      });
      if (existingEmail) {
        throw new ApiError(409, 'Vendor with this email already exists.');
      }
    }

    if (payload.phone && payload.phone !== vendor.phone) {
      const existingPhone = await Vendor.findOne({
        phone: payload.phone,
        isDeleted: { $ne: true },
      });
      if (existingPhone) {
        throw new ApiError(409, 'Vendor with this phone number already exists.');
      }
    }

    const updated = await Vendor.findByIdAndUpdate(id, payload, { new: true });
    return vendorMapper(updated);
  }

  async updateApprovalStatus(id, approvalStatus) {
    const vendor = await Vendor.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!vendor) {
      throw new ApiError(404, 'Vendor not found.');
    }

    const updated = await Vendor.findByIdAndUpdate(id, { approvalStatus }, { new: true });
    return vendorMapper(updated);
  }

  async deleteVendor(id) {
    const vendor = await Vendor.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!vendor) {
      throw new ApiError(404, 'Vendor not found.');
    }
    await Vendor.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() });
    return true;
  }
}

module.exports = new VendorService();
