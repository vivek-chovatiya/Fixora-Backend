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
process.env.LOG_LEVEL = 'debug';
// The per-IP /auth limit is read per request; suites make many auth calls from one address, so it
// is out of the way by default and tests/rateLimits.test.js lowers it to prove it.
process.env.AUTH_RATE_LIMIT_MAX = '1000000';
