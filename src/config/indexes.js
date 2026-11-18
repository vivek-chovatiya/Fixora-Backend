const Customer = require('../models/customer');
const Vendor = require('../models/vendor');
const OtpChallenge = require('../models/otpchallenge');
const VendorRegistration = require('../models/vendorregistration');
const SignInAttempt = require('../models/signinattempt');
const logger = require('../utils/logger');

// Brings the account collections' indexes in line with their schemas. Phone sign in changed the
// customer and vendor email/phone indexes to partial ones (accounts without an email, soft-deleted
// accounts), and Mongoose's autoIndex only creates missing indexes — it never replaces one whose
// options changed — so an existing database would keep the old unique email index and refuse the
// second phone-only customer. Run at start-up and by the seed.
//
// ⚠️ syncIndexes also drops indexes the schema does not declare. Only models whose indexes are all
// declared in their schema belong in this list.
const ACCOUNT_MODELS = [Customer, Vendor, OtpChallenge, VendorRegistration, SignInAttempt];

const syncAccountIndexes = async () => {
  for (const model of ACCOUNT_MODELS) {
    try {
      await model.syncIndexes();
    } catch (error) {
      // codeName only: a duplicate-key message would quote the conflicting phone or email.
      logger.error(`Index sync failed for ${model.modelName}: ${error.codeName || error.name}`);
    }
  }
};

module.exports = syncAccountIndexes;
