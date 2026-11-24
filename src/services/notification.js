const Notification = require('../models/notification');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { NOTIFICATION_TYPE } = require('../constants');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');

const notificationMapper = (n) => {
  if (!n) return null;
  return {
    id: n._id,
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
  /**
   * Notification delivery must never block business operations (PROJECT_BIBLE §11.8),
   * so failures are logged and swallowed here — and only here.
   */
  async notify({ userId, userRole, title, message, type = NOTIFICATION_TYPE.GENERAL, referenceId }) {
    try {
      if (!userId) return null;
      const notification = await Notification.create({
        userId,
        userRole,
        title,
        message,
        type,
        referenceId: referenceId || null,
      });
      return notificationMapper(notification);
    } catch (error) {
      logger.warn(`Notification delivery failed: ${error.message}`);
      return null;
    }
  }

  async notifyMany(userIds, payload) {
    try {
      if (!userIds || userIds.length === 0) return 0;
      const docs = userIds.map((userId) => ({
        ...payload,
        userId,
        type: payload.type || NOTIFICATION_TYPE.GENERAL,
        referenceId: payload.referenceId || null,
      }));
      const created = await Notification.insertMany(docs, { ordered: false });
      return created.length;
    } catch (error) {
      logger.warn(`Bulk notification delivery failed: ${error.message}`);
      return 0;
    }
  }

  async getUserNotifications(userContext, body = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = {
      userId: userContext.id,
      userRole: userContext.role,
      isDeleted: { $ne: true },
    };

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Notification.countDocuments(filter),
      Notification.countDocuments({ ...filter, isRead: false }),
    ]);

    return {
      data: notifications.map(notificationMapper),
      meta: { ...getPaginationMetadata(total, page, limit), unreadCount },
    };
  }

  async getUnreadCount(userContext) {
    const unreadCount = await Notification.countDocuments({
      userId: userContext.id,
      userRole: userContext.role,
      isRead: false,
      isDeleted: { $ne: true },
    });
    return { unreadCount };
  }

  async markAsRead(id, userContext) {
    const updated = await Notification.findOneAndUpdate(
      { _id: id, userId: userContext.id, userRole: userContext.role, isDeleted: { $ne: true } },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
    if (!updated) {
      throw new ApiError(404, 'Notification not found.');
    }
    return notificationMapper(updated);
  }

  async markAllAsRead(userContext) {
    const result = await Notification.updateMany(
      { userId: userContext.id, userRole: userContext.role, isRead: false, isDeleted: { $ne: true } },
      { isRead: true, readAt: new Date() }
    );
    return { updated: result.modifiedCount };
  }
}

module.exports = new NotificationService();
