// Notifications (Phase 4B contract §8): deleting from one's own inbox, and the same ownership rule
// (account id AND role) on /notifications/read, both answering NOTIFICATION_NOT_FOUND. And the
// whole-inbox operations (Phase 5 contract §3): read-all and delete-all touch the caller's own
// inbox only.
const mongoose = require('mongoose');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const f = require('./helpers/fixtures');
const Notification = require('../src/models/notification');

let customer;
let customerToken;
let vendor;
let vendorToken;

const notify = (account, userRole, overrides = {}) =>
  Notification.create({
    userId: account._id,
    userRole,
    title: 'Request received',
    message: 'We have received your request.',
    type: 'SERVICE_REQUEST',
    ...overrides,
  });

const inbox = async (token) => (await api.post('/notifications/list', {}, token)).body.data.map((n) => n.id);

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  customer = await f.createCustomer();
  customerToken = f.tokenFor(customer, 'CUSTOMER');
  vendor = await f.createVendor();
  vendorToken = f.tokenFor(vendor, 'VENDOR');
});

describe('POST /notifications/delete', () => {
  test('own → 200 data null, gone from the list (soft delete); again → 404', async () => {
    const mine = await notify(customer, 'CUSTOMER');
    const kept = await notify(customer, 'CUSTOMER');
    expect(await inbox(customerToken)).toHaveLength(2);

    const res = await api.post('/notifications/delete', { id: String(mine._id) }, customerToken);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBe(null);
    expect(await inbox(customerToken)).toEqual([String(kept._id)]);

    const stored = await Notification.findById(mine._id);
    expect(stored.isDeleted).toBe(true);
    expect(stored.deletedAt).toBeInstanceOf(Date);

    const again = await api.post('/notifications/delete', { id: String(mine._id) }, customerToken);
    expect(again.status).toBe(404);
    expect(again.body.code).toBe('NOTIFICATION_NOT_FOUND');
  });

  test('another account’s → 404 and still there', async () => {
    const theirs = await notify(await f.createCustomer(), 'CUSTOMER');
    const res = await api.post('/notifications/delete', { id: String(theirs._id) }, customerToken);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOTIFICATION_NOT_FOUND');
    expect((await Notification.findById(theirs._id)).isDeleted).toBe(false);
  });

  test('the same account id under the other role → 404 and still there', async () => {
    // A customer whose id is the vendor's: same userId, other inbox.
    const twin = await f.createCustomer({ _id: vendor._id });
    const vendorNote = await notify(vendor, 'VENDOR');

    const res = await api.post(
      '/notifications/delete',
      { id: String(vendorNote._id) },
      f.tokenFor(twin, 'CUSTOMER')
    );
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('NOTIFICATION_NOT_FOUND');
    expect((await Notification.findById(vendorNote._id)).isDeleted).toBe(false);
    expect(await inbox(vendorToken)).toEqual([String(vendorNote._id)]);
  });

  test('an unknown id → 404; a malformed or missing id → 400; no token → 401', async () => {
    const unknown = await api.post(
      '/notifications/delete',
      { id: String(new mongoose.Types.ObjectId()) },
      customerToken
    );
    expect(unknown.status).toBe(404);
    expect(unknown.body.code).toBe('NOTIFICATION_NOT_FOUND');

    for (const body of [{ id: 'not-an-id' }, {}]) {
      const res = await api.post('/notifications/delete', body, customerToken);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors[0].field).toBe('id');
    }

    const anonymous = await api.post('/notifications/delete', { id: String(new mongoose.Types.ObjectId()) });
    expect(anonymous.status).toBe(401);
  });

  test('a vendor deletes from their own inbox', async () => {
    const mine = await notify(vendor, 'VENDOR');
    const res = await api.post('/notifications/delete', { id: String(mine._id) }, vendorToken);
    expect(res.status).toBe(200);
    expect(await inbox(vendorToken)).toEqual([]);
  });
});

describe('POST /notifications/read — the same ownership rule and code', () => {
  test('own → 200 marked read', async () => {
    const mine = await notify(customer, 'CUSTOMER');
    const res = await api.post('/notifications/read', { id: String(mine._id) }, customerToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ id: String(mine._id), isRead: true });
    expect(res.body.data.readAt).toEqual(expect.any(String));
  });

  test('another account’s, the other role’s, a deleted one, or an unknown id → 404 NOTIFICATION_NOT_FOUND', async () => {
    const twin = await f.createCustomer({ _id: vendor._id });
    const twinToken = f.tokenFor(twin, 'CUSTOMER');
    const theirs = await notify(await f.createCustomer(), 'CUSTOMER');
    const vendorNote = await notify(vendor, 'VENDOR');
    const deleted = await notify(customer, 'CUSTOMER', { isDeleted: true, deletedAt: new Date() });

    const attempts = [
      [customerToken, theirs._id],
      [twinToken, vendorNote._id],
      [customerToken, deleted._id],
      [customerToken, new mongoose.Types.ObjectId()],
    ];
    for (const [token, id] of attempts) {
      const res = await api.post('/notifications/read', { id: String(id) }, token);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('NOTIFICATION_NOT_FOUND');
    }
    expect((await Notification.findById(theirs._id)).isRead).toBe(false);
    expect((await Notification.findById(vendorNote._id)).isRead).toBe(false);
  });
});

// Everything a test may not touch: another customer's, the vendor whose id a customer twin shares,
// and the caller's own already-deleted one.
const othersAndDeleted = async () => {
  const twin = await f.createCustomer({ _id: vendor._id });
  return {
    twinToken: f.tokenFor(twin, 'CUSTOMER'),
    theirs: await notify(await f.createCustomer(), 'CUSTOMER'),
    vendorNote: await notify(vendor, 'VENDOR'),
    deleted: await notify(customer, 'CUSTOMER', { isDeleted: true, deletedAt: null }),
  };
};

const untouched = async ({ theirs, vendorNote }) => {
  for (const note of [theirs, vendorNote]) {
    const stored = await Notification.findById(note._id);
    expect(stored).toMatchObject({ isRead: false, readAt: null, isDeleted: false, deletedAt: null });
  }
};

describe('POST /notifications/read-all', () => {
  test('marks the caller’s own unread read and answers how many; nobody else’s changes', async () => {
    const unread = [await notify(customer, 'CUSTOMER'), await notify(customer, 'CUSTOMER')];
    const alreadyRead = await notify(customer, 'CUSTOMER', { isRead: true, readAt: new Date('2026-11-01') });
    const others = await othersAndDeleted();

    const res = await api.post('/notifications/read-all', {}, customerToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'All notifications marked as read.',
      data: { updated: 2 },
      meta: {},
      errors: null,
    });

    for (const note of unread) {
      const stored = await Notification.findById(note._id);
      expect(stored.isRead).toBe(true);
      expect(stored.readAt).toBeInstanceOf(Date);
    }
    // Already read keeps when it was read; the deleted one stays out of it.
    expect((await Notification.findById(alreadyRead._id)).readAt.toISOString()).toBe('2026-11-01T00:00:00.000Z');
    expect((await Notification.findById(others.deleted._id)).isRead).toBe(false);
    await untouched(others);

    const listed = (await api.post('/notifications/list', {}, customerToken)).body.data;
    expect(listed.map((n) => n.isRead)).toEqual([true, true, true]);

    const again = await api.post('/notifications/read-all', {}, customerToken);
    expect(again.body.data).toEqual({ updated: 0 });
  });

  test('the same id under the other role is another inbox', async () => {
    const others = await othersAndDeleted();
    const res = await api.post('/notifications/read-all', {}, others.twinToken);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ updated: 0 });
    await untouched(others);
  });

  test('a vendor marks their own; a body naming someone else changes nothing; no token → 401', async () => {
    const mine = await notify(vendor, 'VENDOR');
    const theirs = await notify(customer, 'CUSTOMER');

    const res = await api.post(
      '/notifications/read-all',
      { userId: String(customer._id), userRole: 'CUSTOMER' },
      vendorToken
    );
    expect(res.body.data).toEqual({ updated: 1 });
    expect((await Notification.findById(mine._id)).isRead).toBe(true);
    expect((await Notification.findById(theirs._id)).isRead).toBe(false);

    const anonymous = await api.post('/notifications/read-all', {});
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe('UNAUTHORIZED');
  });
});

describe('POST /notifications/delete-all', () => {
  test('soft-deletes the caller’s whole inbox and answers how many; nobody else’s changes', async () => {
    const mine = [
      await notify(customer, 'CUSTOMER'),
      await notify(customer, 'CUSTOMER', { isRead: true, readAt: new Date() }),
    ];
    const others = await othersAndDeleted();

    const res = await api.post('/notifications/delete-all', {}, customerToken);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      success: true,
      message: 'All notifications deleted.',
      data: { deleted: 2 },
      meta: {},
      errors: null,
    });
    expect(await inbox(customerToken)).toEqual([]);

    // Soft: the rows stay, marked deleted, exactly as /notifications/delete leaves them.
    for (const note of mine) {
      const stored = await Notification.findById(note._id);
      expect(stored.isDeleted).toBe(true);
      expect(stored.deletedAt).toBeInstanceOf(Date);
    }
    // The one deleted before is not counted again.
    expect((await Notification.findById(others.deleted._id)).deletedAt).toBeNull();
    await untouched(others);
    expect(await inbox(vendorToken)).toEqual([String(others.vendorNote._id)]);

    const again = await api.post('/notifications/delete-all', {}, customerToken);
    expect(again.body.data).toEqual({ deleted: 0 });
  });

  test('the same id under the other role is another inbox; no token → 401', async () => {
    const others = await othersAndDeleted();
    const res = await api.post('/notifications/delete-all', {}, others.twinToken);
    expect(res.body.data).toEqual({ deleted: 0 });
    await untouched(others);

    const anonymous = await api.post('/notifications/delete-all', {});
    expect(anonymous.status).toBe(401);
  });

  test('a vendor clears their own inbox only', async () => {
    const mine = await notify(vendor, 'VENDOR');
    const theirs = await notify(customer, 'CUSTOMER');
    const res = await api.post('/notifications/delete-all', {}, vendorToken);
    expect(res.body.data).toEqual({ deleted: 1 });
    expect((await Notification.findById(mine._id)).isDeleted).toBe(true);
    expect((await Notification.findById(theirs._id)).isDeleted).toBe(false);
    expect(await inbox(customerToken)).toEqual([String(theirs._id)]);
  });
});
