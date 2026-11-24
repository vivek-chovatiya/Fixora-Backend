// The words of every notification a request change sends (Phase 4B contract §8): exactly the new
// titles and bodies, with the reference, the service and the business filled in, and no emoji.
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const f = require('./helpers/fixtures');
const Notification = require('../src/models/notification');
const Vendor = require('../src/models/vendor');
const ServiceRequest = require('../src/models/servicerequest');

const EMOJI = /\p{Extended_Pictographic}/u;

let electrical;
let wiring;
let asha;
let ashaToken;
let kumar;
let kumarToken;

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  electrical = await f.createCategory({ name: 'Electrical' });
  wiring = await f.createSubCategory(electrical, { name: 'Switch & Socket Repair' });
  asha = await f.createCustomer();
  ashaToken = f.tokenFor(asha, 'CUSTOMER');
  kumar = await f.createVendor([electrical], { businessName: 'Kumar Electricals' });
  kumarToken = f.tokenFor(kumar, 'VENDOR');
});

const create = (extra = {}) =>
  api.post(
    '/requests',
    { categoryId: String(electrical._id), serviceAddress: '22 Hill Road, Mumbai', ...extra },
    ashaToken
  );

// The newest notification about this request to an account of this role.
const latest = async (requestId, userRole) => {
  const found = await Notification.find({ referenceId: requestId, userRole }).sort({ createdAt: -1, _id: -1 }).lean();
  return found[0];
};

const expectWords = (notification, title, message) => {
  expect(notification).toMatchObject({ title, message, type: 'SERVICE_REQUEST' });
  expect(EMOJI.test(notification.title)).toBe(false);
  expect(EMOJI.test(notification.message)).toBe(false);
};

describe('the eight request notifications', () => {
  test('1 create, directed — and 3 accept, 5 assign, 6 start, 7 complete to the customer', async () => {
    const created = await create({ subCategoryId: String(wiring._id), vendorId: String(kumar._id) });
    const { id, requestNumber: ref } = created.body.data;
    expectWords(
      await latest(id, 'CUSTOMER'),
      'Request received',
      `We have received your Switch & Socket Repair request ${ref} and sent it to Kumar Electricals.`
    );

    await api.post('/requests/accept', { id }, kumarToken);
    expectWords(await latest(id, 'CUSTOMER'), 'Request accepted', `Kumar Electricals accepted your Switch & Socket Repair request ${ref}.`);

    const member = await f.createTeamMember(kumar);
    await api.post('/requests/assign', { id, assignedTeamMemberId: String(member._id) }, kumarToken);
    expectWords(
      await latest(id, 'CUSTOMER'),
      'Team member assigned',
      `Kumar Electricals assigned a team member to your Switch & Socket Repair request ${ref}.`
    );

    await api.post('/requests/start', { id }, kumarToken);
    expectWords(await latest(id, 'CUSTOMER'), 'Work started', `Kumar Electricals started work on your Switch & Socket Repair request ${ref}.`);

    await api.post('/requests/complete', { id, amount: 499 }, kumarToken);
    expectWords(
      await latest(id, 'CUSTOMER'),
      'Work completed',
      `Kumar Electricals marked your Switch & Socket Repair request ${ref} as complete. You can now rate the work.`
    );

    // Recording the payment later sends nothing (the status did not change).
    const before = await Notification.countDocuments();
    await api.post('/requests/record-payment', { id, paymentStatus: 'PAID', paymentMethodId: 'UPI' }, kumarToken);
    expect(await Notification.countDocuments()).toBe(before);
    // And nobody notified the vendor when they were chosen.
    expect(await Notification.countDocuments({ userRole: 'VENDOR' })).toBe(0);
  });

  test('2 create, open — the category’s name when there is no sub-category', async () => {
    const created = await create();
    const { id, requestNumber: ref } = created.body.data;
    expectWords(
      await latest(id, 'CUSTOMER'),
      'Request received',
      `We have received your Electrical request ${ref}. We will let you know when a professional accepts it.`
    );
  });

  test('4 reject, directed', async () => {
    const created = await create({ subCategoryId: String(wiring._id), vendorId: String(kumar._id) });
    const { id, requestNumber: ref } = created.body.data;
    await api.post('/requests/reject', { id }, kumarToken);
    expectWords(
      await latest(id, 'CUSTOMER'),
      'Request not accepted',
      `Kumar Electricals did not accept your Switch & Socket Repair request ${ref}.`
    );
  });

  test('8 cancel, directed — to the vendor', async () => {
    const created = await create({ vendorId: String(kumar._id) });
    const { id, requestNumber: ref } = created.body.data;
    await api.post('/requests/cancel', { id }, ashaToken);
    const notification = await latest(id, 'VENDOR');
    expect(String(notification.userId)).toBe(String(kumar._id));
    expectWords(notification, 'Request cancelled', `The customer cancelled their Electrical request ${ref}.`);
  });

  test('a business name that cannot be read becomes "Your professional"; the change still stands', async () => {
    const request = await f.createRequest(asha, electrical, { vendorId: kumar._id, status: 'ACCEPTED' });
    await Vendor.updateOne({ _id: kumar._id }, { $unset: { businessName: '' } });
    const res = await api.post('/requests/start', { id: String(request._id) }, kumarToken);
    expect(res.status).toBe(200);
    expect((await ServiceRequest.findById(request._id)).status).toBe('IN_PROGRESS');
    expectWords(
      await latest(request._id, 'CUSTOMER'),
      'Work started',
      `Your professional started work on your Electrical request ${request.requestNumber}.`
    );
  });
});
