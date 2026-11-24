const { Joi, objectId, phone, password } = require('./common');
const { ROLES } = require('../constants');

const role = () => Joi.string().valid(...ROLES).required();

const login = {
  body: Joi.object({
    identifier: Joi.string().trim().max(120),
    email: Joi.string().trim().max(120),
    password: Joi.string().required(),
    role: role(),
  }).or('identifier', 'email'),
};

const registerCustomer = {
  body: Joi.object({
    firstName: Joi.string().trim().min(1).max(60).required(),
    lastName: Joi.string().trim().max(60).allow(''),
    email: Joi.string().email().lowercase().trim().required(),
    phone: phone().required(),
    password: password().required(),
  }),
};

const registerVendor = {
  body: Joi.object({
    businessName: Joi.string().trim().min(2).max(120).required(),
    ownerName: Joi.string().trim().min(2).max(120).required(),
    email: Joi.string().email().lowercase().trim().required(),
    phone: phone().required(),
    password: password().required(),
    address: Joi.string().trim().min(3).max(300).required(),
    description: Joi.string().trim().max(1000).allow(''),
    workingAreas: Joi.array().items(Joi.string().trim().max(80)).max(20),
    workingHours: Joi.string().trim().max(120).allow(''),
    categoryIds: Joi.array().items(objectId()).min(1).required().messages({
      'array.min': 'Select at least one service category.',
    }),
  }),
};

const forgotPassword = {
  body: Joi.object({ identifier: Joi.string().trim().required(), role: role() }),
};

const resetPassword = {
  body: Joi.object({
    identifier: Joi.string().trim().required(),
    role: role(),
    code: Joi.string().trim().length(6).required(),
    newPassword: password().required(),
  }),
};

const changePassword = {
  body: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: password().required(),
  }),
};

module.exports = { login, registerCustomer, registerVendor, forgotPassword, resetPassword, changePassword };
