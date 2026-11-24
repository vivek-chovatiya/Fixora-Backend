// The vendor's report (Phase 4B contract §5; PROJECT_BIBLE.md section 42, and section 30's Today's
// Requests): India-time windows, what each figure counts and leaves out, the new reject / decline /
// cancel timestamps, and rejectedAt as each party sees it. The clock is fixed (tests/helpers/clock.js)
// at Wednesday 25/11/2026, 15:00 in India unless a test moves it.
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const clock = require('./helpers/clock');
const f = require('./helpers/fixtures');
const Review = require('../src/models/review');
const Vendor = require('../src/models/vendor');
const ServiceRequest = require('../src/models/servicerequest');

const ist = (wallClock) => new Date(`${wallClock}+05:30`);
const NOW = '2026-11-25T15:00:00';
const TODAY = ist('2026-11-25T10:00:00');
const YESTERDAY = ist('2026-11-24T10:00:00');
const LAST_MONTH = ist('2026-10-20T10:00:00');

const freezeAt = (wallClock) => {
  clock.install();
  clock.advance(ist(wallClock).getTime() - Date.now());
};

const REPORT_KEYS = [
  'averageRating',
  'cancelledRequests',
  'completedRequests',
  'from',
  'period',
  'ratingCount',
  'rejectedRequests',
  'timeZone',
  'to',
  'totalRequests',
];

let electrical;
let plumbing;
let asha;
let ashaToken;
let v;
let vToken;
let w;
let wToken;

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  freezeAt(NOW);
  electrical = await f.createCategory({ name: 'Electrical' });
  plumbing = await f.createCategory({ name: 'Plumbing' });
  asha = await f.createCustomer();
  ashaToken = f.tokenFor(asha, 'CUSTOMER');
  v = await f.createVendor([electrical]);
  vToken = f.tokenFor(v, 'VENDOR');
  w = await f.createVendor([electrical]);
  wToken = f.tokenFor(w, 'VENDOR');
});
afterEach(() => clock.restore());

const report = async (period, token = vToken) => {
  const res = await api.post('/vendors/report', { period }, token);
  expect(res.status).toBe(200);
  return res.body.data;
};

// Mongoose sets a new document's updatedAt to its createdAt, so an older record's last change is
// written to the collection afterwards.
const requestAt = async (createdAt, { updatedAt, ...overrides } = {}) => {
  const request = await f.createRequest(asha, electrical, { createdAt, ...overrides });
  if (updatedAt) {
    await ServiceRequest.collection.updateOne({ _id: request._id }, { $set: { updatedAt } });
  }
  return request;
};

describe('POST /vendors/report: the windows, in India time', () => {
  test('today from midnight, the week from Monday, the month from the 1st; [from, to)', async () => {
    expect(await report('today')).toMatchObject({
      period: 'today',
      from: ist('2026-11-25T00:00:00').toISOString(),
      to: ist('2026-11-26T00:00:00').toISOString(),
      timeZone: 'Asia/Kolkata',
    });
    expect(await report('week')).toMatchObject({
      from: ist('2026-11-23T00:00:00').toISOString(),
      to: ist('2026-11-30T00:00:00').toISOString(),
    });
    expect(await report('month')).toMatchObject({
      from: ist('2026-11-01T00:00:00').toISOString(),
      to: ist('2026-12-01T00:00:00').toISOString(),
    });

    // Sunday night still belongs to the week that began on Monday; Monday 00:10 starts a new one.
    freezeAt('2026-11-29T23:50:00');
    expect((await report('week')).from).toBe(ist('2026-11-23T00:00:00').toISOString());
    freezeAt('2026-11-30T00:10:00');
    expect((await report('week')).from).toBe(ist('2026-11-30T00:00:00').toISOString());

    // The last minutes of a month, and of a year, are still that month.
    freezeAt('2026-12-31T23:55:00');
    expect(await report('month')).toMatchObject({
      from: ist('2026-12-01T00:00:00').toISOString(),
      to: ist('2027-01-01T00:00:00').toISOString(),
    });
    freezeAt('2027-01-01T00:05:00');
    expect((await report('month')).from).toBe(ist('2027-01-01T00:00:00').toISOString());
  });

  test('a request at 23:50 IST counts in that day, not the next', async () => {
    await requestAt(ist('2026-11-25T23:50:00'), { vendorId: v._id });

    freezeAt('2026-11-25T23:55:00');
    expect((await report('today')).totalRequests).toBe(1);

    freezeAt('2026-11-26T00:10:00');
    expect((await report('today')).totalRequests).toBe(0);
    expect((await report('week')).totalRequests).toBe(1);
  });
});

describe('POST /vendors/report: what each figure counts', () => {
  test('totalRequests: exactly what the two lists hold, created in the window, each once', async () => {
    // Counted.
    await requestAt(TODAY, { vendorId: v._id });
    await requestAt(TODAY, { vendorId: v._id, status: 'ACCEPTED' });
    await requestAt(TODAY, { vendorId: v._id, status: 'REJECTED', rejectedAt: TODAY });
    await requestAt(TODAY, { vendorId: v._id, status: 'CANCELLED', cancelledAt: TODAY });
    await requestAt(TODAY, { declinedBy: [v._id], declines: [{ vendorId: v._id, at: TODAY }] });
    await requestAt(TODAY, { declinedBy: [v._id], vendorId: w._id, status: 'ACCEPTED' });
    const waiting = await requestAt(TODAY);
    // Not counted.
    await requestAt(TODAY, { vendorId: w._id });
    await f.createRequest(asha, plumbing, { createdAt: TODAY });
    await requestAt(TODAY, { vendorId: w._id, status: 'ACCEPTED' });
    await requestAt(TODAY, { vendorId: v._id, isDeleted: true });
    await requestAt(YESTERDAY, { vendorId: v._id });

    const today = await report('today');
    expect(today.totalRequests).toBe(7);
    expect((await report('week')).totalRequests).toBe(8);

    // The same figure as the vendor's own lists, limited to today.
    const listed = [
      ...(await api.post('/requests/list', { limit: 100 }, vToken)).body.data,
      ...(await api.post('/requests/list', { limit: 100, declined: true }, vToken)).body.data,
    ].filter((r) => new Date(r.createdAt) >= new Date(today.from));
    expect(new Set(listed.map((r) => r.id)).size).toBe(7);

    // While V is not accepting requests, the open one still waiting leaves the figure.
    await Vendor.updateOne({ _id: v._id }, { availability: false });
    expect((await report('today')).totalRequests).toBe(6);
    expect(waiting.vendorId).toBeNull();
  });

  test('completedRequests: by completedAt — last month’s request finished today counts today', async () => {
    await requestAt(LAST_MONTH, { vendorId: v._id, status: 'COMPLETED', completedAt: TODAY });
    await requestAt(LAST_MONTH, { vendorId: v._id, status: 'COMPLETED', completedAt: YESTERDAY });
    await requestAt(TODAY, { vendorId: w._id, status: 'COMPLETED', completedAt: TODAY });
    await requestAt(TODAY, { vendorId: v._id, status: 'COMPLETED', completedAt: TODAY, isDeleted: true });

    expect(await report('today')).toMatchObject({ completedRequests: 1, totalRequests: 0 });
    expect(await report('week')).toMatchObject({ completedRequests: 2, totalRequests: 0 });
    expect((await report('month')).completedRequests).toBe(2);
  });

  test('rejectedRequests: directed rejects and V’s own declines, when they happened', async () => {
    const directed = await requestAt(LAST_MONTH, { vendorId: v._id });
    const open = await requestAt(LAST_MONTH);
    expect((await api.post('/requests/reject', { id: String(directed._id) }, vToken)).status).toBe(200);
    expect((await api.post('/requests/reject', { id: String(open._id) }, vToken)).status).toBe(200);
    // Another vendor's decline is not V's.
    await api.post('/requests/reject', { id: String((await requestAt(TODAY))._id) }, wToken);

    // Older records: a reject with no rejectedAt falls back to updatedAt; a decline with no
    // declines entry to the request's createdAt.
    await requestAt(LAST_MONTH, { vendorId: v._id, status: 'REJECTED', updatedAt: YESTERDAY });
    await requestAt(YESTERDAY, { declinedBy: [v._id] });

    expect(await report('today')).toMatchObject({ rejectedRequests: 2, totalRequests: 1 });
    expect((await report('week')).rejectedRequests).toBe(4);

    // The decline went in with its time, in the same update; the request is unchanged otherwise.
    const declined = await ServiceRequest.findById(open._id).lean();
    expect(declined.status).toBe('PENDING');
    expect(declined.declinedBy.map(String)).toEqual([String(v._id)]);
    expect(declined.declines).toHaveLength(1);
    expect(String(declined.declines[0].vendorId)).toBe(String(v._id));
    expect(Math.abs(declined.declines[0].at - ist(NOW))).toBeLessThan(60000);
    // Declining again adds nothing.
    await api.post('/requests/reject', { id: String(open._id) }, vToken);
    expect((await ServiceRequest.findById(open._id).lean()).declines).toHaveLength(1);
  });

  test('cancelledRequests: V’s directed requests cancelled in the window', async () => {
    const directed = await requestAt(LAST_MONTH, { vendorId: v._id });
    expect((await api.post('/requests/cancel', { id: String(directed._id) }, ashaToken)).status).toBe(200);
    const stored = await ServiceRequest.findById(directed._id).lean();
    expect(Math.abs(stored.cancelledAt - ist(NOW))).toBeLessThan(60000);

    await requestAt(LAST_MONTH, { vendorId: v._id, status: 'CANCELLED', updatedAt: TODAY });
    await requestAt(TODAY, { status: 'CANCELLED', cancelledAt: TODAY });
    await requestAt(TODAY, { vendorId: w._id, status: 'CANCELLED', cancelledAt: TODAY });
    await requestAt(LAST_MONTH, { vendorId: v._id, status: 'CANCELLED', cancelledAt: YESTERDAY });

    expect((await report('today')).cancelledRequests).toBe(2);
    expect((await report('week')).cancelledRequests).toBe(3);
  });

  test('averageRating: V’s ACTIVE reviews in the window, to one decimal; null and 0 when none', async () => {
    const job = await requestAt(LAST_MONTH, { vendorId: v._id, status: 'COMPLETED', completedAt: LAST_MONTH });
    const review = (rating, createdAt, overrides = {}) =>
      Review.create({ serviceRequestId: job._id, customerId: asha._id, vendorId: v._id, rating, createdAt, ...overrides });

    expect(await report('today')).toMatchObject({ averageRating: null, ratingCount: 0 });

    await review(5, TODAY);
    await review(4, TODAY);
    await review(4, TODAY);
    await review(1, TODAY, { status: 'INACTIVE' });
    await review(1, TODAY, { isDeleted: true });
    await review(1, TODAY, { vendorId: w._id });
    await review(2, LAST_MONTH);

    expect(await report('today')).toMatchObject({ averageRating: 4.3, ratingCount: 3 });
    expect(await report('month')).toMatchObject({ averageRating: 4.3, ratingCount: 3 });
  });

  test('an empty period is zeros and no rating, and no key holds money', async () => {
    await requestAt(TODAY, { vendorId: v._id, status: 'COMPLETED', completedAt: TODAY, amount: 950, paymentRecordedAt: TODAY });
    const data = await report('today');
    expect(Object.keys(data).sort()).toEqual(REPORT_KEYS);
    expect(data).toMatchObject({ totalRequests: 1, completedRequests: 1, rejectedRequests: 0, cancelledRequests: 0 });
    expect(JSON.stringify(data)).not.toMatch(/amount|payment|earning|950/i);

    const empty = await report('month', wToken);
    expect(empty).toMatchObject({
      totalRequests: 0,
      completedRequests: 0,
      rejectedRequests: 0,
      cancelledRequests: 0,
      averageRating: null,
      ratingCount: 0,
    });
  });

  test('another period answers 400 on period; only a vendor may ask', async () => {
    for (const body of [{ period: 'year' }, {}, { period: 'TODAY' }]) {
      const res = await api.post('/vendors/report', body, vToken);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors[0].field).toBe('period');
    }
    const { token } = await f.createAdmin();
    for (const token2 of [ashaToken, token]) {
      const res = await api.post('/vendors/report', { period: 'today' }, token2);
      expect(res.status).toBe(403);
      expect(res.body.code).toBe('FORBIDDEN');
    }
    expect((await api.post('/vendors/report', { period: 'today' })).status).toBe(401);
  });
});

describe('rejectedAt, cancelledAt and declines in request responses', () => {
  test('a directed reject: the vendor and the customer see its stored time', async () => {
    const request = await requestAt(TODAY, { vendorId: v._id });
    const res = await api.post('/requests/reject', { id: String(request._id) }, vToken);
    const rejectedAt = res.body.data.rejectedAt;
    expect(Math.abs(new Date(rejectedAt) - ist(NOW))).toBeLessThan(60000);
    expect((await ServiceRequest.findById(request._id)).rejectedAt.toISOString()).toBe(rejectedAt);

    const customer = await api.post('/requests/detail', { id: String(request._id) }, ashaToken);
    expect(customer.body.data.rejectedAt).toBe(rejectedAt);
  });

  test('a decline: only the decliner sees their own time; declines reach admins only', async () => {
    const request = await requestAt(TODAY);
    const id = String(request._id);
    const declined = await api.post('/requests/reject', { id }, vToken);
    const at = declined.body.data.rejectedAt;
    expect(Math.abs(new Date(at) - ist(NOW))).toBeLessThan(60000);
    expect((await api.post('/requests/list', { declined: true }, vToken)).body.data[0].rejectedAt).toBe(at);

    const other = await api.post('/requests/detail', { id }, wToken);
    expect(other.body.data.rejectedAt).toBeNull();
    const customer = await api.post('/requests/detail', { id }, ashaToken);
    expect(customer.body.data.rejectedAt).toBeNull();

    // Taken by W afterwards: W's own view carries no reject, and V's still carries V's decline.
    await api.post('/requests/accept', { id }, wToken);
    expect((await api.post('/requests/detail', { id }, wToken)).body.data.rejectedAt).toBeNull();
    expect((await api.post('/requests/detail', { id }, vToken)).body.data.rejectedAt).toBe(at);

    const DECLINES = /"declines"\s*:/;
    for (const res of [declined, other, customer]) expect(res.text).not.toMatch(DECLINES);
    const { token } = await f.createAdmin();
    const admin = await api.post('/requests/detail', { id }, token);
    expect(admin.body.data.declines).toEqual([{ vendorId: String(v._id), at }]);
  });

  test('a decline from before 4B has no time to show', async () => {
    const request = await requestAt(YESTERDAY, { declinedBy: [v._id] });
    const res = await api.post('/requests/detail', { id: String(request._id) }, vToken);
    expect(res.body.data).toMatchObject({ declinedByMe: true, rejectedAt: null });
  });

  test('cancelledAt is in every view of a cancelled request', async () => {
    const request = await requestAt(TODAY, { vendorId: v._id });
    const res = await api.post('/requests/cancel', { id: String(request._id) }, ashaToken);
    const cancelledAt = res.body.data.cancelledAt;
    expect(cancelledAt).toBeTruthy();
    expect((await api.post('/requests/detail', { id: String(request._id) }, vToken)).body.data.cancelledAt).toBe(cancelledAt);
    const { token } = await f.createAdmin();
    expect((await api.post('/requests/detail', { id: String(request._id) }, token)).body.data.cancelledAt).toBe(cancelledAt);

    const open = await requestAt(TODAY);
    expect((await api.post('/requests/detail', { id: String(open._id) }, vToken)).body.data).toMatchObject({
      rejectedAt: null,
      cancelledAt: null,
    });
  });
});
