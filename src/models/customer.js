const mongoose = require('mongoose');
const { normalisePhone } = require('../utils/phone');
const hideSecrets = require('../utils/hideSecrets');

// Customers arrive two ways: the email/password register route (web views) and phone + one-time
// code (mobile app), where the account is created on first verification with no name, email or
// password yet (PROJECT_BIBLE.md section 7A.1). So none of those is required by the schema; the
// email register route still requires them through its Joi schema.
//
// Uniqueness lives in the partial indexes below rather than `unique: true` on the fields: an index
// that counted accounts without an email would allow only one phone-only customer, and soft-deleted
// accounts must not hold a phone or email forever (numbers get reassigned).
// ⚠️ autoIndex never replaces an index whose options changed, so an existing database needs
// config/indexes.js (run at start-up and by the seed) to pick these up.
const customerSchema = new mongoose.Schema(
  {
    firstName: { type: String, trim: true, default: '' },
    lastName: { type: String, trim: true, default: '' },
    email: { type: String, lowercase: true, trim: true },
    // Stored and compared normalised (digits only); Mongoose applies the setter to filters too.
    phone: { type: String, required: true, trim: true, set: normalisePhone },
    password: { type: String, select: false },
    profileImage: { type: String, default: null },
    defaultAddress: { type: mongoose.Schema.Types.ObjectId, ref: 'Address', default: null },
    isVerified: { type: Boolean, default: false },
    // When the phone was proved by a one-time code. Email sign-up leaves it null: such a phone is
    // unproven, and its first OTP sign-in takes the account over (requests contract §8).
    phoneVerifiedAt: { type: Date, default: null },
    // Bumped to end every session (services/tokenaccount.js).
    tokenVersion: { type: Number, default: 0 },
    lastLogin: { type: Date, default: null },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'BLOCKED'], default: 'ACTIVE' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

customerSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' }, isDeleted: false } }
);
customerSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

hideSecrets(customerSchema, ['password']);

module.exports = mongoose.model('Customer', customerSchema);
