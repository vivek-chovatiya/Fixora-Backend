const Notification = require('../models/notification');
const ApiError = require('../utils/ApiError');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');

const notificationMapper = (n) => {
  if (!n) return null;
  return {
    id: n._id,
    userId: n.userId,
    userRole: n.userRole,
    title: n.title,
    message: n.message,
    type: n.type,
    referenceId: n.referenceId,
    isRead: n.isRead,
    readAt: n.readAt,
    createdAt: n.createdAt,
  };
};

class NotificationService {
  async createNotification(payload) {
    const notification = await Notification.create(payload);
    return notificationMapper(notification);
  }

  async getUserNotifications(userContext, body = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = {
      userId: userContext.id,
      userRole: userContext.role,
      isDeleted: { $ne: true },
    };

    const [notifications, total] = await Promise.all([
      Notification.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Notification.countDocuments(filter),
    ]);

    const mapped = notifications.map(notificationMapper);
    const meta = getPaginationMetadata(total, page, limit);

    return { data: mapped, meta };
  }

  async markAsRead(id, userContext) {
    const notification = await Notification.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!notification || notification.userId.toString() !== userContext.id.toString()) {
      throw new ApiError(404, 'Notification not found.');
    }

    const updated = await Notification.findByIdAndUpdate(
      id,
      { isRead: true, readAt: new Date() },
      { new: true }
    );

    return notificationMapper(updated);
  }
}

module.exports = new NotificationService();
