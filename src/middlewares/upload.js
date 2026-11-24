/**
 * Receives the image files of `POST /uploads` into memory (Phase 4B contract §1).
 *
 * Why it exists: every file must be decoded and re-encoded (services/upload.js) before anything
 * reaches the disk, and a call is all or nothing, so nothing may be written while the parts are
 * still arriving. It replaces the earlier disk-storage middleware (which kept the client's file
 * extension and allowed PDFs); nothing routed through that one.
 *
 * The decision that shaped it: memory storage with the contract's limits — 5 MB per file as
 * received, 5 files, all under the field name `files`. Multer's own errors pass through to
 * middlewares/error.js, which answers them FILE_TOO_LARGE / TOO_MANY_FILES / VALIDATION_FAILED;
 * a body that cannot be parsed as multipart at all is the caller's input and answers 400 here,
 * never a 500.
 *
 * ⚠️ Mount it after `authenticate` and `authorize`: an anonymous caller must never make the server
 * hold 25 MB. And never read `file.originalname` anywhere: the client's file name is not stored,
 * returned or logged.
 */

const multer = require('multer');
const ApiError = require('../utils/ApiError');
const { ERROR_CODES } = require('../utils/errorCodes');
const { MAX_UPLOAD_FILE_BYTES, MAX_UPLOAD_FILES } = require('../config/uploads');

// Busboy refuses a file as soon as it REACHES `fileSize` bytes, so one byte more than the maximum
// is what lets a file of exactly 5 MB through ("at most 5 MB") and refuses 5 MB + 1.
const parseFiles = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_UPLOAD_FILE_BYTES + 1, files: MAX_UPLOAD_FILES },
}).array('files', MAX_UPLOAD_FILES);

const receiveUploadFiles = (req, res, next) =>
  parseFiles(req, res, (error) => {
    if (!error || error instanceof multer.MulterError) return next(error);
    // Busboy's own parse failures (no boundary, a part cut short). Its message is not passed on.
    return next(
      new ApiError(
        400,
        'Validation Failed',
        [{ field: 'files', message: 'The upload could not be read.' }],
        ERROR_CODES.VALIDATION_FAILED
      )
    );
  });

module.exports = receiveUploadFiles;
