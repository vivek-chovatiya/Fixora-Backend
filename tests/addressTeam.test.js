// Optional fields (requests contract §7): address book city/state/pincode, team member phone.
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const f = require('./helpers/fixtures');
const Address = require('../src/models/address');

let customerToken;
let vendorToken;

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  customerToken = f.tokenFor(await f.createCustomer(), 'CUSTOMER');
  vendorToken = f.tokenFor(await f.createVendor(), 'VENDOR');
});

describe('address book', () => {
  test('only the address text and the title are needed to save one', async () => {
    const res = await api.post(
      '/addresses',
      { title: 'Work', addressLine1: 'Near the old bus stand, Shivaji Nagar' },
      customerToken
    );
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      title: 'Work',
      addressLine1: 'Near the old bus stand, Shivaji Nagar',
      city: '',
      state: '',
      pincode: '',
      fullAddress: 'Near the old bus stand, Shivaji Nagar',
    });
  });

  test('the title defaults to Home; the address text is still required', async () => {
    const titled = await api.post('/addresses', { addressLine1: '5 Station Road' }, customerToken);
    expect(titled.status).toBe(201);
    expect(titled.body.data.title).toBe('Home');

    const missing = await api.post('/addresses', { title: 'Home', city: 'Pune' }, customerToken);
    expect(missing.status).toBe(400);
    expect(missing.body.code).toBe('VALIDATION_FAILED');
    expect(missing.body.errors[0].field).toBe('addressLine1');
  });

  test('city, state and pincode can be cleared on update with null or an empty string', async () => {
    const created = await api.post(
      '/addresses',
      { addressLine1: '14 Lake View Road', city: 'Pune', state: 'MH', pincode: '411001' },
      customerToken
    );
    const id = created.body.data.id;
    expect(created.body.data.fullAddress).toBe('14 Lake View Road, Pune, MH - 411001');

    const nulled = await api.post('/addresses/update', { id, city: null }, customerToken);
    expect(nulled.status).toBe(200);
    expect(nulled.body.data.city).toBe('');
    expect(nulled.body.data.state).toBe('MH');

    const emptied = await api.post('/addresses/update', { id, state: '', pincode: '' }, customerToken);
    expect(emptied.status).toBe(200);
    expect(emptied.body.data).toMatchObject({ city: '', state: '', pincode: '' });
    expect(emptied.body.data.fullAddress).toBe('14 Lake View Road');

    const stored = await Address.findById(id);
    expect(stored).toMatchObject({ city: '', state: '', pincode: '' });
  });

  test('a field that is not sent is left as it was', async () => {
    const created = await api.post('/addresses', { addressLine1: '1 MG Road', city: 'Pune' }, customerToken);
    const res = await api.post('/addresses/update', { id: created.body.data.id, title: 'Office' }, customerToken);
    expect(res.body.data).toMatchObject({ title: 'Office', city: 'Pune' });
  });
});

describe('team members', () => {
  test('phone is optional on create and can be cleared on update', async () => {
    const created = await api.post('/team', { name: 'Suresh', designation: 'Electrician' }, vendorToken);
    expect(created.status).toBe(201);
    expect(created.body.data).toMatchObject({ name: 'Suresh', designation: 'Electrician', phone: '' });

    const withPhone = await api.post('/team/update', { id: created.body.data.id, phone: '9800011122' }, vendorToken);
    expect(withPhone.body.data.phone).toBe('9800011122');

    const cleared = await api.post('/team/update', { id: created.body.data.id, phone: '' }, vendorToken);
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.phone).toBe('');
  });

  test('on update phone: null clears it, and leaving phone out keeps it', async () => {
    const created = await api.post('/team', { name: 'Suresh', phone: '9800011122' }, vendorToken);
    const id = created.body.data.id;

    const untouched = await api.post('/team/update', { id, designation: 'Senior Electrician' }, vendorToken);
    expect(untouched.body.data).toMatchObject({ designation: 'Senior Electrician', phone: '9800011122' });

    const cleared = await api.post('/team/update', { id, phone: null }, vendorToken);
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.phone).toBe('');
  });

  test('the name is still required', async () => {
    const res = await api.post('/team', { designation: 'Plumber' }, vendorToken);
    expect(res.status).toBe(400);
    expect(res.body.errors[0].field).toBe('name');
  });
});
