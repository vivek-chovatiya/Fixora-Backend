// Codes never leak: not into a response (except the one-time display of a newly issued vendor
// auth code), not into a log line, not into the database in plain text. Each flow runs with
// distinctive pinned codes so a search for them cannot match by accident.
const mongoose = require('mongoose');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const clock = require('./helpers/clock');
const { createAdmin, createCategory } = require('./helpers/fixtures');
const secretCode = require('../src/utils/secretCode');

const CUSTOMER_PHONE = '9876543210';
const VENDOR_PHONE = '9000000003';

// One-time codes: may appear nowhere.
const OTPS = ['731905', '731906', '731907'];
// Auth codes: each may appear only in the response that issued it.
const AUTH_CODES = ['846201', '846202', '846203'];

// Paths whose response is the one-time display of a vendor auth code.
const DISPLAY_PATHS = [
  '/auth/vendor/otp/verify',
  '/auth/vendor/auth-code/regenerate',
  '/vendors/auth-code/regenerate',
];

const databaseText = async () => {
  const collections = await mongoose.connection.db.collections();
  const dumps = await Promise.all(collections.map((c) => c.find({}).toArray()));
  return JSON.stringify(dumps);
};

beforeAll(db.connect);
afterAll(db.disconnect);

test('no code reaches a response, a log line or the database, except the one-time display', async () => {
  await db.clear();
  logs.reset();
  api.resetResponses();
  clock.install();
  process.env.OTP_STATIC_CODE = '';
  jest
    .spyOn(secretCode, 'generateNumericCode')
    .mockReturnValueOnce(OTPS[0]) // customer one-time code
    .mockReturnValueOnce(OTPS[1]) // vendor registration one-time code
    .mockReturnValueOnce(AUTH_CODES[0]) // auth code issued on phone verification
    .mockReturnValueOnce(AUTH_CODES[1]) // regenerated before confirmation
    .mockReturnValueOnce(AUTH_CODES[2]) // reissued by an administrator
    .mockReturnValueOnce(OTPS[2]); // a second customer code, after the resend wait

  // Customer: request, a wrong attempt, sign in.
  await api.post('/auth/customer/otp/request', { phone: CUSTOMER_PHONE });
  await api.post('/auth/customer/otp/verify', { phone: CUSTOMER_PHONE, code: '913371' });
  const customer = await api.post('/auth/customer/otp/verify', {
    phone: CUSTOMER_PHONE,
    code: OTPS[0],
  });
  expect(customer.status).toBe(200);

  // Vendor: register, wrong then right one-time code, regenerate, wrong then right confirm,
  // wrong then right sign in.
  const category = await createCategory();
  const registered = await api.post('/auth/vendor/register', {
    businessName: 'Sharma Plumbing',
    ownerFirstName: 'Anil',
    ownerLastName: 'Sharma',
    phone: VENDOR_PHONE,
    serviceCategoryIds: [String(category._id)],
  });
  const { registrationId } = registered.body.data;
  await api.post('/auth/vendor/otp/verify', { registrationId, code: '913372' });
  const shown = await api.post('/auth/vendor/otp/verify', { registrationId, code: OTPS[1] });
  expect(shown.body.data.code).toBe(AUTH_CODES[0]);

  const regenerated = await api.post('/auth/vendor/auth-code/regenerate', { registrationId });
  expect(regenerated.body.data.code).toBe(AUTH_CODES[1]);

  await api.post('/auth/vendor/auth-code/confirm', { registrationId, authCode: AUTH_CODES[0] });
  const confirmed = await api.post('/auth/vendor/auth-code/confirm', {
    registrationId,
    authCode: AUTH_CODES[1],
  });
  expect(confirmed.status).toBe(200);

  await api.post('/auth/vendor/signin', { phone: VENDOR_PHONE, authCode: '913373' });
  expect(
    (await api.post('/auth/vendor/signin', { phone: VENDOR_PHONE, authCode: AUTH_CODES[1] }))
      .status
  ).toBe(200);

  // Administrator reissue, then the vendor signs in with the new code.
  const { token } = await createAdmin();
  const reissued = await api.post(
    '/vendors/auth-code/regenerate',
    { id: confirmed.body.data.user.id },
    token
  );
  expect(reissued.body.data.code).toBe(AUTH_CODES[2]);
  await api.post('/auth/vendor/signin', { phone: VENDOR_PHONE, authCode: AUTH_CODES[2] });

  // A second customer code after the wait, used once.
  clock.advance(31000);
  await api.post('/auth/customer/otp/request', { phone: CUSTOMER_PHONE });
  await api.post('/auth/customer/otp/verify', { phone: CUSTOMER_PHONE, code: OTPS[2] });

  // Responses: one-time codes appear in none; each auth code only in the response that issued
  // it. (Wrong attempts, which the client sent, are checked too.)
  const responses = api.responses;
  for (const otp of [...OTPS, '913371', '913372', '913373']) {
    for (const res of responses) {
      expect({ path: res.path, leaked: res.text.includes(otp) }).toEqual({
        path: res.path,
        leaked: false,
      });
    }
  }
  for (const code of AUTH_CODES) {
    const carrying = responses.filter((res) => res.text.includes(code));
    expect(carrying).toHaveLength(1);
    expect(DISPLAY_PATHS).toContain(carrying[0].path);
  }

  // Logs: no code of any kind, no full phone number; the masked delivery line is there.
  const logText = logs.all();
  for (const value of [...OTPS, ...AUTH_CODES, '913371', '913372', '913373']) {
    expect(logText).not.toContain(value);
  }
  expect(logText).not.toContain(CUSTOMER_PHONE);
  expect(logText).not.toContain(VENDOR_PHONE);
  expect(logText).toContain('otp issued for ••••3210');
  expect(logText).toContain('otp issued for ••••0003');

  // Database: hashes only.
  const stored = await databaseText();
  for (const value of [...OTPS, ...AUTH_CODES]) {
    expect(stored).not.toContain(`"${value}"`);
  }

  clock.restore();
  jest.restoreAllMocks();
});
