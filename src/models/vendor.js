const mongoose = require('mongoose');
const { normalisePhone } = require('../utils/phone');
const hideSecrets = require('../utils/hideSecrets');

// Vendors arrive two ways: the email/password register route (web views) and the mobile phone
// registration, which creates the vendor only when they confirm their permanent auth code
// (services/vendorauth.js; PROJECT_BIBLE.md section 7A.2, amended 21/10/2026). A phone vendor has
// no password, may have no email and gives no address at sign up, so none of those is required
// here; the email register route still requires them through its Joi schema.
//
// `ownerName` stays the full name the web views read; `ownerFirstName` / `ownerLastName` are what
// the app's session user carries.
//
// ⚠️ `authCodeHash` is the bcrypt hash of a standing credential that never expires: select: false,
// never mapped into a response, never logged. Replacing it is what revokes the old code.
// Uniqueness lives in the partial indexes below for the reasons given in models/customer.js.
const vendorSchema = new mongoose.Schema(
  {
    businessName: { type: String, required: true, trim: true },
    ownerName: { type: String, required: true, trim: true },
    ownerFirstName: { type: String, trim: true, default: '' },
    ownerLastName: { type: String, trim: true, default: '' },
    email: { type: String, lowercase: true, trim: true },
    // Stored and compared normalised (digits only); Mongoose applies the setter to filters too.
    phone: { type: String, required: true, trim: true, set: normalisePhone },
    password: { type: String, select: false },
    authCodeHash: { type: String, select: false, default: null },
    authCodeIssuedAt: { type: Date, default: null },
    // When the phone was proved by a one-time code (phone registration). Email sign-up leaves it
    // null, and an unproven phone never blocks a phone registration (requests contract §8).
    phoneVerifiedAt: { type: Date, default: null },
    // Bumped to end every session: admin auth-code reissue, suspension, deletion, take-over.
    tokenVersion: { type: Number, default: 0 },
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    address: { type: String, trim: true, default: '' },
    description: { type: String, default: '' },
    profileImage: { type: String, default: null },
    shopImages: [{ type: String }],
    documents: [{ type: String }],
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    totalReviews: { type: Number, default: 0 },
    approvalStatus: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    availability: { type: Boolean, default: true },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'BLOCKED'], default: 'ACTIVE' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

vendorSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { email: { $type: 'string' }, isDeleted: false } }
);
vendorSchema.index({ phone: 1 }, { unique: true, partialFilterExpression: { isDeleted: false } });

hideSecrets(vendorSchema, ['password', 'authCodeHash']);

module.exports = mongoose.model('Vendor', vendorSchema);
