// Customer sign in: phone + one-time code (shared contract; PROJECT_BIBLE.md section 7A.1).
const jwt = require('jsonwebtoken');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const clock = require('./helpers/clock');
const { createPhoneCustomer } = require('./helpers/fixtures');
const Customer = require('../src/models/customer');
const OtpChallenge = require('../src/models/otpchallenge');
const secretCode = require('../src/utils/secretCode');

const PHONE = '9876543210';
const STATIC_CODE = '123456';

const requestOtp = (phone = PHONE) => api.post('/auth/customer/otp/request', { phone });
const verifyOtp = (code, phone = PHONE) => api.post('/auth/customer/otp/verify', { phone, code });

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  clock.install();
  process.env.OTP_STATIC_CODE = STATIC_CODE;
});
afterEach(() => {
  clock.restore();
  jest.restoreAllMocks();
  process.env.OTP_STATIC_CODE = '';
});

describe('POST /auth/customer/otp/request', () => {
  test('answers an OtpChallenge and nothing else', async () => {
    const before = Date.now();
    const res = await requestOtp();

    expect(res.status).toBe(200);
    expect(Object.keys(res.body.data).sort()).toEqual([
      'expiresAt',
      'maskedDestination',
      'resendAfterSeconds',
    ]);
    expect(res.body.data.maskedDestination).toBe('••••••3210');
    expect(res.body.data.resendAfterSeconds).toBe(30);
    const expiresAt = Date.parse(res.body.data.expiresAt);
    expect(expiresAt).toBeGreaterThanOrEqual(before + 300000);
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 300000);
  });

  test('answers the same for a registered and an unregistered number', async () => {
    await createPhoneCustomer();
    const known = await requestOtp(PHONE);
    const unknown = await requestOtp('9876500000');

    expect(known.status).toBe(unknown.status);
    expect(Object.keys(known.body.data)).toEqual(Object.keys(unknown.body.data));
    expect(known.body.message).toBe(unknown.body.message);
  });

  test('normalises the phone, so a formatted number and its digits are one challenge', async () => {
    await requestOtp(' (987) 654-3210 ');
    const res = await verifyOtp(STATIC_CODE, '9876543210');
    expect(res.status).toBe(200);
  });

  test('rejects a phone that is not 7 to 15 digits with VALIDATION_FAILED', async () => {
    for (const phone of ['98765abc10', '123456', '1234567890123456', '']) {
      const res = await requestOtp(phone);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors[0].field).toBe('phone');
    }
  });

  test('stores only a bcrypt hash of the code', async () => {
    await requestOtp();
    const challenge = await OtpChallenge.findOne({ phone: PHONE }).select('+codeHash').lean();
    expect(challenge.codeHash).toMatch(/^\$2[aby]\$/);
    expect(JSON.stringify(challenge)).not.toContain(STATIC_CODE);
  });

  test('a second request inside 30 seconds answers 429 OTP_RESEND_TOO_SOON', async () => {
    await requestOtp();
    clock.advance(29000);
    const res = await requestOtp();
    expect(res.status).toBe(429);
    expect(res.body.code).toBe('OTP_RESEND_TOO_SOON');

    clock.advance(1500);
    expect((await requestOtp()).status).toBe(200);
  });

  test('a resend replaces the code: the earlier one stops working', async () => {
    process.env.OTP_STATIC_CODE = '';
    jest
      .spyOn(secretCode, 'generateNumericCode')
      .mockReturnValueOnce('111111')
      .mockReturnValueOnce('222222');

    await requestOtp();
    clock.advance(31000);
    await requestOtp();

    const old = await verifyOtp('111111');
    expect(old.status).toBe(400);
    expect(old.body.code).toBe('OTP_INVALID');
    expect((await verifyOtp('222222')).status).toBe(200);
  });
});

describe('OTP_STATIC_CODE', () => {
  test('when set, every code is that value and no random code is drawn', async () => {
    const random = jest.spyOn(secretCode, 'generateNumericCode');
    await requestOtp();
    expect(random).not.toHaveBeenCalled();
    expect((await verifyOtp(STATIC_CODE)).status).toBe(200);
  });

  test('when empty, the code is random and the static value is refused', async () => {
    process.env.OTP_STATIC_CODE = '';
    jest.spyOn(secretCode, 'generateNumericCode').mockReturnValue('804317');

    await requestOtp();
    const wrong = await verifyOtp(STATIC_CODE);
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('OTP_INVALID');
    expect((await verifyOtp('804317')).status).toBe(200);
  });

  test('a value that is not 6 digits is ignored in favour of a random code', async () => {
    process.env.OTP_STATIC_CODE = '12ab';
    const random = jest.spyOn(secretCode, 'generateNumericCode').mockReturnValue('660022');
    await requestOtp();
    expect(random).toHaveBeenCalledTimes(1);
    expect((await verifyOtp('660022')).status).toBe(200);
  });
});

describe('POST /auth/customer/otp/verify', () => {
  test('first verification creates the account and says so', async () => {
    await requestOtp();
    const res = await verifyOtp(STATIC_CODE);

    expect(res.status).toBe(200);
    const { data } = res.body;
    expect(Object.keys(data).sort()).toEqual(['isNewAccount', 'role', 'token', 'user']);
    expect(data.isNewAccount).toBe(true);
    expect(data.role).toBe('CUSTOMER');
    // A new account has no name, email or avatar yet; absent fields are absent, not null.
    expect(data.user).toEqual({
      id: expect.any(String),
      firstName: '',
      lastName: '',
      phone: PHONE,
      role: 'customer',
    });

    const customer = await Customer.findById(data.user.id);
    expect(customer.phone).toBe(PHONE);
    expect(customer.isVerified).toBe(true);
    expect(customer.email).toBeUndefined();

    const payload = jwt.verify(data.token, process.env.JWT_SECRET);
    expect(payload).toMatchObject({ id: data.user.id, role: 'CUSTOMER' });
    expect(Object.keys(payload).sort()).toEqual(['exp', 'iat', 'id', 'role', 'v']);
    expect(payload.v).toBe(0);
  });

  test('an existing customer signs in to their own account', async () => {
    const asha = await createPhoneCustomer({ email: 'asha@example.com' });
    await requestOtp();
    const res = await verifyOtp(STATIC_CODE);

    expect(res.status).toBe(200);
    expect(res.body.data.isNewAccount).toBe(false);
    expect(res.body.data.user).toEqual({
      id: String(asha._id),
      firstName: 'Asha',
      lastName: 'Patel',
      email: 'asha@example.com',
      phone: PHONE,
      role: 'customer',
    });
    expect(await Customer.countDocuments()).toBe(1);
  });

  test('several phone-only customers can exist (no email uniqueness clash)', async () => {
    for (const phone of ['9876543210', '9876543211', '9876543212']) {
      await requestOtp(phone);
      expect((await verifyOtp(STATIC_CODE, phone)).body.data.isNewAccount).toBe(true);
    }
    expect(await Customer.countDocuments()).toBe(3);
  });

  test('/auth/me and /auth/logout work with the session token', async () => {
    await requestOtp();
    const { data } = (await verifyOtp(STATIC_CODE)).body;

    const me = await api.get('/auth/me', data.token);
    expect(me.status).toBe(200);
    expect(me.body.data).toMatchObject(data.user);

    const logout = await api.post('/auth/logout', {}, data.token);
    expect(logout.status).toBe(200);
    expect(logout.body.data).toBeNull();

    // Signing out ends the session on the server, not just on the phone: the same token is refused.
    const after = await api.get('/auth/me', data.token);
    expect(after.status).toBe(401);
    expect(after.body.code).toBe('UNAUTHORIZED');
  });

  test('a wrong code answers 400 OTP_INVALID and does not use the challenge up', async () => {
    await requestOtp();
    const wrong = await verifyOtp('000000');
    expect(wrong.status).toBe(400);
    expect(wrong.body.code).toBe('OTP_INVALID');
    expect((await verifyOtp(STATIC_CODE)).status).toBe(200);
  });

  test('the fifth wrong code answers 429 OTP_TOO_MANY_ATTEMPTS and the challenge is dead', async () => {
    await requestOtp();
    for (let i = 0; i < 4; i += 1) {
      expect((await verifyOtp('000000')).body.code).toBe('OTP_INVALID');
    }
    const fifth = await verifyOtp('000000');
    expect(fifth.status).toBe(429);
    expect(fifth.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');

    // Dead: even the right code is refused now.
    const right = await verifyOtp(STATIC_CODE);
    expect(right.status).toBe(429);
    expect(right.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');

    // A new code (after the resend wait) works.
    clock.advance(31000);
    expect((await requestOtp()).status).toBe(200);
    expect((await verifyOtp(STATIC_CODE)).status).toBe(200);
  });

  test('four wrong codes then the right one still signs in', async () => {
    await requestOtp();
    for (let i = 0; i < 4; i += 1) {
      await verifyOtp('000000');
    }
    expect((await verifyOtp(STATIC_CODE)).status).toBe(200);
  });

  test('parallel wrong guesses cannot get past the attempt limit', async () => {
    await requestOtp();
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) => verifyOtp(String(100000 + i)))
    );
    const invalid = results.filter((r) => r.body.code === 'OTP_INVALID').length;
    expect(invalid).toBeLessThanOrEqual(4);
    const challenge = await OtpChallenge.findOne({ phone: PHONE });
    expect(challenge.attempts).toBe(5);
    expect((await verifyOtp(STATIC_CODE)).body.code).toBe('OTP_TOO_MANY_ATTEMPTS');
  });

  test('a code past its 5 minutes answers 400 OTP_EXPIRED', async () => {
    await requestOtp();
    clock.advance(5 * 60 * 1000 + 1000);
    const res = await verifyOtp(STATIC_CODE);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_EXPIRED');
  });

  test('a code just inside its 5 minutes still works', async () => {
    await requestOtp();
    clock.advance(5 * 60 * 1000 - 2000);
    expect((await verifyOtp(STATIC_CODE)).status).toBe(200);
  });

  test('no live challenge for the phone answers 400 OTP_EXPIRED', async () => {
    const res = await verifyOtp(STATIC_CODE);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('OTP_EXPIRED');
  });

  test('a code signs in once: using it again answers OTP_EXPIRED', async () => {
    await requestOtp();
    expect((await verifyOtp(STATIC_CODE)).status).toBe(200);
    expect((await verifyOtp(STATIC_CODE)).body.code).toBe('OTP_EXPIRED');
  });

  test('a suspended customer is refused with 403 ACCOUNT_SUSPENDED, but only after a right code', async () => {
    await createPhoneCustomer({ status: 'BLOCKED' });
    await requestOtp();

    expect((await verifyOtp('000000')).body.code).toBe('OTP_INVALID');

    const res = await verifyOtp(STATIC_CODE);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
    expect(res.body.data).toBeNull();
  });

  test('a code that is not 6 digits answers VALIDATION_FAILED and costs no attempt', async () => {
    await requestOtp();
    const res = await verifyOtp('12345');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors[0].field).toBe('code');
    const challenge = await OtpChallenge.findOne({ phone: PHONE });
    expect(challenge.attempts).toBe(0);
  });
});
