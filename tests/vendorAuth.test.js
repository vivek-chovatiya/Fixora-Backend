// Vendor onboarding and sign in (shared contract; PROJECT_BIBLE.md section 7A.2 amended 21/10/2026).
const jwt = require('jsonwebtoken');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const clock = require('./helpers/clock');
const { createCategory, createPhoneVendor } = require('./helpers/fixtures');
const Vendor = require('../src/models/vendor');
const VendorRegistration = require('../src/models/vendorregistration');
const secretCode = require('../src/utils/secretCode');

const OTP = '123456';
const PHONE = '9000000003';

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
const confirm = (registrationId, authCode) =>
  api.post('/auth/vendor/auth-code/confirm', { registrationId, authCode });
const regenerate = (registrationId) =>
  api.post('/auth/vendor/auth-code/regenerate', { registrationId });
const signIn = (phone, authCode) => api.post('/auth/vendor/signin', { phone, authCode });

// Register and verify the phone; answers the registration id and the auth code shown.
const registerAndVerify = async (overrides) => {
  const { registrationId } = (await register(overrides)).body.data;
  const { code } = (await verifyOtp(registrationId)).body.data;
  return { registrationId, code };
};

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
    expect(res.body.data.maskedDestination).toBe('••••••0003');
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

describe('POST /auth/vendor/otp/verify', () => {
  test('answers the permanent auth code once, as a 6-digit string, without signing in', async () => {
    const { registrationId } = (await register()).body.data;
    const res = await verifyOtp(registrationId);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['code', 'issuedAt']);
    expect(res.body.data.code).toMatch(/^\d{6}$/);
    expect(new Date(res.body.data.issuedAt).toISOString()).toBe(res.body.data.issuedAt);
    expect(res.body.data.token).toBeUndefined();

    const registration = await VendorRegistration.findById(registrationId).select('+authCodeHash');
    expect(registration.state).toBe('CODE_ISSUED');
    expect(registration.authCodeHash).toMatch(/^\$2[aby]\$/);
    expect(await Vendor.countDocuments()).toBe(0);
  });

  test('keeps a leading zero', async () => {
    jest.spyOn(secretCode, 'generateNumericCode').mockReturnValue('004217');
    const { registrationId, code } = await registerAndVerify();
    expect(code).toBe('004217');
    expect((await confirm(registrationId, '004217')).status).toBe(200);
    expect((await signIn(PHONE, '004217')).status).toBe(200);
  });

  test('wrong code, too many attempts and expiry answer the OTP codes', async () => {
    const { registrationId } = (await register()).body.data;

    const wrong = await verifyOtp(registrationId, '000000');
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('OTP_INVALID');

    for (let i = 0; i < 3; i += 1) await verifyOtp(registrationId, '000000');
    const fifth = await verifyOtp(registrationId, '000000');
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');

    clock.advance(31000);
    await requestOtp(registrationId);
    clock.advance(5 * 60 * 1000 + 1000);
    const expired = await verifyOtp(registrationId);
    expect(expired.status).toBe(400);
    expect(expired.body.code).toBe('OTP_EXPIRED');
  });

  test('an unknown registration answers 404 REGISTRATION_NOT_FOUND', async () => {
    const res = await verifyOtp('aaaaaaaaaaaaaaaaaaaaaaaa');
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('REGISTRATION_NOT_FOUND');
  });
});

describe('POST /auth/vendor/auth-code/confirm', () => {
  test('the shown code signs the vendor in and creates them ACTIVE + APPROVED', async () => {
    const { registrationId, code } = await registerAndVerify();
    const res = await confirm(registrationId, code);

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

    const vendor = await Vendor.findById(data.user.id);
    expect(vendor).toMatchObject({
      businessName: 'Sharma Plumbing',
      ownerName: 'Anil Sharma',
      status: 'ACTIVE',
      approvalStatus: 'APPROVED',
    });
    expect(vendor.categoryIds.map(String).sort()).toEqual(categories.map((c) => String(c._id)).sort());
    expect((await VendorRegistration.findById(registrationId)).state).toBe('COMPLETED');

    const me = await api.get('/auth/me', data.token);
    expect(me.body.data).toMatchObject(data.user);
  });

  // Not signed in yet, so a mismatch is a 400 — never a 401 that could read as an expired session.
  test('a wrong code answers 400 AUTH_CODE_INVALID and creates nothing', async () => {
    const { registrationId, code } = await registerAndVerify();
    const wrong = code === '111111' ? '222222' : '111111';
    const res = await confirm(registrationId, wrong);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      success: false,
      message: 'That code does not match the one shown.',
      code: 'AUTH_CODE_INVALID',
      errors: null,
      data: null,
    });
    expect(await Vendor.countDocuments()).toBe(0);
  });

  test('before the phone is verified any code answers 400 AUTH_CODE_INVALID', async () => {
    const { registrationId } = (await register()).body.data;
    const res = await confirm(registrationId, '123456');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('AUTH_CODE_INVALID');
  });

  test('the fifth wrong code answers 429 OTP_TOO_MANY_ATTEMPTS until the code is regenerated', async () => {
    jest
      .spyOn(secretCode, 'generateNumericCode')
      .mockReturnValueOnce('640011')
      .mockReturnValueOnce('640022');
    const { registrationId } = await registerAndVerify();

    for (let i = 0; i < 4; i += 1) {
      const res = await confirm(registrationId, '000000');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('AUTH_CODE_INVALID');
    }
    const fifth = await confirm(registrationId, '000000');
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');

    // Locked: even the code that was shown is refused now.
    const right = await confirm(registrationId, '640011');
    expect(right.status).toBe(429);
    expect(right.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect(await Vendor.countDocuments()).toBe(0);

    // Regenerating issues a fresh code with a fresh allowance.
    const { code } = (await regenerate(registrationId)).body.data;
    expect(code).toBe('640022');
    expect((await confirm(registrationId, '000000')).status).toBe(400);
    expect((await confirm(registrationId, '640022')).status).toBe(200);
  });

  test('a registration saved before the attempt counter existed can still be confirmed', async () => {
    const { registrationId, code } = await registerAndVerify();
    await VendorRegistration.collection.updateOne(
      { _id: VendorRegistration.castObject({ _id: registrationId })._id },
      { $unset: { confirmAttempts: '' } }
    );
    expect((await confirm(registrationId, code)).status).toBe(200);
  });

  test('four wrong codes then the right one still confirms', async () => {
    const { registrationId, code } = await registerAndVerify();
    const wrong = code === '111111' ? '222222' : '111111';
    for (let i = 0; i < 4; i += 1) {
      await confirm(registrationId, wrong);
    }
    expect((await confirm(registrationId, code)).status).toBe(200);
  });

  test('parallel wrong guesses cannot get past the confirm limit', async () => {
    const { registrationId, code } = await registerAndVerify();
    const guesses = Array.from({ length: 12 }, (_, i) => String(300000 + i)).filter(
      (guess) => guess !== code
    );
    const results = await Promise.all(guesses.map((guess) => confirm(registrationId, guess)));
    expect(results.filter((r) => r.body.code === 'AUTH_CODE_INVALID').length).toBeLessThanOrEqual(4);
    expect((await VendorRegistration.findById(registrationId)).confirmAttempts).toBe(5);
    expect((await confirm(registrationId, code)).body.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  test('a finished registration cannot be confirmed again or regenerated', async () => {
    const { registrationId, code } = await registerAndVerify();
    expect((await confirm(registrationId, code)).status).toBe(200);

    const again = await confirm(registrationId, code);
    expect(again.status).toBe(404);
    expect(again.body.code).toBe('REGISTRATION_NOT_FOUND');
    expect((await regenerate(registrationId)).body.code).toBe('REGISTRATION_NOT_FOUND');
    expect(await Vendor.countDocuments()).toBe(1);
  });

  test('a double tap creates one vendor', async () => {
    const { registrationId, code } = await registerAndVerify();
    const results = await Promise.all([confirm(registrationId, code), confirm(registrationId, code)]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(await Vendor.countDocuments()).toBe(1);
  });

  test('if another registration for the number finished first, answers 409 PHONE_ALREADY_REGISTERED', async () => {
    const first = await registerAndVerify();
    clock.advance(31000);
    const second = await registerAndVerify({ email: 'other@example.com' });

    expect((await confirm(first.registrationId, first.code)).status).toBe(200);
    const res = await confirm(second.registrationId, second.code);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PHONE_ALREADY_REGISTERED');
  });

  test('a registration older than 24 hours answers 404 REGISTRATION_NOT_FOUND', async () => {
    const { registrationId, code } = await registerAndVerify();
    clock.advance(24 * 60 * 60 * 1000 + 1000);
    const res = await confirm(registrationId, code);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('REGISTRATION_NOT_FOUND');
  });
});

describe('POST /auth/vendor/auth-code/regenerate', () => {
  test('issues a different code and the old one stops working at once', async () => {
    const { registrationId, code: oldCode } = await registerAndVerify();
    const res = await regenerate(registrationId);

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual(['code', 'issuedAt']);
    expect(res.body.data.code).toMatch(/^\d{6}$/);
    expect(res.body.data.code).not.toBe(oldCode);

    const old = await confirm(registrationId, oldCode);
    expect(old.status).toBe(400);
    expect(old.body.code).toBe('AUTH_CODE_INVALID');
    expect((await confirm(registrationId, res.body.data.code)).status).toBe(200);
  });

  test('never reissues the code it replaces, even when the random draw repeats it', async () => {
    jest
      .spyOn(secretCode, 'generateNumericCode')
      .mockReturnValueOnce('555555')
      .mockReturnValueOnce('555555')
      .mockReturnValueOnce('777777');
    const { registrationId, code } = await registerAndVerify();
    expect(code).toBe('555555');
    expect((await regenerate(registrationId)).body.data.code).toBe('777777');
  });

  test('before the phone is verified answers 404 REGISTRATION_NOT_FOUND', async () => {
    const { registrationId } = (await register()).body.data;
    const res = await regenerate(registrationId);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('REGISTRATION_NOT_FOUND');
  });
});

describe('POST /auth/vendor/signin', () => {
  const REFUSAL = {
    success: false,
    message: 'Those sign-in details were not recognised.',
    code: 'AUTH_CODE_INVALID',
    errors: null,
    data: null,
  };

  test('phone + auth code signs a vendor in', async () => {
    const vendor = await createPhoneVendor({ phone: '9000000001', authCode: '482913' });
    const res = await signIn('9000000001', '482913');

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('VENDOR');
    expect(res.body.data.user).toEqual({
      id: String(vendor._id),
      firstName: 'Ravi',
      lastName: 'Kumar',
      phone: '9000000001',
      role: 'vendor',
    });
  });

  test('accepts a formatted phone and a spaced or hyphenated code', async () => {
    await createPhoneVendor({ phone: '9000000001', authCode: '482913' });
    expect((await signIn('(900) 000-0001', '482 913')).status).toBe(200);
    expect((await signIn('900-000-0001', '482-913')).status).toBe(200);
  });

  test('wrong code, unknown phone and revoked code get one identical 401', async () => {
    const vendor = await createPhoneVendor({ phone: '9000000001', authCode: '482913' });
    await createPhoneVendor({ phone: '9000000004', authCode: null });

    const wrongCode = await signIn('9000000001', '482914');
    const unknownPhone = await signIn('9111111111', '482913');
    const noCodeIssued = await signIn('9000000004', '482913');

    await Vendor.updateOne({ _id: vendor._id }, { authCodeHash: null });
    const revoked = await signIn('9000000001', '482913');

    for (const res of [wrongCode, unknownPhone, noCodeIssued, revoked]) {
      expect(res.status).toBe(401);
      expect(res.body).toEqual(REFUSAL);
    }
  });

  test('a soft-deleted vendor is refused like an unknown phone', async () => {
    await createPhoneVendor({ phone: '9000000001', authCode: '482913', isDeleted: true });
    const res = await signIn('9000000001', '482913');
    expect(res.status).toBe(401);
    expect(res.body).toEqual(REFUSAL);
  });

  test('a suspended vendor gets 403 ACCOUNT_SUSPENDED only with the right code', async () => {
    await createPhoneVendor({ phone: '9000000001', authCode: '482913', status: 'BLOCKED' });

    const wrong = await signIn('9000000001', '000000');
    expect(wrong.status).toBe(401);
    expect(wrong.body).toEqual(REFUSAL);

    const right = await signIn('9000000001', '482913');
    expect(right.status).toBe(403);
    expect(right.body.code).toBe('ACCOUNT_SUSPENDED');
  });

  test('a vendor who registered by phone signs in later with the code they were shown', async () => {
    const { registrationId, code } = await registerAndVerify();
    await confirm(registrationId, code);
    expect((await signIn(PHONE, code)).status).toBe(200);
  });

  test('a code that is not 6 digits answers VALIDATION_FAILED', async () => {
    const res = await signIn('9000000001', '48291');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors[0].field).toBe('authCode');
  });
});
