const { Joi, objectId, idBody } = require('./common');

const fields = {
  title: Joi.string().trim().max(40),
  addressLine1: Joi.string().trim().min(3).max(200),
  addressLine2: Joi.string().trim().max(200).allow(''),
  city: Joi.string().trim().min(2).max(80),
  state: Joi.string().trim().min(2).max(80),
  pincode: Joi.string()
    .trim()
    .pattern(/^[0-9A-Za-z -]{4,10}$/)
    .messages({ 'string.pattern.base': 'Enter a valid postal code.' }),
  latitude: Joi.number().min(-90).max(90).allow(null),
  longitude: Joi.number().min(-180).max(180).allow(null),
  isDefault: Joi.boolean(),
};

const createAddress = {
  body: Joi.object({
    ...fields,
    title: fields.title.default('Home'),
    addressLine1: fields.addressLine1.required(),
    city: fields.city.required(),
    state: fields.state.required(),
    pincode: fields.pincode.required(),
    isDefault: fields.isDefault.default(false),
  }),
};

const updateAddress = { body: Joi.object({ id: objectId().required(), ...fields }) };

module.exports = { createAddress, updateAddress, getById: idBody };
