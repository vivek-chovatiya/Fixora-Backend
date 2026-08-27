const Joi = require('joi');

const updateCustomer = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    firstName: Joi.string().trim(),
    lastName: Joi.string().trim().allow(''),
    email: Joi.string().email().lowercase().trim(),
    phone: Joi.string().trim(),
    profileImage: Joi.string().allow(null, ''),
    defaultAddress: Joi.string().hex().length(24).allow(null),
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'BLOCKED'),
  }),
};

const listCustomers = {
  body: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().allow(''),
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'BLOCKED'),
  }),
};

const getById = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
};

module.exports = {
  updateCustomer,
  listCustomers,
  getById,
};
