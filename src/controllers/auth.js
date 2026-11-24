const authService = require('../services/auth');
const ApiResponse = require('../utils/ApiResponse');
const { wrapController } = require('../utils/asyncHandler');

class AuthController {
  async login(req, res) {
    const result = await authService.login(req.body);
    return ApiResponse.success(res, 'Logged in successfully.', result);
  }

  async registerCustomer(req, res) {
    const result = await authService.registerCustomer(req.body);
    return ApiResponse.created(res, 'Account created successfully.', result);
  }

  async registerVendor(req, res) {
    const result = await authService.registerVendor(req.body);
    return ApiResponse.created(res, 'Vendor account created. It is now under verification.', result);
  }

  async me(req, res) {
    const profile = await authService.getCurrentUser(req.user);
    return ApiResponse.success(res, 'Profile retrieved successfully.', profile);
  }

  async logout(req, res) {
    return ApiResponse.success(res, 'Logged out successfully.', null);
  }

  async forgotPassword(req, res) {
    const result = await authService.forgotPassword(req.body);
    return ApiResponse.success(res, result.message, result);
  }

  async resetPassword(req, res) {
    await authService.resetPassword(req.body);
    return ApiResponse.success(res, 'Password reset successfully. Please log in.', null);
  }

  async changePassword(req, res) {
    await authService.changePassword(req.user, req.body);
    return ApiResponse.success(res, 'Password changed successfully.', null);
  }
}

module.exports = wrapController(new AuthController());
