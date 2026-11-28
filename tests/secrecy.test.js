// Codes never leak: not into a response, not into a log line, not into the database in plain text.
// Since the vendor auth code was removed (Phase 5 contract §1) there is no response that may show
// a code at all. Each flow runs with distinctive pinned codes so a search cannot match by accident.
const mongoose = require('mongoose');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const clock = require('./helpers/clock');
const { createCategory } = require('./helpers/fixtures');
const secretCode = require('../src/utils/secretCode');

const CUSTOMER_PHONE = '9876543210';
const VENDOR_PHONE = '9000000003';
const UNKNOWN_PHONE = '9111111111';

// One-time codes, in the order they are drawn below. None may appear anywhere.
const OTPS = ['731905', '731906', '731907', '731908', '731909'];
// Wrong codes the client sends.
const GUESSES = ['913371', '913372', '913373', '913374'];

const databaseText = async () => {
  const collections = await mongoose.connection.db.collections();
  const dumps = await Promise.all(collections.map((c) => c.find({}).toArray()));
  return JSON.stringify(dumps);
};

beforeAll(db.connect);
afterAll(db.disconnect);

test('no code reaches a response, a log line or the database', async () => {
  await db.clear();
  logs.reset();
  api.resetResponses();
  clock.install();
  process.env.OTP_STATIC_CODE = '';
  jest
    .spyOn(secretCode, 'generateNumericCode')
    .mockReturnValueOnce(OTPS[0]) // customer sign in
    .mockReturnValueOnce(OTPS[1]) // vendor registration
    .mockReturnValueOnce(OTPS[2]) // vendor sign in
    .mockReturnValueOnce(OTPS[3]) // stand-in challenge for a number with no vendor account
    .mockReturnValueOnce(OTPS[4]); // a second customer code, after the resend wait

  // Customer: request, a wrong attempt, sign in.
  await api.post('/auth/customer/otp/request', { phone: CUSTOMER_PHONE });
  await api.post('/auth/customer/otp/verify', { phone: CUSTOMER_PHONE, code: GUESSES[0] });
  const customer = await api.post('/auth/customer/otp/verify', {
    phone: CUSTOMER_PHONE,
    code: OTPS[0],
  });
  expect(customer.status).toBe(200);

  // Vendor: register, wrong then right code (which creates the vendor and signs in).
  const category = await createCategory();
  const registered = await api.post('/auth/vendor/register', {
    businessName: 'Sharma Plumbing',
    ownerFirstName: 'Anil',
    ownerLastName: 'Sharma',
    phone: VENDOR_PHONE,
    serviceCategoryIds: [String(category._id)],
  });
  const { registrationId } = registered.body.data;
  await api.post('/auth/vendor/otp/verify', { registrationId, code: GUESSES[1] });
  const verified = await api.post('/auth/vendor/otp/verify', { registrationId, code: OTPS[1] });
  expect(verified.status).toBe(200);

  // Vendor sign in later: request, wrong then right code.
  await api.post('/auth/vendor/signin/otp/request', { phone: VENDOR_PHONE });
  await api.post('/auth/vendor/signin/otp/verify', { phone: VENDOR_PHONE, code: GUESSES[2] });
  const signedIn = await api.post('/auth/vendor/signin/otp/verify', {
    phone: VENDOR_PHONE,
    code: OTPS[2],
  });
  expect(signedIn.status).toBe(200);

  // A number with no vendor account: a stand-in challenge, and a guess against it.
  await api.post('/auth/vendor/signin/otp/request', { phone: UNKNOWN_PHONE });
  await api.post('/auth/vendor/signin/otp/verify', { phone: UNKNOWN_PHONE, code: GUESSES[3] });

  // A second customer code after the wait, used once.
  clock.advance(31000);
  await api.post('/auth/customer/otp/request', { phone: CUSTOMER_PHONE });
  await api.post('/auth/customer/otp/verify', { phone: CUSTOMER_PHONE, code: OTPS[4] });

  // Responses: no code, drawn or guessed, appears in any.
  for (const value of [...OTPS, ...GUESSES]) {
    for (const res of api.responses) {
      expect({ path: res.path, leaked: res.text.includes(value) }).toEqual({
        path: res.path,
        leaked: false,
      });
    }
  }

  // Logs: no code of any kind, no full phone number; the masked delivery line is there.
  const logText = logs.all();
  for (const value of [...OTPS, ...GUESSES]) {
    expect(logText).not.toContain(value);
  }
  expect(logText).not.toContain(CUSTOMER_PHONE);
  expect(logText).not.toContain(VENDOR_PHONE);
  expect(logText).not.toContain(UNKNOWN_PHONE);
  expect(logText).toContain('otp issued for ••••3210');
  expect(logText).toContain('otp issued for ••••0003');

  // Database: hashes only.
  const stored = await databaseText();
  for (const value of OTPS) {
    expect(stored).not.toContain(`"${value}"`);
  }

  clock.restore();
  jest.restoreAllMocks();
});
