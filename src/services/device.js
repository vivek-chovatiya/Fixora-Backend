// Device push tokens (Phase 5 contract §6.1): what POST /devices/register and /devices/unregister
// do. A token belongs to one account (id AND role) at a time: registering it from another account
// moves it there. An account keeps at most 10; registering past that drops the least recently
// seen. Tokens are stored whether or not push sending is configured, so they are ready the day the
// Firebase key is added.
//
// It refuses to tell a caller anything about a token it does not own: unregistering someone else's
// answers `removed: false`, exactly like a token nobody registered.
//
// ⚠️ The token being registered is never the one the limit drops (it is excluded from the
// trimming query, whatever the clocks say). Never log a token.
const DeviceToken = require('../models/devicetoken');
const clock = require('../utils/clock');

const MAX_TOKENS_PER_ACCOUNT = 10;
const DUPLICATE_KEY = 11000;

const ownerOf = (userContext) => ({ accountId: userContext.id, role: userContext.role });

// One upsert keyed on the unique token: a new token is inserted, a known one is moved to this
// account and refreshed. Two first registrations of the same token at once can both try to insert;
// the loser hits the unique index and becomes a plain update.
const saveToken = async (token, fields) => {
  try {
    await DeviceToken.updateOne({ token }, { $set: fields }, { upsert: true });
  } catch (error) {
    if (error.code !== DUPLICATE_KEY) throw error;
    await DeviceToken.updateOne({ token }, { $set: fields });
  }
};

// Keeps the account's other tokens to the newest 9 (the registered one makes 10). Ties on
// lastSeenAt keep the later-created token.
const dropOldestBeyondLimit = async (owner, keptToken) => {
  const extra = await DeviceToken.find({ ...owner, token: { $ne: keptToken } })
    .sort({ lastSeenAt: -1, _id: -1 })
    .skip(MAX_TOKENS_PER_ACCOUNT - 1)
    .select('_id')
    .lean();
  if (extra.length) {
    await DeviceToken.deleteMany({ _id: { $in: extra.map((device) => device._id) } });
  }
};

class DeviceService {
  async register(userContext, { token, platform }) {
    const owner = ownerOf(userContext);
    await saveToken(token, { ...owner, platform, lastSeenAt: clock.now() });
    await dropOldestBeyondLimit(owner, token);
    return { registered: true };
  }

  async unregister(userContext, { token }) {
    const result = await DeviceToken.deleteOne({ token, ...ownerOf(userContext) });
    return { removed: result.deletedCount === 1 };
  }
}

module.exports = new DeviceService();
module.exports.MAX_TOKENS_PER_ACCOUNT = MAX_TOKENS_PER_ACCOUNT;
