// The failure envelope and the endpoints that existed before phone sign in.
const express = require('express');
const jwt = require('jsonwebtoken');
const request = require('supertest');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const { createAdmin, createCategory, createPhoneVendor, tokenFor } = require('./helpers/fixtures');
const bcrypt = require('bcryptjs');
const errorHandler = require('../src/middlewares/error');
const Customer = require('../src/models/customer');

const ENVELOPE_KEYS = ['code', 'data', 'errors', 'message', 'success'];

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
});

describe('failure envelope', () => {
  test('an unknown route answers 404 NOT_FOUND in the full envelope', async () => {
    const res = await api.post('/nowhere', {});
    expect(res.status).toBe(404);
    expect(Object.keys(res.body).sort()).toEqual(ENVELOPE_KEYS);
    expect(res.body).toMatchObject({ success: false, code: 'NOT_FOUND', errors: null, data: null });
  });

  test('a Joi rejection answers 400 VALIDATION_FAILED and lists every field', async () => {
    const res = await api.post('/auth/vendor/register', {});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors.map((e) => e.field).sort()).toEqual([
      'businessName',
      'ownerFirstName',
      'ownerLastName',
      'phone',
      'serviceCategoryIds',
    ]);
  });

  test('a malformed code is rejected without the value being echoed back or logged', async () => {
    const res = await api.post('/auth/customer/otp/verify', { phone: '9876543210', code: '98a7z1' });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors).toEqual([{ field: 'code', message: '"code" must be exactly 6 digits.' }]);
    expect(res.text).not.toContain('98a7z1');
    expect(logs.all()).not.toContain('98a7z1');
  });

  test('a malformed JSON body answers 400 with a generic message that never quotes the body', async () => {
    const res = await request(api.app)
      .post('/api/v1/auth/vendor/signin/otp/verify')
      .set('Content-Type', 'application/json')
      .send('{"phone":"9000000001","code":"482913"');
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'BAD_REQUEST', message: 'The request body could not be read.' });
    expect(res.text).not.toContain('482913');
    expect(logs.all()).not.toContain('482913');
  });

  test('an unexpected error answers 500 INTERNAL_ERROR without leaking its message', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    try {
      const app = express();
      app.get('/boom', () => {
        throw new Error('connection string mongodb://user:hunter2@db');
      });
      app.use(errorHandler);

      const res = await request(app).get('/boom');
      expect(res.status).toBe(500);
      expect(res.body).toEqual({
        success: false,
        message: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
        errors: null,
        data: null,
      });
      expect(res.text).not.toContain('hunter2');
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe('protected routes', () => {
  test('a missing, invalid or expired token answers 401 UNAUTHORIZED', async () => {
    const customer = await Customer.create({ phone: '9876543210' });
    const expired = jwt.sign(
      { id: String(customer._id), role: 'CUSTOMER', exp: Math.floor(Date.now() / 1000) - 60 },
      process.env.JWT_SECRET
    );

    for (const token of [undefined, 'not-a-token', expired]) {
      const res = await api.get('/auth/me', token);
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('UNAUTHORIZED');
    }

    const logout = await api.post('/auth/logout', {});
    expect(logout.status).toBe(401);
    expect(logout.body.code).toBe('UNAUTHORIZED');
  });

  test('a role that may not use a route answers 403 FORBIDDEN', async () => {
    const vendor = await createPhoneVendor();
    const res = await api.post('/customers/list', {}, tokenFor(vendor, 'VENDOR'));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('endpoints that existed before phone sign in still work', () => {
  test('health check', async () => {
    const res = await api.get('/health');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test('email customer: register, log in, /auth/me', async () => {
    const register = await api.post('/auth/register/customer', {
      firstName: 'Alex',
      lastName: 'Morgan',
      email: 'Alex@Example.com',
      phone: '+1 (800) 555-0100',
      password: 'Password123!',
    });
    expect(register.status).toBe(201);
    expect(register.body.data.user.phone).toBe('18005550100');

    const login = await api.post('/auth/login', {
      email: 'alex@example.com',
      password: 'Password123!',
      role: 'CUSTOMER',
    });
    expect(login.status).toBe(200);
    expect(login.body.data.role).toBe('CUSTOMER');

    const me = await api.get('/auth/me', login.body.data.token);
    expect(me.status).toBe(200);
    // The web views' fields survive alongside the session user's.
    expect(me.body.data).toMatchObject({
      fullName: 'Alex Morgan',
      firstName: 'Alex',
      lastName: 'Morgan',
      email: 'alex@example.com',
      phone: '18005550100',
      role: 'customer',
    });
    expect(typeof me.body.data.id).toBe('string');

    const wrong = await api.post('/auth/login', {
      email: 'alex@example.com',
      password: 'nope-nope',
      role: 'CUSTOMER',
    });
    expect(wrong.status).toBe(401);
    expect(wrong.body.code).toBe('UNAUTHORIZED');
  });

  test('email vendor: register and log in', async () => {
    const category = await createCategory();
    const register = await api.post('/auth/register/vendor', {
      businessName: 'SparkFix Electricals',
      ownerName: 'David Miller',
      email: 'vendor@example.com',
      phone: '+1 800 555 0201',
      password: 'Password123!',
      address: '102 Tech Park Avenue',
      categoryIds: [String(category._id)],
    });
    expect(register.status).toBe(201);

    const login = await api.post('/auth/login', {
      email: 'vendor@example.com',
      password: 'Password123!',
      role: 'VENDOR',
    });
    expect(login.status).toBe(200);

    const me = await api.get('/auth/me', login.body.data.token);
    expect(me.body.data).toMatchObject({
      businessName: 'SparkFix Electricals',
      ownerName: 'David Miller',
      firstName: 'David',
      lastName: 'Miller',
      role: 'vendor',
    });
  });

  test('an account with no password (phone sign in) is refused by email login with 401, not a 500', async () => {
    await createPhoneVendor({ phone: '9000000002', email: 'meena.iyer@example.com' });
    const res = await api.post('/auth/login', {
      email: 'meena.iyer@example.com',
      password: 'anything',
      role: 'VENDOR',
    });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
  });

  test('the vendor list does not expose auth code fields an older vendor still holds', async () => {
    await createPhoneVendor({ authCodeHash: await bcrypt.hash('482913', 4) });
    const res = await api.post('/vendors/list', {});
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('authCodeHash');
    expect(res.text).not.toContain('$2');
  });

  test('admin dashboard still answers for an admin', async () => {
    const { token } = await createAdmin();
    const res = await api.get('/admin/dashboard', token);
    expect(res.status).toBe(200);
  });
});
