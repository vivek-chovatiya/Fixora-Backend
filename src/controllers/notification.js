const notificationService = require('../services/notification');
const ApiResponse = require('../utils/ApiResponse');
const { wrapController } = require('../utils/asyncHandler');

class NotificationController {
  async getAll(req, res) {
    const { data, meta } = await notificationService.getUserNotifications(req.user, req.body || {});
    return ApiResponse.success(res, 'Notifications retrieved successfully.', data, meta);
  }

  async unreadCount(req, res) {
    const data = await notificationService.getUnreadCount(req.user);
    return ApiResponse.success(res, 'Unread count retrieved successfully.', data);
  }

  async markAsRead(req, res) {
    const notification = await notificationService.markAsRead(req.body.id, req.user);
    return ApiResponse.success(res, 'Notification marked as read.', notification);
  }

  async markAllAsRead(req, res) {
    const data = await notificationService.markAllAsRead(req.user);
    return ApiResponse.success(res, 'All notifications marked as read.', data);
  }
}

module.exports = wrapController(new NotificationController());
