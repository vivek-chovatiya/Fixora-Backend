const mongoose = require('mongoose');
const hideSecrets = require('../utils/hideSecrets');

// One outstanding one-time code, for a customer or vendor sign in (keyed by purpose and phone) or a
// vendor registration (keyed by registration). Issuing a new code rewrites the key's single
// document in place, which is what makes the previous code stop working; services/otp.js owns
// every rule. A vendor sign-in challenge for a number with no vendor account is a decoy that looks
// exactly like a real one; nothing here records which it is.
//
// ⚠️ Only `codeHash` (bcrypt) is stored, never the code, and it is select: false. The TTL index
// removes a challenge an hour after it expires; expiry itself is checked by services/otp.js
// against the clock, because the TTL monitor only runs about once a minute.
const otpChallengeSchema = new mongoose.Schema(
  {
    purpose: {
      type: String,
      enum: ['CUSTOMER_SIGN_IN', 'VENDOR_SIGN_IN', 'VENDOR_REGISTRATION'],
      required: true,
    },
    phone: { type: String, required: true, trim: true },
    registrationId: { type: mongoose.Schema.Types.ObjectId, ref: 'VendorRegistration', default: null },
    codeHash: { type: String, required: true, select: false },
    expiresAt: { type: Date, required: true },
    resendAfter: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    consumedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

otpChallengeSchema.index({ purpose: 1, phone: 1, registrationId: 1 }, { unique: true });
otpChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 3600 });

hideSecrets(otpChallengeSchema, ['codeHash']);

module.exports = mongoose.model('OtpChallenge', otpChallengeSchema);
