const Admin = require('../models/admin');
const Customer = require('../models/customer');
const Vendor = require('../models/vendor');

// The account behind a verified token, if the token may still be used (requests contract §8):
// the account exists, is not deleted, is ACTIVE, and the token's version `v` matches its
// `tokenVersion` (a token from before a reissue, suspension or take-over carries an older one).
// Tokens issued before versions existed carry no `v` and count as version 0.
const MODELS = Object.freeze({ CUSTOMER: Customer, VENDOR: Vendor, ADMIN: Admin });

const findUsableAccount = async (payload) => {
  const Model = payload && MODELS[payload.role];
  if (!Model || !payload.id) return null;

  const account = await Model.findOne({ _id: payload.id, isDeleted: { $ne: true } })
    .select('status tokenVersion')
    .lean();
  if (!account || account.status !== 'ACTIVE') return null;
  if ((account.tokenVersion || 0) !== (payload.v || 0)) return null;
  return account;
};

/// Ends every session of an account: the next request with an older token is refused.
const revokeSessions = (Model, id) => Model.updateOne({ _id: id }, { $inc: { tokenVersion: 1 } });

// Sign out (lead decision 17/11/2026): the token stops working server-side. Tokens carry one
// version per account, so this ends the account's other sessions (other devices) too.
const revokeSessionsOf = (user) => {
  const Model = user && MODELS[user.role];
  return Model ? revokeSessions(Model, user.id) : Promise.resolve();
};

module.exports = {
  findUsableAccount,
  revokeSessions,
  revokeSessionsOf,
};
