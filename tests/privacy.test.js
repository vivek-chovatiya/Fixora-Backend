// What each party sees (requests contract §1–§3; PROJECT_BIBLE.md section 32): secrets never
// leave the database, other people's records answer 404, and a vendor sees the customer only
// once they hold the work.
const bcrypt = require('bcryptjs');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const f = require('./helpers/fixtures');
const Customer = require('../src/models/customer');
const Vendor = require('../src/models/vendor');

const VENDOR_SEEN_BY_CUSTOMER = ['_id', 'averageRating', 'businessName', 'id', 'ownerName', 'profileImage', 'totalReviews'];
const CUSTOMER_SEEN_BY_HOLDER = ['_id', 'firstName', 'id', 'lastName', 'phone'];
const PUBLIC_VENDOR = [
  'address',
  'availability',
  'averageRating',
  'businessName',
  'categoryIds',
  'description',
  'id',
  'ownerName',
  'profileImage',
  'totalReviews',
];

let electrical;
let asha;
let ashaToken;
let other;
let otherToken;
let v1;
let v1Token;
let v2;
let v2Token;

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  electrical = await f.createCategory({ name: 'Electrical' });
  asha = await f.createCustomer({ email: 'asha.patel@example.com', phone: '9876543210' });
  ashaToken = f.tokenFor(asha, 'CUSTOMER');
  other = await f.createCustomer({ firstName: 'Ravi' });
  otherToken = f.tokenFor(other, 'CUSTOMER');
  v1 = await f.createVendor([electrical], { email: 'v1.private@example.com', phone: '9000000101' });
  v1Token = f.tokenFor(v1, 'VENDOR');
  v2 = await f.createVendor([electrical], { phone: '9000000102' });
  v2Token = f.tokenFor(v2, 'VENDOR');
});

const post = (path, body, token) => api.post(path, body, token);

describe('a vendor as a customer sees them', () => {
  test('request detail and list carry only the public-facing vendor fields', async () => {
    const request = await f.createRequest(asha, electrical, { vendorId: v1._id, status: 'ACCEPTED' });

    const detail = await post('/requests/detail', { id: String(request._id) }, ashaToken);
    expect(Object.keys(detail.body.data.vendorId).sort()).toEqual(VENDOR_SEEN_BY_CUSTOMER);
    const list = await post('/requests/list', {}, ashaToken);
    expect(Object.keys(list.body.data[0].vendorId).sort()).toEqual(VENDOR_SEEN_BY_CUSTOMER);

    for (const res of [detail, list]) {
      expect(res.text).not.toContain('v1.private@example.com');
      expect(res.text).not.toContain('9000000101');
    }
  });
});

describe('a customer as a vendor sees them', () => {
  const withheld = ['Asha', 'Patel', '9876543210', 'asha.patel@example.com', '14 Lake View Road', '411001'];

  test('before holding the work: no name, phone or email, and the area only', async () => {
    const open = await f.createRequest(asha, electrical);
    const directed = await f.createRequest(asha, electrical, { vendorId: v1._id });
    const rejected = await f.createRequest(asha, electrical, { vendorId: v1._id, status: 'REJECTED' });

    for (const request of [open, directed, rejected]) {
      const res = await post('/requests/detail', { id: String(request._id) }, v1Token);
      expect(res.status).toBe(200);
      expect(res.body.data).toMatchObject({
        customerId: String(asha._id),
        addressId: null,
        serviceAddress: 'Koregaon Park',
        serviceArea: 'Koregaon Park',
        serviceAddressDetails: { area: 'Koregaon Park', city: 'Pune' },
      });
      for (const value of withheld) expect(res.text).not.toContain(value);
    }

    const list = await post('/requests/list', {}, v1Token);
    for (const value of withheld) expect(list.text).not.toContain(value);

    await post('/requests/reject', { id: String(open._id) }, v1Token);
    const declined = await post('/requests/list', { declined: true }, v1Token);
    expect(declined.body.data).toHaveLength(1);
    for (const value of withheld) expect(declined.text).not.toContain(value);
  });

  test('once holding it: { id, firstName, lastName, phone } and the full address, never the email', async () => {
    const request = await f.createRequest(asha, electrical);
    const accepted = await post('/requests/accept', { id: String(request._id) }, v1Token);

    for (const res of [accepted, await post('/requests/detail', { id: String(request._id) }, v1Token)]) {
      expect(Object.keys(res.body.data.customerId).sort()).toEqual(CUSTOMER_SEEN_BY_HOLDER);
      expect(res.body.data.customerId).toMatchObject({ firstName: 'Asha', lastName: 'Patel', phone: '9876543210' });
      expect(res.body.data.serviceAddress).toBe('14 Lake View Road, Flat 3B, Koregaon Park, Pune 411001');
      expect(res.body.data.serviceAddressDetails).toMatchObject({ line1: '14 Lake View Road', pincode: '411001' });
      expect(res.text).not.toContain('asha.patel@example.com');
    }

    const list = await post('/requests/list', {}, v1Token);
    expect(Object.keys(list.body.data[0].customerId).sort()).toEqual(CUSTOMER_SEEN_BY_HOLDER);
    expect(list.text).not.toContain('asha.patel@example.com');
  });

  test('a cancelled directed request goes back to the area-only view', async () => {
    const request = await f.createRequest(asha, electrical, { vendorId: v1._id });
    await post('/requests/cancel', { id: String(request._id) }, ashaToken);
    const res = await post('/requests/detail', { id: String(request._id) }, v1Token);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(res.body.data.customerId).toBe(String(asha._id));
    expect(res.text).not.toContain('9876543210');
  });
});

describe('the public vendor list and detail', () => {
  test('without a token: the public fields of bookable vendors only', async () => {
    await f.createVendor([electrical], { status: 'BLOCKED', phone: '9000000103' });
    await f.createVendor([electrical], { approvalStatus: 'PENDING', phone: '9000000104' });

    const list = await post('/vendors/list', {});
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(2);
    for (const vendor of list.body.data) {
      expect(Object.keys(vendor).sort()).toEqual(PUBLIC_VENDOR);
    }
    expect(list.text).not.toContain('v1.private@example.com');
    expect(list.text).not.toContain('9000000101');

    const detail = await post('/vendors/detail', { id: String(v1._id) });
    expect(Object.keys(detail.body.data).sort()).toEqual(PUBLIC_VENDOR);
  });

  test('public search matches names only, and status filters are ignored', async () => {
    const byPhone = await post('/vendors/list', { search: '9000000101' });
    expect(byPhone.body.data).toEqual([]);
    const byEmail = await post('/vendors/list', { search: 'v1.private' });
    expect(byEmail.body.data).toEqual([]);
    const regex = await post('/vendors/list', { search: '(a+)+$' });
    expect(regex.status).toBe(200);

    await f.createVendor([electrical], { status: 'BLOCKED', phone: '9000000105' });
    const blocked = await post('/vendors/list', { status: 'BLOCKED' });
    expect(blocked.body.data.every((v) => v.id !== undefined)).toBe(true);
    expect(blocked.body.data).toHaveLength(2);
  });

  test('a vendor that is not bookable is not found publicly', async () => {
    const blocked = await f.createVendor([electrical], { status: 'BLOCKED', phone: '9000000106' });
    const res = await post('/vendors/detail', { id: String(blocked._id) });
    expect(res.status).toBe(404);
  });

  test('an admin token unlocks every vendor with every field; a vendor sees their own record', async () => {
    const { token } = await f.createAdmin();
    await f.createVendor([electrical], { status: 'BLOCKED', phone: '9000000107' });

    const list = await post('/vendors/list', {}, token);
    expect(list.body.data).toHaveLength(3);
    expect(list.body.data.find((v) => String(v.id) === String(v1._id))).toMatchObject({
      phone: '9000000101',
      email: 'v1.private@example.com',
      approvalStatus: 'APPROVED',
      status: 'ACTIVE',
    });

    const own = await post('/vendors/detail', { id: String(v1._id) }, v1Token);
    expect(own.body.data.phone).toBe('9000000101');
    const someoneElse = await post('/vendors/detail', { id: String(v2._id) }, v1Token);
    expect(Object.keys(someoneElse.body.data).sort()).toEqual(PUBLIC_VENDOR);
  });
});

describe('own record only', () => {
  test('/customers/detail and /customers/update: another customer answers 404', async () => {
    expect((await post('/customers/detail', { id: String(other._id) }, ashaToken)).status).toBe(404);
    expect((await post('/customers/detail', { id: String(asha._id) }, ashaToken)).status).toBe(200);

    const update = await post('/customers/update', { id: String(other._id), firstName: 'Hacked' }, ashaToken);
    expect(update.status).toBe(404);
    expect((await Customer.findById(other._id)).firstName).toBe('Ravi');
  });

  test('a vendor may not read or change a customer record', async () => {
    expect((await post('/customers/detail', { id: String(asha._id) }, v1Token)).status).toBe(403);
    expect((await post('/customers/update', { id: String(asha._id), firstName: 'X' }, v1Token)).status).toBe(403);
  });

  test('a customer cannot change their status or point their default address at someone else’s', async () => {
    const res = await post('/customers/update', { id: String(asha._id), status: 'BLOCKED', firstName: 'Asha M' }, ashaToken);
    expect(res.status).toBe(200);
    expect(await Customer.findById(asha._id)).toMatchObject({ status: 'ACTIVE', firstName: 'Asha M' });

    const theirs = await f.createAddress(other);
    const bad = await post('/customers/update', { id: String(asha._id), defaultAddress: String(theirs._id) }, ashaToken);
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].field).toBe('defaultAddress');

    const mine = await f.createAddress(asha);
    const ok = await post('/customers/update', { id: String(asha._id), defaultAddress: String(mine._id) }, ashaToken);
    expect(ok.status).toBe(200);
  });

  test('an admin may read and update any customer', async () => {
    const { token } = await f.createAdmin();
    expect((await post('/customers/detail', { id: String(other._id) }, token)).status).toBe(200);
    const res = await post('/customers/update', { id: String(other._id), status: 'BLOCKED' }, token);
    expect(res.status).toBe(200);
    expect((await Customer.findById(other._id)).status).toBe('BLOCKED');
  });

  test('/vendors/update: another vendor answers 404; rating and status stay out of reach', async () => {
    const res = await post('/vendors/update', { id: String(v2._id), businessName: 'Hacked' }, v1Token);
    expect(res.status).toBe(404);

    const own = await post(
      '/vendors/update',
      { id: String(v1._id), businessName: 'Kumar Electricals', approvalStatus: 'REJECTED', status: 'BLOCKED', averageRating: 5, totalReviews: 999 },
      v1Token
    );
    expect(own.status).toBe(200);
    const stored = await Vendor.findById(v1._id);
    expect(stored).toMatchObject({ businessName: 'Kumar Electricals', approvalStatus: 'APPROVED', status: 'ACTIVE', averageRating: 0, totalReviews: 0 });
  });
});

describe('secrets never leave the database', () => {
  test('a document loaded with its secrets still serialises without them', async () => {
    const vendor = await Vendor.findById(v1._id).select('+password +authCodeHash');
    vendor.password = 'plain-should-never-show';
    vendor.authCodeHash = '$2a$10$abcdefghijklmnopqrstuv';
    const json = JSON.stringify(vendor);
    expect(json).not.toContain('password');
    expect(json).not.toContain('authCodeHash');

    const customer = await Customer.findById(asha._id).select('+password');
    customer.password = 'plain-should-never-show';
    expect(JSON.stringify(customer)).not.toContain('password');
  });

  test('every endpoint, as every role: no secret key, and no known stored hash', async () => {
    const passwordHash = await bcrypt.hash('Password123!', 4);
    const authCodeHash = await bcrypt.hash('482913', 4);
    await Customer.updateOne({ _id: asha._id }, { password: passwordHash });
    await Vendor.updateOne({ _id: v1._id }, { password: passwordHash, authCodeHash });
    const { admin, token: adminToken } = await f.createAdmin();
    const request = await f.createRequest(asha, electrical, { vendorId: v1._id, status: 'ACCEPTED' });
    const address = await f.createAddress(asha);
    await f.createTeamMember(v1);

    api.resetResponses();
    const id = String(request._id);
    const calls = [
      ['get', '/auth/me', ashaToken],
      ['get', '/auth/me', v1Token],
      ['get', '/auth/me', adminToken],
      ['post', '/requests/detail', ashaToken, { id }],
      ['post', '/requests/detail', v1Token, { id }],
      ['post', '/requests/detail', adminToken, { id }],
      ['post', '/requests/list', ashaToken, {}],
      ['post', '/requests/list', v1Token, {}],
      ['post', '/requests/list', adminToken, {}],
      ['post', '/vendors/list', undefined, {}],
      ['post', '/vendors/list', adminToken, {}],
      ['post', '/vendors/detail', undefined, { id: String(v1._id) }],
      ['post', '/vendors/detail', adminToken, { id: String(v1._id) }],
      ['post', '/vendors/detail', v1Token, { id: String(v1._id) }],
      ['post', '/customers/detail', ashaToken, { id: String(asha._id) }],
      ['post', '/customers/detail', adminToken, { id: String(asha._id) }],
      ['post', '/customers/list', adminToken, {}],
      ['post', '/customers/update', ashaToken, { id: String(asha._id), firstName: 'Asha' }],
      ['post', '/vendors/update', v1Token, { id: String(v1._id), description: 'Wiring' }],
      ['get', '/addresses', ashaToken],
      ['post', '/addresses/detail', ashaToken, { id: String(address._id) }],
      ['get', '/team', v1Token],
      ['post', '/admin/detail', adminToken, { id: String(admin._id) }],
      ['get', '/admin/dashboard', adminToken],
      ['post', '/reviews/vendor', undefined, { vendorId: String(v1._id) }],
      ['post', '/requests/start', v1Token, { id }],
      ['post', '/auth/login', undefined, { email: asha.email, password: 'Password123!', role: 'CUSTOMER' }],
    ];
    for (const [method, path, token, body] of calls) {
      const res = method === 'get' ? await api.get(path, token) : await api.post(path, body, token);
      expect({ path, status: res.status < 500 }).toEqual({ path, status: true });
    }

    expect(api.responses).toHaveLength(calls.length);
    for (const res of api.responses) {
      expect(res.text).not.toMatch(/"(password|authCodeHash|codeHash)"\s*:/);
      expect(res.text).not.toContain(passwordHash);
      expect(res.text).not.toContain(authCodeHash);
    }
  });
});

describe('the sign-in phone is identity (contract §2, lead 17/11/2026)', () => {
  test('/customers/update refuses a changed phone and accepts the unchanged one', async () => {
    const changed = await post('/customers/update', { id: String(asha._id), phone: '9876500000' }, ashaToken);
    expect(changed.status).toBe(400);
    expect(changed.body.code).toBe('VALIDATION_FAILED');
    expect(changed.body.errors).toEqual([
      { field: 'phone', message: 'The sign-in phone number cannot be changed here.' },
    ]);
    expect((await Customer.findById(asha._id)).phone).toBe('9876543210');

    // The same number, however it is typed, is not a change.
    const same = await post('/customers/update', { id: String(asha._id), phone: '98765 43210', firstName: 'Asha M' }, ashaToken);
    expect(same.status).toBe(200);
    expect(same.body.data.firstName).toBe('Asha M');
  });

  test('/vendors/update refuses a changed phone and accepts the unchanged one', async () => {
    const changed = await post('/vendors/update', { id: String(v1._id), phone: '9000000999' }, v1Token);
    expect(changed.status).toBe(400);
    expect(changed.body.errors[0].field).toBe('phone');
    expect((await Vendor.findById(v1._id)).phone).toBe('9000000101');

    const same = await post('/vendors/update', { id: String(v1._id), phone: '9000000101', description: 'Wiring' }, v1Token);
    expect(same.status).toBe(200);
  });

  test('an admin cannot change it through these routes either', async () => {
    const { token } = await f.createAdmin();
    expect((await post('/customers/update', { id: String(asha._id), phone: '9876500000' }, token)).status).toBe(400);
    expect((await post('/vendors/update', { id: String(v1._id), phone: '9000000999' }, token)).status).toBe(400);
  });
});
