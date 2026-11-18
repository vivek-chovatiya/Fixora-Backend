// Administrator reissue of a vendor's auth code (PROJECT_BIBLE.md section 7A.2, amended 21/10/2026).
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const { createAdmin, createPhoneCustomer, createPhoneVendor, tokenFor } = require('./helpers/fixtures');
const Vendor = require('../src/models/vendor');

const reissue = (id, token) => api.post('/vendors/auth-code/regenerate', { id }, token);
const signIn = (phone, authCode) => api.post('/auth/vendor/signin', { phone, authCode });

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
});

test('an admin reissues the code: the old one dies at once, the new one signs in', async () => {
  const { token } = await createAdmin();
  const vendor = await createPhoneVendor({ phone: '9000000001', authCode: '482913' });

  const res = await reissue(String(vendor._id), token);
  expect(res.status).toBe(200);
  expect(Object.keys(res.body.data).sort()).toEqual(['code', 'issuedAt']);
  expect(res.body.data.code).toMatch(/^\d{6}$/);
  expect(res.body.data.code).not.toBe('482913');
  expect(new Date(res.body.data.issuedAt).toISOString()).toBe(res.body.data.issuedAt);

  expect((await signIn('9000000001', '482913')).body.code).toBe('AUTH_CODE_INVALID');
  expect((await signIn('9000000001', res.body.data.code)).status).toBe(200);

  const stored = await Vendor.findById(vendor._id).select('+authCodeHash');
  expect(stored.authCodeIssuedAt.toISOString()).toBe(res.body.data.issuedAt);
});

test('an email-registered vendor with no code gets one and can then sign in by phone', async () => {
  const { token } = await createAdmin();
  const vendor = await createPhoneVendor({ phone: '18005550201', authCode: null });

  const { code } = (await reissue(String(vendor._id), token)).body.data;
  expect((await signIn('18005550201', code)).status).toBe(200);
});

test('only an admin may reissue', async () => {
  const vendor = await createPhoneVendor();
  const customer = await createPhoneCustomer();

  const none = await reissue(String(vendor._id));
  expect(none.status).toBe(401);
  expect(none.body.code).toBe('UNAUTHORIZED');

  for (const token of [tokenFor(vendor, 'VENDOR'), tokenFor(customer, 'CUSTOMER')]) {
    const res = await reissue(String(vendor._id), token);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  }
  expect((await signIn('9000000001', '482913')).status).toBe(200);
});

test('an unknown vendor answers 404 NOT_FOUND, a malformed id VALIDATION_FAILED', async () => {
  const { token } = await createAdmin();

  const unknown = await reissue('aaaaaaaaaaaaaaaaaaaaaaaa', token);
  expect(unknown.status).toBe(404);
  expect(unknown.body.code).toBe('NOT_FOUND');

  const malformed = await reissue('vendor-1', token);
  expect(malformed.status).toBe(400);
  expect(malformed.body.code).toBe('VALIDATION_FAILED');
});
