const mongoose = require('mongoose');

// Vendor sign-in attempts for one normalised phone — any phone, known or not, so a lock never
// reveals whether an account exists (lead decision 17/11/2026; services/signinthrottle.js owns the
// rules). Kept in Mongo so a restart does not reset a lock.
//
// ⚠️ Counts and times only: the attempted codes are never stored. The TTL index removes a record
// once its window and any lock have long passed; the throttle itself checks times against the
// clock, because the TTL monitor only runs about once a minute.
const signInAttemptSchema = new mongoose.Schema(
  {
    phone: { type: String, required: true, trim: true, unique: true },
    failures: { type: Number, default: 0 },
    windowStartedAt: { type: Date, required: true },
    lockedUntil: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

signInAttemptSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('SignInAttempt', signInAttemptSchema);
