// Completing work and the offline payment record (Phase 4B contract §4; PROJECT_BIBLE.md sections
// 36–37, amended 21/10/2026): the completion body's rules, the one later "paid", the configured
// methods, and what each party sees of the record.
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const f = require('./helpers/fixtures');
const Notification = require('../src/models/notification');
const ServiceRequest = require('../src/models/servicerequest');
const ServiceRequestTimeline = require('../src/models/timeline');

let electrical;
let asha;
let ashaToken;
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
  asha = await f.createCustomer({ profileImage: '/uploads/profile/0123456789abcdef0123456789abcdef.jpg' });
  ashaToken = f.tokenFor(asha, 'CUSTOMER');
  v1 = await f.createVendor([electrical]);
  v1Token = f.tokenFor(v1, 'VENDOR');
  v2 = await f.createVendor([electrical]);
  v2Token = f.tokenFor(v2, 'VENDOR');
});

const post = (path, body, token) => api.post(path, body, token);
const inProgress = () => f.createRequest(asha, electrical, { vendorId: v1._id, status: 'IN_PROGRESS' });
const NOTES = 'Customer asked for the old switch to be left behind.';

describe('POST /requests/complete with a payment record', () => {
  test('{ id, amount } alone records "not paid yet"; the top-level fields stay as before', async () => {
    const request = await inProgress();
    const res = await post('/requests/complete', { id: String(request._id), amount: 499 }, v1Token);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'COMPLETED', amount: 499, paymentStatus: 'PENDING', paymentMode: 'CASH' });
    expect(Object.keys(res.body.data.payment).sort()).toEqual(['currency', 'finalAmount', 'paymentStatus', 'recordedAt']);
    expect(res.body.data.payment).toMatchObject({ finalAmount: 499, currency: 'INR', paymentStatus: 'PENDING' });
    expect(new Date(res.body.data.payment.recordedAt).getTime()).toBe(new Date(res.body.data.completedAt).getTime());

    const stored = await ServiceRequest.findById(request._id);
    expect(stored).toMatchObject({ currency: 'INR', paymentStatus: 'PENDING', completionNotes: '', paidAt: null, paymentMethodLabel: null });
    expect(stored.paymentRecordedAt).toBeInstanceOf(Date);
  });

  test('PAID with UPI carries the method, its label and when it was paid; rupees keep two decimals', async () => {
    const request = await inProgress();
    const res = await post(
      '/requests/complete',
      { id: String(request._id), amount: 499.5, currency: 'INR', paymentStatus: 'PAID', paymentMethodId: 'UPI', completionNotes: `  ${NOTES}  ` },
      v1Token
    );

    expect(res.status).toBe(200);
    expect(res.body.data.payment).toEqual({
      finalAmount: 499.5,
      currency: 'INR',
      paymentStatus: 'PAID',
      paymentMethodId: 'UPI',
      paymentMethodLabel: 'UPI',
      completionNotes: NOTES,
      recordedAt: expect.any(String),
      paidAt: expect.any(String),
    });
    expect(res.body.data).toMatchObject({ amount: 499.5, paymentStatus: 'PAID', paymentMode: 'UPI' });
  });

  test('no amount and no payment field completes with no record, as before 4B', async () => {
    // Whitespace-only notes are trimmed to none, so they are not a payment field either.
    const bodies = [{}, { amount: 0 }, { completionNotes: '' }, { amount: 0, completionNotes: '   ' }, { completionNotes: '   ' }];
    for (const body of bodies) {
      const request = await inProgress();
      const res = await post('/requests/complete', { id: String(request._id), ...body }, v1Token);
      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('COMPLETED');
      expect(res.body.data.payment).toBeNull();
      expect((await ServiceRequest.findById(request._id)).paymentRecordedAt).toBeNull();
    }
  });

  test('each refused body answers 400 on its own field and completes nothing', async () => {
    const cases = [
      [{ amount: 499, paymentStatus: 'PAID' }, 'paymentMethodId'],
      [{ amount: 499, paymentStatus: 'PENDING', paymentMethodId: 'CASH' }, 'paymentMethodId'],
      [{ amount: 499, paymentMethodId: 'CASH' }, 'paymentMethodId'],
      [{ amount: 499, paymentStatus: 'PAID', paymentMethodId: 'CHEQUE' }, 'paymentMethodId'],
      [{ amount: 499, paymentStatus: 'PAID', paymentMethodId: 'ONLINE' }, 'paymentMethodId'],
      [{ amount: 499, currency: 'USD' }, 'currency'],
      [{ amount: 0, paymentStatus: 'PENDING' }, 'amount'],
      [{ completionNotes: NOTES }, 'amount'],
      [{ amount: 10.555 }, 'amount'],
      [{ amount: 1000000.01 }, 'amount'],
      [{ amount: -5 }, 'amount'],
      [{ amount: 499, completionNotes: 'x'.repeat(501) }, 'completionNotes'],
      [{ amount: 499, paymentStatus: 'REFUNDED' }, 'paymentStatus'],
    ];
    const request = await inProgress();
    for (const [body, field] of cases) {
      const res = await post('/requests/complete', { id: String(request._id), ...body }, v1Token);
      expect({ body, status: res.status, code: res.body.code }).toEqual({ body, status: 400, code: 'VALIDATION_FAILED' });
      expect(res.body.errors.map((e) => e.field)).toEqual([field]);
    }
    expect((await ServiceRequest.findById(request._id)).status).toBe('IN_PROGRESS');

    // The limits themselves are accepted, and the amount is stored exactly as sent.
    const max = await post('/requests/complete', { id: String(request._id), amount: 1000000, paymentStatus: 'PAID', paymentMethodId: 'BANK_TRANSFER' }, v1Token);
    expect(max.status).toBe(200);
    expect(max.body.data.payment).toMatchObject({ finalAmount: 1000000, paymentMethodLabel: 'Bank transfer' });
  });

  test('answers in order: 400 for the body, then 404, then 409', async () => {
    const theirs = await f.createRequest(asha, electrical, { vendorId: v2._id, status: 'IN_PROGRESS' });
    const bad = await post('/requests/complete', { id: String(theirs._id), amount: 10.555 }, v1Token);
    expect(bad.status).toBe(400);
    const hidden = await post('/requests/complete', { id: String(theirs._id), amount: 499 }, v1Token);
    expect(hidden.status).toBe(404);
    expect(hidden.body.code).toBe('REQUEST_NOT_FOUND');

    const accepted = await f.createRequest(asha, electrical, { vendorId: v1._id, status: 'ACCEPTED' });
    const early = await post('/requests/complete', { id: String(accepted._id), amount: 499 }, v1Token);
    expect(early.status).toBe(409);
    expect(early.body.code).toBe('INVALID_TRANSITION');
    expect((await ServiceRequest.findById(accepted._id)).paymentRecordedAt).toBeNull();
  });
});

describe('POST /requests/record-payment', () => {
  const completeUnpaid = async () => {
    const request = await inProgress();
    await post('/requests/complete', { id: String(request._id), amount: 650, completionNotes: NOTES }, v1Token);
    return ServiceRequest.findById(request._id);
  };

  test('"not paid yet" becomes "paid" once; amount, currency, notes and completedAt never move', async () => {
    const before = await completeUnpaid();
    const id = String(before._id);
    const timelineBefore = await ServiceRequestTimeline.countDocuments({ serviceRequestId: before._id });
    const notificationsBefore = await Notification.countDocuments();

    const res = await post('/requests/record-payment', { id, paymentStatus: 'PAID', paymentMethodId: 'CASH' }, v1Token);
    expect(res.status).toBe(200);
    expect(res.body.data.payment).toEqual({
      finalAmount: 650,
      currency: 'INR',
      paymentStatus: 'PAID',
      paymentMethodId: 'CASH',
      paymentMethodLabel: 'Cash',
      completionNotes: NOTES,
      recordedAt: before.paymentRecordedAt.toISOString(),
      paidAt: expect.any(String),
    });
    // The same shape /requests/detail gives this vendor.
    const detail = await post('/requests/detail', { id }, v1Token);
    expect(Object.keys(res.body.data).sort()).toEqual(Object.keys(detail.body.data).sort());

    const after = await ServiceRequest.findById(id);
    expect(after).toMatchObject({ amount: 650, currency: 'INR', completionNotes: NOTES, status: 'COMPLETED', paymentMode: 'CASH' });
    expect(after.completedAt.getTime()).toBe(before.completedAt.getTime());
    expect(after.paymentRecordedAt.getTime()).toBe(before.paymentRecordedAt.getTime());
    expect(await ServiceRequestTimeline.countDocuments({ serviceRequestId: before._id })).toBe(timelineBefore);
    expect(await Notification.countDocuments()).toBe(notificationsBefore);

    // Again, with another method: refused, and the first method stands.
    const again = await post('/requests/record-payment', { id, paymentStatus: 'PAID', paymentMethodId: 'UPI' }, v1Token);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('PAYMENT_ALREADY_RECORDED');
    expect(await ServiceRequest.findById(id)).toMatchObject({ paymentMode: 'CASH', paymentMethodLabel: 'Cash' });
  });

  test('two presses together: exactly one 200 and one 409 PAYMENT_ALREADY_RECORDED', async () => {
    const request = await completeUnpaid();
    const id = String(request._id);
    const results = await Promise.all([
      post('/requests/record-payment', { id, paymentStatus: 'PAID', paymentMethodId: 'UPI' }, v1Token),
      post('/requests/record-payment', { id, paymentStatus: 'PAID', paymentMethodId: 'CARD' }, v1Token),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const loser = results.find((r) => r.status === 409);
    expect(loser.body.code).toBe('PAYMENT_ALREADY_RECORDED');
    const winner = results.find((r) => r.status === 200);
    expect((await ServiceRequest.findById(id)).paymentMode).toBe(winner.body.data.payment.paymentMethodId);
  });

  test('not completed, or completed with no record: 409 INVALID_TRANSITION', async () => {
    const working = await inProgress();
    const noRecord = await f.createRequest(asha, electrical, { vendorId: v1._id, status: 'COMPLETED', amount: 300, completedAt: new Date() });
    for (const request of [working, noRecord]) {
      const res = await post('/requests/record-payment', { id: String(request._id), paymentStatus: 'PAID', paymentMethodId: 'CASH' }, v1Token);
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('INVALID_TRANSITION');
      expect((await ServiceRequest.findById(request._id)).paymentStatus).toBe('PENDING');
    }
  });

  test('another vendor gets 404, a customer 403, and the fixed fields cannot be sent', async () => {
    const request = await completeUnpaid();
    const id = String(request._id);
    const body = { id, paymentStatus: 'PAID', paymentMethodId: 'CASH' };

    const other = await post('/requests/record-payment', body, v2Token);
    expect(other.status).toBe(404);
    expect(other.body.code).toBe('REQUEST_NOT_FOUND');
    expect((await post('/requests/record-payment', body, ashaToken)).status).toBe(403);

    for (const [extra, field] of [
      [{ amount: 700 }, 'amount'],
      [{ currency: 'INR' }, 'currency'],
      [{ completionNotes: 'x' }, 'completionNotes'],
      [{ note: 'x' }, 'note'],
      [{ paymentStatus: 'PENDING' }, 'paymentStatus'],
      [{ paymentMethodId: 'ONLINE' }, 'paymentMethodId'],
    ]) {
      const res = await post('/requests/record-payment', { ...body, ...extra }, v1Token);
      expect(res.status).toBe(400);
      expect(res.body.errors.map((e) => e.field)).toEqual([field]);
    }
    const { paymentMethodId, ...withoutMethod } = body;
    expect(paymentMethodId).toBe('CASH');
    expect((await post('/requests/record-payment', withoutMethod, v1Token)).body.errors[0].field).toBe('paymentMethodId');

    expect((await ServiceRequest.findById(id)).paymentStatus).toBe('PENDING');
  });
});

describe('POST /payment-methods/list', () => {
  test('the five configured methods in order, for vendors and admins; every id is a paymentMode', async () => {
    const res = await post('/payment-methods/list', {}, v1Token);
    expect(res.status).toBe(200);
    expect(res.body.data).toEqual([
      { id: 'CASH', label: 'Cash' },
      { id: 'UPI', label: 'UPI' },
      { id: 'BANK_TRANSFER', label: 'Bank transfer' },
      { id: 'CARD', label: 'Card' },
      { id: 'OTHER', label: 'Other' },
    ]);

    const modes = ServiceRequest.schema.path('paymentMode').enumValues;
    for (const method of res.body.data) expect(modes).toContain(method.id);

    const { token } = await f.createAdmin();
    expect((await post('/payment-methods/list', {}, token)).status).toBe(200);
    const customer = await post('/payment-methods/list', {}, ashaToken);
    expect(customer.status).toBe(403);
    expect(customer.body.code).toBe('FORBIDDEN');
  });
});

describe('the payment view, per role', () => {
  const completePaid = async () => {
    const request = await f.createRequest(asha, electrical);
    const id = String(request._id);
    // v2 declines the broadcast first, so it can still read the finished job without holding it.
    await post('/requests/reject', { id }, v2Token);
    await post('/requests/accept', { id }, v1Token);
    await post('/requests/start', { id }, v1Token);
    await post(
      '/requests/complete',
      { id, amount: 1250.75, paymentStatus: 'PAID', paymentMethodId: 'BANK_TRANSFER', completionNotes: NOTES, note: 'Replaced two sockets.' },
      v1Token
    );
    return id;
  };

  test('the customer sees amount, status and method label only — never the notes or the method id', async () => {
    const id = await completePaid();
    const detail = await post('/requests/detail', { id }, ashaToken);
    const list = await post('/requests/list', {}, ashaToken);

    expect(detail.body.data.payment).toEqual({
      finalAmount: 1250.75,
      currency: 'INR',
      paymentStatus: 'PAID',
      paymentMethodLabel: 'Bank transfer',
    });
    expect(list.body.data[0].payment).toEqual(detail.body.data.payment);
    // The timeline note is theirs to read; the vendor's completion notes are not.
    expect(detail.body.data.timeline.map((t) => t.note)).toContain('Replaced two sockets.');
    for (const res of [detail, list]) {
      expect(res.text).not.toContain(NOTES);
      expect(res.text).not.toMatch(/"paymentMethodId"\s*:/);
      expect(res.text).not.toMatch(/"completionNotes"\s*:/);
      expect(res.text).not.toMatch(/"(recordedAt|paidAt|paymentRecordedAt)"\s*:/);
    }
  });

  test('the holder and an admin see the whole record; a vendor who does not hold it sees none', async () => {
    const id = await completePaid();
    const holder = await post('/requests/detail', { id }, v1Token);
    expect(holder.body.data.payment).toMatchObject({ paymentMethodId: 'BANK_TRANSFER', completionNotes: NOTES });

    const { token } = await f.createAdmin();
    const admin = await post('/requests/detail', { id }, token);
    expect(admin.body.data.payment).toEqual(holder.body.data.payment);

    const decliner = await post('/requests/detail', { id }, v2Token);
    expect(decliner.status).toBe(200);
    expect(decliner.body.data).toMatchObject({ payment: null, amount: null, paymentStatus: null, paymentMode: null, completionImages: [] });
    expect(decliner.text).not.toContain(NOTES);
    expect(decliner.text).not.toContain('Bank transfer');
  });

  test('an older completed record already PAID shows as a record with no method or times', async () => {
    const older = await f.createRequest(asha, electrical, {
      vendorId: v1._id,
      status: 'COMPLETED',
      completedAt: new Date(),
      amount: 800,
      paymentStatus: 'PAID',
    });
    const res = await post('/requests/detail', { id: String(older._id) }, v1Token);
    expect(res.body.data.payment).toEqual({ finalAmount: 800, currency: 'INR', paymentStatus: 'PAID', recordedAt: null });
    const customer = await post('/requests/detail', { id: String(older._id) }, ashaToken);
    expect(customer.body.data.payment).toEqual({ finalAmount: 800, currency: 'INR', paymentStatus: 'PAID' });

    // A paid record is final: pressing "Paid" on it is the already-recorded answer.
    const again = await post('/requests/record-payment', { id: String(older._id), paymentStatus: 'PAID', paymentMethodId: 'CASH' }, v1Token);
    expect(again.status).toBe(409);
    expect(again.body.code).toBe('PAYMENT_ALREADY_RECORDED');
  });

  test('no record before completion, whatever the stored amount', async () => {
    const working = await f.createRequest(asha, electrical, { vendorId: v1._id, status: 'IN_PROGRESS', amount: 499 });
    for (const token of [v1Token, ashaToken]) {
      expect((await post('/requests/detail', { id: String(working._id) }, token)).body.data.payment).toBeNull();
    }
  });
});
