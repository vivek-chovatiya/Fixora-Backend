// Profile fields (Phase 4B contract §6, §7): a vendor's working hours, clearing the description
// and service area, and removing a customer's email.
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const f = require('./helpers/fixtures');
const Customer = require('../src/models/customer');
const Vendor = require('../src/models/vendor');

const DAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];
const fieldsOf = (res) => (res.body.errors || []).map((error) => error.field);

// Monday to Saturday 09:00–19:00, Sunday closed.
const week = () =>
  DAYS.map((day) =>
    day === 'SUN' ? { day, isOpen: false } : { day, isOpen: true, opensAt: '09:00', closesAt: '19:00' }
  );
const withDay = (index, changes) => week().map((day, i) => (i === index ? { ...day, ...changes } : day));

let vendor;
let vendorToken;

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  vendor = await f.createVendor();
  vendorToken = f.tokenFor(vendor, 'VENDOR');
});

const updateVendor = (body, token = vendorToken) =>
  api.post('/vendors/update', { id: String(vendor._id), ...body }, token);

describe('working hours (/vendors/update workingHours)', () => {
  test('never set → [] in /auth/me', async () => {
    const me = await api.get('/auth/me', vendorToken);
    expect(me.status).toBe(200);
    expect(me.body.data.workingHours).toEqual([]);
  });

  test('a valid week, sent alone, is stored and read back; a closed day carries no time keys', async () => {
    const res = await updateVendor({ workingHours: week() });
    expect(res.status).toBe(200);
    expect(res.body.data.workingHours).toEqual(week());
    expect(Object.keys(res.body.data.workingHours[6])).toEqual(['day', 'isOpen']);

    const me = await api.get('/auth/me', vendorToken);
    expect(me.body.data.workingHours).toEqual(week());

    const { token: adminToken } = await f.createAdmin();
    const adminRead = await api.post('/vendors/detail', { id: String(vendor._id) }, adminToken);
    expect(adminRead.body.data.workingHours).toEqual(week());

    // Not part of the public vendor shape in 4B.
    const publicRead = await api.post('/vendors/detail', { id: String(vendor._id) });
    expect(publicRead.status).toBe(200);
    expect(publicRead.body.data).not.toHaveProperty('workingHours');
  });

  test('a closed day sent with null times is stored without them', async () => {
    const res = await updateVendor({ workingHours: withDay(6, { opensAt: null, closesAt: null }) });
    expect(res.status).toBe(200);
    expect(res.body.data.workingHours[6]).toEqual({ day: 'SUN', isOpen: false });

    const raw = await Vendor.collection.findOne({ _id: vendor._id });
    expect(raw.workingHours[6]).toEqual({ day: 'SUN', isOpen: false });
    expect(raw.workingHours[0]).toEqual({ day: 'MON', isOpen: true, opensAt: '09:00', closesAt: '19:00' });
  });

  test('refused with the path: 6 days, wrong order, closes ≤ opens, times on a closed day, 9:00', async () => {
    const cases = [
      [week().slice(0, 6), 'workingHours'],
      [[...week(), week()[0]], 'workingHours'],
      [[week()[6], ...week().slice(0, 6)], 'workingHours.0.day'],
      [withDay(3, { closesAt: '09:00' }), 'workingHours.3.closesAt'],
      [withDay(3, { opensAt: '18:00', closesAt: '10:30' }), 'workingHours.3.closesAt'],
      [withDay(6, { opensAt: '10:00', closesAt: '12:00' }), 'workingHours.6.opensAt'],
      [withDay(0, { opensAt: '9:00' }), 'workingHours.0.opensAt'],
      [withDay(1, { closesAt: '24:00' }), 'workingHours.1.closesAt'],
      [withDay(2, { opensAt: undefined }), 'workingHours.2.opensAt'],
      [week().map((day, i) => (i === 4 ? { day: 'FRI', opensAt: '09:00', closesAt: '19:00' } : day)), 'workingHours.4.isOpen'],
      ['every day', 'workingHours'],
    ];
    for (const [workingHours, field] of cases) {
      const res = await updateVendor({ workingHours });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(fieldsOf(res)).toContain(field);
    }
    expect((await Vendor.findById(vendor._id)).workingHours).toHaveLength(0);
  });

  test('a missing isOpen is reported once, as itself', async () => {
    const res = await updateVendor({
      workingHours: week().map((day, i) => (i === 4 ? { day: 'FRI' } : day)),
    });
    expect(res.status).toBe(400);
    expect(fieldsOf(res)).toEqual(['workingHours.4.isOpen']);
  });
});

describe('clearing the description and the service area (/vendors/update)', () => {
  beforeEach(async () => {
    await Vendor.updateOne(
      { _id: vendor._id },
      { description: 'Wiring and fittings.', address: 'Koregaon Park, Pune' }
    );
  });

  test('"" and null are stored as ""', async () => {
    const emptied = await updateVendor({ description: '', address: '' });
    expect(emptied.status).toBe(200);
    expect(emptied.body.data).toMatchObject({ description: '', address: '' });

    await Vendor.updateOne({ _id: vendor._id }, { description: 'Again', address: 'Again' });
    const nulled = await updateVendor({ description: null, address: null });
    expect(nulled.status).toBe(200);
    expect(nulled.body.data).toMatchObject({ description: '', address: '' });
    expect(await Vendor.findById(vendor._id)).toMatchObject({ description: '', address: '' });
  });

  test('businessName stays required: "" (or only spaces) → 400', async () => {
    for (const businessName of ['', '   ']) {
      const res = await updateVendor({ businessName });
      expect(res.status).toBe(400);
      expect(fieldsOf(res)).toEqual(['businessName']);
    }
    expect((await Vendor.findById(vendor._id)).businessName).toBe(vendor.businessName);
  });

  test('a field left out is unchanged; lengths are as before', async () => {
    const res = await updateVendor({ description: 'New text' });
    expect(res.body.data).toMatchObject({ description: 'New text', address: 'Koregaon Park, Pune' });

    const tooLong = await updateVendor({ address: 'x'.repeat(201) });
    expect(tooLong.status).toBe(400);
    expect(fieldsOf(tooLong)).toEqual(['address']);
  });
});

describe('removing a customer’s email (/customers/update)', () => {
  test('a phone-verified customer: null and "" remove it — no email key anywhere', async () => {
    for (const removed of [null, '']) {
      const customer = await f.createCustomer();
      const token = f.tokenFor(customer, 'CUSTOMER');
      const res = await api.post('/customers/update', { id: String(customer._id), email: removed }, token);
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('email');

      const me = await api.get('/auth/me', token);
      expect(me.body.data).not.toHaveProperty('email');

      const raw = await Customer.collection.findOne({ _id: customer._id });
      expect(raw).not.toHaveProperty('email');
    }
    // The two customers without an email coexist under the partial unique index.
    expect(await Customer.countDocuments({ email: { $exists: false } })).toBe(2);
  });

  test('without a verified phone → 400 EMAIL_REQUIRED_FOR_SIGN_IN and nothing changes', async () => {
    const customer = await f.createCustomer({ phoneVerifiedAt: null, firstName: 'Asha' });
    const token = f.tokenFor(customer, 'CUSTOMER');
    const res = await api.post(
      '/customers/update',
      { id: String(customer._id), email: null, firstName: 'Changed' },
      token
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('EMAIL_REQUIRED_FOR_SIGN_IN');
    expect(fieldsOf(res)).toEqual(['email']);
    expect(await Customer.findById(customer._id)).toMatchObject({
      email: customer.email,
      firstName: 'Asha',
    });
  });

  test('no email stored and no verified phone: null / "" removes nothing → 200, unchanged', async () => {
    for (const removed of [null, '']) {
      const customer = await f.createCustomer({ email: undefined, phoneVerifiedAt: null });
      const token = f.tokenFor(customer, 'CUSTOMER');
      const res = await api.post(
        '/customers/update',
        { id: String(customer._id), email: removed, firstName: 'Meera' },
        token
      );
      expect(res.status).toBe(200);
      expect(res.body.data).not.toHaveProperty('email');
      expect(res.body.data.firstName).toBe('Meera');

      const raw = await Customer.collection.findOne({ _id: customer._id });
      expect(raw).not.toHaveProperty('email');
    }
  });

  test('the same rule for an administrator', async () => {
    const { token: adminToken } = await f.createAdmin();
    const unverified = await f.createCustomer({ phoneVerifiedAt: null });
    const refused = await api.post('/customers/update', { id: String(unverified._id), email: '' }, adminToken);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('EMAIL_REQUIRED_FOR_SIGN_IN');
    expect((await Customer.findById(unverified._id)).email).toBe(unverified.email);

    const verified = await f.createCustomer();
    const removed = await api.post('/customers/update', { id: String(verified._id), email: null }, adminToken);
    expect(removed.status).toBe(200);
    expect(removed.body.data).not.toHaveProperty('email');
  });

  test('an absent email is unchanged; a new one can be set after removal', async () => {
    const customer = await f.createCustomer();
    const token = f.tokenFor(customer, 'CUSTOMER');
    const kept = await api.post('/customers/update', { id: String(customer._id), firstName: 'Asha' }, token);
    expect(kept.body.data.email).toBe(customer.email);

    await api.post('/customers/update', { id: String(customer._id), email: null }, token);
    const added = await api.post('/customers/update', { id: String(customer._id), email: 'New@Example.com' }, token);
    expect(added.status).toBe(200);
    expect(added.body.data.email).toBe('new@example.com');
  });
});
