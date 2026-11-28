// Device push tokens (Phase 5 contract §6.1): POST /devices/register and /devices/unregister —
// storing, moving between accounts, the 10-per-account limit, unregistering one's own only, the
// body rules and who may call them. Push sending is off here (tests/setup/env.js), which is the
// contract's point: tokens are stored all the same.
//
// ⚠️ No token may ever reach a log: every test ends by searching the logs for the tokens it used.
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const clock = require('./helpers/clock');
const f = require('./helpers/fixtures');
const DeviceToken = require('../src/models/devicetoken');

// Distinctive, so a search of the logs cannot match by accident. Not real FCM tokens.
const tokenNo = (n) => `fcm-test-token-${String(n).padStart(3, '0')}:APA91bF${'x'.repeat(40)}`;
const TOKEN = tokenNo(1);

let customer;
let customerToken;
let vendor;
let vendorToken;
let usedTokens;

const register = (body, token = customerToken) => {
  if (body && typeof body.token === 'string' && body.token.trim()) usedTokens.push(body.token.trim());
  return api.post('/devices/register', body, token);
};
const unregister = (body, token = customerToken) => api.post('/devices/unregister', body, token);

const storedFor = (account, role) =>
  DeviceToken.find({ accountId: account._id, role }).sort({ lastSeenAt: 1 }).lean();
const tokensOf = async (account, role) => (await storedFor(account, role)).map((d) => d.token);

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  clock.install();
  usedTokens = [];
  customer = await f.createCustomer();
  customerToken = f.tokenFor(customer, 'CUSTOMER');
  vendor = await f.createVendor();
  vendorToken = f.tokenFor(vendor, 'VENDOR');
});
afterEach(() => {
  clock.restore();
  const text = logs.all();
  for (const token of usedTokens) {
    expect(text).not.toContain(token);
  }
});

describe('POST /devices/register', () => {
  test('stores the token for the caller → 200 { registered: true }', async () => {
    const res = await register({ token: TOKEN, platform: 'android' });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Device registered for push notifications.',
      data: { registered: true },
      meta: {},
      errors: null,
    });

    const stored = await storedFor(customer, 'CUSTOMER');
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ token: TOKEN, platform: 'android', role: 'CUSTOMER' });
    expect(String(stored[0].accountId)).toBe(String(customer._id));
    expect(stored[0].lastSeenAt).toBeInstanceOf(Date);
    // The answer never echoes the token.
    expect(res.text).not.toContain(TOKEN);
  });

  test('a vendor registers too; an ios token is kept as ios', async () => {
    const res = await register({ token: TOKEN, platform: 'ios' }, vendorToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ registered: true });
    expect(await storedFor(vendor, 'VENDOR')).toMatchObject([{ token: TOKEN, platform: 'ios' }]);
  });

  test('re-registering refreshes lastSeenAt (and the platform) without a second row', async () => {
    await register({ token: TOKEN, platform: 'android' });
    const first = (await storedFor(customer, 'CUSTOMER'))[0].lastSeenAt;

    clock.advance(60 * 60 * 1000);
    const res = await register({ token: TOKEN, platform: 'ios' });
    expect(res.status).toBe(200);

    const stored = await DeviceToken.find({ token: TOKEN }).lean();
    expect(stored).toHaveLength(1);
    expect(stored[0].platform).toBe('ios');
    // The hour the clock moved, plus the few real milliseconds the test took.
    const moved = stored[0].lastSeenAt.getTime() - first.getTime();
    expect(moved).toBeGreaterThanOrEqual(60 * 60 * 1000);
    expect(moved).toBeLessThan(60 * 60 * 1000 + 10 * 1000);
  });

  test('registering it from another account moves it there (one row, the new owner)', async () => {
    await register({ token: TOKEN, platform: 'android' });
    const res = await register({ token: TOKEN, platform: 'android' }, vendorToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ registered: true });

    expect(await DeviceToken.countDocuments({ token: TOKEN })).toBe(1);
    expect(await tokensOf(customer, 'CUSTOMER')).toEqual([]);
    expect(await tokensOf(vendor, 'VENDOR')).toEqual([TOKEN]);
  });

  test('the same account id under the other role is another account: the token moves', async () => {
    const twin = await f.createCustomer({ _id: vendor._id });
    await register({ token: TOKEN, platform: 'android' }, vendorToken);
    await register({ token: TOKEN, platform: 'android' }, f.tokenFor(twin, 'CUSTOMER'));

    expect(await tokensOf(vendor, 'VENDOR')).toEqual([]);
    expect(await tokensOf(twin, 'CUSTOMER')).toEqual([TOKEN]);
  });

  test('at most 10 per account: the 11th drops the least recently seen', async () => {
    for (let n = 1; n <= 10; n += 1) {
      clock.advance(1000);
      expect((await register({ token: tokenNo(n), platform: 'android' })).status).toBe(200);
    }
    expect(await tokensOf(customer, 'CUSTOMER')).toHaveLength(10);

    clock.advance(1000);
    expect((await register({ token: tokenNo(11), platform: 'android' })).status).toBe(200);

    const kept = await tokensOf(customer, 'CUSTOMER');
    expect(kept).toHaveLength(10);
    expect(kept).not.toContain(tokenNo(1));
    expect(kept[kept.length - 1]).toBe(tokenNo(11));
    expect(await DeviceToken.countDocuments({ token: tokenNo(1) })).toBe(0);
  });

  test('re-registering an old token counts as seen: the next oldest is the one dropped', async () => {
    for (let n = 1; n <= 10; n += 1) {
      clock.advance(1000);
      await register({ token: tokenNo(n), platform: 'android' });
    }
    clock.advance(1000);
    await register({ token: tokenNo(1), platform: 'android' });
    clock.advance(1000);
    await register({ token: tokenNo(11), platform: 'android' });

    const kept = await tokensOf(customer, 'CUSTOMER');
    expect(kept).toHaveLength(10);
    expect(kept).toContain(tokenNo(1));
    expect(kept).not.toContain(tokenNo(2));
  });

  test('the token being registered is kept even when every other token looks newer', async () => {
    for (let n = 1; n <= 10; n += 1) {
      clock.advance(1000);
      await register({ token: tokenNo(n), platform: 'android' });
    }
    // The phone's clock is irrelevant, but the server's can step back (NTP); the new token stays.
    clock.advance(-60 * 1000);
    await register({ token: tokenNo(11), platform: 'android' });

    const kept = await tokensOf(customer, 'CUSTOMER');
    expect(kept).toHaveLength(10);
    expect(kept).toContain(tokenNo(11));
  });

  test("the limit counts the caller's own tokens only", async () => {
    for (let n = 1; n <= 10; n += 1) {
      clock.advance(1000);
      await register({ token: tokenNo(100 + n), platform: 'android' }, vendorToken);
    }
    for (let n = 1; n <= 10; n += 1) {
      clock.advance(1000);
      await register({ token: tokenNo(n), platform: 'android' });
    }
    expect(await tokensOf(vendor, 'VENDOR')).toHaveLength(10);
    expect(await tokensOf(customer, 'CUSTOMER')).toHaveLength(10);
  });

  test('nothing in the body can name another owner (unknown keys are stripped)', async () => {
    const res = await register({
      token: TOKEN,
      platform: 'android',
      accountId: String(vendor._id),
      role: 'VENDOR',
    });
    expect(res.status).toBe(200);
    expect(await tokensOf(customer, 'CUSTOMER')).toEqual([TOKEN]);
    expect(await tokensOf(vendor, 'VENDOR')).toEqual([]);
  });

  test('a token with spaces around it is stored trimmed; 4096 characters is accepted', async () => {
    await register({ token: `  ${TOKEN}  `, platform: 'android' });
    expect(await tokensOf(customer, 'CUSTOMER')).toEqual([TOKEN]);

    const longest = 'a'.repeat(4096);
    expect((await register({ token: longest, platform: 'android' })).status).toBe(200);
  });

  test.each([
    ['no token', { platform: 'android' }, 'token'],
    ['an empty token', { token: '', platform: 'android' }, 'token'],
    ['a blank token', { token: '   ', platform: 'android' }, 'token'],
    ['a token over 4096 characters', { token: 'a'.repeat(4097), platform: 'android' }, 'token'],
    ['a token that is not a string', { token: 12345, platform: 'android' }, 'token'],
    ['no platform', { token: TOKEN }, 'platform'],
    ['an unknown platform', { token: TOKEN, platform: 'windows' }, 'platform'],
    ['a platform in capitals', { token: TOKEN, platform: 'Android' }, 'platform'],
  ])('%s → 400 VALIDATION_FAILED naming the field, nothing stored', async (label, body, field) => {
    const res = await register(body);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors.map((e) => e.field)).toEqual([field]);
    expect(await DeviceToken.countDocuments()).toBe(0);
    // The rejected value is never quoted back.
    if (typeof body.token === 'string' && body.token.trim()) {
      expect(res.text).not.toContain(body.token.slice(0, 40));
    }
  });

  test('no token → 401; an administrator → 403 FORBIDDEN; nothing stored', async () => {
    const anonymous = await register({ token: TOKEN, platform: 'android' }, null);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe('UNAUTHORIZED');

    const { token: adminToken } = await f.createAdmin();
    const admin = await register({ token: TOKEN, platform: 'android' }, adminToken);
    expect(admin.status).toBe(403);
    expect(admin.body.code).toBe('FORBIDDEN');

    expect(await DeviceToken.countDocuments()).toBe(0);
  });
});

describe('POST /devices/unregister', () => {
  test('own token → 200 { removed: true } and gone; again → removed: false', async () => {
    await register({ token: TOKEN, platform: 'android' });

    const res = await unregister({ token: TOKEN });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'Device unregistered from push notifications.',
      data: { removed: true },
      meta: {},
      errors: null,
    });
    expect(await DeviceToken.countDocuments()).toBe(0);

    const again = await unregister({ token: TOKEN });
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual({ removed: false });
  });

  test("someone else's token → 200 removed: false, and it stays theirs", async () => {
    await register({ token: TOKEN, platform: 'android' }, vendorToken);

    const res = await unregister({ token: TOKEN });
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ removed: false });
    expect(await tokensOf(vendor, 'VENDOR')).toEqual([TOKEN]);
  });

  test('the other role’s account with the same id cannot remove it', async () => {
    const twin = await f.createCustomer({ _id: vendor._id });
    await register({ token: TOKEN, platform: 'android' }, vendorToken);

    const res = await unregister({ token: TOKEN }, f.tokenFor(twin, 'CUSTOMER'));
    expect(res.body.data).toEqual({ removed: false });
    expect(await tokensOf(vendor, 'VENDOR')).toEqual([TOKEN]);
  });

  test('a token nobody registered answers exactly like someone else’s', async () => {
    await register({ token: tokenNo(2), platform: 'android' }, vendorToken);
    const unknown = await unregister({ token: tokenNo(9) });
    const theirs = await unregister({ token: tokenNo(2) });
    expect(unknown.status).toBe(theirs.status);
    expect(unknown.body).toEqual(theirs.body);
  });

  test('a moved token can no longer be removed by its old owner', async () => {
    await register({ token: TOKEN, platform: 'android' });
    await register({ token: TOKEN, platform: 'android' }, vendorToken);

    expect((await unregister({ token: TOKEN })).body.data).toEqual({ removed: false });
    expect((await unregister({ token: TOKEN }, vendorToken)).body.data).toEqual({ removed: true });
  });

  test('no or empty token → 400 VALIDATION_FAILED; no auth → 401; administrator → 403', async () => {
    for (const body of [{}, { token: '' }, { token: 'a'.repeat(4097) }]) {
      const res = await unregister(body);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors[0].field).toBe('token');
    }
    expect((await unregister({ token: TOKEN }, null)).status).toBe(401);
    const { token: adminToken } = await f.createAdmin();
    expect((await unregister({ token: TOKEN }, adminToken)).body.code).toBe('FORBIDDEN');
  });
});
