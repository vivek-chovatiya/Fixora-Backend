// Uploads (Phase 4B contract §1): POST /uploads, processing, storage, serving, and the limits.
const fs = require('fs');
const path = require('path');
const request = require('supertest');
const sharp = require('sharp');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const f = require('./helpers/fixtures');
const images = require('./helpers/images');
const Upload = require('../src/models/upload');

const UPLOAD_DIR = process.env.UPLOAD_PATH;
const PATH_OF = (type, ext) => new RegExp(`^/uploads/${type}/[0-9a-f]{32}\\.${ext}$`);
const FIVE_MB = 5 * 1024 * 1024;

const filesOnDisk = (dir = UPLOAD_DIR) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesOnDisk(full) : [full];
  });
};

const diskPathOf = (urlPath) => path.join(UPLOAD_DIR, ...urlPath.split('/').slice(2));
const fetchFile = (urlPath) => request(api.app).get(urlPath).buffer(true).parse((res, done) => {
  const chunks = [];
  res.on('data', (chunk) => chunks.push(chunk));
  res.on('end', () => done(null, Buffer.concat(chunks)));
});

const typePart = (value) => ({ field: 'type', value });

let customer;
let customerToken;
let vendor;
let vendorToken;

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
  customer = await f.createCustomer();
  customerToken = f.tokenFor(customer, 'CUSTOMER');
  vendor = await f.createVendor();
  vendorToken = f.tokenFor(vendor, 'VENDOR');
});

const expectNothingStored = async () => {
  expect(await Upload.countDocuments()).toBe(0);
  expect(filesOnDisk()).toEqual([]);
};

describe('POST /uploads stores processed images', () => {
  test('one JPEG request photo: 201, a random host-free path, the file on disk and its record', async () => {
    const res = await images.upload(customerToken, [
      typePart('request'),
      { file: await images.jpeg() },
    ]);

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.files).toHaveLength(1);
    const [file] = res.body.data.files;
    expect(Object.keys(file)).toEqual(['id', 'path', 'url', 'type', 'mimeType', 'sizeBytes']);
    expect(file.path).toMatch(PATH_OF('request', 'jpg'));
    expect(file.url).toMatch(/^http:\/\/[^/]+\/uploads\/request\/[0-9a-f]{32}\.jpg$/);
    expect(file.url.endsWith(file.path)).toBe(true);
    expect(file).toMatchObject({ type: 'request', mimeType: 'image/jpeg' });

    const onDisk = fs.readFileSync(diskPathOf(file.path));
    expect(file.sizeBytes).toBe(onDisk.length);

    const row = await Upload.findById(file.id).lean();
    expect(row).toMatchObject({
      path: file.path,
      type: 'request',
      ownerRole: 'CUSTOMER',
      mimeType: 'image/jpeg',
      sizeBytes: onDisk.length,
    });
    expect(String(row.ownerId)).toBe(String(customer._id));
    expect(row.createdAt).toBeInstanceOf(Date);
  });

  test('GET <path> serves the image to any origin; other responses keep helmet’s same-origin', async () => {
    const res = await images.upload(customerToken, [typePart('request'), { file: await images.jpeg() }]);
    const { path: urlPath, sizeBytes } = res.body.data.files[0];

    const served = await fetchFile(urlPath);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');
    expect(served.body.length).toBe(sizeBytes);

    const health = await request(api.app).get('/api/v1/health');
    expect(health.headers['cross-origin-resource-policy']).toBe('same-origin');
  });

  test('no index pages: a folder under /uploads, or a file that is not there, is 404', async () => {
    await images.upload(customerToken, [typePart('request'), { file: await images.jpeg() }]);
    for (const urlPath of ['/uploads/', '/uploads/request/', '/uploads/request/0000.jpg']) {
      const res = await request(api.app).get(urlPath);
      expect(res.status).toBe(404);
    }
  });

  test('each file keeps its own format, judged by content, in the order sent', async () => {
    const res = await images.upload(customerToken, [
      // A PNG claiming to be a JPEG is stored as the PNG it is.
      { file: await images.png(), name: 'holiday.jpg', contentType: 'image/jpeg' },
      { file: await images.jpeg(), name: 'one.png', contentType: 'image/png' },
      { file: await images.webp(), name: 'two.jpg' },
      typePart('request'),
    ]);

    expect(res.status).toBe(201);
    const files = res.body.data.files;
    expect(files.map((file) => file.mimeType)).toEqual(['image/png', 'image/jpeg', 'image/webp']);
    expect(files[0].path).toMatch(PATH_OF('request', 'png'));
    expect(files[1].path).toMatch(PATH_OF('request', 'jpg'));
    expect(files[2].path).toMatch(PATH_OF('request', 'webp'));
    for (const file of files) {
      const meta = await sharp(fs.readFileSync(diskPathOf(file.path))).metadata();
      expect(`image/${meta.format}`).toBe(file.mimeType);
    }
    expect(await Upload.countDocuments({ ownerId: customer._id })).toBe(3);
    expect(new Set(files.map((file) => file.path)).size).toBe(3);
  });

  test('five files in one call are accepted', async () => {
    const jpg = await images.jpeg();
    const res = await images.upload(vendorToken, [
      typePart('shop'),
      ...Array.from({ length: 5 }, () => ({ file: jpg })),
    ]);
    expect(res.status).toBe(201);
    expect(res.body.data.files).toHaveLength(5);
    expect(filesOnDisk()).toHaveLength(5);
  });
});

describe('processing', () => {
  test('a JPEG carrying EXIF (incl. a GPS position) is stored with no EXIF or XMP at all', async () => {
    const original = await images.jpeg({
      exif: {
        IFD0: { Make: 'FixoraTestCam', Model: 'Model 7' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '18/1 31/1 1234/100',
          GPSLongitudeRef: 'E',
          GPSLongitude: '73/1 51/1 2345/100',
        },
      },
    });
    const before = await sharp(original).metadata();
    expect(before.exif).toBeDefined();

    const res = await images.upload(customerToken, [typePart('request'), { file: original }]);
    expect(res.status).toBe(201);

    const stored = fs.readFileSync(diskPathOf(res.body.data.files[0].path));
    const after = await sharp(stored).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(stored.includes(Buffer.from('FixoraTestCam'))).toBe(false);
  });

  test('a 3000 px image comes back at most 1600 px; a small one is not enlarged', async () => {
    const res = await images.upload(vendorToken, [
      typePart('shop'),
      { file: await images.jpeg({ width: 3000, height: 2000 }) },
      { file: await images.png({ width: 1200, height: 3000 }) },
      { file: await images.jpeg({ width: 64, height: 48 }) },
    ]);
    expect(res.status).toBe(201);

    const sizes = [];
    for (const file of res.body.data.files) {
      const { width, height } = await sharp(fs.readFileSync(diskPathOf(file.path))).metadata();
      sizes.push([width, height]);
    }
    expect(sizes[0][0]).toBe(1600);
    expect(sizes[0][1]).toBeLessThanOrEqual(1600);
    expect(sizes[1][1]).toBe(1600);
    expect(sizes[1][0]).toBeLessThanOrEqual(1600);
    expect(sizes[2]).toEqual([64, 48]);
  });

  test('the camera orientation is applied, so the stored image is upright', async () => {
    // 40 × 20 pixels, tagged "rotate 90°": upright it is 20 × 40.
    const res = await images.upload(customerToken, [
      typePart('profile'),
      { file: await images.jpeg({ width: 40, height: 20, orientation: 6 }) },
    ]);
    expect(res.status).toBe(201);
    const meta = await sharp(fs.readFileSync(diskPathOf(res.body.data.files[0].path))).metadata();
    expect([meta.width, meta.height]).toEqual([20, 40]);
    expect(meta.orientation).toBeUndefined();
  });

  test('the client’s file name appears nowhere: response, path, record, disk or logs', async () => {
    const clientName = 'asha-patel-kitchen-sink-leak-7731.jpg';
    const res = await images.upload(customerToken, [
      typePart('request'),
      { file: await images.jpeg(), name: clientName },
    ]);
    expect(res.status).toBe(201);

    const stem = 'asha-patel-kitchen';
    expect(res.text).not.toContain(stem);
    const rows = await Upload.find().lean();
    expect(JSON.stringify(rows)).not.toContain(stem);
    expect(filesOnDisk().join('|')).not.toContain(stem);
    expect(logs.all()).not.toContain(stem);
  });
});

describe('refusals', () => {
  test('six files → 400 TOO_MANY_FILES, nothing stored', async () => {
    const jpg = await images.jpeg();
    const res = await images.upload(customerToken, [
      typePart('request'),
      ...Array.from({ length: 6 }, () => ({ file: jpg })),
    ]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('TOO_MANY_FILES');
    expect(res.body.errors[0].field).toBe('files');
    await expectNothingStored();
  });

  test('no file → 400 VALIDATION_FAILED on files (multipart or not)', async () => {
    const multipart = await images.upload(customerToken, [typePart('request')]);
    expect(multipart.status).toBe(400);
    expect(multipart.body.code).toBe('VALIDATION_FAILED');
    expect(multipart.body.errors.map((e) => e.field)).toEqual(['files']);

    const json = await api.post('/uploads', { type: 'request' }, customerToken);
    expect(json.status).toBe(400);
    expect(json.body.errors.map((e) => e.field)).toEqual(['files']);
  });

  test('5 MB + 1 byte → 413 FILE_TOO_LARGE; exactly 5 MB passes the size limit', async () => {
    const tooBig = await images.upload(customerToken, [
      typePart('request'),
      { file: Buffer.alloc(FIVE_MB + 1, 0x41) },
    ]);
    expect(tooBig.status).toBe(413);
    expect(tooBig.body.code).toBe('FILE_TOO_LARGE');
    expect(tooBig.body.errors[0].field).toBe('files');
    await expectNothingStored();

    // Exactly the limit is received, then judged by its content (these bytes are no image).
    const atLimit = await images.upload(customerToken, [
      typePart('request'),
      { file: Buffer.alloc(FIVE_MB, 0x41) },
    ]);
    expect(atLimit.status).toBe(400);
    expect(atLimit.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
  });

  test('anything but a JPEG, PNG or WebP by content → 400 FILE_TYPE_NOT_ALLOWED', async () => {
    const notImages = [
      { file: Buffer.from('just some text, not a photo'), name: 'x.jpg', contentType: 'image/jpeg' },
      {
        file: Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << >>\n%%EOF\n'),
        name: 'invoice.pdf',
        contentType: 'application/pdf',
      },
      { file: await images.gif(), name: 'anim.gif', contentType: 'image/gif' },
      {
        file: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"/>'),
        name: 'logo.png',
        contentType: 'image/png',
      },
      // A JPEG's first bytes with nothing decodable behind them.
      {
        file: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('x'.repeat(200))]),
        name: 'broken.jpg',
      },
    ];
    for (const part of notImages) {
      const res = await images.upload(customerToken, [typePart('request'), part]);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
      expect(res.body.errors[0].field).toBe('files');
    }
    await expectNothingStored();
  });

  test('all or nothing: one bad file among good ones stores no file and no record', async () => {
    const res = await images.upload(customerToken, [
      typePart('request'),
      { file: await images.jpeg() },
      { file: await images.png() },
      { file: Buffer.from('not an image'), name: 'third.jpg' },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    await expectNothingStored();
  });

  test('a small file declaring more than 40 million pixels → 400 FILE_TYPE_NOT_ALLOWED, never a 500', async () => {
    // 8000 × 5001 one-colour pixels compress to ~125 KB but would decode to ~120 MB.
    const huge = await images.png({ width: 8000, height: 5001 });
    expect(huge.length).toBeLessThan(FIVE_MB);

    const res = await images.upload(customerToken, [typePart('request'), { file: huge }]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('FILE_TYPE_NOT_ALLOWED');
    expect(res.body.errors[0].field).toBe('files');
    await expectNothingStored();

    // Exactly the cap is still accepted (and shrunk to 1600 px).
    const atCap = await images.upload(customerToken, [
      typePart('request'),
      { file: await images.png({ width: 8000, height: 5000 }) },
    ]);
    expect(atCap.status).toBe(201);
    const meta = await sharp(fs.readFileSync(diskPathOf(atCap.body.data.files[0].path))).metadata();
    expect([meta.width, meta.height]).toEqual([1600, 1000]);
  });

  test('type: who may upload what; missing or unknown → 400 on type', async () => {
    const jpg = await images.jpeg();
    const refused = [
      [customerToken, 'shop'],
      [customerToken, 'team'],
      [vendorToken, 'request'],
      [customerToken, 'avatar'],
      [vendorToken, undefined],
    ];
    for (const [token, type] of refused) {
      const parts = type === undefined ? [{ file: jpg }] : [typePart(type), { file: jpg }];
      const res = await images.upload(token, parts);
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('VALIDATION_FAILED');
      expect(res.body.errors.map((e) => e.field)).toEqual(['type']);
    }
    await expectNothingStored();

    const allowed = [
      [customerToken, 'request'],
      [customerToken, 'profile'],
      [vendorToken, 'profile'],
      [vendorToken, 'shop'],
      [vendorToken, 'team'],
    ];
    for (const [token, type] of allowed) {
      const res = await images.upload(token, [typePart(type), { file: jpg }]);
      expect(res.status).toBe(201);
      expect(res.body.data.files[0].path).toMatch(PATH_OF(type, 'jpg'));
    }
    const vendorRows = await Upload.find({ ownerId: vendor._id }).lean();
    expect(vendorRows.map((row) => row.ownerRole)).toEqual(['VENDOR', 'VENDOR', 'VENDOR']);
  });

  test('no token → 401; an administrator → 403; nothing stored', async () => {
    const jpg = await images.jpeg();
    const anonymous = await images.upload(null, [typePart('request'), { file: jpg }]);
    expect(anonymous.status).toBe(401);
    expect(anonymous.body.code).toBe('UNAUTHORIZED');

    const { token: adminToken } = await f.createAdmin();
    const admin = await images.upload(adminToken, [typePart('profile'), { file: jpg }]);
    expect(admin.status).toBe(403);
    expect(admin.body.code).toBe('FORBIDDEN');
    await expectNothingStored();
  });

  test('a file under another field name → 400 VALIDATION_FAILED naming that field', async () => {
    const res = await images.upload(customerToken, [
      typePart('request'),
      { file: await images.jpeg(), field: 'photo' },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    expect(res.body.errors.map((e) => e.field)).toEqual(['photo']);
    await expectNothingStored();
  });

  test('a body that is not readable multipart → 400, never a 500', async () => {
    const res = await request(api.app)
      .post('/api/v1/uploads')
      .set('Authorization', `Bearer ${customerToken}`)
      .set('Content-Type', 'multipart/form-data; boundary=fixora-boundary')
      .send('--fixora-boundary\r\nContent-Disposition: form-data; name="type"\r\n\r\nreq');
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('VALIDATION_FAILED');
    await expectNothingStored();
  });
});
