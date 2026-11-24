const Notification = require('../models/notification');
const ApiError = require('../utils/ApiError');
const { ERROR_CODES } = require('../utils/errorCodes');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');

// A notification is the caller's own only when both the account id AND the role match: a customer
// and a vendor are separate collections, so the same id under the other role is another inbox
// (Phase 4B contract §8). Anything else — another account's, already deleted, unknown — is 404.
const ownNotification = (id, userContext) => ({
  _id: id,
  userId: userContext.id,
  userRole: userContext.role,
  isDeleted: { $ne: true },
});

const notificationNotFound = () =>
  new ApiError(404, 'Notification not found.', null, ERROR_CODES.NOTIFICATION_NOT_FOUND);

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
    const updated = await Notification.findOneAndUpdate(
      ownNotification(id, userContext),
      { isRead: true, readAt: new Date() },
      { new: true }
    );
    if (!updated) throw notificationNotFound();

    return notificationMapper(updated);
  }

  // Soft delete: the row stays, it only leaves the inbox (Phase 4B contract §8).
  async deleteNotification(id, userContext) {
    const deleted = await Notification.findOneAndUpdate(ownNotification(id, userContext), {
      isDeleted: true,
      deletedAt: new Date(),
    });
    if (!deleted) throw notificationNotFound();
    return true;
  }
}

module.exports = new NotificationService();
