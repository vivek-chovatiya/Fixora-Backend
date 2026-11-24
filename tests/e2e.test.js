/**
 * End-to-end API tests for every Phase 1 workflow.
 *
 * Boots the real Express app against an isolated database (fixora_e2e), seeds it
 * through the service layer, then drives everything over HTTP exactly like the app.
 *
 *   npm test
 */
process.env.NODE_ENV = 'test';
process.env.MONGO_URI = process.env.E2E_MONGO_URI || 'mongodb://localhost:27017/fixora_e2e';
process.env.RATE_LIMIT_AUTH_MAX = '10000';
process.env.RATE_LIMIT_API_MAX = '100000';
process.env.BCRYPT_SALT_ROUNDS = '4';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const mongoose = require('mongoose');

const { run: seed, DEMO_PASSWORD } = require('../src/utils/seed');
const app = require('../index');

let server;
let base;

const api = async (method, path, { token, body, form } = {}) => {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (form) {
    payload = form;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(`${base}${path}`, { method, headers, body: payload });
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json };
};
const post = (path, body, token) => api('POST', path, { body, token });
const get = (path, token) => api('GET', path, { token });

const login = async (identifier, role) => {
  const res = await post('/auth/login', { identifier, password: DEMO_PASSWORD, role });
  assert.equal(res.status, 200, `login ${identifier}: ${JSON.stringify(res.body)}`);
  return res.body.data;
};

const ctx = {};

before(async () => {
  await seed();
  await mongoose.connect(process.env.MONGO_URI);
  await new Promise((resolve) => {
    server = app.listen(0, resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/api/v1`;

  ctx.priya = await login('customer@fixora.com', 'CUSTOMER');
  ctx.rahul = await login('rahul@fixora.com', 'CUSTOMER');
  ctx.sparkfix = await login('vendor@fixora.com', 'VENDOR');
  ctx.brightvolt = await login('brightvolt@fixora.com', 'VENDOR');
  ctx.aquaflow = await login('plumber@fixora.com', 'VENDOR');
  ctx.admin = await login('admin@fixora.com', 'ADMIN');

  const cats = await get('/categories');
  ctx.categories = Object.fromEntries(cats.body.data.map((c) => [c.name, c]));
  const subs = await post('/subcategories/list', { categoryId: ctx.categories.Electrician.id });
  ctx.electricSubs = subs.body.data;
  const addresses = await get('/addresses', ctx.priya.token);
  ctx.priyaAddress = addresses.body.data.find((a) => a.isDefault);
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  await mongoose.disconnect();
});

const createElectricRequest = (token, addressId, extra = {}) =>
  post(
    '/requests',
    {
      categoryId: ctx.categories.Electrician.id,
      subCategoryId: ctx.electricSubs[0].id,
      addressId,
      description: 'Bedroom fan is wobbling and making a clicking sound.',
      priority: 'MEDIUM',
      ...extra,
    },
    token
  );

const newList = async (token) =>
  (await post('/requests/list', { view: 'NEW', limit: 100 }, token)).body.data.map((r) => r.id);

// ---------------------------------------------------------------------------
describe('health & response envelope', () => {
  test('health returns standard envelope', async () => {
    const res = await get('/health');
    assert.equal(res.status, 200);
    assert.deepEqual(Object.keys(res.body).sort(), ['data', 'errors', 'message', 'meta', 'success']);
  });

  test('meta exposes backend-owned priorities and payment methods', async () => {
    const res = await get('/meta');
    assert.deepEqual(res.body.data.priorities.map((p) => p.value), ['LOW', 'MEDIUM', 'HIGH', 'EMERGENCY']);
    assert.ok(res.body.data.paymentMethods.some((p) => p.value === 'UPI'));
  });

  test('unknown endpoint returns 404 envelope with code', async () => {
    const res = await get('/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body.success, false);
    assert.equal(res.body.code, 'RESOURCE_NOT_FOUND');
  });
});

describe('authentication', () => {
  test('login with phone number works', async () => {
    const res = await post('/auth/login', { identifier: '+919876543210', password: DEMO_PASSWORD, role: 'CUSTOMER' });
    assert.equal(res.status, 200);
    assert.equal(res.body.data.user.email, 'customer@fixora.com');
    assert.equal(res.body.data.role, 'CUSTOMER');
  });

  test('phone login accepts any common format of the same number', async () => {
    for (const identifier of ['9876543210', '09876543210', '919876543210', '+91 98765 43210', '98765-43210']) {
      const res = await post('/auth/login', { identifier, password: DEMO_PASSWORD, role: 'CUSTOMER' });
      assert.equal(res.status, 200, identifier);
      assert.equal(res.body.data.user.email, 'customer@fixora.com', identifier);
    }
  });

  test('signup stores the canonical phone and rejects the same number in another format', async () => {
    const payload = { firstName: 'Meera', email: 'meera@example.com', phone: '098111 22299', password: 'Secret123!' };
    const res = await post('/auth/register/customer', payload);
    assert.equal(res.status, 201);
    assert.equal(res.body.data.user.phone, '+919811122299');
    const dup = await post('/auth/register/customer', { ...payload, email: 'meera2@example.com', phone: '+91 98111-22299' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.errors[0].field, 'phone');
  });

  test('wrong password returns INVALID_CREDENTIALS', async () => {
    const res = await post('/auth/login', { identifier: 'customer@fixora.com', password: 'wrong-pass', role: 'CUSTOMER' });
    assert.equal(res.status, 401);
    assert.equal(res.body.code, 'INVALID_CREDENTIALS');
  });

  test('customer credentials do not log in as vendor', async () => {
    const res = await post('/auth/login', { identifier: 'customer@fixora.com', password: DEMO_PASSWORD, role: 'VENDOR' });
    assert.equal(res.status, 401);
  });

  test('signup validates fields and returns field errors', async () => {
    const res = await post('/auth/register/customer', { firstName: '', email: 'bad', phone: '12', password: 'x' });
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'VALIDATION_FAILED');
    const fields = res.body.errors.map((e) => e.field);
    ['firstName', 'email', 'phone', 'password'].forEach((f) => assert.ok(fields.includes(f), f));
  });

  test('signup → token → /auth/me, duplicate email rejected', async () => {
    const payload = { firstName: 'Kiran', lastName: 'Shah', email: 'kiran@example.com', phone: '+919811122233', password: 'Secret123!' };
    const res = await post('/auth/register/customer', payload);
    assert.equal(res.status, 201);
    assert.ok(res.body.data.token);
    const me = await get('/auth/me', res.body.data.token);
    assert.equal(me.body.data.fullName, 'Kiran Shah');
    const dup = await post('/auth/register/customer', { ...payload, phone: '+919811122234' });
    assert.equal(dup.status, 409);
    assert.equal(dup.body.errors[0].field, 'email');
  });

  test('forgot + reset password', async () => {
    const forgot = await post('/auth/forgot-password', { identifier: 'kiran@example.com', role: 'CUSTOMER' });
    assert.equal(forgot.status, 200);
    const code = forgot.body.data.devResetCode;
    assert.match(code, /^\d{6}$/);
    const bad = await post('/auth/reset-password', { identifier: 'kiran@example.com', role: 'CUSTOMER', code: '000000', newPassword: 'NewSecret123' });
    assert.equal(bad.status, 400);
    assert.equal(bad.body.code, 'INVALID_RESET_CODE');
    const ok = await post('/auth/reset-password', { identifier: 'kiran@example.com', role: 'CUSTOMER', code, newPassword: 'NewSecret123' });
    assert.equal(ok.status, 200);
    const relog = await post('/auth/login', { identifier: 'kiran@example.com', password: 'NewSecret123', role: 'CUSTOMER' });
    assert.equal(relog.status, 200);
    const unknown = await post('/auth/forgot-password', { identifier: 'nobody@example.com', role: 'CUSTOMER' });
    assert.equal(unknown.status, 200);
    assert.equal(unknown.body.data.devResetCode, undefined);
  });

  test('missing / invalid token → 401', async () => {
    assert.equal((await get('/auth/me')).status, 401);
    const bad = await get('/auth/me', 'garbage');
    assert.equal(bad.status, 401);
    assert.equal(bad.body.code, 'AUTH_REQUIRED');
  });
});

describe('catalog is backend driven', () => {
  test('public categories exclude hidden ones', async () => {
    const res = await get('/categories');
    const names = res.body.data.map((c) => c.name);
    assert.ok(names.includes('Electrician'));
    assert.ok(!names.includes('Home Automation'));
    assert.ok(res.body.data.every((c) => c.icon));
  });

  test('admin list includes hidden categories', async () => {
    const res = await post('/categories/admin-list', {}, ctx.admin.token);
    assert.ok(res.body.data.some((c) => c.name === 'Home Automation'));
  });

  test('sub-categories are filtered by category', async () => {
    assert.ok(ctx.electricSubs.length >= 3);
    assert.ok(ctx.electricSubs.every((s) => String(s.categoryId) === String(ctx.categories.Electrician.id)));
  });

  test('catalog entries with active requests cannot be deleted; they can once the work is finished', async () => {
    const cat = await post('/categories', { name: 'Water Purifier Service', icon: 'water' }, ctx.admin.token);
    const sub = await post('/subcategories', { categoryId: cat.body.data.id, name: 'RO Filter Change', estimatedPrice: 999 }, ctx.admin.token);
    const created = await post(
      '/requests',
      { categoryId: cat.body.data.id, subCategoryId: sub.body.data.id, addressId: ctx.priyaAddress.id, description: 'RO purifier is leaking and tastes odd.', priority: 'LOW' },
      ctx.priya.token
    );
    assert.equal(created.status, 201);

    const blockedSub = await api('DELETE', '/subcategories/delete', { body: { id: sub.body.data.id }, token: ctx.admin.token });
    assert.equal(blockedSub.status, 409);
    assert.equal(blockedSub.body.code, 'RESOURCE_IN_USE');
    const blockedCat = await api('DELETE', '/categories/delete', { body: { id: cat.body.data.id }, token: ctx.admin.token });
    assert.equal(blockedCat.status, 409);

    await post('/requests/cancel', { id: created.body.data.id, reason: 'Test cleanup' }, ctx.priya.token);
    const removedSub = await api('DELETE', '/subcategories/delete', { body: { id: sub.body.data.id }, token: ctx.admin.token });
    assert.equal(removedSub.status, 200);
    const removedCat = await api('DELETE', '/categories/delete', { body: { id: cat.body.data.id }, token: ctx.admin.token });
    assert.equal(removedCat.status, 200);
  });
});

describe('authorization & ownership', () => {
  test('customer cannot call vendor or admin endpoints', async () => {
    assert.equal((await post('/requests/accept', { id: '0'.repeat(24) }, ctx.priya.token)).status, 403);
    assert.equal((await post('/vendors/list', {}, ctx.priya.token)).status, 403);
    assert.equal((await get('/admin/dashboard', ctx.priya.token)).status, 403);
  });

  test('vendor list (with emails/documents) is admin only and unauthenticated is rejected', async () => {
    assert.equal((await post('/vendors/list', {})).status, 401);
  });

  test('customer cannot read another customer request', async () => {
    const mine = await post('/requests/list', {}, ctx.rahul.token);
    const rahulRequestId = mine.body.data[0].id;
    const res = await post('/requests/detail', { id: rahulRequestId }, ctx.priya.token);
    assert.equal(res.status, 404);
  });

  test('customer cannot update another customer or their own status', async () => {
    const other = await post('/customers/update', { id: ctx.rahul.user.id, firstName: 'Hacked' }, ctx.priya.token);
    assert.equal(other.status, 403);
    const self = await post('/customers/update', { firstName: 'Priya', status: 'BLOCKED' }, ctx.priya.token);
    assert.equal(self.status, 200);
    assert.equal(self.body.data.status, 'ACTIVE');
  });

  test('vendor cannot change approval or rating via profile update', async () => {
    const res = await post('/vendors/update', { description: 'Updated', approvalStatus: 'APPROVED', averageRating: 5 }, ctx.sparkfix.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.description, 'Updated');
    assert.notEqual(res.body.data.averageRating, 5);
  });

  test('request using another customer address is rejected', async () => {
    const rahulAddr = (await get('/addresses', ctx.rahul.token)).body.data[0];
    const res = await createElectricRequest(ctx.priya.token, rahulAddr.id);
    assert.equal(res.status, 400);
    assert.equal(res.body.errors[0].field, 'addressId');
  });

  test('sub-category must belong to the category', async () => {
    const plumbing = (await post('/subcategories/list', { categoryId: ctx.categories.Plumber.id })).body.data[0];
    const res = await createElectricRequest(ctx.priya.token, ctx.priyaAddress.id, { subCategoryId: plumbing.id });
    assert.equal(res.status, 400);
  });
});

describe('vendor recommendation', () => {
  test('returns only approved vendors for the category, ordered by rating, without private fields', async () => {
    const res = await post('/vendors/recommended', { categoryId: ctx.categories.Electrician.id }, ctx.priya.token);
    assert.equal(res.status, 200);
    const names = res.body.data.map((v) => v.businessName);
    assert.deepEqual(names, ['SparkFix Electricals', 'BrightVolt Electric Services']);
    assert.equal(res.body.data[0].email, undefined);
    assert.equal(res.body.data[0].documents, undefined);
    const ratings = res.body.data.map((v) => v.averageRating);
    assert.deepEqual(ratings, [...ratings].sort((a, b) => b - a));
  });

  test('ranking is review-weighted: one 5★ review does not outrank an established vendor', async () => {
    const Vendor = require('../src/models/vendor');
    const brightvolt = await Vendor.findOne({ businessName: 'BrightVolt Electric Services' });
    const original = { averageRating: brightvolt.averageRating, totalReviews: brightvolt.totalReviews };
    await Vendor.updateOne({ _id: brightvolt._id }, { averageRating: 5, totalReviews: 1 });
    try {
      const res = await post('/vendors/recommended', { categoryId: ctx.categories.Electrician.id }, ctx.priya.token);
      assert.equal(res.body.data[0].businessName, 'SparkFix Electricals');
    } finally {
      await Vendor.updateOne({ _id: brightvolt._id }, original);
    }
  });

  test('pending vendors are never recommended', async () => {
    const res = await post('/vendors/recommended', { categoryId: ctx.categories['AC Repair'].id }, ctx.priya.token);
    assert.ok(!res.body.data.some((v) => v.businessName === 'CoolAir Services'));
  });

  test('a category with no vendors returns an empty list and open dispatch still works', async () => {
    const cat = await post('/categories', { name: 'Gardening', icon: 'flower' }, ctx.admin.token);
    const sub = await post('/subcategories', { categoryId: cat.body.data.id, name: 'Lawn Mowing', estimatedPrice: 499 }, ctx.admin.token);
    const rec = await post('/vendors/recommended', { categoryId: cat.body.data.id }, ctx.priya.token);
    assert.equal(rec.status, 200);
    assert.deepEqual(rec.body.data, []);
    const created = await post('/requests', {
      categoryId: cat.body.data.id,
      subCategoryId: sub.body.data.id,
      addressId: ctx.priyaAddress.id,
      description: 'Front lawn needs mowing and edging.',
    }, ctx.priya.token);
    assert.equal(created.status, 201);
    assert.equal(created.body.data.dispatchMode, 'OPEN');
    assert.equal(created.body.data.status, 'PENDING_VENDOR');
  });

  test('directing to an ineligible vendor is rejected with VENDOR_NOT_ELIGIBLE', async () => {
    const res = await createElectricRequest(ctx.priya.token, ctx.priyaAddress.id, { vendorId: ctx.aquaflow.user.id });
    assert.equal(res.status, 422);
    assert.equal(res.body.code, 'VENDOR_NOT_ELIGIBLE');
  });
});

describe('directed dispatch: full lifecycle', () => {
  let id;

  test('customer selects SparkFix → request goes only to SparkFix', async () => {
    const res = await createElectricRequest(ctx.priya.token, ctx.priyaAddress.id, {
      vendorId: ctx.sparkfix.user.id,
      priority: 'EMERGENCY',
      notes: 'Ring the bell twice.',
    });
    assert.equal(res.status, 201);
    const r = res.body.data;
    id = r.id;
    assert.equal(r.dispatchMode, 'DIRECTED');
    assert.equal(r.status, 'PENDING_VENDOR');
    assert.equal(r.requestedVendor.businessName, 'SparkFix Electricals');
    assert.equal(r.priorityLabel, 'Emergency');
    assert.match(r.requestNumber, /^FX-\d{6}-\d{6}$/);
    assert.deepEqual(r.timeline.map((t) => t.title), ['Request Created', 'Vendor Requested']);
    assert.ok(r.allowedActions.includes('CANCEL'));

    assert.ok((await newList(ctx.sparkfix.token)).includes(id));
    assert.ok(!(await newList(ctx.brightvolt.token)).includes(id));
  });

  test('SparkFix sees it flagged as directed, without customer phone before accepting', async () => {
    const res = await post('/requests/detail', { id }, ctx.sparkfix.token);
    assert.equal(res.body.data.isDirectedToMe, true);
    assert.equal(res.body.data.customer.phone, null);
    assert.deepEqual(res.body.data.allowedActions.sort(), ['ACCEPT', 'REJECT']);
  });

  test('another vendor cannot accept or view a directed request', async () => {
    assert.equal((await post('/requests/accept', { id }, ctx.brightvolt.token)).status, 404);
    assert.equal((await post('/requests/detail', { id }, ctx.brightvolt.token)).status, 404);
  });

  test('cannot complete or start before accepting', async () => {
    assert.equal((await post('/requests/start', { id }, ctx.sparkfix.token)).status, 404);
  });

  test('SparkFix accepts → customer sees vendor contact', async () => {
    const res = await post('/requests/accept', { id }, ctx.sparkfix.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'ACCEPTED');
    assert.ok(res.body.data.customer.phone);
    assert.deepEqual(res.body.data.allowedActions.sort(), ['ASSIGN_TEAM', 'START']);
    const asCustomer = await post('/requests/detail', { id }, ctx.priya.token);
    assert.equal(asCustomer.body.data.vendor.businessName, 'SparkFix Electricals');
    assert.ok(asCustomer.body.data.vendor.phone);
  });

  test('accepting twice is an invalid transition', async () => {
    const res = await post('/requests/accept', { id }, ctx.sparkfix.token);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'INVALID_STATUS_TRANSITION');
  });

  test('complete before start is rejected', async () => {
    const res = await post('/requests/complete', { id, finalAmount: 100, paymentMethod: 'CASH', paymentStatus: 'PAID' }, ctx.sparkfix.token);
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'INVALID_STATUS_TRANSITION');
  });

  test('team assignment: active member works, on-leave member rejected', async () => {
    const team = (await get('/team', ctx.sparkfix.token)).body.data;
    const active = team.find((m) => m.status === 'ACTIVE');
    const onLeave = team.find((m) => m.status === 'ON_LEAVE');
    const ok = await post('/requests/assign', { id, assignedTeamMemberId: active.id }, ctx.sparkfix.token);
    assert.equal(ok.status, 200);
    assert.equal(ok.body.data.assignedTeamMember.name, active.name);
    const bad = await post('/requests/assign', { id, assignedTeamMemberId: onLeave.id }, ctx.sparkfix.token);
    assert.equal(bad.status, 400);
  });

  test('start → customer can no longer cancel', async () => {
    const res = await post('/requests/start', { id }, ctx.sparkfix.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'IN_PROGRESS');
    const cancel = await post('/requests/cancel', { id }, ctx.priya.token);
    assert.equal(cancel.status, 409);
  });

  test('review before completion is rejected', async () => {
    const res = await post('/reviews', { serviceRequestId: id, rating: 5 }, ctx.priya.token);
    assert.equal(res.status, 400);
    assert.equal(res.body.code, 'REVIEW_NOT_ALLOWED');
  });

  test('complete requires offline payment fields and records them', async () => {
    const missing = await post('/requests/complete', { id }, ctx.sparkfix.token);
    assert.equal(missing.status, 400);
    const res = await post('/requests/complete', {
      id,
      finalAmount: 750,
      paymentMethod: 'UPI',
      paymentStatus: 'PAID',
      completionNotes: 'Replaced fan capacitor.',
    }, ctx.sparkfix.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'COMPLETED');
    assert.equal(res.body.data.finalAmount, 750);
    assert.equal(res.body.data.paymentMethodLabel, 'UPI');
    assert.equal(res.body.data.paymentStatusLabel, 'Payment Recorded');
    const asCustomer = await post('/requests/detail', { id }, ctx.priya.token);
    assert.deepEqual(asCustomer.body.data.allowedActions, ['REVIEW']);
  });

  test('customer reviews once → request CLOSED, vendor rating recalculated', async () => {
    const before = (await get('/auth/me', ctx.sparkfix.token)).body.data;
    const res = await post('/reviews', { serviceRequestId: id, rating: 1, comment: 'Test review' }, ctx.priya.token);
    assert.equal(res.status, 201);
    const detail = (await post('/requests/detail', { id }, ctx.priya.token)).body.data;
    assert.equal(detail.status, 'CLOSED');
    assert.equal(detail.review.rating, 1);
    assert.deepEqual(detail.allowedActions, []);
    assert.deepEqual(detail.timeline.map((t) => t.title), [
      'Request Created', 'Vendor Requested', 'Vendor Accepted', 'Technician Assigned', 'Work Started', 'Work Completed', 'Review Submitted',
    ]);
    const afterProfile = (await get('/auth/me', ctx.sparkfix.token)).body.data;
    assert.equal(afterProfile.totalReviews, before.totalReviews + 1);
    assert.ok(afterProfile.averageRating < before.averageRating);

    const again = await post('/reviews', { serviceRequestId: id, rating: 5 }, ctx.priya.token);
    assert.equal(again.status, 409);
  });
});

describe('directed request declined → re-enters open dispatch', () => {
  test('SparkFix declines; BrightVolt then sees it and accepts', async () => {
    const created = (await createElectricRequest(ctx.rahul.token, (await get('/addresses', ctx.rahul.token)).body.data[0].id, { vendorId: ctx.sparkfix.user.id })).body.data;
    assert.ok(!(await newList(ctx.brightvolt.token)).includes(created.id));

    const declined = await post('/requests/reject', { id: created.id, reason: 'Busy today' }, ctx.sparkfix.token);
    assert.equal(declined.status, 200);
    assert.equal(declined.body.data.dispatchMode, 'OPEN');
    assert.equal(declined.body.data.status, 'PENDING_VENDOR');

    assert.ok(!(await newList(ctx.sparkfix.token)).includes(created.id));
    const rejectedView = await post('/requests/list', { view: 'REJECTED' }, ctx.sparkfix.token);
    assert.ok(rejectedView.body.data.some((r) => r.id === created.id));

    assert.ok((await newList(ctx.brightvolt.token)).includes(created.id));
    const accept = await post('/requests/accept', { id: created.id }, ctx.brightvolt.token);
    assert.equal(accept.status, 200);
    const asCustomer = (await post('/requests/detail', { id: created.id }, ctx.rahul.token)).body.data;
    assert.equal(asCustomer.vendor.businessName, 'BrightVolt Electric Services');
    assert.ok(asCustomer.timeline.some((t) => t.title === 'Sent to Vendors'));
  });
});

describe('open dispatch: first accept wins', () => {
  test('both eligible vendors see the broadcast; concurrent accept → exactly one winner', async () => {
    const created = (await createElectricRequest(ctx.priya.token, ctx.priyaAddress.id)).body.data;
    assert.equal(created.dispatchMode, 'OPEN');
    assert.deepEqual(created.timeline.map((t) => t.title), ['Request Created', 'Sent to Vendors']);
    assert.ok((await newList(ctx.sparkfix.token)).includes(created.id));
    assert.ok((await newList(ctx.brightvolt.token)).includes(created.id));
    assert.ok(!(await newList(ctx.aquaflow.token)).includes(created.id), 'plumber should not see electrician work');

    const results = await Promise.all([
      post('/requests/accept', { id: created.id }, ctx.sparkfix.token),
      post('/requests/accept', { id: created.id }, ctx.brightvolt.token),
    ]);
    const statuses = results.map((r) => r.status).sort();
    assert.deepEqual(statuses, [200, 409]);
    const loser = results.find((r) => r.status === 409);
    assert.equal(loser.body.code, 'REQUEST_ALREADY_ASSIGNED');
    assert.equal(loser.body.message, 'This request has already been assigned to another vendor.');

    const winnerToken = results[0].status === 200 ? ctx.sparkfix.token : ctx.brightvolt.token;
    const loserToken = winnerToken === ctx.sparkfix.token ? ctx.brightvolt.token : ctx.sparkfix.token;
    assert.ok(!(await newList(loserToken)).includes(created.id));
    assert.ok(!(await newList(winnerToken)).includes(created.id));
    const accepted = await post('/requests/list', { view: 'ACCEPTED' }, winnerToken);
    assert.ok(accepted.body.data.some((r) => r.id === created.id));
  });

  test('ten-way race on many requests never double-assigns', async () => {
    for (let i = 0; i < 5; i += 1) {
      const created = (await createElectricRequest(ctx.priya.token, ctx.priyaAddress.id)).body.data;
      const attempts = await Promise.all(
        Array.from({ length: 10 }, (_, n) =>
          post('/requests/accept', { id: created.id }, n % 2 ? ctx.sparkfix.token : ctx.brightvolt.token)
        )
      );
      assert.equal(attempts.filter((a) => a.status === 200).length, 1);
    }
  });

  test('customer can cancel before work starts and vendor list updates', async () => {
    const created = (await createElectricRequest(ctx.priya.token, ctx.priyaAddress.id)).body.data;
    const res = await post('/requests/cancel', { id: created.id, reason: 'Fixed it myself' }, ctx.priya.token);
    assert.equal(res.status, 200);
    assert.equal(res.body.data.status, 'CANCELLED');
    assert.ok(!(await newList(ctx.sparkfix.token)).includes(created.id));
    const accept = await post('/requests/accept', { id: created.id }, ctx.sparkfix.token);
    assert.equal(accept.status, 409);
  });
});

describe('vendor approval', () => {
  let pending;

  test('new vendor signup is pending, admins notified, cannot receive requests', async () => {
    const reg = await post('/auth/register/vendor', {
      businessName: 'FreshFix Electric',
      ownerName: 'Dev Patel',
      email: 'freshfix@example.com',
      phone: '+919800011122',
      password: 'Secret123!',
      address: 'Bodakdev, Ahmedabad',
      categoryIds: [ctx.categories.Electrician.id],
      approvalStatus: 'APPROVED',
    });
    assert.equal(reg.status, 201);
    assert.equal(reg.body.data.user.approvalStatus, 'PENDING');
    pending = reg.body.data;

    const list = await post('/requests/list', { view: 'NEW' }, pending.token);
    assert.equal(list.status, 403);
    assert.equal(list.body.code, 'VENDOR_NOT_APPROVED');
    assert.equal((await get('/vendors/dashboard', pending.token)).status, 403);

    const adminNotifs = await get('/notifications', ctx.admin.token);
    assert.ok(adminNotifs.body.data.some((n) => n.message.includes('FreshFix Electric')));

    const rec = await post('/vendors/recommended', { categoryId: ctx.categories.Electrician.id }, ctx.priya.token);
    assert.ok(!rec.body.data.some((v) => v.businessName === 'FreshFix Electric'));
  });

  test('vendor signup requires categories', async () => {
    const res = await post('/auth/register/vendor', {
      businessName: 'X Co', ownerName: 'X Y', email: 'x@example.com', phone: '+919800011199', password: 'Secret123!', address: 'Somewhere',
    });
    assert.equal(res.status, 400);
    assert.ok(res.body.errors.some((e) => e.field === 'categoryIds'));
  });

  test('admin approves → vendor can now see broadcast work', async () => {
    const res = await post('/vendors/approval-status', { id: pending.user.id, approvalStatus: 'APPROVED' }, ctx.admin.token);
    assert.equal(res.status, 200);
    const list = await post('/requests/list', { view: 'NEW' }, pending.token);
    assert.equal(list.status, 200);
    const me = await get('/auth/me', pending.token);
    assert.equal(me.body.data.approvalStatus, 'APPROVED');
    const notifs = await get('/notifications', pending.token);
    assert.ok(notifs.body.data.some((n) => n.title === 'Account approved'));
  });
});

describe('uploads', () => {
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
    'base64'
  );

  test('image upload returns a server path that is served back', async () => {
    const form = new FormData();
    form.append('type', 'REQUEST');
    form.append('files', new Blob([png], { type: 'image/png' }), 'leak.png');
    const res = await api('POST', '/uploads', { form, token: ctx.priya.token });
    assert.equal(res.status, 201);
    const url = res.body.data[0].url;
    assert.match(url, /^\/uploads\/[\w-]+\.png$/);
    const file = await fetch(`${base.replace('/api/v1', '')}${url}`);
    assert.equal(file.status, 200);

    const created = await createElectricRequest(ctx.priya.token, ctx.priyaAddress.id, { images: [url] });
    assert.equal(created.status, 201);
    assert.deepEqual(created.body.data.images, [url]);
  });

  test('non-image upload is rejected', async () => {
    const form = new FormData();
    form.append('files', new Blob(['hello'], { type: 'text/plain' }), 'x.txt');
    const res = await api('POST', '/uploads', { form, token: ctx.priya.token });
    assert.equal(res.status, 400);
  });

  test('upload requires auth; external image URLs cannot be attached', async () => {
    const form = new FormData();
    form.append('files', new Blob([png], { type: 'image/png' }), 'a.png');
    assert.equal((await api('POST', '/uploads', { form })).status, 401);
    const res = await createElectricRequest(ctx.priya.token, ctx.priyaAddress.id, { images: ['https://evil.example/x.png'] });
    assert.equal(res.status, 400);
  });
});

describe('customer history, addresses & notifications', () => {
  test('history filters', async () => {
    const all = (await post('/requests/list', { view: 'ALL', limit: 100 }, ctx.priya.token)).body;
    const active = (await post('/requests/list', { view: 'ACTIVE', limit: 100 }, ctx.priya.token)).body.data;
    const done = (await post('/requests/list', { view: 'COMPLETED', limit: 100 }, ctx.priya.token)).body.data;
    const cancelled = (await post('/requests/list', { view: 'CANCELLED', limit: 100 }, ctx.priya.token)).body.data;
    assert.ok(active.every((r) => ['PENDING_VENDOR', 'ACCEPTED', 'IN_PROGRESS', 'ON_HOLD', 'CREATED'].includes(r.status)));
    assert.ok(done.every((r) => ['COMPLETED', 'CLOSED'].includes(r.status)));
    assert.ok(cancelled.every((r) => ['CANCELLED', 'REJECTED'].includes(r.status)));
    assert.equal(all.meta.total, active.length + done.length + cancelled.length);
  });

  test('pagination meta', async () => {
    const page = await post('/requests/list', { view: 'ALL', page: 1, limit: 2 }, ctx.priya.token);
    assert.equal(page.body.data.length, 2);
    assert.equal(page.body.meta.limit, 2);
    assert.equal(page.body.meta.hasNextPage, true);
    assert.equal(page.body.meta.hasPreviousPage, false);
  });

  test('address CRUD keeps exactly one default', async () => {
    const created = await post('/addresses', { title: 'Parents', addressLine1: '5 Law Garden', city: 'Ahmedabad', state: 'Gujarat', pincode: '380006', isDefault: true }, ctx.priya.token);
    assert.equal(created.status, 201);
    let list = (await get('/addresses', ctx.priya.token)).body.data;
    assert.equal(list.filter((a) => a.isDefault).length, 1);
    assert.equal(list.find((a) => a.isDefault).id, created.body.data.id);
    await api('DELETE', '/addresses/delete', { body: { id: created.body.data.id }, token: ctx.priya.token });
    list = (await get('/addresses', ctx.priya.token)).body.data;
    assert.equal(list.filter((a) => a.isDefault).length, 1);
    assert.ok(!list.some((a) => a.id === created.body.data.id));
  });

  test('notifications: unread count and mark all read', async () => {
    const before = (await get('/notifications/unread-count', ctx.priya.token)).body.data.unreadCount;
    assert.ok(before > 0);
    const res = await post('/notifications/read-all', {}, ctx.priya.token);
    assert.equal(res.status, 200);
    assert.equal((await get('/notifications/unread-count', ctx.priya.token)).body.data.unreadCount, 0);
  });
});

describe('vendor dashboard, reviews & reports', () => {
  test('dashboard counts are numbers and active jobs belong to the vendor', async () => {
    const res = await get('/vendors/dashboard', ctx.sparkfix.token);
    assert.equal(res.status, 200);
    const d = res.body.data;
    ['todayRequests', 'pendingRequests', 'acceptedRequests', 'inProgressRequests', 'completedRequests'].forEach((k) =>
      assert.equal(typeof d[k], 'number', k)
    );
    assert.ok(d.activeJobs.every((j) => j.vendor && j.vendor.businessName === 'SparkFix Electricals'));
  });

  test('review summary breakdown adds up', async () => {
    const res = await post('/reviews/summary', {}, ctx.sparkfix.token);
    const s = res.body.data;
    assert.equal(s.breakdown.length, 5);
    assert.equal(s.breakdown.reduce((n, b) => n + b.count, 0), s.totalReviews);
    const list = await post('/reviews/vendor', {}, ctx.sparkfix.token);
    assert.equal(list.body.meta.total, s.totalReviews);
    assert.ok(list.body.data[0].customer.name);
  });

  test('reports for each period', async () => {
    for (const period of ['TODAY', 'WEEK', 'MONTH']) {
      const res = await post('/vendors/reports', { period }, ctx.sparkfix.token);
      assert.equal(res.status, 200, period);
      assert.ok(res.body.data.rejectedRequests >= 1, `${period} should include today's decline`);
    }
    const bad = await post('/vendors/reports', { period: 'YEAR' }, ctx.sparkfix.token);
    assert.equal(bad.status, 400);
  });

  test('team CRUD', async () => {
    const created = await post('/team', { name: 'Test Tech', phone: '+919811199999', designation: 'Helper' }, ctx.sparkfix.token);
    assert.equal(created.status, 201);
    const updated = await post('/team/update', { id: created.body.data.id, status: 'INACTIVE' }, ctx.sparkfix.token);
    assert.equal(updated.body.data.status, 'INACTIVE');
    const otherVendor = await post('/team/detail', { id: created.body.data.id }, ctx.brightvolt.token);
    assert.equal(otherVendor.status, 404);
  });

  test('team phone numbers are unique within a vendor, in any format', async () => {
    const dup = await post('/team', { name: 'Copy Tech', phone: '98111 99999' }, ctx.sparkfix.token);
    assert.equal(dup.status, 409);
    assert.equal(dup.body.errors[0].field, 'phone');
    const otherVendor = await post('/team', { name: 'Other Tech', phone: '9811199999' }, ctx.brightvolt.token);
    assert.equal(otherVendor.status, 201);
  });

  test('availability off → vendor is no longer recommended', async () => {
    await post('/vendors/update', { availability: false }, ctx.brightvolt.token);
    const rec = await post('/vendors/recommended', { categoryId: ctx.categories.Electrician.id }, ctx.priya.token);
    assert.ok(!rec.body.data.some((v) => v.businessName === 'BrightVolt Electric Services'));
    await post('/vendors/update', { availability: true }, ctx.brightvolt.token);
  });
});
