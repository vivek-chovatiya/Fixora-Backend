const Joi = require('joi');

const createAdmin = {
  body: Joi.object({
    name: Joi.string().max(100).trim().required(),
    email: Joi.string().max(254).email().lowercase().trim().required(),
    phone: Joi.string().max(20).trim().required(),
    password: Joi.string().max(128).min(6).required(),
  }),
};

const updateAdmin = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    name: Joi.string().max(100).trim(),
    email: Joi.string().max(254).email().lowercase().trim(),
    phone: Joi.string().max(20).trim(),
    status: Joi.string().valid('ACTIVE', 'INACTIVE'),
  }),
};

const getById = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
};

module.exports = {
  createAdmin,
  updateAdmin,
  getById,
};
