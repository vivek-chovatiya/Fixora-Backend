const Joi = require('joi');
const { normalizePhone } = require('../utils/phone');

const objectId = () => Joi.string().hex().length(24);

/** Only files served from our own /uploads directory may be attached. */
const uploadedPath = () =>
  Joi.string()
    .trim()
    .pattern(/^\/uploads\/[A-Za-z0-9._-]+$/)
    .messages({ 'string.pattern.base': 'Image must be uploaded through the upload API.' });

/** Accepts common formats and stores one canonical E.164 value (see utils/phone). */
const phone = () =>
  Joi.string()
    .trim()
    .custom((value, helpers) => normalizePhone(value) || helpers.error('string.pattern.base'))
    .messages({ 'string.pattern.base': 'Enter a valid phone number (10–15 digits).' });

const password = () => Joi.string().min(8).max(64).messages({
  'string.min': 'Password must be at least 8 characters.',
});

const pagination = {
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
};

const idBody = { body: Joi.object({ id: objectId().required() }) };

module.exports = { Joi, objectId, uploadedPath, phone, password, pagination, idBody };
