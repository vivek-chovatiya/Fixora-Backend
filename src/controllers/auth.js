const authService = require('../services/auth');
const ApiResponse = require('../utils/ApiResponse');

class AuthController {
  async login(req, res, next) {
    try {
      const result = await authService.login(req.body);
      return ApiResponse.success(res, 'User authenticated successfully.', result);
    } catch (error) {
      next(error);
    }
  }

  async registerCustomer(req, res, next) {
    try {
      const result = await authService.registerCustomer(req.body);
      return ApiResponse.created(res, 'Customer registered successfully.', result);
    } catch (error) {
      next(error);
    }
  }

  async registerVendor(req, res, next) {
    try {
      const result = await authService.registerVendor(req.body);
      return ApiResponse.created(res, 'Vendor registered successfully.', result);
    } catch (error) {
      next(error);
    }
  }

  async me(req, res, next) {
    try {
      const profile = await authService.getCurrentUser(req.user);
      return ApiResponse.success(res, 'User profile retrieved successfully.', profile);
    } catch (error) {
      next(error);
    }
  }

  async logout(req, res, next) {
    try {
      return ApiResponse.success(res, 'User logged out successfully.', null);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();
