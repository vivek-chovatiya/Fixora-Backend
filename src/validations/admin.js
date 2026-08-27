const Joi = require('joi');

const createAdmin = {
  body: Joi.object({
    name: Joi.string().trim().required(),
    email: Joi.string().email().lowercase().trim().required(),
    phone: Joi.string().trim().required(),
    password: Joi.string().min(6).required(),
  }),
};

const updateAdmin = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    name: Joi.string().trim(),
    email: Joi.string().email().lowercase().trim(),
    phone: Joi.string().trim(),
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
