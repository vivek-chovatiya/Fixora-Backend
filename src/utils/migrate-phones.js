/**
 * One-time migration: rewrites every stored phone number into canonical E.164 (utils/phone).
 *
 *   npm run migrate:phones            -> dry run, prints what would change
 *   npm run migrate:phones -- --apply -> writes the changes
 *
 * Records whose canonical number is already used by another record of the same
 * collection are reported as conflicts and left untouched for a human to resolve.
 */
const mongoose = require('mongoose');
const connectDB = require('../config/db');
const logger = require('./logger');
const { normalizePhone } = require('./phone');
const Customer = require('../models/customer');
const Vendor = require('../models/vendor');
const Admin = require('../models/admin');
const TeamMember = require('../models/team');

const apply = process.argv.includes('--apply');

/** `scopeKey` groups records whose phones must be unique together (whole collection, or per vendor for teams). */
const COLLECTIONS = [
  { name: 'customers', Model: Customer, scopeKey: () => 'all' },
  { name: 'vendors', Model: Vendor, scopeKey: () => 'all' },
  { name: 'admins', Model: Admin, scopeKey: () => 'all' },
  { name: 'team members', Model: TeamMember, scopeKey: (doc) => String(doc.vendorId) },
];

const migrateCollection = async ({ name, Model, scopeKey }) => {
  const docs = await Model.find({ isDeleted: { $ne: true } }).select('phone vendorId').lean();
  const taken = new Map(docs.map((d) => [`${scopeKey(d)}|${d.phone}`, String(d._id)]));
  const summary = { changed: 0, unchanged: 0, invalid: 0, conflicts: 0 };

  for (const doc of docs) {
    const canonical = normalizePhone(doc.phone);
    if (!canonical) {
      summary.invalid += 1;
      logger.warn(`[${name}] ${doc._id}: "${doc.phone}" is not a valid phone number — left as is.`);
      continue;
    }
    if (canonical === doc.phone) {
      summary.unchanged += 1;
      continue;
    }
    const key = `${scopeKey(doc)}|${canonical}`;
    const owner = taken.get(key);
    if (owner && owner !== String(doc._id)) {
      summary.conflicts += 1;
      logger.warn(`[${name}] ${doc._id}: "${doc.phone}" -> ${canonical} conflicts with ${owner} — left as is.`);
      continue;
    }
    logger.info(`[${name}] ${doc._id}: "${doc.phone}" -> ${canonical}`);
    if (apply) await Model.updateOne({ _id: doc._id }, { $set: { phone: canonical } });
    taken.delete(`${scopeKey(doc)}|${doc.phone}`);
    taken.set(key, String(doc._id));
    summary.changed += 1;
  }
  logger.info(`[${name}] ${apply ? 'updated' : 'would update'} ${summary.changed}, unchanged ${summary.unchanged}, invalid ${summary.invalid}, conflicts ${summary.conflicts}`);
  return summary;
};

const run = async () => {
  await connectDB();
  logger.info(apply ? 'Applying phone normalisation…' : 'Dry run — pass --apply to write changes.');
  let conflicts = 0;
  for (const collection of COLLECTIONS) {
    conflicts += (await migrateCollection(collection)).conflicts;
  }
  await mongoose.disconnect();
  process.exit(conflicts ? 2 : 0);
};

if (require.main === module) {
  run().catch((error) => {
    logger.error(`Phone migration failed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = { run };
