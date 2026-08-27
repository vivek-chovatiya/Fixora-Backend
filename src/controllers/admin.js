const adminService = require('../services/admin');
const ApiResponse = require('../utils/ApiResponse');

class AdminController {
  async create(req, res, next) {
    try {
      const admin = await adminService.createAdmin(req.body);
      return ApiResponse.created(res, 'Admin user created successfully.', admin);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const admin = await adminService.getAdminById(req.body.id);
      return ApiResponse.success(res, 'Admin details retrieved successfully.', admin);
    } catch (error) {
      next(error);
    }
  }

  async getDashboard(req, res, next) {
    try {
      const metrics = await adminService.getDashboardMetrics();
      return ApiResponse.success(res, 'Admin dashboard metrics retrieved successfully.', metrics);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AdminController();
