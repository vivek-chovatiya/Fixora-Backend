const bcrypt = require('bcryptjs');
const Vendor = require('../models/vendor');
const ApiError = require('../utils/ApiError');
const { escapeRegex } = require('../utils/regex');
const { ERROR_CODES } = require('../utils/errorCodes');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');

const vendorMapper = (vendor) => {
  if (!vendor) return null;
  return {
    id: vendor._id,
    businessName: vendor.businessName,
    ownerName: vendor.ownerName,
    ownerFirstName: vendor.ownerFirstName,
    ownerLastName: vendor.ownerLastName,
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

// The vendor as anyone may see them (requests contract §3): no email, phone, documents or status
// flags. Used for /vendors/list and /vendors/detail unless an administrator (or the vendor
// themself) asks.
const publicVendorMapper = (vendor) => {
  if (!vendor) return null;
  return {
    id: vendor._id,
    businessName: vendor.businessName,
    ownerName: vendor.ownerName,
    description: vendor.description,
    profileImage: vendor.profileImage,
    categoryIds: vendor.categoryIds,
    address: vendor.address,
    averageRating: vendor.averageRating,
    totalReviews: vendor.totalReviews,
    availability: vendor.availability,
  };
};

// Only vendors a customer can actually book are public.
const PUBLIC_FILTER = Object.freeze({ status: 'ACTIVE', approvalStatus: 'APPROVED' });

class VendorService {
  async getPublicVendorById(id) {
    const vendor = await Vendor.findOne({
      _id: id,
      ...PUBLIC_FILTER,
      isDeleted: { $ne: true },
    }).populate('categoryIds');
    if (!vendor) {
      throw new ApiError(404, 'Vendor not found.');
    }
    return publicVendorMapper(vendor);
  }

  // Public search covers names only: searching email or phone would let anyone test whether a
  // number or address belongs to a vendor. Status filters are ignored for the same reason.
  async getPublicVendors(body = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = { ...PUBLIC_FILTER, isDeleted: { $ne: true } };

    if (body.search) {
      const pattern = escapeRegex(body.search);
      filter.$or = [
        { businessName: { $regex: pattern, $options: 'i' } },
        { ownerName: { $regex: pattern, $options: 'i' } },
      ];
    }

    if (body.categoryId) {
      filter.categoryIds = body.categoryId;
    }

    const [vendors, total] = await Promise.all([
      Vendor.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Vendor.countDocuments(filter),
    ]);

    return {
      data: vendors.map(publicVendorMapper),
      meta: getPaginationMetadata(total, page, limit),
    };
  }

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
        { businessName: { $regex: escapeRegex(body.search), $options: 'i' } },
        { ownerName: { $regex: escapeRegex(body.search), $options: 'i' } },
        { email: { $regex: escapeRegex(body.search), $options: 'i' } },
        { phone: { $regex: escapeRegex(body.search), $options: 'i' } },
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

    // The sign-in phone is identity (requests contract §2, lead 17/11/2026): changing it will be
    // its own verified flow. The unchanged value is accepted, so a client can send the whole form.
    if (payload.phone !== undefined && payload.phone !== vendor.phone) {
      throw new ApiError(
        400,
        'Validation Failed',
        [{ field: 'phone', message: 'The sign-in phone number cannot be changed here.' }],
        ERROR_CODES.VALIDATION_FAILED
      );
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
    await Vendor.findByIdAndUpdate(id, {
      isDeleted: true,
      deletedAt: new Date(),
      $inc: { tokenVersion: 1 },
    });
    return true;
  }
}

module.exports = new VendorService();
