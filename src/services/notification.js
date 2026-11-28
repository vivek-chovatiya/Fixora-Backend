const Notification = require('../models/notification');
const ApiError = require('../utils/ApiError');
const { ERROR_CODES } = require('../utils/errorCodes');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');
const pushService = require('./push');

// A notification is the caller's own only when both the account id AND the role match: a customer
// and a vendor are separate collections, so the same id under the other role is another inbox
// (Phase 4B contract §8). Anything else — another account's, already deleted, unknown — is 404.
//
// ⚠️ The "all" operations (Phase 5 contract §3) filter on exactly this inbox and nothing wider:
// dropping the role from it would read or clear the other role's account with the same id.
const ownInbox = (userContext) => ({
  userId: userContext.id,
  userRole: userContext.role,
  isDeleted: { $ne: true },
});

const ownNotification = (id, userContext) => ({ _id: id, ...ownInbox(userContext) });

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
  // The one place an in-app notification is created. Once it is stored it is also pushed to the
  // recipient's phones (Phase 5 contract §6.2) — started, never awaited: a push is a courtesy on
  // top of the inbox, and its failure or slowness must not reach the action that caused it.
  // sendForNotification never rejects, and does nothing while push is off.
  async createNotification(payload) {
    const notification = await Notification.create(payload);
    pushService.sendForNotification(notification);
    return notificationMapper(notification);
  }

  async getUserNotifications(userContext, body = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = ownInbox(userContext);

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

  // Every unread notification in the caller's own inbox; answers how many changed.
  async markAllAsRead(userContext) {
    const result = await Notification.updateMany(
      { ...ownInbox(userContext), isRead: { $ne: true } },
      { $set: { isRead: true, readAt: new Date() } }
    );
    return { updated: result.modifiedCount };
  }

  // The same soft delete as deleteNotification, for the caller's whole inbox.
  async deleteAllNotifications(userContext) {
    const result = await Notification.updateMany(ownInbox(userContext), {
      $set: { isDeleted: true, deletedAt: new Date() },
    });
    return { deleted: result.modifiedCount };
  }
}

module.exports = new NotificationService();
