const mongoose = require('mongoose');
const hideSecrets = require('../utils/hideSecrets');

// A vendor's onboarding in progress (Phase 5 contract §1.2, 28/11/2026):
//   OTP_PENDING  registered, one-time code sent to the phone
//   COMPLETED    the code proved the phone; the Vendor account now exists (vendorId)
//   CODE_ISSUED  legacy only: phone verified under the removed auth-code flow. Such a registration
//                is still live — a new code (resend) and its verification complete it.
//
// Kept apart from the vendors collection so an unfinished sign up never appears in vendor lists,
// never holds the phone number against a real account, and simply lapses: the TTL index removes it
// 24 hours after it was started (the contract allows discarding unconfirmed registrations then).
//
// ⚠️ `authCodeHash`, `authCodeIssuedAt` and `confirmAttempts` belong to the removed auth-code flow
// and are no longer read or written; a legacy record may still hold a bcrypt hash, so it stays
// select: false and hidden.
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
    confirmAttempts: { type: Number, default: 0 },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

vendorRegistrationSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

hideSecrets(vendorRegistrationSchema, ['authCodeHash']);

module.exports = mongoose.model('VendorRegistration', vendorRegistrationSchema);
