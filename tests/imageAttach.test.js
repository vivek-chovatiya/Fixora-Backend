// Attaching uploaded images (Phase 4B contract §2): customer and vendor profile pictures, shop
// images and team photos. Request `images` on POST /requests are covered with the request suites.
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const f = require('./helpers/fixtures');
const images = require('./helpers/images');
const Customer = require('../src/models/customer');
const Vendor = require('../src/models/vendor');
const TeamMember = require('../src/models/team');
const { normaliseImageValue, resolveImageField } = require('../src/services/uploadAttach');

const fieldsOf = (res) => (res.body.errors || []).map((error) => error.field);

let customer;
let customerToken;
let vendor;
let vendorToken;

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  customer = await f.createCustomer();
  customerToken = f.tokenFor(customer, 'CUSTOMER');
  vendor = await f.createVendor();
  vendorToken = f.tokenFor(vendor, 'VENDOR');
});

describe('normaliseImageValue', () => {
  test('an absolute http(s) URL under /uploads/ becomes its path; anything else is unchanged', () => {
    const name = `${'a'.repeat(32)}.jpg`;
    expect(normaliseImageValue(`http://10.0.2.2:5000/uploads/request/${name}`)).toBe(
      `/uploads/request/${name}`
    );
    expect(normaliseImageValue(`HTTPS://api.example.com/uploads/shop/${name}?v=2#top`)).toBe(
      `/uploads/shop/${name}`
    );
    expect(normaliseImageValue(`/uploads/profile/${name}`)).toBe(`/uploads/profile/${name}`);
    expect(normaliseImageValue('https://cdn.example.com/photos/1.jpg')).toBe(
      'https://cdn.example.com/photos/1.jpg'
    );
    expect(normaliseImageValue('https://cdn.example.com/uploadsX/1.jpg')).toBe(
      'https://cdn.example.com/uploadsX/1.jpg'
    );
    expect(normaliseImageValue(`ftp://host/uploads/shop/${name}`)).toBe(`ftp://host/uploads/shop/${name}`);
    expect(normaliseImageValue('http://')).toBe('http://');
    expect(normaliseImageValue(null)).toBe(null);
    expect(normaliseImageValue('')).toBe('');
  });

  test('resolveImageField: a field that was not sent keeps what is stored', async () => {
    await expect(
      resolveImageField({ value: undefined, field: 'profileImage', type: 'profile', ownerId: customer._id, stored: 'x' })
    ).resolves.toBe('x');
  });
});

describe('customer profileImage (/customers/update)', () => {
  test('their own profile upload is stored as its path, and becomes the session avatarUrl', async () => {
    const upload = await images.uploadRow(customer, 'CUSTOMER', 'profile');
    const res = await api.post('/customers/update', { id: String(customer._id), profileImage: upload.path }, customerToken);
    expect(res.status).toBe(200);
    expect(res.body.data.profileImage).toBe(upload.path);

    const me = await api.get('/auth/me', customerToken);
    expect(me.body.data.avatarUrl).toBe(upload.path);
  });

  test('the absolute URL the app was shown is stored as the path', async () => {
    const upload = await images.uploadRow(customer, 'CUSTOMER', 'profile');
    const res = await api.post(
      '/customers/update',
      { id: String(customer._id), profileImage: `http://10.0.2.2:5000${upload.path}?t=1#x` },
      customerToken
    );
    expect(res.status).toBe(200);
    expect((await Customer.findById(customer._id)).profileImage).toBe(upload.path);
  });

  test('another customer’s upload, their own request upload, an unknown path or an outside URL → 400', async () => {
    const other = await f.createCustomer();
    const candidates = [
      (await images.uploadRow(other, 'CUSTOMER', 'profile')).path,
      (await images.uploadRow(customer, 'CUSTOMER', 'request')).path,
      `/uploads/profile/${'b'.repeat(32)}.jpg`,
      'https://example.com/me.jpg',
    ];
    for (const profileImage of candidates) {
      const res = await api.post('/customers/update', { id: String(customer._id), profileImage }, customerToken);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(fieldsOf(res)).toEqual(['profileImage']);
    }
    expect((await Customer.findById(customer._id)).profileImage).toBe(null);
  });

  test('null or "" clears the picture', async () => {
    for (const cleared of [null, '']) {
      await Customer.updateOne({ _id: customer._id }, { profileImage: 'https://cdn.example.com/old.jpg' });
      const res = await api.post('/customers/update', { id: String(customer._id), profileImage: cleared }, customerToken);
      expect(res.status).toBe(200);
      expect(res.body.data.profileImage).toBe(null);
    }
  });

  test('an unchanged stored picture is kept exactly as stored, even one that was never uploaded', async () => {
    const webViewUrl = `http://localhost:5000/uploads/profile/${'c'.repeat(32)}.jpg`;
    await Customer.updateOne({ _id: customer._id }, { profileImage: webViewUrl });

    // The app sends back the path form of what it was shown.
    const res = await api.post(
      '/customers/update',
      { id: String(customer._id), profileImage: `/uploads/profile/${'c'.repeat(32)}.jpg`, firstName: 'Asha' },
      customerToken
    );
    expect(res.status).toBe(200);
    expect(res.body.data.profileImage).toBe(webViewUrl);
  });

  test('an administrator attaches the customer’s own upload, never anyone else’s', async () => {
    const { admin, token: adminToken } = await f.createAdmin();
    const own = await images.uploadRow(customer, 'CUSTOMER', 'profile');
    const ok = await api.post('/customers/update', { id: String(customer._id), profileImage: own.path }, adminToken);
    expect(ok.status).toBe(200);
    expect(ok.body.data.profileImage).toBe(own.path);

    const other = await f.createCustomer();
    const theirs = await images.uploadRow(other, 'CUSTOMER', 'profile');
    const refused = await api.post(
      '/customers/update',
      { id: String(customer._id), profileImage: theirs.path },
      adminToken
    );
    expect(refused.status).toBe(400);
    expect(fieldsOf(refused)).toEqual(['profileImage']);
    expect(String(admin._id)).not.toBe(String(customer._id));
  });

  test('end to end: POST /uploads, then attach the returned path', async () => {
    const uploaded = await images.upload(customerToken, [
      { field: 'type', value: 'profile' },
      { file: await images.jpeg() },
    ]);
    expect(uploaded.status).toBe(201);
    const { path, url } = uploaded.body.data.files[0];

    const res = await api.post('/customers/update', { id: String(customer._id), profileImage: url }, customerToken);
    expect(res.status).toBe(200);
    expect(res.body.data.profileImage).toBe(path);
  });
});

describe('vendor profileImage and shopImages (/vendors/update)', () => {
  const update = (body, token = vendorToken) => api.post('/vendors/update', { id: String(vendor._id), ...body }, token);

  test('profileImage: own profile upload OK; another account’s → 400; null clears', async () => {
    const own = await images.uploadRow(vendor, 'VENDOR', 'profile');
    const ok = await update({ profileImage: own.path });
    expect(ok.status).toBe(200);
    expect(ok.body.data.profileImage).toBe(own.path);

    const otherVendor = await f.createVendor();
    for (const theirs of [
      await images.uploadRow(otherVendor, 'VENDOR', 'profile'),
      await images.uploadRow(customer, 'CUSTOMER', 'profile'),
      await images.uploadRow(vendor, 'VENDOR', 'shop'),
    ]) {
      const refused = await update({ profileImage: theirs.path });
      expect(refused.status).toBe(400);
      expect(fieldsOf(refused)).toEqual(['profileImage']);
    }
    expect((await Vendor.findById(vendor._id)).profileImage).toBe(own.path);

    const cleared = await update({ profileImage: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.profileImage).toBe(null);
  });

  test('shop images stored before (never uploaded) re-sent reordered → 200, in the new order', async () => {
    const seeded = ['https://cdn.example.com/shop-1.jpg', 'https://cdn.example.com/shop-2.jpg'];
    await Vendor.updateOne({ _id: vendor._id }, { shopImages: seeded });

    const res = await update({ shopImages: [seeded[1], seeded[0]] });
    expect(res.status).toBe(200);
    expect(res.body.data.shopImages).toEqual([seeded[1], seeded[0]]);
  });

  test('an own shop upload added beside stored ones → 200, stored as its path; up to 6', async () => {
    const seeded = ['https://cdn.example.com/shop-1.jpg'];
    await Vendor.updateOne({ _id: vendor._id }, { shopImages: seeded });
    const uploads = [];
    for (let i = 0; i < 5; i += 1) uploads.push(await images.uploadRow(vendor, 'VENDOR', 'shop'));

    const res = await update({
      shopImages: [`https://api.example.com${uploads[0].path}`, seeded[0], ...uploads.slice(1).map((u) => u.path)],
    });
    expect(res.status).toBe(200);
    expect(res.body.data.shopImages).toEqual([uploads[0].path, seeded[0], ...uploads.slice(1).map((u) => u.path)]);
  });

  test('another vendor’s upload, or an own upload of another type → 400 on its index', async () => {
    const otherVendor = await f.createVendor();
    const own = await images.uploadRow(vendor, 'VENDOR', 'shop');
    const theirs = await images.uploadRow(otherVendor, 'VENDOR', 'shop');
    const ownProfile = await images.uploadRow(vendor, 'VENDOR', 'profile');

    const res = await update({ shopImages: [own.path, theirs.path, ownProfile.path] });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(fieldsOf(res)).toEqual(['shopImages.1', 'shopImages.2']);
    expect((await Vendor.findById(vendor._id)).shopImages).toEqual([]);
  });

  test('7 images → 400; a duplicate (also as URL and path) → 400; [] clears', async () => {
    const uploads = [];
    for (let i = 0; i < 7; i += 1) uploads.push(await images.uploadRow(vendor, 'VENDOR', 'shop'));

    const seven = await update({ shopImages: uploads.map((u) => u.path) });
    expect(seven.status).toBe(400);
    expect(fieldsOf(seven)).toEqual(['shopImages']);

    const duplicate = await update({ shopImages: [uploads[0].path, uploads[0].path] });
    expect(duplicate.status).toBe(400);
    expect(fieldsOf(duplicate)).toEqual(['shopImages.1']);

    const sameAsUrl = await update({
      shopImages: [uploads[1].path, uploads[2].path, `http://10.0.2.2:5000${uploads[1].path}`],
    });
    expect(sameAsUrl.status).toBe(400);
    expect(fieldsOf(sameAsUrl)).toEqual(['shopImages.2']);

    await Vendor.updateOne({ _id: vendor._id }, { shopImages: [uploads[3].path] });
    const cleared = await update({ shopImages: [] });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.shopImages).toEqual([]);
  });

  test('an administrator may attach the vendor’s own uploads only', async () => {
    const { token: adminToken } = await f.createAdmin();
    const own = await images.uploadRow(vendor, 'VENDOR', 'shop');
    const ok = await update({ shopImages: [own.path] }, adminToken);
    expect(ok.status).toBe(200);
    expect(ok.body.data.shopImages).toEqual([own.path]);

    const theirs = await images.uploadRow(await f.createVendor(), 'VENDOR', 'shop');
    const refused = await update({ shopImages: [own.path, theirs.path] }, adminToken);
    expect(refused.status).toBe(400);
    expect(fieldsOf(refused)).toEqual(['shopImages.1']);
  });
});

describe('team member profileImage (/team, /team/update)', () => {
  test('add with an own team upload → 201; another vendor’s or a non-team upload → 400', async () => {
    const own = await images.uploadRow(vendor, 'VENDOR', 'team');
    const added = await api.post('/team', { name: 'Suresh', profileImage: own.path }, vendorToken);
    expect(added.status).toBe(201);
    expect(added.body.data.profileImage).toBe(own.path);

    const otherVendor = await f.createVendor();
    for (const bad of [
      await images.uploadRow(otherVendor, 'VENDOR', 'team'),
      await images.uploadRow(vendor, 'VENDOR', 'profile'),
    ]) {
      const refused = await api.post('/team', { name: 'Mahesh', profileImage: bad.path }, vendorToken);
      expect(refused.status).toBe(400);
      expect(fieldsOf(refused)).toEqual(['profileImage']);
    }
    expect(await TeamMember.countDocuments({ vendorId: vendor._id })).toBe(1);

    const blank = await api.post('/team', { name: 'Ramesh', profileImage: '' }, vendorToken);
    expect(blank.status).toBe(201);
    expect(blank.body.data.profileImage).toBe(null);
  });

  test('update with an own team upload → 200; another vendor’s → 400; unchanged kept; null clears', async () => {
    const member = await f.createTeamMember(vendor, { profileImage: 'https://cdn.example.com/suresh.jpg' });
    const id = String(member._id);

    const unchanged = await api.post(
      '/team/update',
      { id, profileImage: 'https://cdn.example.com/suresh.jpg', designation: 'Senior' },
      vendorToken
    );
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.data.profileImage).toBe('https://cdn.example.com/suresh.jpg');

    const own = await images.uploadRow(vendor, 'VENDOR', 'team');
    const ok = await api.post('/team/update', { id, profileImage: own.path }, vendorToken);
    expect(ok.status).toBe(200);
    expect(ok.body.data.profileImage).toBe(own.path);

    const theirs = await images.uploadRow(await f.createVendor(), 'VENDOR', 'team');
    const refused = await api.post('/team/update', { id, profileImage: theirs.path }, vendorToken);
    expect(refused.status).toBe(400);
    expect(fieldsOf(refused)).toEqual(['profileImage']);
    expect((await TeamMember.findById(id)).profileImage).toBe(own.path);

    const cleared = await api.post('/team/update', { id, profileImage: null }, vendorToken);
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.profileImage).toBe(null);
  });
});
