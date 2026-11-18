const Joi = require('joi');

// Only the address text and the title are required, so a hand-typed address can be saved
// (requests contract §7, lead 17/11/2026). The title still defaults to 'Home'.
// On update, null or '' clears a field (services/address.js stores '' either way).
const optionalPart = Joi.string().max(200).trim().allow('', null);

const createAddress = {
  body: Joi.object({
    title: Joi.string().max(100).trim().default('Home'),
    addressLine1: Joi.string().max(240).trim().required(),
    addressLine2: optionalPart,
    city: optionalPart,
    state: optionalPart,
    pincode: optionalPart,
    latitude: Joi.number().allow(null),
    longitude: Joi.number().allow(null),
    isDefault: Joi.boolean().default(false),
  }),
};

const updateAddress = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    title: Joi.string().max(100).trim(),
    addressLine1: Joi.string().max(240).trim(),
    addressLine2: optionalPart,
    city: optionalPart,
    state: optionalPart,
    pincode: optionalPart,
    latitude: Joi.number().allow(null),
    longitude: Joi.number().allow(null),
    isDefault: Joi.boolean(),
  }),
};

const getById = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
};

module.exports = {
  createAddress,
  updateAddress,
  getById,
};
