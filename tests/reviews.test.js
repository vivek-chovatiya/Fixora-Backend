// Reviews carry the reviewed request's requestNumber beside its id (requests contract §7).
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const f = require('./helpers/fixtures');

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
});

test('creating a review and listing a vendor’s reviews both carry the requestNumber', async () => {
  const electrical = await f.createCategory();
  const customer = await f.createCustomer();
  const vendor = await f.createVendor([electrical]);
  const request = await f.createRequest(customer, electrical, {
    vendorId: vendor._id,
    status: 'COMPLETED',
    requestNumber: 'REQ-77001234',
  });

  const created = await api.post(
    '/reviews',
    { serviceRequestId: String(request._id), rating: 5, comment: 'Quick and tidy.' },
    f.tokenFor(customer, 'CUSTOMER')
  );
  expect(created.status).toBe(201);
  expect(created.body.data).toMatchObject({
    serviceRequestId: String(request._id),
    requestNumber: 'REQ-77001234',
    rating: 5,
  });

  const listed = await api.post('/reviews/vendor', { vendorId: String(vendor._id) });
  expect(listed.status).toBe(200);
  expect(listed.body.data).toHaveLength(1);
  // The id stays an id (not an object); the number sits beside it.
  expect(listed.body.data[0].serviceRequestId).toBe(String(request._id));
  expect(listed.body.data[0].requestNumber).toBe('REQ-77001234');
});

test('a review of a request that no longer exists lists with requestNumber null, not a crash', async () => {
  const Review = require('../src/models/review');
  const electrical = await f.createCategory();
  const customer = await f.createCustomer();
  const vendor = await f.createVendor([electrical]);
  await Review.create({
    serviceRequestId: '6afc0000000000000000abcd',
    customerId: customer._id,
    vendorId: vendor._id,
    rating: 4,
  });

  const listed = await api.post('/reviews/vendor', { vendorId: String(vendor._id) });
  expect(listed.status).toBe(200);
  expect(listed.body.data[0].requestNumber).toBeNull();
});
