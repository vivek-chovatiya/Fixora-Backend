const adminService = require('../services/admin');
const ApiResponse = require('../utils/ApiResponse');
const { wrapController } = require('../utils/asyncHandler');

class AdminController {
  async create(req, res) {
    const admin = await adminService.createAdmin(req.body);
    return ApiResponse.created(res, 'Admin user created successfully.', admin);
  }

  async getById(req, res) {
    const admin = await adminService.getAdminById(req.body.id);
    return ApiResponse.success(res, 'Admin details retrieved successfully.', admin);
  }

  async getDashboard(req, res) {
    const metrics = await adminService.getDashboardMetrics();
    return ApiResponse.success(res, 'Admin dashboard metrics retrieved successfully.', metrics);
  }
}

module.exports = wrapController(new AdminController());
