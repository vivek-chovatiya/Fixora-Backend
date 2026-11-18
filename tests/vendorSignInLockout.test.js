// Vendor sign-in lockout (lead decision 17/11/2026, contract error table): 5 failures for a phone
// within 15 minutes → 429 SIGNIN_TOO_MANY_ATTEMPTS + Retry-After until 15 minutes after the 5th.
const mongoose = require('mongoose');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const clock = require('./helpers/clock');
const { createPhoneVendor } = require('./helpers/fixtures');
const SignInAttempt = require('../src/models/signinattempt');

const PHONE = '9000000001';
const CODE = '482913';
const MINUTE = 60 * 1000;

const signIn = (authCode, phone = PHONE) => api.post('/auth/vendor/signin', { phone, authCode });
const failTimes = async (n, phone = PHONE) => {
  const results = [];
  for (let i = 0; i < n; i += 1) {
    results.push(await signIn(String(700100 + i), phone));
  }
  return results;
};

const LOCKED_BODY = {
  success: false,
  message: 'Too many sign-in attempts. Please try again later.',
  code: 'SIGNIN_TOO_MANY_ATTEMPTS',
  errors: null,
  data: null,
};

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  clock.install();
  await createPhoneVendor({ phone: PHONE, authCode: CODE });
});
afterEach(() => clock.restore());

test('the 5th failure locks the phone: 429 SIGNIN_TOO_MANY_ATTEMPTS with Retry-After 900', async () => {
  const results = await failTimes(5);

  for (const res of results.slice(0, 4)) {
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_CODE_INVALID');
    expect(res.headers['retry-after']).toBeUndefined();
  }
  const fifth = results[4];
  expect(fifth.status).toBe(429);
  expect(fifth.body).toEqual(LOCKED_BODY);
  expect(fifth.headers['retry-after']).toBe('900');
});

test('5th vs 6th attempt: after 4 failures the right code signs in; after 5 it is refused', async () => {
  await failTimes(4);
  expect((await signIn(CODE)).status).toBe(200);

  await db.clear();
  await createPhoneVendor({ phone: PHONE, authCode: CODE });
  await failTimes(5);
  const sixth = await signIn(CODE);
  expect(sixth.status).toBe(429);
  expect(sixth.body).toEqual(LOCKED_BODY);
});

test('an unknown phone locks exactly the same way, so the lock reveals nothing', async () => {
  const known = await failTimes(6, PHONE);
  const unknown = await failTimes(6, '9111111111');

  expect(unknown.map((r) => r.status)).toEqual(known.map((r) => r.status));
  expect(unknown.map((r) => r.body)).toEqual(known.map((r) => r.body));
  expect(unknown.map((r) => r.headers['retry-after'])).toEqual(
    known.map((r) => r.headers['retry-after'])
  );
  expect(unknown[5].status).toBe(429);
});

test('while locked even the right code is refused, and Retry-After counts down', async () => {
  await failTimes(5);

  clock.advance(10 * MINUTE);
  const during = await signIn(CODE);
  expect(during.status).toBe(429);
  expect(during.body).toEqual(LOCKED_BODY);
  expect(during.headers['retry-after']).toBe('300');

  clock.advance(5 * MINUTE - 2000);
  const lastSeconds = await signIn(CODE);
  expect(lastSeconds.status).toBe(429);
  expect(Number(lastSeconds.headers['retry-after'])).toBeLessThanOrEqual(2);
});

test('the lock ends 15 minutes after the 5th failure', async () => {
  await failTimes(5);
  clock.advance(15 * MINUTE + 1000);
  expect((await signIn(CODE)).status).toBe(200);
});

test('after a lock ends the phone starts again with five attempts', async () => {
  await failTimes(5);
  clock.advance(15 * MINUTE + 1000);
  const again = await failTimes(5);
  expect(again.slice(0, 4).map((r) => r.status)).toEqual([401, 401, 401, 401]);
  expect(again[4].status).toBe(429);
});

test('a successful sign in clears the counter', async () => {
  await failTimes(4);
  expect((await signIn(CODE)).status).toBe(200);
  expect(await SignInAttempt.countDocuments({ phone: PHONE })).toBe(0);

  const after = await failTimes(5);
  expect(after.slice(0, 4).map((r) => r.status)).toEqual([401, 401, 401, 401]);
  expect(after[4].status).toBe(429);
});

test('failures more than 15 minutes apart do not add up', async () => {
  await failTimes(4);
  clock.advance(15 * MINUTE + 1000);
  const later = await failTimes(4);
  expect(later.map((r) => r.status)).toEqual([401, 401, 401, 401]);
  expect((await signIn(CODE)).status).toBe(200);
});

test('a formatted phone counts against the same normalised number', async () => {
  await failTimes(2, '(900) 000-0001');
  await failTimes(2, '900-000-0001');
  const fifth = await signIn('700199', '9000000001');
  expect(fifth.status).toBe(429);
});

test('locking one phone does not touch another', async () => {
  await createPhoneVendor({ phone: '9000000002', authCode: '573014' });
  await failTimes(5, PHONE);
  expect((await signIn('573014', '9000000002')).status).toBe(200);
});

test('parallel wrong guesses cannot get past the limit', async () => {
  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) => signIn(String(710000 + i)))
  );
  // Exactly five are counted and compared; the other seven are refused uncompared.
  expect(results.filter((r) => r.status === 401)).toHaveLength(4);
  expect(results.filter((r) => r.status === 429)).toHaveLength(8);
  expect((await SignInAttempt.findOne({ phone: PHONE })).failures).toBe(5);
  const refused = await signIn(CODE);
  expect(refused.status).toBe(429);
  expect(Number(refused.headers['retry-after'])).toBeGreaterThan(0);
});

test('a suspended vendor with the right code is neither counted nor locked', async () => {
  await createPhoneVendor({ phone: '9000000005', authCode: '573015', status: 'BLOCKED' });
  for (let i = 0; i < 6; i += 1) {
    const res = await signIn('573015', '9000000005');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('ACCOUNT_SUSPENDED');
  }
});

test('the lock survives in Mongo and never holds or logs the attempted codes', async () => {
  await failTimes(5);

  const stored = await SignInAttempt.findOne({ phone: PHONE }).lean();
  expect(stored.failures).toBe(5);
  expect(stored.lockedUntil).toBeInstanceOf(Date);
  expect(stored.expiresAt.getTime()).toBeGreaterThan(stored.lockedUntil.getTime());

  const indexes = await mongoose.connection.db.collection('signinattempts').indexes();
  expect(indexes.some((i) => i.key.expiresAt === 1 && i.expireAfterSeconds === 0)).toBe(true);

  const dump = JSON.stringify(await mongoose.connection.db.collection('signinattempts').find().toArray());
  const logText = logs.all();
  for (let i = 0; i < 5; i += 1) {
    expect(dump).not.toContain(String(700100 + i));
    expect(logText).not.toContain(String(700100 + i));
  }
  expect(logText).toContain('vendor sign in locked for ••••0001');
  expect(logText).not.toContain(PHONE);
});
