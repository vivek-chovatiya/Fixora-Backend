const authService = require('../services/auth');
const customerAuthService = require('../services/customerauth');
const vendorAuthService = require('../services/vendorauth');
const ApiResponse = require('../utils/ApiResponse');
const { revokeSessionsOf } = require('../services/tokenaccount');

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

  // Revokes the session server-side: the token (and the account's other sessions) stop working.
  async logout(req, res, next) {
    try {
      await revokeSessionsOf(req.user);
      return ApiResponse.success(res, 'User logged out successfully.', null);
    } catch (error) {
      next(error);
    }
  }

  // ----------------------------------------------------
  // Phone sign in (shared contract, owner decision 17/11/2026)
  // ----------------------------------------------------

  async requestCustomerOtp(req, res, next) {
    try {
      const challenge = await customerAuthService.requestOtp(req.body);
      return ApiResponse.success(res, 'Verification code sent.', challenge);
    } catch (error) {
      next(error);
    }
  }

  async verifyCustomerOtp(req, res, next) {
    try {
      const session = await customerAuthService.verifyOtp(req.body);
      return ApiResponse.success(res, 'Customer signed in successfully.', session);
    } catch (error) {
      next(error);
    }
  }

  async registerVendorByPhone(req, res, next) {
    try {
      const registration = await vendorAuthService.register(req.body);
      return ApiResponse.created(res, 'Vendor registration started.', registration);
    } catch (error) {
      next(error);
    }
  }

  async requestVendorOtp(req, res, next) {
    try {
      const challenge = await vendorAuthService.requestOtp(req.body);
      return ApiResponse.success(res, 'Verification code sent.', challenge);
    } catch (error) {
      next(error);
    }
  }

  // The response carries the vendor's permanent auth code — the one time it is ever shown.
  async verifyVendorOtp(req, res, next) {
    try {
      const authCode = await vendorAuthService.verifyOtp(req.body);
      return ApiResponse.success(res, 'Phone verified. Save your auth code.', authCode);
    } catch (error) {
      next(error);
    }
  }

  async confirmVendorAuthCode(req, res, next) {
    try {
      const session = await vendorAuthService.confirmAuthCode(req.body);
      return ApiResponse.success(res, 'Vendor signed in successfully.', session);
    } catch (error) {
      next(error);
    }
  }

  async regenerateVendorAuthCode(req, res, next) {
    try {
      const authCode = await vendorAuthService.regenerateAuthCode(req.body);
      return ApiResponse.success(res, 'A new auth code was issued.', authCode);
    } catch (error) {
      next(error);
    }
  }

  async signInVendor(req, res, next) {
    try {
      const session = await vendorAuthService.signIn(req.body);
      return ApiResponse.success(res, 'Vendor signed in successfully.', session);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AuthController();
