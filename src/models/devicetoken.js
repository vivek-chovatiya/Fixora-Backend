// One phone's push token (Phase 5 contract §6.1), owned by one customer or vendor account at a
// time. The account is the id AND the role: customers and vendors are separate collections, so the
// same id under the other role is another account (the same rule as the notification inbox).
// services/device.js owns every rule: moving a token between accounts, the 10-per-account limit,
// refreshing lastSeenAt. services/push.js reads the tokens and deletes the ones FCM calls dead.
//
// It refuses to hold anything about the device beyond the platform: no model, no app version, no
// IP — the token is all a push needs.
//
// ⚠️ `token` is unique, and that index is what makes "registering it from another account moves
// it" a single upsert. Never log a token: it addresses a person's phone.
const mongoose = require('mongoose');

const deviceTokenSchema = new mongoose.Schema(
  {
    accountId: { type: mongoose.Schema.Types.ObjectId, required: true },
    role: { type: String, enum: ['CUSTOMER', 'VENDOR'], required: true },
    token: { type: String, required: true, maxlength: 4096 },
    platform: { type: String, enum: ['android', 'ios'], required: true },
    lastSeenAt: { type: Date, required: true },
  },
  { timestamps: true }
);

deviceTokenSchema.index({ token: 1 }, { unique: true });
// An account's tokens, newest first: what a push reads and what the limit keeps.
deviceTokenSchema.index({ accountId: 1, role: 1, lastSeenAt: -1 });

module.exports = mongoose.model('DeviceToken', deviceTokenSchema);
