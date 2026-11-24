const Joi = require('joi');
const { UPLOAD_TYPE_NAMES } = require('../config/uploads');

// The text part of POST /uploads (Phase 4B contract §1). It runs after multer has parsed the
// multipart body, so the order of the parts does not matter. Whether this account may upload this
// type, and whether any file came, are checked in services/upload.js.
//
// ⚠️ The files themselves are not in `req.body` and are not checked here; a new text part must be
// added to this schema, or the validation middleware's stripUnknown silently drops it.
const createUpload = {
  body: Joi.object({
    type: Joi.string()
      .valid(...UPLOAD_TYPE_NAMES)
      .required(),
  }),
};

module.exports = {
  createUpload,
};
