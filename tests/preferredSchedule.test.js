// The customer's preferred date and time, each optional and independent (Phase 4B contract §3;
// PROJECT_BIBLE.md section 32 lists Preferred Date/Time among what a vendor sees before accepting).
// Stored as sent, in India wall-clock; scheduledAt derived for the web views, and the other way
// round for a web view's scheduledAt-only body and for a request stored before 4B.
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const f = require('./helpers/fixtures');
const ServiceRequest = require('../src/models/servicerequest');

let electrical;
let asha;
let ashaToken;
let v1;
let v1Token;

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  electrical = await f.createCategory({ name: 'Electrical' });
  asha = await f.createCustomer();
  ashaToken = f.tokenFor(asha, 'CUSTOMER');
  v1 = await f.createVendor([electrical]);
  v1Token = f.tokenFor(v1, 'VENDOR');
});

const create = (extra) =>
  api.post(
    '/requests',
    {
      categoryId: String(electrical._id),
      serviceAddress: '22 Hill Road, Bandra West, Mumbai',
      serviceAddressDetails: { area: 'Bandra West', city: 'Mumbai' },
      ...extra,
    },
    ashaToken
  );

const pairOf = (data) => ({
  preferredDate: data.preferredDate,
  preferredTime: data.preferredTime,
  scheduledAt: data.scheduledAt,
});

describe('POST /requests: preferredDate and preferredTime', () => {
  test('date only, time only, both and neither are stored and read back exactly', async () => {
    const cases = [
      [{ preferredDate: '2026-12-05' }, { preferredDate: '2026-12-05', preferredTime: null, scheduledAt: '2026-12-04T18:30:00.000Z' }],
      [{ preferredTime: '18:45' }, { preferredDate: null, preferredTime: '18:45', scheduledAt: null }],
      [{ preferredDate: '2026-12-05', preferredTime: '09:30' }, { preferredDate: '2026-12-05', preferredTime: '09:30', scheduledAt: '2026-12-05T04:00:00.000Z' }],
      [{ preferredDate: null, preferredTime: '' }, { preferredDate: null, preferredTime: null, scheduledAt: null }],
      [{}, { preferredDate: null, preferredTime: null, scheduledAt: null }],
    ];

    for (const [body, expected] of cases) {
      const res = await create(body);
      expect(res.status).toBe(201);
      expect(pairOf(res.body.data)).toEqual(expected);

      const stored = await ServiceRequest.findById(res.body.data.id).lean();
      expect({ preferredDate: stored.preferredDate, preferredTime: stored.preferredTime }).toEqual({
        preferredDate: expected.preferredDate,
        preferredTime: expected.preferredTime,
      });
      const detail = await api.post('/requests/detail', { id: res.body.data.id }, ashaToken);
      expect(pairOf(detail.body.data)).toEqual(expected);
    }
  });

  test('both given: scheduledAt is that India time (+05:30); any scheduledAt sent beside them is ignored', async () => {
    const res = await create({
      preferredDate: '2026-12-31',
      preferredTime: '23:30',
      scheduledAt: '2027-06-01T10:00:00.000Z',
    });
    expect(res.body.data.scheduledAt).toBe(new Date('2026-12-31T23:30:00+05:30').toISOString());

    const timeOnly = await create({ preferredTime: '10:00', scheduledAt: '2027-06-01T10:00:00.000Z' });
    expect(timeOnly.body.data.scheduledAt).toBeNull();
  });

  test('a web view’s scheduledAt alone: the pair is derived in India time, midnight meaning no time', async () => {
    const evening = await create({ scheduledAt: '2026-12-05T13:15:00.000Z' });
    expect(pairOf(evening.body.data)).toEqual({
      preferredDate: '2026-12-05',
      preferredTime: '18:45',
      scheduledAt: '2026-12-05T13:15:00.000Z',
    });

    // 20:00 UTC is already the next day in India.
    const lateUtc = await create({ scheduledAt: '2026-12-05T20:00:00.000Z' });
    expect(pairOf(lateUtc.body.data)).toMatchObject({ preferredDate: '2026-12-06', preferredTime: '01:30' });

    const midnight = await create({ scheduledAt: '2026-12-04T18:30:00.000Z' });
    expect(pairOf(midnight.body.data)).toMatchObject({ preferredDate: '2026-12-05', preferredTime: null });
    const stored = await ServiceRequest.findById(midnight.body.data.id).lean();
    expect(stored).toMatchObject({ preferredDate: '2026-12-05', preferredTime: null });
  });

  test('a past date is stored as sent (no range rule in 4B)', async () => {
    const res = await create({ preferredDate: '2020-01-01' });
    expect(res.status).toBe(201);
    expect(res.body.data.preferredDate).toBe('2020-01-01');
  });

  test('a date that is not on the calendar, or a time not written HH:mm, answers 400 on its field', async () => {
    const cases = [
      [{ preferredDate: '2026-02-30' }, 'preferredDate'],
      [{ preferredDate: '2027-02-29' }, 'preferredDate'],
      [{ preferredDate: '2026-13-01' }, 'preferredDate'],
      [{ preferredDate: '05/12/2026' }, 'preferredDate'],
      [{ preferredDate: '2026-12-05T10:00' }, 'preferredDate'],
      [{ preferredTime: '9:00' }, 'preferredTime'],
      [{ preferredTime: '24:00' }, 'preferredTime'],
      [{ preferredTime: '09:60' }, 'preferredTime'],
      [{ preferredTime: '09:00:00' }, 'preferredTime'],
    ];
    for (const [body, field] of cases) {
      const res = await create(body);
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors.map((e) => e.field)).toEqual([field]);
      // The message never repeats what was sent.
      expect(res.body.errors[0].message).not.toContain(Object.values(body)[0]);
    }
    expect(await ServiceRequest.countDocuments()).toBe(0);

    expect((await create({ preferredDate: '2028-02-29', preferredTime: '00:00' })).status).toBe(201);
  });
});

describe('reading the pair', () => {
  test('a request stored before 4B (both null, scheduledAt set) is answered derived, not written back', async () => {
    const older = await f.createRequest(asha, electrical, { scheduledAt: new Date('2026-11-20T05:30:00.000Z') });
    const midnight = await f.createRequest(asha, electrical, { scheduledAt: new Date('2026-11-20T18:30:00.000Z') });

    const res = await api.post('/requests/detail', { id: String(older._id) }, ashaToken);
    expect(pairOf(res.body.data)).toEqual({
      preferredDate: '2026-11-20',
      preferredTime: '11:00',
      scheduledAt: '2026-11-20T05:30:00.000Z',
    });
    const list = await api.post('/requests/list', {}, ashaToken);
    const listed = list.body.data.find((r) => r.id === String(midnight._id));
    expect(pairOf(listed)).toMatchObject({ preferredDate: '2026-11-21', preferredTime: null });

    const stored = await ServiceRequest.findById(older._id).lean();
    expect(stored).toMatchObject({ preferredDate: null, preferredTime: null });
  });

  test('a vendor who does not hold the request sees both, as the holder does', async () => {
    const created = await create({ preferredDate: '2026-12-05', preferredTime: '09:30' });
    const id = created.body.data.id;

    const open = await api.post('/requests/detail', { id }, v1Token);
    expect(open.body.data.customerId).toBe(String(asha._id));
    expect(open.body.data).toMatchObject({ preferredDate: '2026-12-05', preferredTime: '09:30' });
    const openList = await api.post('/requests/list', {}, v1Token);
    expect(openList.body.data[0]).toMatchObject({ preferredDate: '2026-12-05', preferredTime: '09:30' });

    await api.post('/requests/accept', { id }, v1Token);
    const held = await api.post('/requests/detail', { id }, v1Token);
    expect(held.body.data).toMatchObject({ preferredDate: '2026-12-05', preferredTime: '09:30' });

    const { token } = await f.createAdmin();
    const admin = await api.post('/requests/detail', { id }, token);
    expect(admin.body.data).toMatchObject({ preferredDate: '2026-12-05', preferredTime: '09:30' });
  });
});
