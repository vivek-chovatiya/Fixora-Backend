// Review fixes, part 2 (requests contract §8, lead 17/11/2026): rate limits, field limits, regex
// search, the start-up phone migration, and the seed / server refusing to run unsafely.
const path = require('path');
const { spawnSync } = require('child_process');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const clock = require('./helpers/clock');
const f = require('./helpers/fixtures');
const Customer = require('../src/models/customer');
const runStartupMigrations = require('../src/config/migrations');

const OTP = '123456';
const ROOT = path.join(__dirname, '..');
const THROWAWAY_DB = 'mongodb://127.0.0.1:27017/fixora_test_throwaway';

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  clock.install();
  process.env.OTP_STATIC_CODE = OTP;
});
afterEach(() => {
  clock.restore();
  process.env.OTP_STATIC_CODE = '';
});

// First in the file: the per-IP counter is in memory and counts every /auth call this file makes.
describe('per-IP limit on /auth/*', () => {
  test('past the limit: 429 RATE_LIMITED with Retry-After; other routes are not limited', async () => {
    process.env.AUTH_RATE_LIMIT_MAX = '3';
    try {
      for (let i = 0; i < 3; i += 1) {
        expect((await api.post('/auth/customer/otp/request', { phone: `98765000${10 + i}` })).status).not.toBe(429);
      }
      const limited = await api.post('/auth/vendor/signin/otp/request', { phone: '9000000001' });
      expect(limited.status).toBe(429);
      expect(limited.body).toMatchObject({ success: false, code: 'RATE_LIMITED', data: null });
      const retryAfter = Number(limited.headers['retry-after']);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(15 * 60);

      expect((await api.get('/health')).status).toBe(200);
      expect((await api.post('/vendors/list', {})).status).toBe(200);
    } finally {
      process.env.AUTH_RATE_LIMIT_MAX = '1000000';
    }
  });
});

describe('per-phone caps on one-time codes', () => {
  const request = (phone = '9876543210') => api.post('/auth/customer/otp/request', { phone });
  const verify = (code, phone = '9876543210') => api.post('/auth/customer/otp/verify', { phone, code });

  test('10 codes per phone per 24 hours, across purposes; the 11th is 429 RATE_LIMITED', async () => {
    const category = await f.createCategory();
    for (let i = 0; i < 9; i += 1) {
      expect((await request()).status).toBe(200);
      clock.advance(31000);
    }
    // The tenth goes out through vendor registration: the cap is per phone, not per purpose.
    const tenth = await api.post('/auth/vendor/register', {
      businessName: 'Patel Repairs',
      ownerFirstName: 'Asha',
      ownerLastName: 'Patel',
      phone: '9876543210',
      serviceCategoryIds: [String(category._id)],
    });
    expect(tenth.status).toBe(201);
    clock.advance(31000);

    const eleventh = await request();
    expect(eleventh.status).toBe(429);
    expect(eleventh.body.code).toBe('RATE_LIMITED');
    const retryAfter = Number(eleventh.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(24 * 60 * 60 - 10 * 31 - 5);
    expect(retryAfter).toBeLessThanOrEqual(24 * 60 * 60);

    // A blocked registration leaves nothing behind.
    const blocked = await api.post('/auth/vendor/register', {
      businessName: 'Patel Repairs 2',
      ownerFirstName: 'Asha',
      ownerLastName: 'Patel',
      phone: '9876543210',
      serviceCategoryIds: [String(category._id)],
    });
    expect(blocked.status).toBe(429);
    expect(await require('../src/models/vendorregistration').countDocuments()).toBe(1);

    expect((await request('9876543299')).status).toBe(200);
    clock.advance(24 * 60 * 60 * 1000);
    expect((await request()).status).toBe(200);
  });

  test('wrong guesses are capped at 10 per phone per hour across resends', async () => {
    await request();
    for (let i = 0; i < 5; i += 1) await verify(String(700000 + i));
    clock.advance(31000);
    await request();
    for (let i = 0; i < 4; i += 1) {
      expect((await verify(String(710000 + i))).body.code).toBe('OTP_INVALID');
    }
    // The tenth wrong guess is also this challenge's fifth.
    expect((await verify('719999')).body.code).toBe('OTP_TOO_MANY_ATTEMPTS');

    // A fresh code does not reset the phone's budget: even the right code is refused now.
    clock.advance(31000);
    await request();
    const capped = await verify(OTP);
    expect(capped.status).toBe(429);
    expect(capped.body.code).toBe('OTP_TOO_MANY_ATTEMPTS');
    expect(Number(capped.headers['retry-after'])).toBeGreaterThan(0);

    clock.advance(60 * 60 * 1000);
    await request();
    expect((await verify(OTP)).status).toBe(200);
  });

  test('right codes do not use up the guess budget', async () => {
    for (let i = 0; i < 12; i += 1) {
      await request();
      expect((await verify(OTP)).status).toBe(200);
      clock.advance(31000);
      if (i === 8) clock.advance(24 * 60 * 60 * 1000); // stay under the daily send cap
    }
  });
});

describe('field limits', () => {
  test('free text and arrays are bounded, and the app’s own limits still fit', async () => {
    const category = await f.createCategory();
    const customer = await f.createCustomer();
    const token = f.tokenFor(customer, 'CUSTOMER');
    const base = { categoryId: String(category._id), serviceAddress: '12 MG Road' };

    const cases = [
      [{ ...base, description: 'x'.repeat(1001) }, 'description'],
      [{ ...base, notes: 'x'.repeat(501) }, 'notes'],
      [{ ...base, images: Array.from({ length: 11 }, (_, i) => `https://cdn.example.com/${i}.jpg`) }, 'images'],
      [{ ...base, serviceAddress: 'x'.repeat(501) }, 'serviceAddress'],
    ];
    for (const [body, field] of cases) {
      const res = await api.post('/requests', body, token);
      expect({ field, status: res.status }).toEqual({ field, status: 400 });
      expect(res.body.errors[0].field).toMatch(new RegExp(`^${field}`));
    }
    expect((await api.post('/requests', { ...base, description: 'x'.repeat(1000), notes: 'y'.repeat(500) }, token)).status).toBe(201);

    // The app allows a 240-character typed address.
    expect((await api.post('/addresses', { addressLine1: 'a'.repeat(240) }, token)).status).toBe(201);
    expect((await api.post('/addresses', { addressLine1: 'a'.repeat(241) }, token)).status).toBe(400);
    expect((await api.post('/addresses', { addressLine1: 'ok', city: 'c'.repeat(201) }, token)).status).toBe(400);

    const vendorToken = f.tokenFor(await f.createVendor(), 'VENDOR');
    expect((await api.post('/team', { name: 'n'.repeat(101) }, vendorToken)).status).toBe(400);
    expect((await api.post('/customers/update', { id: String(customer._id), firstName: 'n'.repeat(101) }, token)).status).toBe(400);
  });
});

describe('admin search is literal', () => {
  test('a dot matches a dot, and a hostile pattern is just text', async () => {
    const { token } = await f.createAdmin();
    await f.createVendor([], { businessName: 'A.B Electric' });
    await f.createVendor([], { businessName: 'AxB Electric' });

    const dot = await api.post('/vendors/list', { search: 'A.B' }, token);
    expect(dot.body.data.map((v) => v.businessName)).toEqual(['A.B Electric']);

    for (const search of ['(a+)+$', '[', '\\']) {
      expect((await api.post('/vendors/list', { search }, token)).status).toBe(200);
      expect((await api.post('/customers/list', { search }, token)).status).toBe(200);
    }
  });
});

describe('start-up phone migration', () => {
  test('normalises old phones, skips (and logs, masked) a clash, backfills phone-verified', async () => {
    const base = { firstName: 'Old', lastName: '', status: 'ACTIVE', isDeleted: false, tokenVersion: 0 };
    await Customer.collection.insertMany([
      { ...base, phone: '+91 98765-43210', email: 'old@example.com', password: 'x', phoneVerifiedAt: null },
      { ...base, phone: '919876500000', phoneVerifiedAt: new Date() },
      { ...base, phone: '+91 98765 00000', email: 'clash@example.com', password: 'x', phoneVerifiedAt: null },
      { ...base, phone: '9123456780' },
    ]);

    await expect(runStartupMigrations()).resolves.toBeUndefined();

    const phones = (await Customer.collection.find({}).toArray()).map((c) => c.phone).sort();
    expect(phones).toEqual(['+91 98765 00000', '9123456780', '919876500000', '919876543210'].sort());

    const text = logs.all();
    expect(text).toContain('clashes with another account on ••••0000');
    expect(text).not.toContain('919876500000');

    // A phone-created account (no password) is marked verified; email sign-ups are not.
    expect((await Customer.collection.findOne({ phone: '9123456780' })).phoneVerifiedAt).toBeInstanceOf(Date);
    expect((await Customer.collection.findOne({ phone: '919876543210' })).phoneVerifiedAt).toBeNull();

    // Idempotent.
    await runStartupMigrations();
    expect((await Customer.collection.find({}).toArray()).map((c) => c.phone).sort()).toEqual(phones);
  });
});

describe('refusing to run unsafely', () => {
  test('the seed refuses when NODE_ENV is production', () => {
    const result = spawnSync(process.execPath, ['src/utils/seed.js'], {
      cwd: ROOT,
      env: { ...process.env, NODE_ENV: 'production', MONGO_URI: THROWAWAY_DB },
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('Refusing to seed');
  });

  test('the server refuses to start without JWT_SECRET', () => {
    const result = spawnSync(process.execPath, ['index.js'], {
      cwd: ROOT,
      env: { ...process.env, JWT_SECRET: '', PORT: '5057', MONGO_URI: THROWAWAY_DB, NODE_ENV: 'development' },
      encoding: 'utf8',
      timeout: 20000,
    });
    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).toContain('JWT_SECRET is not set');
  });
});
