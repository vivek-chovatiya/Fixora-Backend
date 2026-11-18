// Service requests: create, accept, decline/reject, start, complete, cancel, and who may see them
// (requests contract §2, §4, §5, §6; PROJECT_BIBLE.md sections 31–36).
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const f = require('./helpers/fixtures');
const Address = require('../src/models/address');
const Notification = require('../src/models/notification');
const ServiceRequest = require('../src/models/servicerequest');
const ServiceRequestTimeline = require('../src/models/timeline');

let electrical;
let plumbing;
let wiring;
let leak;
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
  plumbing = await f.createCategory({ name: 'Plumbing' });
  wiring = await f.createSubCategory(electrical);
  leak = await f.createSubCategory(plumbing);
  asha = await f.createCustomer();
  ashaToken = f.tokenFor(asha, 'CUSTOMER');
  other = await f.createCustomer({ firstName: 'Ravi' });
  otherToken = f.tokenFor(other, 'CUSTOMER');
  v1 = await f.createVendor([electrical]);
  v1Token = f.tokenFor(v1, 'VENDOR');
  v2 = await f.createVendor([electrical]);
  v2Token = f.tokenFor(v2, 'VENDOR');
});

const post = (path, body, token) => api.post(path, body, token);
const statusOf = async (request) => (await ServiceRequest.findById(request._id)).status;

describe('POST /requests (create)', () => {
  const typed = () => ({
    categoryId: String(electrical._id),
    serviceAddress: '22 Hill Road, Bandra West, Mumbai',
    serviceAddressDetails: { line1: '22 Hill Road', area: 'Bandra West', city: 'Mumbai', pincode: '400050' },
    description: 'Two sockets spark when used.',
  });

  test('a typed address is stored on the request only — no address-book write', async () => {
    const res = await post('/requests', typed(), ashaToken);

    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      status: 'PENDING',
      addressId: null,
      vendorId: null,
      subCategoryId: null,
      serviceAddress: '22 Hill Road, Bandra West, Mumbai',
      serviceAddressDetails: { line1: '22 Hill Road', area: 'Bandra West', city: 'Mumbai', pincode: '400050' },
      serviceArea: 'Bandra West',
    });
    expect(res.body.data.requestNumber).toMatch(/^REQ-/);
    expect(await Address.countDocuments()).toBe(0);
  });

  test('neither addressId nor serviceAddress answers VALIDATION_FAILED on serviceAddress', async () => {
    const res = await post('/requests', { categoryId: String(electrical._id) }, ashaToken);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors[0].field).toBe('serviceAddress');
    expect(await Address.countDocuments()).toBe(0);
  });

  test('a saved address must be the caller’s own', async () => {
    const theirs = await f.createAddress(other);
    const bad = await post('/requests', { categoryId: String(electrical._id), addressId: String(theirs._id) }, ashaToken);
    expect(bad.status).toBe(400);
    expect(bad.body.errors).toEqual([
      { field: 'addressId', message: 'This address is not in your address book.' },
    ]);

    const mine = await f.createAddress(asha);
    const ok = await post('/requests', { categoryId: String(electrical._id), addressId: String(mine._id) }, ashaToken);
    expect(ok.status).toBe(201);
    expect(ok.body.data.serviceAddress).toBe('14 Lake View Road, Flat 3B, Pune, MH - 411001');
    expect(ok.body.data.serviceArea).toBe('Pune');
    expect(await Address.countDocuments()).toBe(2);
  });

  test('the sub-category must belong to the category; none given stays none', async () => {
    const bad = await post('/requests', { ...typed(), subCategoryId: String(leak._id) }, ashaToken);
    expect(bad.status).toBe(400);
    expect(bad.body.errors[0].field).toBe('subCategoryId');

    const ok = await post('/requests', { ...typed(), subCategoryId: String(wiring._id) }, ashaToken);
    expect(ok.status).toBe(201);
    expect(ok.body.data.subCategoryId._id).toBe(String(wiring._id));
  });

  test('a preferred vendor must exist, be ACTIVE + APPROVED and offer the category', async () => {
    const plumber = await f.createVendor([plumbing]);
    const blocked = await f.createVendor([electrical], { status: 'BLOCKED' });
    const pending = await f.createVendor([electrical], { approvalStatus: 'PENDING' });

    for (const vendorId of [plumber._id, blocked._id, pending._id, 'aaaaaaaaaaaaaaaaaaaaaaaa']) {
      const res = await post('/requests', { ...typed(), vendorId: String(vendorId) }, ashaToken);
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('vendorId');
    }

    const directed = await post('/requests', { ...typed(), vendorId: String(v1._id) }, ashaToken);
    expect(directed.status).toBe(201);
    expect(directed.body.data.status).toBe('PENDING');
    expect(directed.body.data.vendorId.id).toBe(String(v1._id));
  });

  test('description is optional', async () => {
    const { description, ...rest } = typed();
    expect(description).toBeDefined();
    const omitted = await post('/requests', rest, ashaToken);
    expect(omitted.status).toBe(201);
    expect(omitted.body.data.description).toBe('');
    expect((await post('/requests', { ...rest, description: '' }, ashaToken)).status).toBe(201);
  });

  test('an unknown or inactive category answers VALIDATION_FAILED on categoryId', async () => {
    const inactive = await f.createCategory({ status: 'INACTIVE' });
    for (const categoryId of ['aaaaaaaaaaaaaaaaaaaaaaaa', String(inactive._id)]) {
      const res = await post('/requests', { ...typed(), categoryId }, ashaToken);
      expect(res.status).toBe(400);
      expect(res.body.errors[0].field).toBe('categoryId');
    }
  });

  test('only a customer may create one', async () => {
    const res = await post('/requests', typed(), v1Token);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });
});

describe('POST /requests/accept', () => {
  test('12 vendors accepting at once: exactly one 200, eleven 409 REQUEST_ALREADY_TAKEN', async () => {
    const request = await f.createRequest(asha, electrical);
    const vendors = [];
    for (let i = 0; i < 12; i += 1) vendors.push(await f.createVendor([electrical]));

    const results = await Promise.all(
      vendors.map((vendor) => post('/requests/accept', { id: String(request._id) }, f.tokenFor(vendor, 'VENDOR')))
    );

    const winners = results.filter((r) => r.status === 200);
    expect(winners).toHaveLength(1);
    const losers = results.filter((r) => r.status !== 200);
    expect(losers).toHaveLength(11);
    for (const res of losers) {
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('REQUEST_ALREADY_TAKEN');
    }

    const stored = await ServiceRequest.findById(request._id);
    expect(stored.status).toBe('ACCEPTED');
    expect(String(stored.vendorId)).toBe(winners[0].body.data.vendorId.id);
    expect(await ServiceRequestTimeline.countDocuments({ serviceRequestId: request._id, status: 'ACCEPTED' })).toBe(1);
  });

  test('a directed request accepted by another vendor answers 409 REQUEST_ALREADY_TAKEN', async () => {
    const request = await f.createRequest(asha, electrical, { vendorId: v1._id });
    const res = await post('/requests/accept', { id: String(request._id) }, v2Token);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('REQUEST_ALREADY_TAKEN');
    expect(await statusOf(request)).toBe('PENDING');

    expect((await post('/requests/accept', { id: String(request._id) }, v1Token)).status).toBe(200);
  });

  test('accepting again is idempotent; once started it is REQUEST_NOT_PENDING', async () => {
    const request = await f.createRequest(asha, electrical);
    const first = await post('/requests/accept', { id: String(request._id) }, v1Token);
    const again = await post('/requests/accept', { id: String(request._id) }, v1Token);
    expect(first.status).toBe(200);
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe('ACCEPTED');

    await post('/requests/start', { id: String(request._id) }, v1Token);
    const late = await post('/requests/accept', { id: String(request._id) }, v1Token);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('REQUEST_NOT_PENDING');
  });

  test('a cancelled or rejected request answers 409 REQUEST_NOT_PENDING', async () => {
    const cancelled = await f.createRequest(asha, electrical, { status: 'CANCELLED' });
    const rejected = await f.createRequest(asha, electrical, { vendorId: v1._id, status: 'REJECTED' });
    for (const request of [cancelled, rejected]) {
      const res = await post('/requests/accept', { id: String(request._id) }, v1Token);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('REQUEST_NOT_PENDING');
    }
  });

  test('a vendor who is not APPROVED or does not offer the category gets 403 FORBIDDEN', async () => {
    const request = await f.createRequest(asha, electrical);
    const plumber = await f.createVendor([plumbing]);
    const pending = await f.createVendor([electrical], { approvalStatus: 'PENDING' });

    for (const vendor of [plumber, pending]) {
      const res = await post('/requests/accept', { id: String(request._id) }, f.tokenFor(vendor, 'VENDOR'));
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    expect(await statusOf(request)).toBe('PENDING');
  });

  test('a suspended vendor’s session has ended: 401 UNAUTHORIZED (contract §8)', async () => {
    const request = await f.createRequest(asha, electrical);
    const blocked = await f.createVendor([electrical], { status: 'BLOCKED' });
    const res = await post('/requests/accept', { id: String(request._id) }, f.tokenFor(blocked, 'VENDOR'));
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('UNAUTHORIZED');
    expect(await statusOf(request)).toBe('PENDING');
  });

  test('an unknown request answers 404 REQUEST_NOT_FOUND', async () => {
    const res = await post('/requests/accept', { id: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, v1Token);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('REQUEST_NOT_FOUND');
  });

  test('only vendors may accept', async () => {
    const request = await f.createRequest(asha, electrical);
    expect((await post('/requests/accept', { id: String(request._id) }, ashaToken)).status).toBe(403);
  });
});

describe('POST /requests/reject', () => {
  test('a directed request is rejected back to the customer', async () => {
    const request = await f.createRequest(asha, electrical, { vendorId: v1._id });
    const res = await post('/requests/reject', { id: String(request._id), note: 'Fully booked.' }, v1Token);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('REJECTED');
    expect(await ServiceRequestTimeline.exists({ serviceRequestId: request._id, status: 'REJECTED', note: 'Fully booked.' })).toBeTruthy();

    const seen = await post('/requests/detail', { id: String(request._id) }, ashaToken);
    expect(seen.body.data.status).toBe('REJECTED');

    const again = await post('/requests/reject', { id: String(request._id) }, v1Token);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('REQUEST_NOT_PENDING');
  });

  test('declining a broadcast hides it from that vendor only; it stays PENDING', async () => {
    const request = await f.createRequest(asha, electrical);
    const id = String(request._id);

    const declined = await post('/requests/reject', { id }, v1Token);
    expect(declined.status).toBe(200);
    expect(declined.body.data.status).toBe('PENDING');
    expect(declined.body.data.declined).toBe(true);
    expect(await statusOf(request)).toBe('PENDING');
    // The request itself did not change, so the customer's timeline does not say it did.
    expect(await ServiceRequestTimeline.countDocuments({ serviceRequestId: request._id })).toBe(0);

    const v1List = await post('/requests/list', {}, v1Token);
    expect(v1List.body.data.map((r) => String(r.id))).not.toContain(id);
    const v2List = await post('/requests/list', {}, v2Token);
    expect(v2List.body.data.map((r) => String(r.id))).toContain(id);

    // Amended §2: the decliner may still read it (read-only, area only) for their Rejected tab.
    const readable = await post('/requests/detail', { id }, v1Token);
    expect(readable.status).toBe(200);
    expect(readable.body.data).toMatchObject({ declined: true, status: 'PENDING', addressId: null });
    expect(readable.body.data.serviceAddress).toBe('Koregaon Park');

    const declinedList = await post('/requests/list', { declined: true }, v1Token);
    expect(declinedList.body.data.map((r) => String(r.id))).toEqual([id]);
    expect(declinedList.body.data[0].declined).toBe(true);
    expect((await post('/requests/list', { declined: true }, v2Token)).body.data).toEqual([]);

    // Idempotent and read-only: the decliner cannot accept it; another vendor still can.
    expect((await post('/requests/reject', { id }, v1Token)).status).toBe(200);
    const late = await post('/requests/accept', { id }, v1Token);
    expect(late.status).toBe(409);
    expect(late.body.code).toBe('REQUEST_NOT_PENDING');
    expect((await post('/requests/accept', { id }, v2Token)).status).toBe(200);

    // Once a competitor holds it, the decliner can still read it, but never sees who won.
    const afterWon = await post('/requests/detail', { id }, v1Token);
    expect(afterWon.status).toBe(200);
    expect(afterWon.body.data).toMatchObject({ status: 'ACCEPTED', vendorId: null, declined: true });
    expect(afterWon.text).not.toContain(String(v2._id));
  });

  test('a request held by another vendor answers REQUEST_NOT_PENDING; one directed to another, 404', async () => {
    const held = await f.createRequest(asha, electrical, { vendorId: v2._id, status: 'ACCEPTED' });
    const heldRes = await post('/requests/reject', { id: String(held._id) }, v1Token);
    expect(heldRes.status).toBe(409);
    expect(heldRes.body.code).toBe('REQUEST_NOT_PENDING');

    const directed = await f.createRequest(asha, electrical, { vendorId: v2._id });
    const directedRes = await post('/requests/reject', { id: String(directed._id) }, v1Token);
    expect(directedRes.status).toBe(404);
    expect(directedRes.body.code).toBe('REQUEST_NOT_FOUND');
    expect(await statusOf(directed)).toBe('PENDING');
  });
});

describe('POST /requests/start and /requests/complete', () => {
  test('the holder moves ACCEPTED → IN_PROGRESS → COMPLETED, with timeline entries', async () => {
    const request = await f.createRequest(asha, electrical);
    const id = String(request._id);
    await post('/requests/accept', { id }, v1Token);

    const started = await post('/requests/start', { id }, v1Token);
    expect(started.status).toBe(200);
    expect(started.body.data.status).toBe('IN_PROGRESS');

    const completed = await post('/requests/complete', { id, amount: 650, note: 'Replaced capacitor.' }, v1Token);
    expect(completed.status).toBe(200);
    expect(completed.body.data).toMatchObject({ status: 'COMPLETED', amount: 650 });
    expect(completed.body.data.completedAt).toBeTruthy();

    const statuses = (await ServiceRequestTimeline.find({ serviceRequestId: request._id }).sort({ timestamp: 1 })).map((t) => t.status);
    expect(statuses).toEqual(['ACCEPTED', 'IN_PROGRESS', 'COMPLETED']);
  });

  test('from the wrong status: 409 INVALID_TRANSITION', async () => {
    const open = await f.createRequest(asha, electrical);
    const openStart = await post('/requests/start', { id: String(open._id) }, v1Token);
    expect(openStart.status).toBe(409);
    expect(openStart.body.code).toBe('INVALID_TRANSITION');

    const accepted = await f.createRequest(asha, electrical, { vendorId: v1._id, status: 'ACCEPTED' });
    const early = await post('/requests/complete', { id: String(accepted._id) }, v1Token);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('INVALID_TRANSITION');

    await post('/requests/start', { id: String(accepted._id) }, v1Token);
    const twice = await post('/requests/start', { id: String(accepted._id) }, v1Token);
    expect(twice.body.code).toBe('INVALID_TRANSITION');
  });

  test('a vendor who does not hold it gets 404; an admin cannot complete it', async () => {
    const held = await f.createRequest(asha, electrical, { vendorId: v1._id, status: 'IN_PROGRESS' });
    for (const path of ['/requests/start', '/requests/complete']) {
      const res = await post(path, { id: String(held._id) }, v2Token);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('REQUEST_NOT_FOUND');
    }
    const { token } = await f.createAdmin();
    expect((await post('/requests/complete', { id: String(held._id) }, token)).status).toBe(403);
    expect(await statusOf(held)).toBe('IN_PROGRESS');
  });
});

describe('POST /requests/assign', () => {
  test('only the holder, only their own team member, only before work starts', async () => {
    const request = await f.createRequest(asha, electrical, { vendorId: v1._id, status: 'ACCEPTED' });
    const mine = await f.createTeamMember(v1);
    const theirs = await f.createTeamMember(v2);
    const id = String(request._id);

    const foreign = await post('/requests/assign', { id, assignedTeamMemberId: String(theirs._id) }, v1Token);
    expect(foreign.status).toBe(400);
    expect(foreign.body.errors[0].field).toBe('assignedTeamMemberId');

    expect((await post('/requests/assign', { id, assignedTeamMemberId: String(theirs._id) }, v2Token)).status).toBe(404);

    const ok = await post('/requests/assign', { id, assignedTeamMemberId: String(mine._id) }, v1Token);
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe('ASSIGNED');

    await post('/requests/start', { id }, v1Token);
    const late = await post('/requests/assign', { id, assignedTeamMemberId: String(mine._id) }, v1Token);
    expect(late.body.code).toBe('INVALID_TRANSITION');
  });
});

describe('POST /requests/cancel', () => {
  test('the customer cancels while PENDING; the directed vendor is told', async () => {
    const request = await f.createRequest(asha, electrical, { vendorId: v1._id });
    const res = await post('/requests/cancel', { id: String(request._id), reason: 'Fixed it myself.' }, ashaToken);

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('CANCELLED');
    expect(res.body.data.timeline.map((t) => t.status)).toEqual(['CANCELLED']);
    expect(res.body.data.timeline[0].note).toBe('Fixed it myself.');
    expect(await Notification.exists({ userId: v1._id, userRole: 'VENDOR', referenceId: request._id })).toBeTruthy();

    // The same shape as /requests/detail.
    const detail = await post('/requests/detail', { id: String(request._id) }, ashaToken);
    expect(Object.keys(res.body.data).sort()).toEqual(Object.keys(detail.body.data).sort());
  });

  test('cancelling again is idempotent', async () => {
    const request = await f.createRequest(asha, electrical);
    await post('/requests/cancel', { id: String(request._id) }, ashaToken);
    const again = await post('/requests/cancel', { id: String(request._id) }, ashaToken);
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe('CANCELLED');
    expect(await ServiceRequestTimeline.countDocuments({ serviceRequestId: request._id })).toBe(1);
  });

  test('once a vendor accepted it: 409 REQUEST_NOT_CANCELLABLE', async () => {
    for (const status of ['ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'REJECTED']) {
      const request = await f.createRequest(asha, electrical, { vendorId: v1._id, status });
      const res = await post('/requests/cancel', { id: String(request._id) }, ashaToken);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('REQUEST_NOT_CANCELLABLE');
    }
  });

  test('another customer’s request answers 404; a vendor may not cancel', async () => {
    const request = await f.createRequest(asha, electrical);
    const res = await post('/requests/cancel', { id: String(request._id) }, otherToken);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('REQUEST_NOT_FOUND');
    expect((await post('/requests/cancel', { id: String(request._id) }, v1Token)).status).toBe(403);
    expect(await statusOf(request)).toBe('PENDING');
  });
});

describe('who may see a request', () => {
  test('a customer sees only their own', async () => {
    const mine = await f.createRequest(asha, electrical);
    const theirs = await f.createRequest(other, electrical);

    const res = await post('/requests/detail', { id: String(theirs._id) }, ashaToken);
    expect(res.status).toBe(404);
    expect(res.body.code).toBe('REQUEST_NOT_FOUND');

    const list = await post('/requests/list', {}, ashaToken);
    expect(list.body.data.map((r) => String(r.id))).toEqual([String(mine._id)]);
  });

  test('a vendor sees their own and open broadcasts, never another vendor’s', async () => {
    const open = await f.createRequest(asha, electrical);
    const directedToMe = await f.createRequest(asha, electrical, { vendorId: v1._id });
    const directedToOther = await f.createRequest(asha, electrical, { vendorId: v2._id });
    const heldByOther = await f.createRequest(asha, electrical, { vendorId: v2._id, status: 'ACCEPTED' });
    const cancelledOpen = await f.createRequest(asha, electrical, { status: 'CANCELLED' });

    for (const request of [open, directedToMe]) {
      expect((await post('/requests/detail', { id: String(request._id) }, v1Token)).status).toBe(200);
    }
    for (const request of [directedToOther, heldByOther, cancelledOpen]) {
      const res = await post('/requests/detail', { id: String(request._id) }, v1Token);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('REQUEST_NOT_FOUND');
    }

    const list = await post('/requests/list', {}, v1Token);
    expect(list.body.data.map((r) => String(r.id)).sort()).toEqual([String(open._id), String(directedToMe._id)].sort());
  });

  test('an admin sees every request', async () => {
    const { token } = await f.createAdmin();
    const held = await f.createRequest(asha, electrical, { vendorId: v2._id, status: 'ACCEPTED' });
    expect((await post('/requests/detail', { id: String(held._id) }, token)).status).toBe(200);
    expect((await post('/requests/list', {}, token)).body.data).toHaveLength(1);
  });
});

describe('open broadcasts reach only vendors who offer the category (contract §2, bible §31)', () => {
  test('list and detail leave out open broadcasts in categories the vendor does not offer', async () => {
    const plumber = await f.createVendor([plumbing]);
    const plumberToken = f.tokenFor(plumber, 'VENDOR');
    const electricalJob = await f.createRequest(asha, electrical);
    const plumbingJob = await f.createRequest(asha, plumbing);

    const electricianList = await post('/requests/list', {}, v1Token);
    expect(electricianList.body.data.map((r) => String(r.id))).toEqual([String(electricalJob._id)]);
    const plumberList = await post('/requests/list', {}, plumberToken);
    expect(plumberList.body.data.map((r) => String(r.id))).toEqual([String(plumbingJob._id)]);

    const outside = await post('/requests/detail', { id: String(plumbingJob._id) }, v1Token);
    expect(outside.status).toBe(404);
    expect(outside.body.code).toBe('REQUEST_NOT_FOUND');
    expect((await post('/requests/detail', { id: String(electricalJob._id) }, v1Token)).status).toBe(200);

    // Accept was already category-checked.
    expect((await post('/requests/accept', { id: String(plumbingJob._id) }, v1Token)).status).toBe(403);
  });

  test('a request directed to a vendor stays theirs even outside their categories', async () => {
    const directed = await f.createRequest(asha, plumbing, { vendorId: v1._id });
    expect((await post('/requests/detail', { id: String(directed._id) }, v1Token)).status).toBe(200);
    const list = await post('/requests/list', {}, v1Token);
    expect(list.body.data.map((r) => String(r.id))).toEqual([String(directed._id)]);
  });

  test('a vendor with no categories sees no open broadcasts', async () => {
    const bare = await f.createVendor([]);
    await f.createRequest(asha, electrical);
    expect((await post('/requests/list', {}, f.tokenFor(bare, 'VENDOR'))).body.data).toEqual([]);
  });
});

describe('declinedByMe, and the declinedBy array never leaving admin views', () => {
  test('vendors get declinedByMe in list and detail; no vendor or customer response carries declinedBy', async () => {
    const request = await f.createRequest(asha, electrical);
    const id = String(request._id);
    await post('/requests/reject', { id }, v1Token);

    const v1Detail = await post('/requests/detail', { id }, v1Token);
    expect(v1Detail.body.data.declinedByMe).toBe(true);
    const v2Detail = await post('/requests/detail', { id }, v2Token);
    expect(v2Detail.body.data.declinedByMe).toBe(false);
    const v1Declined = await post('/requests/list', { declined: true }, v1Token);
    expect(v1Declined.body.data[0].declinedByMe).toBe(true);
    const v2List = await post('/requests/list', {}, v2Token);
    expect(v2List.body.data[0].declinedByMe).toBe(false);

    const customerDetail = await post('/requests/detail', { id }, ashaToken);
    const customerList = await post('/requests/list', {}, ashaToken);
    expect(customerDetail.body.data.declinedByMe).toBeUndefined();
    const accepted = await post('/requests/accept', { id }, v2Token);

    const DECLINED_BY = /"declinedBy"\s*:/;
    for (const res of [v1Detail, v2Detail, v1Declined, v2List, customerDetail, customerList, accepted]) {
      expect(res.text).not.toMatch(DECLINED_BY);
      expect(res.text).not.toContain(String(v1._id));
    }

    // Admins still see the array.
    const { token } = await f.createAdmin();
    const adminDetail = await post('/requests/detail', { id }, token);
    expect(adminDetail.body.data.declinedBy.map(String)).toEqual([String(v1._id)]);
  });
});
