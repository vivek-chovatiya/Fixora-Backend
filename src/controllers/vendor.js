const vendorService = require('../services/vendor');
const serviceRequestService = require('../services/servicerequest');
const ApiResponse = require('../utils/ApiResponse');
const { wrapController } = require('../utils/asyncHandler');

class VendorController {
  async getById(req, res) {
    const vendor = await vendorService.getVendorById(req.body.id);
    return ApiResponse.success(res, 'Vendor details retrieved successfully.', vendor);
  }

  async getPublicById(req, res) {
    const vendor = await vendorService.getPublicVendorById(req.body.id);
    return ApiResponse.success(res, 'Vendor details retrieved successfully.', vendor);
  }

  async getAll(req, res) {
    const { data, meta } = await vendorService.getAllVendors(req.body);
    return ApiResponse.success(res, 'Vendor list retrieved successfully.', data, meta);
  }

  async recommended(req, res) {
    const vendors = await vendorService.getRecommendedVendors(req.body);
    return ApiResponse.success(res, 'Recommended vendors retrieved successfully.', vendors, {
      total: vendors.length,
    });
  }

  async update(req, res) {
    const vendor = await vendorService.updateVendor(req.user, req.body);
    return ApiResponse.success(res, 'Profile updated successfully.', vendor);
  }

  async updateApprovalStatus(req, res) {
    const vendor = await vendorService.updateApprovalStatus(
      req.body.id,
      req.body.approvalStatus,
      req.body.note
    );
    return ApiResponse.success(res, 'Vendor approval status updated successfully.', vendor);
  }

  async dashboard(req, res) {
    const data = await serviceRequestService.getVendorDashboard(req.user.id);
    return ApiResponse.success(res, 'Dashboard retrieved successfully.', data);
  }

  async report(req, res) {
    const data = await serviceRequestService.getVendorReport(req.user.id, req.body.period);
    return ApiResponse.success(res, 'Report retrieved successfully.', data);
  }

  async remove(req, res) {
    await vendorService.deleteVendor(req.body.id);
    return ApiResponse.success(res, 'Vendor deleted successfully.', null);
  }
}

module.exports = wrapController(new VendorController());
