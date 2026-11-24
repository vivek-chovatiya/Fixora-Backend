// Test images made in code with sharp (no binary fixtures), and POST /uploads as a multipart call.
// Every upload response is kept in api.responses, so tests/setup/noSecrets.js searches it too.
const crypto = require('crypto');
const request = require('supertest');
const sharp = require('sharp');
const api = require('./api');
const Upload = require('../../src/models/upload');

const canvas = (width, height) =>
  sharp({ create: { width, height, channels: 3, background: { r: 40, g: 120, b: 200 } } });

const jpeg = ({ width = 64, height = 48, exif, orientation } = {}) => {
  let image = canvas(width, height).jpeg();
  if (exif) image = image.withExif(exif);
  if (orientation) image = image.withMetadata({ orientation });
  return image.toBuffer();
};

const png = ({ width = 64, height = 48 } = {}) => canvas(width, height).png().toBuffer();
const webp = ({ width = 64, height = 48 } = {}) => canvas(width, height).webp().toBuffer();
const gif = ({ width = 16, height = 16 } = {}) => canvas(width, height).gif().toBuffer();

/**
 * POST /api/v1/uploads. `parts` are sent in the order given: { field, value } for a text part,
 * { file: Buffer, name?, contentType?, field? } for a file part (field defaults to 'files').
 */
const upload = async (token, parts) => {
  let req = request(api.app).post('/api/v1/uploads');
  if (token) req = req.set('Authorization', `Bearer ${token}`);
  for (const part of parts) {
    if (part.file) {
      req = req.attach(part.field || 'files', part.file, {
        filename: part.name || 'photo.jpg',
        contentType: part.contentType || 'image/jpeg',
      });
    } else {
      req = req.field(part.field, part.value);
    }
  }
  const res = await req;
  api.responses.push({ method: 'post', path: '/uploads', status: res.status, text: res.text });
  return res;
};

// An Upload row written straight to the database, as POST /uploads would leave it.
const uploadRow = (owner, ownerRole, type, ext = 'jpg') =>
  Upload.create({
    path: `/uploads/${type}/${crypto.randomBytes(16).toString('hex')}.${ext}`,
    type,
    ownerId: owner._id,
    ownerRole,
    mimeType: ext === 'png' ? 'image/png' : 'image/jpeg',
    sizeBytes: 1234,
  });

module.exports = {
  jpeg,
  png,
  webp,
  gif,
  upload,
  uploadRow,
};
