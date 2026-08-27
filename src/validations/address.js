const Joi = require('joi');

const createAddress = {
  body: Joi.object({
    title: Joi.string().trim().default('Home'),
    addressLine1: Joi.string().trim().required(),
    addressLine2: Joi.string().trim().allow(''),
    city: Joi.string().trim().required(),
    state: Joi.string().trim().required(),
    pincode: Joi.string().trim().required(),
    latitude: Joi.number().allow(null),
    longitude: Joi.number().allow(null),
    isDefault: Joi.boolean().default(false),
  }),
};

const updateAddress = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    title: Joi.string().trim(),
    addressLine1: Joi.string().trim(),
    addressLine2: Joi.string().trim().allow(''),
    city: Joi.string().trim(),
    state: Joi.string().trim(),
    pincode: Joi.string().trim(),
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
