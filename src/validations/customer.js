const Joi = require('joi');
const { phone } = require('./fields');

const updateCustomer = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    firstName: Joi.string().max(100).trim(),
    lastName: Joi.string().max(100).trim().allow(''),
    // null or '' removes it (Phase 4B contract §7); leaving it out keeps it.
    email: Joi.string().max(254).email().lowercase().trim().allow(null, ''),
    phone,
    // An uploaded `profile` image, the stored one, or null / '' to clear (contract §2).
    profileImage: Joi.string().max(2048).allow(null, ''),
    defaultAddress: Joi.string().hex().length(24).allow(null),
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'BLOCKED'),
  }),
};

const listCustomers = {
  body: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().max(100).trim().allow(''),
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
