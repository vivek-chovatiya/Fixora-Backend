const RateBudget = require('../models/ratebudget');
const clock = require('../utils/clock');

// "At most `limit` per `windowSeconds`" for one key, counted atomically: a burst of parallel
// requests cannot get past the limit (the same conditional-$inc pattern as services/otp.js).
// The window is fixed — it starts at the first use and resets once it has passed.

const after = (date, seconds) => new Date(date.getTime() + seconds * 1000);

const secondsUntil = (date, now) =>
  Math.max(1, Math.ceil((date.getTime() - now.getTime()) / 1000));

class RateBudgetService {
  // Uses one unit. Answers { allowed: true } or { allowed: false, retryAfterSeconds }.
  async consume(key, { limit, windowSeconds }) {
    const now = clock.now();

    await RateBudget.updateOne(
      { key, windowStartedAt: { $lte: after(now, -windowSeconds) } },
      { $set: { count: 0, windowStartedAt: now } }
    );

    const open = { key, count: { $lt: limit } };
    const use = { $inc: { count: 1 }, $set: { expiresAt: after(now, windowSeconds * 2) } };
    let used = null;
    try {
      used = await RateBudget.findOneAndUpdate(
        open,
        { ...use, $setOnInsert: { windowStartedAt: now } },
        { upsert: true, new: true }
      );
    } catch (error) {
      if (error.code !== 11000) throw error;
      // The record exists but is full — or a parallel first use created it a moment ago.
      used = await RateBudget.findOneAndUpdate(open, use, { new: true });
    }

    if (used) return { allowed: true };
    return { allowed: false, retryAfterSeconds: await this.retryAfter(key, windowSeconds, now) };
  }

  // Whether one more unit would be allowed, without using it.
  async peek(key, { limit, windowSeconds }) {
    const now = clock.now();
    const current = await RateBudget.findOne({ key });
    const lapsed = !current || current.windowStartedAt <= after(now, -windowSeconds);
    if (lapsed || current.count < limit) return { allowed: true };
    return {
      allowed: false,
      retryAfterSeconds: secondsUntil(after(current.windowStartedAt, windowSeconds), now),
    };
  }

  // Gives a unit back (an attempt that turned out not to count).
  async refund(key) {
    await RateBudget.updateOne({ key, count: { $gt: 0 } }, { $inc: { count: -1 } });
  }

  async retryAfter(key, windowSeconds, now) {
    const current = await RateBudget.findOne({ key });
    const resetAt = current ? after(current.windowStartedAt, windowSeconds) : after(now, windowSeconds);
    return secondsUntil(resetAt, now);
  }
}

module.exports = new RateBudgetService();
