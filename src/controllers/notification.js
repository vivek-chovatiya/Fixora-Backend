const notificationService = require('../services/notification');
const ApiResponse = require('../utils/ApiResponse');

class NotificationController {
  async getAll(req, res, next) {
    try {
      const { data, meta } = await notificationService.getUserNotifications(req.user, req.body);
      return ApiResponse.success(res, 'Notifications retrieved successfully.', data, meta);
    } catch (error) {
      next(error);
    }
  }

  async markAsRead(req, res, next) {
    try {
      const notification = await notificationService.markAsRead(req.body.id, req.user);
      return ApiResponse.success(res, 'Notification marked as read.', notification);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new NotificationController();
