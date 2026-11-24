// A request's photos (Phase 4B contract §2; PROJECT_BIBLE.md sections 16 and 32, amended
// 21/10/2026): only the customer's own `request` uploads attach, stored as their paths, and a
// vendor who does not hold the request sees those photos and nothing else with a picture in it.
const sharp = require('sharp');
const request = require('supertest');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const f = require('./helpers/fixtures');
const ServiceRequest = require('../src/models/servicerequest');
const Upload = require('../src/models/upload');

let electrical;
let asha;
let ashaToken;
let other;
let v1;
let v1Token;
let v2;
let v2Token;

let sequence = 0;
const nextPath = (type, ext = 'jpg') => {
  sequence += 1;
  return `/uploads/${type}/${String(sequence).padStart(32, 'a')}.${ext}`;
};

// An Upload row, as POST /uploads writes one after storing the file.
const uploaded = async (owner, ownerRole, type = 'request') =>
  (
    await Upload.create({
      path: nextPath(type),
      type,
      ownerId: owner._id,
      ownerRole,
      mimeType: 'image/jpeg',
      sizeBytes: 1024,
    })
  ).path;

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  electrical = await f.createCategory({ name: 'Electrical' });
  asha = await f.createCustomer({
    email: 'asha.patel@example.com',
    phone: '9876543210',
    profileImage: '/uploads/profile/ffffffffffffffffffffffffffffffff.jpg',
  });
  ashaToken = f.tokenFor(asha, 'CUSTOMER');
  other = await f.createCustomer({ firstName: 'Ravi' });
  v1 = await f.createVendor([electrical]);
  v1Token = f.tokenFor(v1, 'VENDOR');
  v2 = await f.createVendor([electrical]);
  v2Token = f.tokenFor(v2, 'VENDOR');
});

const create = (extra) =>
  api.post(
    '/requests',
    {
      categoryId: String(electrical._id),
      serviceAddress: '14 Lake View Road, Flat 3B, Koregaon Park, Pune 411001',
      serviceAddressDetails: { line1: '14 Lake View Road', area: 'Koregaon Park', city: 'Pune', pincode: '411001' },
      ...extra,
    },
    ashaToken
  );

describe('POST /requests: images', () => {
  test('a photo uploaded through POST /uploads attaches and is stored as its path', async () => {
    const jpeg = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#7a7a7a' } }).jpeg().toBuffer();
    const upload = await request(api.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${ashaToken}`)
      .field('type', 'request')
      .attach('files', jpeg, { filename: 'kitchen.jpg', contentType: 'image/jpeg' });
    expect(upload.status).toBe(201);
    const { path } = upload.body.data.files[0];

    const res = await create({ images: [path] });
    expect(res.status).toBe(201);
    expect(res.body.data.images).toEqual([path]);
    expect((await ServiceRequest.findById(res.body.data.id)).images).toEqual([path]);
  });

  test('own request uploads, sent as paths or as the absolute URLs the app was shown', async () => {
    const first = await uploaded(asha, 'CUSTOMER');
    const second = await uploaded(asha, 'CUSTOMER');
    const res = await create({ images: [first, `http://10.0.2.2:5000${second}?v=1#top`] });
    expect(res.status).toBe(201);
    expect(res.body.data.images).toEqual([first, second]);
    // An upload is not consumed: the same photo may go on another request of hers.
    expect((await create({ images: [first] })).status).toBe(201);
  });

  test('another customer’s upload, her own profile upload, or an unknown path answers 400 images.N', async () => {
    const mine = await uploaded(asha, 'CUSTOMER');
    const cases = [
      await uploaded(other, 'CUSTOMER'),
      await uploaded(asha, 'CUSTOMER', 'profile'),
      '/uploads/request/0000000000000000000000000000dead.jpg',
      'https://example.com/photo.jpg',
    ];
    for (const refused of cases) {
      const res = await create({ images: [mine, refused] });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors.map((e) => e.field)).toEqual(['images.1']);
    }
    expect(await ServiceRequest.countDocuments()).toBe(0);
  });

  test('six photos, or the same photo twice, answers 400', async () => {
    const paths = [];
    for (let i = 0; i < 6; i += 1) paths.push(await uploaded(asha, 'CUSTOMER'));

    const six = await create({ images: paths });
    expect(six.status).toBe(400);
    expect(six.body.errors[0].field).toBe('images');
    expect((await create({ images: paths.slice(0, 5) })).status).toBe(201);

    const twice = await create({ images: [paths[0], `http://localhost:5000${paths[0]}`] });
    expect(twice.status).toBe(400);
    expect(twice.body.errors.map((e) => e.field)).toEqual(['images.1']);
  });
});

describe('a vendor who does not hold the request', () => {
  test('sees its photos, and no completion photos, payment, team member or customer picture', async () => {
    const photo = await uploaded(asha, 'CUSTOMER');
    const created = await create({ images: [photo], preferredDate: '2026-12-05' });
    const id = created.body.data.id;
    const withheld = ['Asha', 'Patel', '9876543210', 'asha.patel@example.com', '14 Lake View Road', '411001', asha.profileImage];

    // Open and waiting for them.
    for (const res of [await api.post('/requests/detail', { id }, v1Token), await api.post('/requests/list', {}, v1Token)]) {
      const data = Array.isArray(res.body.data) ? res.body.data[0] : res.body.data;
      expect(data).toMatchObject({ images: [photo], completionImages: [], payment: null, assignedTeamMemberId: null, customerId: String(asha._id) });
      for (const value of withheld) expect(res.text).not.toContain(value);
    }

    // Declined by v2, then held and finished by v1 with completion photos, a team member and a payment.
    await api.post('/requests/reject', { id }, v2Token);
    await api.post('/requests/accept', { id }, v1Token);
    const member = await f.createTeamMember(v1, { profileImage: '/uploads/team/eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee.jpg' });
    await api.post('/requests/assign', { id, assignedTeamMemberId: String(member._id) }, v1Token);
    await api.post('/requests/start', { id }, v1Token);
    await api.post(
      '/requests/complete',
      { id, amount: 650, paymentStatus: 'PAID', paymentMethodId: 'UPI', completionNotes: 'Left the old switch.', completionImages: ['/uploads/request/done.jpg'] },
      v1Token
    );

    const declined = await api.post('/requests/detail', { id }, v2Token);
    expect(declined.status).toBe(200);
    expect(declined.body.data).toMatchObject({
      status: 'COMPLETED',
      images: [photo],
      completionImages: [],
      payment: null,
      amount: null,
      assignedTeamMemberId: null,
      vendorId: null,
      customerId: String(asha._id),
      preferredDate: '2026-12-05',
    });
    for (const value of [...withheld, '/uploads/request/done.jpg', member.profileImage, 'Left the old switch.', 'Suresh']) {
      expect(declined.text).not.toContain(value);
    }

    // The holder sees all of it.
    const held = await api.post('/requests/detail', { id }, v1Token);
    expect(held.body.data).toMatchObject({ images: [photo], completionImages: ['/uploads/request/done.jpg'] });
    expect(held.body.data.payment).toMatchObject({ paymentMethodId: 'UPI', completionNotes: 'Left the old switch.' });
  });

  test('another category’s or another vendor’s request is still 404', async () => {
    const plumbing = await f.createCategory({ name: 'Plumbing' });
    const elsewhere = await f.createRequest(asha, plumbing, { images: [await uploaded(asha, 'CUSTOMER')] });
    const theirs = await f.createRequest(asha, electrical, { vendorId: v2._id, images: [await uploaded(asha, 'CUSTOMER')] });
    for (const hidden of [elsewhere, theirs]) {
      const res = await api.post('/requests/detail', { id: String(hidden._id) }, v1Token);
      expect(res.status).toBe(404);
      expect(res.body.code).toBe('REQUEST_NOT_FOUND');
    }
  });
});
