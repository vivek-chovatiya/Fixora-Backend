const Vendor = require('../models/vendor');
const ApiError = require('../utils/ApiError');
const categoryService = require('./category');
const notificationService = require('./notification');
const { categoryMapper } = require('./category');
const { hashPassword } = require('../utils/password');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');
const { escapeRegex } = require('../utils/text');
const {
  ROLE,
  APPROVAL_STATUS,
  RECORD_STATUS,
  ERROR_CODE,
  NOTIFICATION_TYPE,
  RATING_RANKING,
} = require('../constants');

const mapCategories = (categoryIds = []) =>
  categoryIds.map((c) => (c && c._id ? { id: c._id, name: c.name, icon: c.icon } : c));

/** Full profile — only for the vendor themselves and admins. */
const vendorMapper = (vendor) => {
  if (!vendor) return null;
  const populated = vendor.categoryIds && vendor.categoryIds[0] && vendor.categoryIds[0]._id;
  return {
    id: vendor._id,
    role: ROLE.VENDOR,
    businessName: vendor.businessName,
    ownerName: vendor.ownerName,
    email: vendor.email,
    phone: vendor.phone,
    categoryIds: (vendor.categoryIds || []).map((c) => (c && c._id ? c._id : c)),
    categories: populated ? mapCategories(vendor.categoryIds) : [],
    address: vendor.address,
    description: vendor.description,
    workingAreas: vendor.workingAreas || [],
    workingHours: vendor.workingHours || '',
    profileImage: vendor.profileImage,
    shopImages: vendor.shopImages || [],
    documents: vendor.documents || [],
    averageRating: vendor.averageRating,
    totalReviews: vendor.totalReviews,
    approvalStatus: vendor.approvalStatus,
    approvalNote: vendor.approvalNote || '',
    availability: vendor.availability,
    status: vendor.status,
    lastLogin: vendor.lastLogin,
    createdAt: vendor.createdAt,
    updatedAt: vendor.updatedAt,
  };
};

/** Public profile — what customers see. No email, documents or internal state. */
const publicVendorMapper = (vendor) => {
  if (!vendor) return null;
  const populated = vendor.categoryIds && vendor.categoryIds[0] && vendor.categoryIds[0]._id;
  return {
    id: vendor._id,
    businessName: vendor.businessName,
    ownerName: vendor.ownerName,
    description: vendor.description,
    profileImage: vendor.profileImage,
    shopImages: vendor.shopImages || [],
    categories: populated ? mapCategories(vendor.categoryIds) : [],
    workingAreas: vendor.workingAreas || [],
    workingHours: vendor.workingHours || '',
    areaLabel: (vendor.workingAreas && vendor.workingAreas.join(', ')) || vendor.address || '',
    averageRating: vendor.averageRating,
    totalReviews: vendor.totalReviews,
    availability: vendor.availability,
    isAvailable: vendor.availability,
  };
};

/** Eligible to receive new work (PROJECT_BIBLE §11.3). */
const ELIGIBLE_FILTER = Object.freeze({
  approvalStatus: APPROVAL_STATUS.APPROVED,
  status: RECORD_STATUS.ACTIVE,
  availability: true,
  isDeleted: { $ne: true },
});

/**
 * Bayesian-weighted rating: a vendor's average is blended with a neutral prior
 * until they have enough reviews, so one 5★ review cannot outrank 42 reviews at 4.9★.
 */
const rankingScore = (vendor) => {
  const count = vendor.totalReviews || 0;
  const average = vendor.averageRating || 0;
  const { priorWeight, priorMean } = RATING_RANKING;
  return (count * average + priorWeight * priorMean) / (count + priorWeight);
};

const SELF_EDITABLE_FIELDS = [
  'businessName',
  'ownerName',
  'phone',
  'categoryIds',
  'address',
  'description',
  'workingAreas',
  'workingHours',
  'availability',
  'profileImage',
  'shopImages',
  'documents',
];
const ADMIN_EDITABLE_FIELDS = [...SELF_EDITABLE_FIELDS, 'email', 'status'];

const pick = (source, keys) =>
  keys.reduce((acc, key) => {
    if (source[key] !== undefined) acc[key] = source[key];
    return acc;
  }, {});

class VendorService {
  async createVendor(payload) {
    const email = payload.email.toLowerCase();
    const [existingEmail, existingPhone] = await Promise.all([
      Vendor.findOne({ email, isDeleted: { $ne: true } }),
      Vendor.findOne({ phone: payload.phone, isDeleted: { $ne: true } }),
    ]);
    if (existingEmail) {
      throw new ApiError(409, 'A vendor with this email already exists.', [
        { field: 'email', message: 'A vendor with this email already exists.' },
      ]);
    }
    if (existingPhone) {
      throw new ApiError(409, 'A vendor with this phone number already exists.', [
        { field: 'phone', message: 'A vendor with this phone number already exists.' },
      ]);
    }

    await categoryService.assertCategoriesExist(payload.categoryIds);

    const vendor = await Vendor.create({
      ...pick(payload, SELF_EDITABLE_FIELDS),
      email,
      password: await hashPassword(payload.password),
      // Approval is admin-only, regardless of what the client sends.
      approvalStatus: APPROVAL_STATUS.PENDING,
    });

    return this.getVendorById(vendor._id);
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

  async getPublicVendorById(id) {
    const vendor = await Vendor.findOne({
      _id: id,
      approvalStatus: APPROVAL_STATUS.APPROVED,
      status: RECORD_STATUS.ACTIVE,
      isDeleted: { $ne: true },
    }).populate('categoryIds');
    if (!vendor) {
      throw new ApiError(404, 'Vendor not found.');
    }
    return publicVendorMapper(vendor);
  }

  /** Raw document for cross-service checks. */
  async getVendorDocument(id) {
    const vendor = await Vendor.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!vendor) {
      throw new ApiError(404, 'Vendor not found.');
    }
    return vendor;
  }

  async assertApprovedAndActive(id) {
    const vendor = await this.getVendorDocument(id);
    if (vendor.status !== RECORD_STATUS.ACTIVE) {
      throw new ApiError(403, 'Your vendor account is inactive.', null, ERROR_CODE.ACCOUNT_INACTIVE);
    }
    if (vendor.approvalStatus !== APPROVAL_STATUS.APPROVED) {
      throw new ApiError(
        403,
        'Your account is under verification. You can receive requests once approved.',
        null,
        ERROR_CODE.VENDOR_NOT_APPROVED
      );
    }
    return vendor;
  }

  /** Used for directed dispatch: the chosen vendor must be able to take this category. */
  async assertEligibleForCategory(vendorId, categoryId) {
    const vendor = await Vendor.findOne({ _id: vendorId, ...ELIGIBLE_FILTER, categoryIds: categoryId });
    if (!vendor) {
      throw new ApiError(
        422,
        'The selected vendor is not available for this service. Choose another vendor or continue with any available vendor.',
        [{ field: 'vendorId', message: 'Selected vendor is not available for this service.' }],
        ERROR_CODE.VENDOR_NOT_ELIGIBLE
      );
    }
    return vendor;
  }

  async getEligibleVendorIdsForCategory(categoryId, excludeIds = []) {
    const vendors = await Vendor.find(
      { ...ELIGIBLE_FILTER, categoryIds: categoryId, _id: { $nin: excludeIds } },
      { _id: 1 }
    );
    return vendors.map((v) => v._id);
  }

  /**
   * Recommended vendors for a service (App PROJECT_BIBLE §18A).
   * The backend owns eligibility and ordering; the app renders this list as-is.
   */
  async getRecommendedVendors({ categoryId, limit = 20 }) {
    await categoryService.assertPublicCategory(categoryId);
    const vendors = await Vendor.find({ ...ELIGIBLE_FILTER, categoryIds: categoryId })
      .sort({ createdAt: 1 })
      .populate('categoryIds');
    return vendors
      .map((vendor) => ({ vendor, score: rankingScore(vendor) }))
      .sort((a, b) => b.score - a.score || (b.vendor.totalReviews || 0) - (a.vendor.totalReviews || 0))
      .slice(0, limit)
      .map(({ vendor }) => publicVendorMapper(vendor));
  }

  async getAllVendors(body = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = { isDeleted: { $ne: true } };

    if (body.search) {
      const term = { $regex: escapeRegex(body.search), $options: 'i' };
      filter.$or = [{ businessName: term }, { ownerName: term }, { email: term }, { phone: term }];
    }
    if (body.approvalStatus) filter.approvalStatus = body.approvalStatus;
    if (body.status) filter.status = body.status;
    if (body.categoryId) filter.categoryIds = body.categoryId;

    const [vendors, total] = await Promise.all([
      Vendor.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }).populate('categoryIds'),
      Vendor.countDocuments(filter),
    ]);

    return { data: vendors.map(vendorMapper), meta: getPaginationMetadata(total, page, limit) };
  }

  /** Vendors edit only themselves, and never rating or approval (PROJECT_BIBLE §11.3). */
  async updateVendor(actor, payload) {
    const isAdmin = actor.role === ROLE.ADMIN;
    const targetId = isAdmin && payload.id ? payload.id : actor.id;

    if (!isAdmin && payload.id && payload.id.toString() !== actor.id.toString()) {
      throw new ApiError(403, 'You can only update your own profile.');
    }

    const vendor = await this.getVendorDocument(targetId);
    const update = pick(payload, isAdmin ? ADMIN_EDITABLE_FIELDS : SELF_EDITABLE_FIELDS);

    if (update.categoryIds) {
      await categoryService.assertCategoriesExist(update.categoryIds);
    }

    if (update.email && update.email !== vendor.email) {
      const existingEmail = await Vendor.findOne({
        email: update.email.toLowerCase(),
        isDeleted: { $ne: true },
      });
      if (existingEmail) {
        throw new ApiError(409, 'A vendor with this email already exists.');
      }
    }

    if (update.phone && update.phone !== vendor.phone) {
      const existingPhone = await Vendor.findOne({ phone: update.phone, isDeleted: { $ne: true } });
      if (existingPhone) {
        throw new ApiError(409, 'A vendor with this phone number already exists.', [
          { field: 'phone', message: 'A vendor with this phone number already exists.' },
        ]);
      }
    }

    await Vendor.findByIdAndUpdate(targetId, update);
    return this.getVendorById(targetId);
  }

  async updateApprovalStatus(id, approvalStatus, note = '') {
    await this.getVendorDocument(id);
    await Vendor.findByIdAndUpdate(id, { approvalStatus, approvalNote: note || '' });

    const messages = {
      [APPROVAL_STATUS.APPROVED]: {
        title: 'Account approved',
        message: 'Your vendor account has been approved. You can now receive service requests.',
      },
      [APPROVAL_STATUS.REJECTED]: {
        title: 'Account not approved',
        message: note || 'Your vendor application was not approved. Contact support for details.',
      },
      [APPROVAL_STATUS.PENDING]: {
        title: 'Account under review',
        message: 'Your vendor account is under verification.',
      },
    };

    await notificationService.notify({
      userId: id,
      userRole: ROLE.VENDOR,
      type: NOTIFICATION_TYPE.ACCOUNT,
      ...messages[approvalStatus],
    });

    return this.getVendorById(id);
  }

  async updateRating(vendorId, averageRating, totalReviews) {
    await Vendor.findByIdAndUpdate(vendorId, { averageRating, totalReviews });
  }

  async deleteVendor(id) {
    await this.getVendorDocument(id);
    await Vendor.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() });
    return true;
  }

  /** Minimal shape shown on a request. */
  toRequestParty(vendor, { includeContact }) {
    if (!vendor || !vendor._id) return null;
    return {
      id: vendor._id,
      businessName: vendor.businessName,
      ownerName: vendor.ownerName,
      phone: includeContact ? vendor.phone : null,
      profileImage: vendor.profileImage || null,
      averageRating: vendor.averageRating,
      totalReviews: vendor.totalReviews,
    };
  }
}

module.exports = new VendorService();
module.exports.vendorMapper = vendorMapper;
module.exports.publicVendorMapper = publicVendorMapper;
module.exports.categoryMapper = categoryMapper;
