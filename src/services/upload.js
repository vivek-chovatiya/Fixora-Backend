/**
 * Storing uploaded images (Phase 4B contract §1).
 *
 * Why it exists: request photos are shown to vendors before they accept (PROJECT_BIBLE.md
 * section 32, amended 21/10/2026), and a phone photo can carry the exact GPS position of the
 * customer's home. So no uploaded byte is ever stored as received: each file is decoded and
 * re-encoded in its own format, turned upright, shrunk to at most 1600 px on its longest edge,
 * and saved without any of its metadata (EXIF, XMP, GPS).
 *
 * The decision that shaped it: what a file IS is judged by its bytes, never by the declared
 * mimetype or name — its first bytes must be a JPEG, PNG or WebP signature (so no other decoder
 * ever sees them) and sharp must decode it as that same format. A call is all or nothing: every
 * file is processed in memory first, and only then are they written and recorded; if any step
 * fails, whatever was written is removed. Names are 32 random hex characters.
 *
 * ⚠️ Never call sharp's `.withMetadata()` (or keepExif/keepMetadata) here: it would write the
 * customer's location back into the file. And never use the client's file name for anything.
 */

const crypto = require('crypto');
const fs = require('fs/promises');
const path = require('path');
const sharp = require('sharp');
const Upload = require('../models/upload');
const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { ERROR_CODES } = require('../utils/errorCodes');
const {
  MAX_IMAGE_EDGE_PX,
  IMAGE_QUALITY,
  MAX_INPUT_PIXELS,
  UPLOAD_URL_PREFIX,
  mayUpload,
  uploadRoot,
} = require('../config/uploads');

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// sharp's format name -> how it is stored. Re-encoding in the same format keeps PNG transparency.
const FORMATS = Object.freeze({
  jpeg: {
    ext: 'jpg',
    mimeType: 'image/jpeg',
    encode: (image) => image.jpeg({ quality: IMAGE_QUALITY }),
  },
  png: { ext: 'png', mimeType: 'image/png', encode: (image) => image.png() },
  webp: {
    ext: 'webp',
    mimeType: 'image/webp',
    encode: (image) => image.webp({ quality: IMAGE_QUALITY }),
  },
});

const formatBySignature = (bytes) => {
  if (!Buffer.isBuffer(bytes)) return null;
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'jpeg';
  }
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(PNG_SIGNATURE)) return 'png';
  if (
    bytes.length >= 12 &&
    bytes.toString('latin1', 0, 4) === 'RIFF' &&
    bytes.toString('latin1', 8, 12) === 'WEBP'
  ) {
    return 'webp';
  }
  return null;
};

const invalid = (field, message) =>
  new ApiError(400, 'Validation Failed', [{ field, message }], ERROR_CODES.VALIDATION_FAILED);

const notAllowed = () =>
  new ApiError(
    400,
    'Only JPEG, PNG and WebP images can be uploaded.',
    [{ field: 'files', message: '"files" must be JPEG, PNG or WebP images.' }],
    ERROR_CODES.FILE_TYPE_NOT_ALLOWED
  );

// The processed image, or FILE_TYPE_NOT_ALLOWED. sharp's own error is not passed on: it is about
// the caller's bytes, not a fault here.
const processImage = async (bytes) => {
  const format = formatBySignature(bytes);
  if (!format) throw notAllowed();

  try {
    // Over the pixel cap sharp refuses before decoding; that is answered like any other refusal.
    const image = sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS });
    const metadata = await image.metadata();
    if (metadata.format !== format) throw notAllowed();

    const resized = image
      .rotate()
      .resize({
        width: MAX_IMAGE_EDGE_PX,
        height: MAX_IMAGE_EDGE_PX,
        fit: 'inside',
        withoutEnlargement: true,
      });
    const data = await FORMATS[format].encode(resized).toBuffer();
    return { format, data };
  } catch (error) {
    throw notAllowed();
  }
};

const uploadMapper = (upload) => ({
  id: upload._id,
  path: upload.path,
  type: upload.type,
  mimeType: upload.mimeType,
  sizeBytes: upload.sizeBytes,
});

// Removes what a failed call managed to write. A failure here is logged (no paths: they are the
// only handle on a file) and the original error still answers the call.
const removePartial = async (written) => {
  try {
    await Promise.all(written.map(({ diskPath }) => fs.rm(diskPath, { force: true })));
    await Upload.deleteMany({ path: { $in: written.map(({ row }) => row.path) } });
  } catch (error) {
    logger.error(`[Upload cleanup failed] ${error && error.name}`, { count: written.length });
  }
};

class UploadService {
  /**
   * Stores the files of one call for the signed-in customer or vendor, in the order sent.
   * @param {{ type: string, files: object[], user: { id: string, role: string } }} input
   */
  async storeUploads({ type, files, user }) {
    if (!mayUpload(user.role, type)) {
      throw invalid('type', '"type" is not one this account can upload.');
    }
    if (!Array.isArray(files) || files.length === 0) {
      throw invalid('files', '"files" must contain at least one image.');
    }

    // One at a time keeps at most one decoded image in memory.
    const processed = [];
    for (const file of files) {
      processed.push(await processImage(file.buffer));
    }

    const directory = path.join(uploadRoot(), type);
    const written = [];
    try {
      await fs.mkdir(directory, { recursive: true });
      for (const { format, data } of processed) {
        const fileName = `${crypto.randomBytes(16).toString('hex')}.${FORMATS[format].ext}`;
        const diskPath = path.join(directory, fileName);
        // 'wx': never overwrite an existing file, however unlikely a repeated name is.
        await fs.writeFile(diskPath, data, { flag: 'wx' });
        written.push({
          diskPath,
          row: {
            path: `${UPLOAD_URL_PREFIX}/${type}/${fileName}`,
            type,
            ownerId: user.id,
            ownerRole: user.role,
            mimeType: FORMATS[format].mimeType,
            sizeBytes: data.length,
          },
        });
      }
      const rows = await Upload.insertMany(written.map(({ row }) => row));
      return rows.map(uploadMapper);
    } catch (error) {
      await removePartial(written);
      throw error;
    }
  }
}

module.exports = new UploadService();
