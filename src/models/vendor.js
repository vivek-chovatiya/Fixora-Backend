const mongoose = require('mongoose');
const { normalisePhone } = require('../utils/phone');
const hideSecrets = require('../utils/hideSecrets');
const { VENDOR_WORKING_DAYS } = require('../config/workingHours');

// One day of the vendor's working week (Phase 4B contract §6). A closed day is stored without
// times; an open day closes later than it opens (HH:mm, checked in validations/vendor.js).
const workingDaySchema = new mongoose.Schema(
  {
    day: { type: String, enum: VENDOR_WORKING_DAYS, required: true },
    isOpen: { type: Boolean, required: true },
    opensAt: { type: String },
    closesAt: { type: String },
  },
  { _id: false }
);

// Vendors arrive two ways: the email/password register route (web views) and the mobile phone
// registration, which creates the vendor once the one-time code proves the phone
// (services/vendorauth.js; Phase 5 contract §1). A phone vendor has no password, may have no email
// and gives no address at sign up, so none of those is required here; the email register route
// still requires them through its Joi schema.
//
// `ownerName` stays the full name the web views read; `ownerFirstName` / `ownerLastName` are what
// the app's session user carries.
//
// ⚠️ `authCodeHash` / `authCodeIssuedAt` belong to the permanent auth code removed on 28/11/2026
// (Phase 5 contract §1.3): nothing reads or writes them any more, but older vendors still hold a
// bcrypt hash there, so the field stays select: false and hidden from every response.
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
    // null; an unproven phone never blocks a phone registration (requests contract §8) and cannot
    // be used to sign in by code (services/vendorauth.js).
    phoneVerifiedAt: { type: Date, default: null },
    // Bumped to end every session: suspension, deletion, take-over.
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
    // [] until the vendor first sets it, then the seven days Monday first. Information only.
    workingHours: { type: [workingDaySchema], default: [] },
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
