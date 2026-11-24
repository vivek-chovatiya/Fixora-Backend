// A vendor's availability now stops new requests reaching them (Phase 4B contract §6, the app's
// acceptingRequests): no open broadcasts in their list, and they cannot be chosen on create.
// Everything already theirs carries on as before.
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const f = require('./helpers/fixtures');
const Vendor = require('../src/models/vendor');

let electrical;
let asha;
let ashaToken;
let away;
let awayToken;
let open;
let directed;
let held;

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  electrical = await f.createCategory({ name: 'Electrical' });
  asha = await f.createCustomer();
  ashaToken = f.tokenFor(asha, 'CUSTOMER');
  away = await f.createVendor([electrical]);
  awayToken = f.tokenFor(away, 'VENDOR');
  open = await f.createRequest(asha, electrical);
  directed = await f.createRequest(asha, electrical, { vendorId: away._id });
  held = await f.createRequest(asha, electrical, { vendorId: away._id, status: 'ACCEPTED' });
  await Vendor.updateOne({ _id: away._id }, { availability: false });
});

const idsOf = (res) => res.body.data.map((r) => r.id).sort();

describe('availability: false', () => {
  test('open broadcasts leave the vendor’s list; their own requests stay', async () => {
    const list = await api.post('/requests/list', {}, awayToken);
    expect(list.status).toBe(200);
    expect(idsOf(list)).toEqual([String(directed._id), String(held._id)].sort());

    // Another vendor in the category still gets the broadcast; back on, so does this one.
    const other = await f.createVendor([electrical]);
    expect(idsOf(await api.post('/requests/list', {}, f.tokenFor(other, 'VENDOR')))).toEqual([String(open._id)]);
    await Vendor.updateOne({ _id: away._id }, { availability: true });
    expect(idsOf(await api.post('/requests/list', {}, awayToken))).toContain(String(open._id));
  });

  test('a declined broadcast stays in the Rejected tab', async () => {
    await Vendor.updateOne({ _id: away._id }, { availability: true });
    await api.post('/requests/reject', { id: String(open._id) }, awayToken);
    await Vendor.updateOne({ _id: away._id }, { availability: false });
    expect(idsOf(await api.post('/requests/list', { declined: true }, awayToken))).toEqual([String(open._id)]);
  });

  test('choosing that vendor on create answers 400 on vendorId', async () => {
    const res = await api.post(
      '/requests',
      { categoryId: String(electrical._id), serviceAddress: '22 Hill Road, Mumbai', vendorId: String(away._id) },
      ashaToken
    );
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors).toEqual([
      { field: 'vendorId', message: 'This professional is not available for this service.' },
    ]);
  });

  test('held and directed work is unaffected: detail, accept, start, complete, record-payment', async () => {
    expect((await api.post('/requests/detail', { id: String(open._id) }, awayToken)).status).toBe(200);
    expect((await api.post('/requests/accept', { id: String(directed._id) }, awayToken)).status).toBe(200);

    const id = String(held._id);
    expect((await api.post('/requests/start', { id }, awayToken)).status).toBe(200);
    const done = await api.post('/requests/complete', { id, amount: 400 }, awayToken);
    expect(done.status).toBe(200);
    expect(done.body.data.payment).toMatchObject({ paymentStatus: 'PENDING' });
    const paid = await api.post('/requests/record-payment', { id, paymentStatus: 'PAID', paymentMethodId: 'CASH' }, awayToken);
    expect(paid.status).toBe(200);

    // A broadcast they reach anyway may still be accepted.
    expect((await api.post('/requests/accept', { id: String(open._id) }, awayToken)).status).toBe(200);
  });

  test('the public vendor list still returns them, with availability for the app to filter on', async () => {
    const list = await api.post('/vendors/list', {});
    expect(list.body.data.find((vendor) => String(vendor.id) === String(away._id))).toMatchObject({ availability: false });
  });
});
