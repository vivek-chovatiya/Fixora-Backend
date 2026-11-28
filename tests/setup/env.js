// Runs before every test file, before the app (and so dotenv) loads. dotenv never overrides a
// variable that is already set, so these win over the developer's .env.
//
// ⚠️ Tests run against their own database, never `fixora`; tests/helpers/db.js refuses any
// database whose name does not end in "_test".
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.TEST_MONGO_URI || 'mongodb://127.0.0.1:27017/fixora_test';
process.env.JWT_SECRET = 'fixora-test-only-secret';
process.env.JWT_EXPIRES = '7d';
// Empty, not absent, so .env's development value cannot leak in; suites switch it on per test.
process.env.OTP_STATIC_CODE = '';
// Codes are never sent from a test run: no channel, and no WhatsApp setting from .env can leak in
// (Phase 5 contract §2). tests/otpDelivery.test.js switches WhatsApp on with fetch replaced.
process.env.OTP_DELIVERY_CHANNEL = 'none';
for (const name of [
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_OTP_TEMPLATE_NAME',
  'WHATSAPP_OTP_TEMPLATE_LANGUAGE',
  'WHATSAPP_API_VERSION',
]) {
  process.env[name] = '';
}
// Push is off for every test run, so no key path from .env can leak in and Firebase is never
// reached (Phase 5 contract §6.2). tests/push.test.js switches it on with firebase-admin mocked.
process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '';
process.env.LOG_LEVEL = 'debug';
// The per-IP /auth limit is read per request; suites make many auth calls from one address, so it
// is out of the way by default and tests/rateLimits.test.js lowers it to prove it.
process.env.AUTH_RATE_LIMIT_MAX = '1000000';
// Uploaded files go to a fresh temporary folder per test file (index.js serves the same one),
// never the repository's uploads/; tests/setup/uploads.js removes it after the file's tests.
process.env.UPLOAD_PATH = require('path').join(
  require('os').tmpdir(),
  'fixora-test-uploads',
  `${process.pid}-${require('crypto').randomBytes(6).toString('hex')}`
);
