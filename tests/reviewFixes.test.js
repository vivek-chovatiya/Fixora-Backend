// Code-review fixes (requests contract §8, lead 17/11/2026): static OTP in production, the
// email-sign-up phone pre-hijack, broadcast decline checks, the not-held view, session revocation,
// the JWT secret, malformed ids, and one review by request.
const express = require('express');
const mongoose = require('mongoose');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const clock = require('./helpers/clock');
const f = require('./helpers/fixtures');
const errorHandler = require('../src/middlewares/error');
const checkEnvironment = require('../src/config/startupChecks');
const Customer = require('../src/models/customer');
const Vendor = require('../src/models/vendor');
const secretCode = require('../src/utils/secretCode');
const { generateToken } = require('../src/utils/token');

const OTP = '123456';

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
  jest.restoreAllMocks();
  process.env.OTP_STATIC_CODE = '';
});

const signInCustomer = async (phone) => {
  await api.post('/auth/customer/otp/request', { phone });
  return api.post('/auth/customer/otp/verify', { phone, code: OTP });
};

describe('1. OTP_STATIC_CODE in production', () => {
  test('is ignored: the code is random and the static value is refused', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const random = jest.spyOn(secretCode, 'generateNumericCode').mockReturnValue('590214');
      await api.post('/auth/customer/otp/request', { phone: '9876543210' });
      expect(random).toHaveBeenCalledTimes(1);

      const staticTry = await api.post('/auth/customer/otp/verify', { phone: '9876543210', code: OTP });
      expect(staticTry.body.code).toBe('OTP_INVALID');
      expect((await api.post('/auth/customer/otp/verify', { phone: '9876543210', code: '590214' })).status).toBe(200);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  // Not only production: anything that is not exactly development or test (unset, staging) is a
  // real environment as far as the static code is concerned.
  test.each([['unset'], ['staging']])('is ignored when NODE_ENV is %s', async (label) => {
    const previous = process.env.NODE_ENV;
    if (label === 'unset') delete process.env.NODE_ENV;
    else process.env.NODE_ENV = label;
    try {
      const random = jest.spyOn(secretCode, 'generateNumericCode').mockReturnValue('590214');
      await api.post('/auth/customer/otp/request', { phone: '9876543210' });
      expect(random).toHaveBeenCalledTimes(1);
      const staticTry = await api.post('/auth/customer/otp/verify', { phone: '9876543210', code: OTP });
      expect(staticTry.body.code).toBe('OTP_INVALID');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  test('start-up logs it as an error outside development/test, a warning inside, never the value', () => {
    const logger = { error: jest.fn(), warn: jest.fn() };
    for (const NODE_ENV of ['production', 'staging', undefined]) {
      checkEnvironment({ JWT_SECRET: 's', OTP_STATIC_CODE: '123456', NODE_ENV }, logger);
    }
    expect(logger.error).toHaveBeenCalledTimes(3);
    for (const [message] of logger.error.mock.calls) expect(message).toContain('ignored');

    checkEnvironment({ JWT_SECRET: 's', OTP_STATIC_CODE: '123456', NODE_ENV: 'development' }, logger);
    checkEnvironment({ JWT_SECRET: 's', OTP_STATIC_CODE: '123456', NODE_ENV: 'test' }, logger);
    expect(logger.warn).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledTimes(3);
    for (const call of [...logger.error.mock.calls, ...logger.warn.mock.calls]) {
      expect(call.join(' ')).not.toContain('123456');
    }
  });
});

describe('1b. TRUST_PROXY', () => {
  const parseTrustProxy = require('../src/config/trustProxy');

  test('a whole hop count is trusted; anything else (true, empty, junk) is false', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
    for (const value of [undefined, '', 'false', 'true', 'yes', '-1', '1.5', 'loopback']) {
      expect(parseTrustProxy(value)).toBe(false);
    }
  });
});

describe('2. an email sign-up cannot claim a phone', () => {
  const register = () =>
    api.post('/auth/register/customer', {
      firstName: 'Mallory',
      email: 'mallory@example.com',
      phone: '9876543210',
      password: 'Password123!',
    });

  test('the phone’s owner takes the account over; the unproven email, password and sessions go', async () => {
    const squat = await register();
    expect(squat.status).toBe(201);
    const squatterToken = squat.body.data.token;
    expect((await api.get('/auth/me', squatterToken)).status).toBe(200);
    expect((await Customer.findById(squat.body.data.user.id)).phoneVerifiedAt).toBeNull();

    const owner = await signInCustomer('9876543210');
    expect(owner.status).toBe(200);
    expect(owner.body.data.isNewAccount).toBe(false);
    expect(owner.body.data.user.id).toBe(String(squat.body.data.user.id));
    expect(owner.body.data.user.email).toBeUndefined();

    const stored = await Customer.findById(owner.body.data.user.id).select('+password').lean();
    expect(stored.email).toBeUndefined();
    expect(stored.password).toBeUndefined();
    expect(stored.phoneVerifiedAt).toBeInstanceOf(Date);

    // The squatter is locked out: their session ended and their email login is gone.
    expect((await api.get('/auth/me', squatterToken)).status).toBe(401);
    const login = await api.post('/auth/login', {
      email: 'mallory@example.com',
      password: 'Password123!',
      role: 'CUSTOMER',
    });
    expect(login.status).toBe(401);

    // The owner's session works, and nothing of theirs is visible to the old token.
    expect((await api.get('/auth/me', owner.body.data.token)).status).toBe(200);
    expect(logs.all()).not.toContain('9876543210');
  });

  test('a proven phone stays with its owner on later sign-ins', async () => {
    const first = await signInCustomer('9876543210');
    clock.advance(31000);
    const second = await signInCustomer('9876543210');
    expect(second.body.data.user.id).toBe(first.body.data.user.id);
    expect((await api.get('/auth/me', first.body.data.token)).status).toBe(200);

    const squat = await register();
    expect(squat.status).toBe(409);
  });

  test('an unproven vendor phone does not block a phone registration; the registrant takes it over', async () => {
    const category = await f.createCategory();
    const squat = await api.post('/auth/register/vendor', {
      businessName: 'Squat Electricals',
      ownerName: 'Mallory',
      email: 'mallory.vendor@example.com',
      phone: '9000000003',
      password: 'Password123!',
      address: 'Somewhere',
      categoryIds: [String(category._id)],
    });
    expect(squat.status).toBe(201);
    const squatterToken = squat.body.data.token;

    const registered = await api.post('/auth/vendor/register', {
      businessName: 'Sharma Plumbing',
      ownerFirstName: 'Anil',
      ownerLastName: 'Sharma',
      phone: '9000000003',
      serviceCategoryIds: [String(category._id)],
    });
    expect(registered.status).toBe(201);
    const { registrationId } = registered.body.data;
    const { code } = (await api.post('/auth/vendor/otp/verify', { registrationId, code: OTP })).body.data;
    const confirmed = await api.post('/auth/vendor/auth-code/confirm', { registrationId, authCode: code });
    expect(confirmed.status).toBe(200);
    expect(confirmed.body.data.user.id).toBe(String(squat.body.data.user.id));

    const stored = await Vendor.findById(squat.body.data.user.id).select('+password').lean();
    expect(stored).toMatchObject({ businessName: 'Sharma Plumbing', ownerName: 'Anil Sharma', status: 'ACTIVE', approvalStatus: 'APPROVED' });
    expect(stored.email).toBeUndefined();
    expect(stored.password).toBeUndefined();
    expect(stored.phoneVerifiedAt).toBeInstanceOf(Date);
    expect(await Vendor.countDocuments()).toBe(1);
    expect((await api.get('/auth/me', squatterToken)).status).toBe(401);
  });

  test('a proven vendor phone still answers 409 PHONE_ALREADY_REGISTERED', async () => {
    const category = await f.createCategory();
    await f.createPhoneVendor({ phone: '9000000003' });
    const res = await api.post('/auth/vendor/register', {
      businessName: 'X',
      ownerFirstName: 'A',
      ownerLastName: 'B',
      phone: '9000000003',
      serviceCategoryIds: [String(category._id)],
    });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('PHONE_ALREADY_REGISTERED');
  });
});

describe('3. declining a broadcast needs the same checks as seeing it', () => {
  test('outside the vendor’s categories: 404; a vendor not APPROVED: 403; eligible: 200', async () => {
    const electrical = await f.createCategory();
    const plumbing = await f.createCategory();
    const customer = await f.createCustomer();
    const request = await f.createRequest(customer, electrical);
    const id = String(request._id);

    const plumber = await f.createVendor([plumbing]);
    const outside = await api.post('/requests/reject', { id }, f.tokenFor(plumber, 'VENDOR'));
    expect(outside.status).toBe(404);
    expect(outside.body.code).toBe('REQUEST_NOT_FOUND');

    const pending = await f.createVendor([electrical], { approvalStatus: 'PENDING' });
    const notApproved = await api.post('/requests/reject', { id }, f.tokenFor(pending, 'VENDOR'));
    expect(notApproved.status).toBe(403);

    const stored = await mongoose.model('ServiceRequest').findById(request._id);
    expect(stored.declinedBy).toHaveLength(0);

    const eligible = await f.createVendor([electrical]);
    expect((await api.post('/requests/reject', { id }, f.tokenFor(eligible, 'VENDOR'))).status).toBe(200);
  });
});

describe('4. a vendor who does not hold the work never sees how it was done', () => {
  test('team member, amount, payment fields and completion images are withheld', async () => {
    const electrical = await f.createCategory();
    const customer = await f.createCustomer();
    const holder = await f.createVendor([electrical]);
    const decliner = await f.createVendor([electrical]);
    const member = await f.createTeamMember(holder, { phone: '9800011122' });
    const request = await f.createRequest(customer, electrical, {
      declinedBy: [decliner._id],
      vendorId: holder._id,
      status: 'COMPLETED',
      assignedTeamMemberId: member._id,
      amount: 650,
      paymentStatus: 'PAID',
      paymentMode: 'CASH',
      completionImages: ['https://cdn.example.com/after.jpg'],
    });

    const seen = await api.post('/requests/detail', { id: String(request._id) }, f.tokenFor(decliner, 'VENDOR'));
    expect(seen.status).toBe(200);
    expect(seen.body.data).toMatchObject({
      assignedTeamMemberId: null,
      amount: null,
      paymentStatus: null,
      paymentMode: null,
      completionImages: [],
    });
    expect(seen.text).not.toContain('9800011122');
    expect(seen.text).not.toContain('after.jpg');

    const held = await api.post('/requests/detail', { id: String(request._id) }, f.tokenFor(holder, 'VENDOR'));
    expect(held.body.data).toMatchObject({ amount: 650, paymentStatus: 'PAID' });
    expect(held.body.data.assignedTeamMemberId.name).toBe('Suresh');
  });
});

describe('6. sessions end when they should', () => {
  test('an admin auth-code reissue ends the vendor’s sessions', async () => {
    const { token: adminToken } = await f.createAdmin();
    const vendor = await f.createPhoneVendor({ phone: '9000000001', authCode: '482913' });
    const session = (await api.post('/auth/vendor/signin', { phone: '9000000001', authCode: '482913' })).body.data.token;
    expect((await api.get('/auth/me', session)).status).toBe(200);

    const { code } = (await api.post('/vendors/auth-code/regenerate', { id: String(vendor._id) }, adminToken)).body.data;
    const ended = await api.get('/auth/me', session);
    expect(ended.status).toBe(401);
    expect(ended.body.code).toBe('UNAUTHORIZED');

    const fresh = (await api.post('/auth/vendor/signin', { phone: '9000000001', authCode: code })).body.data.token;
    expect((await api.get('/auth/me', fresh)).status).toBe(200);
  });

  test('suspension ends a customer’s sessions, and reactivating does not bring them back', async () => {
    const { token: adminToken } = await f.createAdmin();
    const signedIn = await signInCustomer('9876543210');
    const { token, user } = signedIn.body.data;

    await api.post('/customers/update', { id: user.id, status: 'BLOCKED' }, adminToken);
    expect((await api.get('/auth/me', token)).status).toBe(401);

    await api.post('/customers/update', { id: user.id, status: 'ACTIVE' }, adminToken);
    expect((await api.get('/auth/me', token)).status).toBe(401);
  });

  test('deleting an account ends its sessions', async () => {
    const { token: adminToken } = await f.createAdmin();
    const customer = await f.createCustomer();
    const vendor = await f.createVendor();
    const customerToken = f.tokenFor(customer, 'CUSTOMER');
    const vendorToken = f.tokenFor(vendor, 'VENDOR');

    const request = require('supertest');
    await request(api.app).delete('/api/v1/customers/delete').set('Authorization', `Bearer ${adminToken}`).send({ id: String(customer._id) });
    await request(api.app).delete('/api/v1/vendors/delete').set('Authorization', `Bearer ${adminToken}`).send({ id: String(vendor._id) });

    expect((await api.get('/auth/me', customerToken)).status).toBe(401);
    expect((await api.get('/auth/me', vendorToken)).status).toBe(401);
  });

  test('a token from before a version bump is refused even for an active account', async () => {
    const customer = await f.createCustomer();
    const old = f.tokenFor(customer, 'CUSTOMER');
    await Customer.updateOne({ _id: customer._id }, { $inc: { tokenVersion: 1 } });
    expect((await api.get('/auth/me', old)).status).toBe(401);
    const current = generateToken({ id: String(customer._id), role: 'CUSTOMER', v: 1 });
    expect((await api.get('/auth/me', current)).status).toBe(200);
  });

  test('a revoked admin token does not unlock the full vendor list', async () => {
    const { admin, token } = await f.createAdmin();
    await f.createVendor([], { phone: '9000000301' });
    await mongoose.model('Admin').updateOne({ _id: admin._id }, { $inc: { tokenVersion: 1 } });
    const res = await api.post('/vendors/list', {}, token);
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('9000000301');
  });
});

describe('7. no fallback JWT secret', () => {
  test('start-up refuses without JWT_SECRET, and signing throws', () => {
    expect(() => checkEnvironment({}, { error() {}, warn() {} })).toThrow('JWT_SECRET is not set');
    const previous = process.env.JWT_SECRET;
    process.env.JWT_SECRET = '';
    try {
      expect(() => generateToken({ id: 'x', role: 'CUSTOMER' })).toThrow('JWT_SECRET is not set');
    } finally {
      process.env.JWT_SECRET = previous;
    }
  });
});

describe('8. malformed ids answer 400 VALIDATION_FAILED, never 500', () => {
  test('/notifications/read and /notifications/list validate their bodies', async () => {
    const token = f.tokenFor(await f.createCustomer(), 'CUSTOMER');
    const read = await api.post('/notifications/read', { id: 'not-an-id' }, token);
    expect(read.status).toBe(400);
    expect(read.body.code).toBe('VALIDATION_FAILED');
    expect(read.body.errors[0].field).toBe('id');

    const list = await api.post('/notifications/list', { page: 'first' }, token);
    expect(list.status).toBe(400);
    expect((await api.post('/notifications/list', {}, token)).status).toBe(200);
  });

  test('a CastError or a model ValidationError reaching the handler is a 400 naming the field, not the value', async () => {
    const request = require('supertest');
    // Express 4 does not catch async throws on its own, so the routes pass them to next().
    const wrapped = express();
    wrapped.get('/cast', (req, res, next) =>
      mongoose.model('ServiceRequest').findOne({ _id: '482913-not-an-id' }).then(() => res.end(), next)
    );
    wrapped.get('/invalid', (req, res, next) =>
      new (mongoose.model('Customer'))({}).validate().then(() => res.end(), next)
    );
    wrapped.use(errorHandler);

    const castRes = await request(wrapped).get('/cast');
    expect(castRes.status).toBe(400);
    expect(castRes.body).toMatchObject({ code: 'VALIDATION_FAILED', errors: [{ field: '_id' }] });
    expect(castRes.text).not.toContain('482913');
    expect(logs.all()).not.toContain('482913');

    const invalidRes = await request(wrapped).get('/invalid');
    expect(invalidRes.status).toBe(400);
    expect(invalidRes.body.errors.map((e) => e.field)).toContain('phone');
  });

  test('Joi failures are logged by field name only', async () => {
    await api.post('/auth/customer/otp/verify', { phone: '9876543210', code: '48a913' });
    const text = logs.all();
    expect(text).toContain('VALIDATION_FAILED');
    expect(text).toContain('code');
    expect(text).not.toContain('48a913');
    expect(text).not.toContain('must be exactly 6 digits');
  });
});

describe('POST /reviews/detail (contract §8)', () => {
  test('own review → 200 with requestNumber; none yet → REVIEW_NOT_FOUND; someone else’s → REQUEST_NOT_FOUND', async () => {
    const category = await f.createCategory();
    const customer = await f.createCustomer();
    const other = await f.createCustomer();
    const vendor = await f.createVendor([category]);
    const token = f.tokenFor(customer, 'CUSTOMER');
    const request = await f.createRequest(customer, category, {
      vendorId: vendor._id,
      status: 'COMPLETED',
      requestNumber: 'REQ-88004321',
    });
    const id = String(request._id);

    const none = await api.post('/reviews/detail', { requestId: id }, token);
    expect(none.status).toBe(404);
    expect(none.body.code).toBe('REVIEW_NOT_FOUND');

    await api.post('/reviews', { serviceRequestId: id, rating: 4, comment: 'Good' }, token);
    const own = await api.post('/reviews/detail', { requestId: id }, token);
    expect(own.status).toBe(200);
    expect(own.body.data).toMatchObject({ serviceRequestId: id, requestNumber: 'REQ-88004321', rating: 4 });

    const theirs = await api.post('/reviews/detail', { requestId: id }, f.tokenFor(other, 'CUSTOMER'));
    expect(theirs.status).toBe(404);
    expect(theirs.body.code).toBe('REQUEST_NOT_FOUND');

    expect((await api.post('/reviews/detail', { requestId: id }, f.tokenFor(vendor, 'VENDOR'))).status).toBe(403);
    expect((await api.post('/reviews/detail', { requestId: 'bad' }, token)).status).toBe(400);
  });
});
