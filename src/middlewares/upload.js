const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const ApiError = require('../utils/ApiError');
const config = require('../config');

const uploadDir = path.resolve(config.upload.path);

if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

/** Extension is derived from the validated MIME type, never from the client filename. */
const EXTENSION_BY_MIME = Object.freeze({
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
});

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
    cb(null, `${unique}${EXTENSION_BY_MIME[file.mimetype]}`);
  },
});

const fileFilter = (req, file, cb) => {
  if (EXTENSION_BY_MIME[file.mimetype]) {
    cb(null, true);
  } else {
    cb(new ApiError(400, 'Invalid file type. Only JPG, PNG, WEBP and PDF files are allowed.'), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: config.upload.maxFileSizeBytes, files: config.upload.maxFilesPerUpload },
});

module.exports = upload;
module.exports.uploadDir = uploadDir;
