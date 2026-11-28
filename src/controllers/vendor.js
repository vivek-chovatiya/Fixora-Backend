const vendorService = require('../services/vendor');
const ApiResponse = require('../utils/ApiResponse');
const { assertSelfOrAdmin, withoutAdminFields } = require('../utils/ownership');

// A vendor may not change these on their own profile (requests contract §2).
const ADMIN_ONLY_FIELDS = ['approvalStatus', 'status', 'averageRating', 'totalReviews'];

const isAdmin = (user) => Boolean(user && user.role === 'ADMIN');
const isSelf = (user, id) => Boolean(user && user.role === 'VENDOR' && String(user.id) === String(id));

class VendorController {
  // Public route: the full record for an administrator or the vendor themself, the public shape
  // (requests contract §3) for everyone else.
  async getById(req, res, next) {
    try {
      const vendor =
        isAdmin(req.user) || isSelf(req.user, req.body.id)
          ? await vendorService.getVendorById(req.body.id)
          : await vendorService.getPublicVendorById(req.body.id);
      return ApiResponse.success(res, 'Vendor details retrieved successfully.', vendor);
    } catch (error) {
      next(error);
    }
  }

  // Public route: an administrator gets every vendor with every field (the web admin view reads
  // phone, email and approval status); anyone else only bookable vendors in the public shape.
  async getAll(req, res, next) {
    try {
      const { data, meta } = isAdmin(req.user)
        ? await vendorService.getAllVendors(req.body)
        : await vendorService.getPublicVendors(req.body);
      return ApiResponse.success(res, 'Vendor list retrieved successfully.', data, meta);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      assertSelfOrAdmin(req.user, req.body.id, 'Vendor not found.');
      const payload = withoutAdminFields(req.user, req.body, ADMIN_ONLY_FIELDS);
      const vendor = await vendorService.updateVendor(req.body.id, payload);
      return ApiResponse.success(res, 'Vendor profile updated successfully.', vendor);
    } catch (error) {
      next(error);
    }
  }

  async updateApprovalStatus(req, res, next) {
    try {
      const vendor = await vendorService.updateApprovalStatus(req.body.id, req.body.approvalStatus);
      return ApiResponse.success(res, 'Vendor approval status updated successfully.', vendor);
    } catch (error) {
      next(error);
    }
  }

  async remove(req, res, next) {
    try {
      await vendorService.deleteVendor(req.body.id);
      return ApiResponse.success(res, 'Vendor deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new VendorController();
