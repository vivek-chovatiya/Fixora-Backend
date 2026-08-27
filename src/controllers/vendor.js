const vendorService = require('../services/vendor');
const ApiResponse = require('../utils/ApiResponse');

class VendorController {
  async getById(req, res, next) {
    try {
      const vendor = await vendorService.getVendorById(req.body.id);
      return ApiResponse.success(res, 'Vendor details retrieved successfully.', vendor);
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const { data, meta } = await vendorService.getAllVendors(req.body);
      return ApiResponse.success(res, 'Vendor list retrieved successfully.', data, meta);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const vendor = await vendorService.updateVendor(req.body.id, req.body);
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
