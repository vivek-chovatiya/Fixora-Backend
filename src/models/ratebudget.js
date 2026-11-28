const mongoose = require('mongoose');

// A counter for one key over a fixed window (services/ratebudget.js owns the rules): one-time
// codes sent to a phone per 24 hours, wrong one-time-code guesses on a phone per hour (requests
// contract §8), sends the provider refused for a phone per 24 hours (review fix 28/11/2026). Kept
// in Mongo so a restart does not reset it.
//
// ⚠️ Counts and times only — never a code, never a full request.
const rateBudgetSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, trim: true, unique: true },
    count: { type: Number, default: 0 },
    windowStartedAt: { type: Date, required: true },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

rateBudgetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('RateBudget', rateBudgetSchema);
