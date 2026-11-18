const Customer = require('../models/customer');
const Vendor = require('../models/vendor');
const logger = require('../utils/logger');
const { maskPhoneForLog } = require('../utils/phone');

// One-time data fixes, run at start-up before the indexes are synced (review fixes 17/11/2026).
// Each is idempotent, and none stops the server: a problem is logged and the rest carries on.
//
//   1. Phones saved before normalisation ('+1 800-555-0100') become digits only. Raw collection
//      writes, so the model setter is not involved. A clash with an account that already has the
//      normalised number is logged (masked) and left as it was — two accounts are never merged here.
//   2. Accounts created by phone sign-in before `phoneVerifiedAt` existed are marked verified:
//      customers without a password, and vendors with an auth code but no password.
//
// ⚠️ Never log a full phone number here.

const normalisePhones = async (Model) => {
  let fixed = 0;
  let skipped = 0;
  const cursor = Model.collection.find({ phone: { $regex: /\D/ } }, { projection: { phone: 1 } });

  for await (const doc of cursor) {
    const digits = String(doc.phone).replace(/\D/g, '');
    try {
      await Model.collection.updateOne({ _id: doc._id }, { $set: { phone: digits } });
      fixed += 1;
    } catch (error) {
      if (error.code !== 11000) throw error;
      skipped += 1;
      logger.error(
        `phone migration: ${Model.modelName} ${doc._id} clashes with another account on ${maskPhoneForLog(digits)}; left unchanged`
      );
    }
  }

  if (fixed || skipped) {
    logger.info(`phone migration: ${Model.modelName} normalised ${fixed}, skipped ${skipped}`);
  }
};

const noPassword = { $or: [{ password: { $exists: false } }, { password: null }] };

const backfillPhoneVerified = async () => {
  const now = new Date();
  const customers = await Customer.collection.updateMany(
    { phoneVerifiedAt: null, ...noPassword },
    { $set: { phoneVerifiedAt: now } }
  );
  const vendors = await Vendor.collection.updateMany(
    { phoneVerifiedAt: null, authCodeHash: { $type: 'string' }, ...noPassword },
    { $set: { phoneVerifiedAt: now } }
  );
  if (customers.modifiedCount || vendors.modifiedCount) {
    logger.info(
      `phone-verified backfill: ${customers.modifiedCount} customers, ${vendors.modifiedCount} vendors`
    );
  }
};

const STEPS = [
  ['customer phones', () => normalisePhones(Customer)],
  ['vendor phones', () => normalisePhones(Vendor)],
  ['phone-verified backfill', backfillPhoneVerified],
];

const runStartupMigrations = async () => {
  for (const [name, step] of STEPS) {
    try {
      await step();
    } catch (error) {
      logger.error(`startup migration "${name}" failed: ${error.codeName || error.name}`);
    }
  }
};

module.exports = runStartupMigrations;
