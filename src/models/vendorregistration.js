const mongoose = require('mongoose');
const hideSecrets = require('../utils/hideSecrets');

// A vendor's onboarding in progress (PROJECT_BIBLE.md section 7A.2, amended 21/10/2026):
//   OTP_PENDING  registered, one-time code sent to the phone
//   CODE_ISSUED  phone verified, permanent auth code generated and shown once
//   COMPLETED    vendor typed the code back; the Vendor account now exists (vendorId)
//
// Kept apart from the vendors collection so an unfinished sign up never appears in vendor lists,
// never holds the phone number against a real account, and simply lapses: the TTL index removes it
// 24 hours after it was started (the contract allows discarding unconfirmed registrations then).
//
// ⚠️ `authCodeHash` is a bcrypt hash of the code shown to the vendor — select: false, never logged.
// It is copied to the Vendor on confirmation, so regenerating here before then revokes the old one.
const vendorRegistrationSchema = new mongoose.Schema(
  {
    businessName: { type: String, required: true, trim: true },
    ownerFirstName: { type: String, required: true, trim: true },
    ownerLastName: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true, index: true },
    email: { type: String, lowercase: true, trim: true },
    serviceCategoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    state: {
      type: String,
      enum: ['OTP_PENDING', 'CODE_ISSUED', 'COMPLETED'],
      default: 'OTP_PENDING',
    },
    authCodeHash: { type: String, select: false, default: null },
    authCodeIssuedAt: { type: Date, default: null },
    // Wrong typed-back codes for the current auth code; reset whenever a new code is issued.
    confirmAttempts: { type: Number, default: 0 },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

vendorRegistrationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

hideSecrets(vendorRegistrationSchema, ['authCodeHash']);

module.exports = mongoose.model('VendorRegistration', vendorRegistrationSchema);
