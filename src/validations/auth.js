const Joi = require('joi');

const login = {
  body: Joi.object({
    email: Joi.string().email().lowercase().trim().required(),
    password: Joi.string().required(),
    role: Joi.string().valid('CUSTOMER', 'VENDOR', 'ADMIN').required(),
  }),
};

const registerCustomer = {
  body: Joi.object({
    firstName: Joi.string().trim().required(),
    lastName: Joi.string().trim().allow(''),
    email: Joi.string().email().lowercase().trim().required(),
    phone: Joi.string().trim().required(),
    password: Joi.string().min(6).required(),
  }),
};

const registerVendor = {
  body: Joi.object({
    businessName: Joi.string().trim().required(),
    ownerName: Joi.string().trim().required(),
    email: Joi.string().email().lowercase().trim().required(),
    phone: Joi.string().trim().required(),
    password: Joi.string().min(6).required(),
    address: Joi.string().trim().required(),
    description: Joi.string().trim().allow(''),
    categoryIds: Joi.array().items(Joi.string().hex().length(24)),
  }),
};

module.exports = {
  login,
  registerCustomer,
  registerVendor,
};
