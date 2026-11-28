// POST /devices/register and /devices/unregister (Phase 5 contract §6.1): the signed-in customer's
// or vendor's push token. The app registers after sign-in and on token refresh, and unregisters on
// sign-out before /auth/logout.
//
// It refuses to echo the token back in any answer: `registered` and `removed` are all a client needs.
//
// ⚠️ The owner comes from req.user only, never from the body.
const deviceService = require('../services/device');
const ApiResponse = require('../utils/ApiResponse');

class DeviceController {
  async register(req, res, next) {
    try {
      const result = await deviceService.register(req.user, req.body);
      return ApiResponse.success(res, 'Device registered for push notifications.', result);
    } catch (error) {
      next(error);
    }
  }

  async unregister(req, res, next) {
    try {
      const result = await deviceService.unregister(req.user, req.body);
      return ApiResponse.success(res, 'Device unregistered from push notifications.', result);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new DeviceController();
