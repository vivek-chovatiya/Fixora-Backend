// Vendor onboarding and sign in by one-time code (Phase 5 contract §1, owner decision 28/11/2026:
// the permanent auth code of PROJECT_BIBLE.md section 7A.2 is removed).
const jwt = require('jsonwebtoken');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const clock = require('./helpers/clock');
const { createCategory, createPhoneVendor } = require('./helpers/fixtures');
const OtpChallenge = require('../src/models/otpchallenge');
const Vendor = require('../src/models/vendor');
const VendorRegistration = require('../src/models/vendorregistration');
const otpDelivery = require('../src/services/otpdelivery');
const secretCode = require('../src/utils/secretCode');

const OTP = '123456';
const PHONE = '9000000003';
const VENDOR_PHONE = '9000000001';
const UNKNOWN_PHONE = '9111111111';
const MINUTE = 60 * 1000;

let categories;

const details = (overrides = {}) => ({
  businessName: 'Sharma Plumbing',
  ownerFirstName: 'Anil',
  ownerLastName: 'Sharma',
  phone: PHONE,
  email: 'anil.sharma@example.com',
  serviceCategoryIds: categories.map((c) => String(c._id)),
  ...overrides,
});

const register = (overrides) => api.post('/auth/vendor/register', details(overrides));
const requestOtp = (registrationId) => api.post('/auth/vendor/otp/request', { registrationId });
const verifyOtp = (registrationId, code = OTP) =>
  api.post('/auth/vendor/otp/verify', { registrationId, code });
const requestSignIn = (phone = VENDOR_PHONE) =>
  api.post('/auth/vendor/signin/otp/request', { phone });
const verifySignIn = (code, phone = VENDOR_PHONE) =>
  api.post('/auth/vendor/signin/otp/verify', { phone, code });

// What a caller can see of an answer, without the parts that differ by number or by the clock.
const visible = (res) => ({
  status: res.status,
  message: res.body.message,
  code: res.body.code,
  errors: res.body.errors,
  dataKeys: res.body.data ? Object.keys(res.body.data).sort() : null,
  deliveryChannel: res.body.data ? res.body.data.deliveryChannel : undefined,
  resendAfterSeconds: res.body.data ? res.body.data.resendAfterSeconds : undefined,
  retryAfter: res.headers['retry-after'],
});

const CHALLENGE_KEYS = ['deliveryChannel', 'expiresAt', 'maskedDestination', 'resendAfterSeconds'];

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  clock.install();
  process.env.OTP_STATIC_CODE = OTP;
  categories = [await createCategory(), await createCategory()];
});
afterEach(() => {
  clock.restore();
  jest.restoreAllMocks();
  process.env.OTP_STATIC_CODE = '';
});

describe('POST /auth/vendor/register', () => {
  test('starts a registration and issues a challenge at once, creating no vendor yet', async () => {
    const res = await register();

    expect(res.status).toBe(201);
    expect(Object.keys(res.body.data).sort()).toEqual(['challenge', 'registrationId']);
    expect(res.body.data.registrationId).toMatch(/^[a-f0-9]{24}$/);
    expect(res.body.data.challenge).toEqual({
      maskedDestination: '••••••0003',
      expiresAt: expect.any(String),
      resendAfterSeconds: 30,
      deliveryChannel: 'NONE',
    });

    const registration = await VendorRegistration.findById(res.body.data.registrationId);
    expect(registration.state).toBe('OTP_PENDING');
    expect(await Vendor.countDocuments()).toBe(0);
  });

  test('email is optional; an empty one is treated as absent', async () => {
    const res = await register({ email: '' });
    expect(res.status).toBe(201);
    const registration = await VendorRegistration.findById(res.body.data.registrationId);
    expect(registration.email).toBeUndefined();
  });

  test('a phone that already has a vendor account answers 409 PHONE_ALREADY_REGISTERED', async () => {
    await createPhoneVendor({ phone: PHONE });
    const res = await register({ phone: '(900) 000-0003' });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PHONE_ALREADY_REGISTERED');
    expect(await VendorRegistration.countDocuments()).toBe(0);
  });

  test('an email another vendor uses answers VALIDATION_FAILED on the email field', async () => {
    await createPhoneVendor({ phone: '9000000009', email: 'anil.sharma@example.com' });
    const res = await register();
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors).toEqual([
      { field: 'email', message: 'This email is already used by another account.' },
    ]);
  });

  test('no categories, an unknown category or an inactive one answers VALIDATION_FAILED', async () => {
    const inactive = await createCategory({ status: 'INACTIVE' });
    for (const serviceCategoryIds of [[], ['aaaaaaaaaaaaaaaaaaaaaaaa'], [String(inactive._id)]]) {
      const res = await register({ serviceCategoryIds });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors[0].field).toMatch(/^serviceCategoryIds/);
    }
  });

  test('registering the same phone again inside 30 seconds answers 429 OTP_RESEND_TOO_SOON', async () => {
    await register();
    const again = await register({ businessName: 'Sharma Plumbing & Sons' });
    expect(again.status).toBe(429);
    expect(again.body.code).toBe('OTP_RESEND_TOO_SOON');
    expect(await VendorRegistration.countDocuments()).toBe(1);

    clock.advance(31000);
    expect((await register({ businessName: 'Sharma Plumbing & Sons' })).status).toBe(201);
  });
});

describe('POST /auth/vendor/otp/request', () => {
  test('re-sends the code after 30 seconds, refuses before', async () => {
    const { registrationId } = (await register()).body.data;

    const early = await requestOtp(registrationId);
    expect(early.status).toBe(429);
    expect(early.body.code).toBe('OTP_RESEND_TOO_SOON');

    clock.advance(30500);
    const res = await requestOtp(registrationId);
    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(CHALLENGE_KEYS);
    expect(res.body.data.maskedDestination).toBe('••••••0003');
    expect(res.body.data.deliveryChannel).toBe('NONE');
  });

  test('an unknown, malformed or lapsed registration answers 404 REGISTRATION_NOT_FOUND', async () => {
    const { registrationId } = (await register()).body.data;
    clock.advance(24 * 60 * 60 * 1000 + 1000);

    for (const id of ['aaaaaaaaaaaaaaaaaaaaaaaa', 'reg_123', registrationId]) {
      const res = await requestOtp(id);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('REGISTRATION_NOT_FOUND');
    }
  });
});

describe('POST /auth/vendor/otp/verify (registration)', () => {
  test('creates the vendor ACTIVE + APPROVED and answers the vendor session; no auth code anywhere', async () => {
    const { registrationId } = (await register()).body.data;
    const res = await verifyOtp(registrationId);

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(Object.keys(data).sort()).toEqual(['role', 'token', 'user']);
    expect(data.role).toBe('VENDOR');
    expect(data.user).toEqual({
      id: expect.any(String),
      firstName: 'Anil',
      lastName: 'Sharma',
      email: 'anil.sharma@example.com',
      phone: PHONE,
      role: 'vendor',
    });
    expect(jwt.verify(data.token, process.env.JWT_SECRET)).toMatchObject({
      id: data.user.id,
      role: 'VENDOR',
    });

    const vendor = await Vendor.findById(data.user.id).select('+authCodeHash');
    expect(vendor).toMatchObject({
      businessName: 'Sharma Plumbing',
      ownerName: 'Anil Sharma',
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
      authCodeHash: null,
      authCodeIssuedAt: null,
    });
    expect(vendor.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(vendor.categoryIds.map(String).sort()).toEqual(categories.map((c) => String(c._id)).sort());

    const registration = await VendorRegistration.findById(registrationId).select('+authCodeHash');
    expect(registration.state).toBe('COMPLETED');
    expect(String(registration.vendorId)).toBe(data.user.id);
    expect(registration.authCodeHash).toBeNull();

    const me = await api.get('/auth/me', data.token);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject(data.user);
  });

  test('wrong code, too many attempts and expiry answer the OTP codes and create nothing', async () => {
    const { registrationId } = (await register()).body.data;

    const wrong = await verifyOtp(registrationId, '000000');
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('OTP_INVALID');

    for (let i = 0; i < 3; i += 1) await verifyOtp(registrationId, '000000');
    const fifth = await verifyOtp(registrationId, '000000');
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect((await verifyOtp(registrationId)).body.code).toBe('OTP_TOO_MANY_ATTEMPTS');

    clock.advance(31000);
    await requestOtp(registrationId);
    clock.advance(5 * MINUTE + 1000);
    const expired = await verifyOtp(registrationId);
    expect(expired.status).toBe(400);
    expect(expired.body.code).toBe('OTP_EXPIRED');
    expect(await Vendor.countDocuments()).toBe(0);
  });

  test('an unknown registration answers 404 REGISTRATION_NOT_FOUND', async () => {
    const res = await verifyOtp('aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('REGISTRATION_NOT_FOUND');
  });

  test('a finished registration cannot be verified again', async () => {
    const { registrationId } = (await register()).body.data;
    expect((await verifyOtp(registrationId)).status).toBe(200);

    const again = await verifyOtp(registrationId);
    expect(again.status).toBe(404);
    expect(again.body.code).toBe('REGISTRATION_NOT_FOUND');
    expect((await requestOtp(registrationId)).body.code).toBe('REGISTRATION_NOT_FOUND');
    expect(await Vendor.countDocuments()).toBe(1);
  });

  test('a double tap creates one vendor', async () => {
    const { registrationId } = (await register()).body.data;
    const results = await Promise.all([verifyOtp(registrationId), verifyOtp(registrationId)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await Vendor.countDocuments()).toBe(1);
  });

  test('if another registration for the number finished first, answers 409 PHONE_ALREADY_REGISTERED', async () => {
    const first = (await register()).body.data.registrationId;
    clock.advance(31000);
    const second = (await register({ email: 'other@example.com' })).body.data.registrationId;

    expect((await verifyOtp(first)).status).toBe(200);
    const res = await verifyOtp(second);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PHONE_ALREADY_REGISTERED');
    expect(await Vendor.countDocuments()).toBe(1);
  });

  test('a registration older than 24 hours answers 404 REGISTRATION_NOT_FOUND', async () => {
    const { registrationId } = (await register()).body.data;
    clock.advance(24 * 60 * 60 * 1000 + 1000);
    const res = await verifyOtp(registrationId);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('REGISTRATION_NOT_FOUND');
  });

  // A registration whose phone was verified under the removed flow (shown an auth code, never
  // confirmed) can still finish: a new code and its verification complete it.
  test('a legacy CODE_ISSUED registration completes after a resend', async () => {
    const { registrationId } = (await register()).body.data;
    await VendorRegistration.updateOne({ _id: registrationId }, { $set: { state: 'CODE_ISSUED' } });
    await OtpChallenge.updateMany({}, { $set: { consumedAt: new Date() } });

    expect((await verifyOtp(registrationId)).body.code).toBe('OTP_EXPIRED');
    clock.advance(31000);
    expect((await requestOtp(registrationId)).status).toBe(200);
    const res = await verifyOtp(registrationId);
    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('VENDOR');
  });

  test('a vendor who registered signs in later with a new one-time code', async () => {
    const { registrationId } = (await register()).body.data;
    const registered = (await verifyOtp(registrationId)).body.data;

    expect((await requestSignIn(PHONE)).status).toBe(200);
    const res = await verifySignIn(OTP, PHONE);
    expect(res.status).toBe(200);
    expect(res.body.data.user).toEqual(registered.user);
  });
});

describe('POST /auth/vendor/signin/otp/request', () => {
  test('answers the challenge, with the channel used, for a vendor', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    const before = Date.now();
    const res = await requestSignIn();

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Verification code sent.');
    expect(Object.keys(res.body.data).sort()).toEqual(CHALLENGE_KEYS);
    expect(res.body.data).toMatchObject({
      maskedDestination: '••••••0001',
      resendAfterSeconds: 30,
      deliveryChannel: 'NONE',
    });
    const expiresAt = Date.parse(res.body.data.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 5 * MINUTE);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 5 * MINUTE);
  });

  test('answers the same for a vendor, an unknown, a suspended, a deleted and an unproven number', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    await createPhoneVendor({ phone: '9000000005', status: 'BLOCKED' });
    await createPhoneVendor({ phone: '9000000006', isDeleted: true });
    await createPhoneVendor({ phone: '9000000007', phoneVerifiedAt: null });

    const answers = [];
    for (const phone of [VENDOR_PHONE, UNKNOWN_PHONE, '9000000005', '9000000006', '9000000007']) {
      answers.push(visible(await requestSignIn(phone)));
    }
    for (const answer of answers) {
      expect(answer).toEqual(answers[0]);
    }
    expect(answers[0]).toMatchObject({ status: 200, dataKeys: CHALLENGE_KEYS });
  });

  test('a code is delivered only to a vendor that can sign in; a suspended vendor still gets one', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    await createPhoneVendor({ phone: '9000000005', status: 'BLOCKED' });
    await createPhoneVendor({ phone: '9000000006', isDeleted: true });
    await createPhoneVendor({ phone: '9000000007', phoneVerifiedAt: null });
    const deliver = jest.spyOn(otpDelivery, 'deliver');

    for (const phone of [VENDOR_PHONE, UNKNOWN_PHONE, '9000000005', '9000000006', '9000000007']) {
      await requestSignIn(phone);
    }

    expect(deliver.mock.calls.map(([args]) => args.phone)).toEqual([VENDOR_PHONE, '9000000005']);
    const text = logs.all();
    expect(text).toContain('otp issued for ••••0001');
    expect(text).not.toContain('otp issued for ••••1111');
    expect(text).toContain('vendor sign-in code asked for ••••1111: no vendor account, none sent');
  });

  test('the resend wait applies to a vendor and an unknown number alike', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    for (const phone of [VENDOR_PHONE, UNKNOWN_PHONE]) {
      await requestSignIn(phone);
    }
    clock.advance(29000);
    const known = await requestSignIn(VENDOR_PHONE);
    const unknown = await requestSignIn(UNKNOWN_PHONE);
    expect(visible(unknown)).toEqual(visible(known));
    expect(known.status).toBe(429);
    expect(known.body.code).toBe('OTP_RESEND_TOO_SOON');

    clock.advance(1500);
    expect((await requestSignIn(VENDOR_PHONE)).status).toBe(200);
    expect((await requestSignIn(UNKNOWN_PHONE)).status).toBe(200);
  });

  test('the daily cap of 10 codes applies to a vendor and an unknown number alike', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    for (let i = 0; i < 10; i += 1) {
      expect((await requestSignIn(VENDOR_PHONE)).status).toBe(200);
      expect((await requestSignIn(UNKNOWN_PHONE)).status).toBe(200);
      clock.advance(31000);
    }
    const known = await requestSignIn(VENDOR_PHONE);
    const unknown = await requestSignIn(UNKNOWN_PHONE);
    expect(known.status).toBe(429);
    expect(known.body.code).toBe('RATE_LIMITED');
    // Each number's day started at its own first request, a few milliseconds apart, so the
    // Retry-After seconds may round one apart; everything else is identical.
    expect({ ...visible(unknown), retryAfter: null }).toEqual({ ...visible(known), retryAfter: null });
    expect(
      Math.abs(Number(unknown.headers['retry-after']) - Number(known.headers['retry-after']))
    ).toBeLessThanOrEqual(1);
  });

  test('a phone that is not 7 to 15 digits answers VALIDATION_FAILED', async () => {
    const res = await requestSignIn('98765abc10');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors[0].field).toBe('phone');
  });
});

describe('POST /auth/vendor/signin/otp/verify', () => {
  test('the right code answers the vendor session', async () => {
    const vendor = await createPhoneVendor({ phone: VENDOR_PHONE });
    await requestSignIn();
    const res = await verifySignIn(OTP);

    expect(res.status).toBe(200);
    expect(res.body.message).toBe('Vendor signed in successfully.');
    const { data } = res.body;
    expect(Object.keys(data).sort()).toEqual(['role', 'token', 'user']);
    expect(data.role).toBe('VENDOR');
    expect(data.user).toEqual({
      id: String(vendor._id),
      firstName: 'Ravi',
      lastName: 'Kumar',
      phone: VENDOR_PHONE,
      role: 'vendor',
    });
    const payload = jwt.verify(data.token, process.env.JWT_SECRET);
    expect(payload).toMatchObject({ id: String(vendor._id), role: 'VENDOR', v: 0 });

    const me = await api.get('/auth/me', data.token);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject(data.user);
  });

  test('accepts a formatted phone and a spaced or hyphenated code', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    await requestSignIn('(900) 000-0001');
    expect((await verifySignIn('123 456', '900-000-0001')).status).toBe(200);
    clock.advance(31000);
    await requestSignIn('900-000-0001');
    expect((await verifySignIn('123-456', '9000000001')).status).toBe(200);
  });

  test('a wrong code answers 400 OTP_INVALID; the fifth kills the code with 429 OTP_TOO_MANY_ATTEMPTS', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    await requestSignIn();
    for (let i = 0; i < 4; i += 1) {
      const res = await verifySignIn('000000');
      expect(res.status).toBe(400);
      expect(res.body).toEqual({
        success: false,
        message: 'The code entered is not correct.',
        code: 'OTP_INVALID',
        errors: null,
        data: null,
      });
    }
    const fifth = await verifySignIn('000000');
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect((await verifySignIn(OTP)).body.code).toBe('OTP_TOO_MANY_ATTEMPTS');

    clock.advance(31000);
    await requestSignIn();
    expect((await verifySignIn(OTP)).status).toBe(200);
  });

  test('a code past its 5 minutes answers OTP_EXPIRED; no request at all answers OTP_EXPIRED', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    expect((await verifySignIn(OTP)).body.code).toBe('OTP_EXPIRED');

    await requestSignIn();
    clock.advance(5 * MINUTE + 1000);
    const res = await verifySignIn(OTP);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_EXPIRED');
  });

  test('a code signs in once: using it again answers OTP_EXPIRED', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    await requestSignIn();
    expect((await verifySignIn(OTP)).status).toBe(200);
    expect((await verifySignIn(OTP)).body.code).toBe('OTP_EXPIRED');
  });

  test('an unknown number answers OTP_INVALID even for the static code', async () => {
    await requestSignIn(UNKNOWN_PHONE);
    const res = await verifySignIn(OTP, UNKNOWN_PHONE);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_INVALID');
  });

  test('an unknown number answers every attempt exactly as a vendor with wrong codes does', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    const run = async (phone) => {
      const answers = [visible(await verifySignIn('000000', phone))];
      await requestSignIn(phone);
      for (let i = 0; i < 6; i += 1) {
        answers.push(visible(await verifySignIn(String(700100 + i), phone)));
      }
      return answers;
    };

    const known = await run(VENDOR_PHONE);
    const unknown = await run(UNKNOWN_PHONE);
    expect(unknown).toEqual(known);
    expect(known.map((a) => a.code)).toEqual([
      'OTP_EXPIRED',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_INVALID',
      'OTP_TOO_MANY_ATTEMPTS',
      'OTP_TOO_MANY_ATTEMPTS',
    ]);
  });

  test('a deleted vendor and an unproven (email sign-up) vendor are refused like an unknown number', async () => {
    await createPhoneVendor({ phone: '9000000006', isDeleted: true });
    await createPhoneVendor({ phone: '9000000007', phoneVerifiedAt: null, email: 'squat@example.com' });

    for (const phone of ['9000000006', '9000000007']) {
      await requestSignIn(phone);
      const res = await verifySignIn(OTP, phone);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('OTP_INVALID');
    }
    const unproven = await Vendor.findOne({ phone: '9000000007' });
    expect(unproven.phoneVerifiedAt).toBeNull();
    expect(unproven.email).toBe('squat@example.com');
  });

  test('a vendor deleted after the code was sent is refused as a wrong code', async () => {
    const vendor = await createPhoneVendor({ phone: VENDOR_PHONE });
    await requestSignIn();
    await Vendor.updateOne({ _id: vendor._id }, { isDeleted: true, deletedAt: new Date() });
    const res = await verifySignIn(OTP);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_INVALID');
  });

  test('a suspended vendor gets 403 ACCOUNT_SUSPENDED, but only after a right code', async () => {
    for (const [phone, status] of [
      ['9000000005', 'BLOCKED'],
      ['9000000008', 'INACTIVE'],
    ]) {
      await createPhoneVendor({ phone, status });
      await requestSignIn(phone);
      expect((await verifySignIn('000000', phone)).body.code).toBe('OTP_INVALID');

      const res = await verifySignIn(OTP, phone);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
      expect(res.body.data).toBeNull();
    }
  });

  test('a code that is not 6 digits answers VALIDATION_FAILED and costs no attempt', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    await requestSignIn();
    const res = await verifySignIn('48291');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors[0].field).toBe('code');
    const challenge = await OtpChallenge.findOne({ phone: VENDOR_PHONE, purpose: 'VENDOR_SIGN_IN' });
    expect(challenge.attempts).toBe(0);
  });

  test('a sign-in code and a customer code for the same number are separate', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    await requestSignIn();
    expect((await api.post('/auth/customer/otp/request', { phone: VENDOR_PHONE })).status).toBe(200);
    expect((await verifySignIn(OTP)).status).toBe(200);
    const customer = await api.post('/auth/customer/otp/verify', { phone: VENDOR_PHONE, code: OTP });
    expect(customer.body.data.role).toBe('CUSTOMER');
  });
});

describe('the static code (OTP_STATIC_CODE) on vendor sign in', () => {
  const withNodeEnv = async (value, run) => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = value;
    try {
      await run();
    } finally {
      process.env.NODE_ENV = previous;
    }
  };

  test('works in development', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    await withNodeEnv('development', async () => {
      const random = jest.spyOn(secretCode, 'generateNumericCode');
      await requestSignIn();
      expect(random).not.toHaveBeenCalled();
      expect((await verifySignIn(OTP)).status).toBe(200);
    });
  });

  test.each([['production'], ['staging']])('is ignored in %s: the code is random', async (env) => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    await withNodeEnv(env, async () => {
      jest.spyOn(secretCode, 'generateNumericCode').mockReturnValue('590214');
      await requestSignIn();
      expect((await verifySignIn(OTP)).body.code).toBe('OTP_INVALID');
      expect((await verifySignIn('590214')).status).toBe(200);
    });
  });

  test('is never the code of an unknown number’s stand-in challenge', async () => {
    const random = jest.spyOn(secretCode, 'generateNumericCode').mockReturnValue('640011');
    await requestSignIn(UNKNOWN_PHONE);
    expect(random).toHaveBeenCalledTimes(1);
    expect((await verifySignIn(OTP, UNKNOWN_PHONE)).body.code).toBe('OTP_INVALID');
  });
});

describe('the removed auth-code routes (Phase 5 contract §1.3)', () => {
  test('answer the router’s 404 NOT_FOUND', async () => {
    await createPhoneVendor({ phone: VENDOR_PHONE });
    const { registrationId } = (await register()).body.data;
    const calls = [
      ['/auth/vendor/signin', { phone: VENDOR_PHONE, authCode: '482913' }],
      ['/auth/vendor/auth-code/confirm', { registrationId, authCode: '482913' }],
      ['/auth/vendor/auth-code/regenerate', { registrationId }],
      ['/vendors/auth-code/regenerate', { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }],
    ];
    for (const [path, body] of calls) {
      const res = await api.post(path, body);
      expect({ path, status: res.status }).toEqual({ path, status: 404 });
      expect(res.body).toEqual({
        success: false,
        message: `Endpoint /api/v1${path} not found.`,
        code: 'NOT_FOUND',
        errors: null,
        data: null,
      });
    }
  });
});
