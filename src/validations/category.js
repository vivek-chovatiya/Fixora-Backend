const Joi = require('joi');

const createCategory = {
  body: Joi.object({
    name: Joi.string().trim().required(),
    slug: Joi.string().trim().lowercase(),
    icon: Joi.string().allow(null, ''),
    description: Joi.string().trim().allow(''),
    sortOrder: Joi.number().integer().default(0),
    isVisible: Joi.boolean().default(true),
  }),
};

const updateCategory = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    name: Joi.string().trim(),
    slug: Joi.string().trim().lowercase(),
    icon: Joi.string().allow(null, ''),
    description: Joi.string().trim().allow(''),
    sortOrder: Joi.number().integer(),
    isVisible: Joi.boolean(),
    status: Joi.string().valid('ACTIVE', 'INACTIVE'),
  }),
};

const listCategories = {
  body: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().allow(''),
    status: Joi.string().valid('ACTIVE', 'INACTIVE'),
  }),
};

const getById = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
};

module.exports = {
  createCategory,
  updateCategory,
  listCategories,
  getById,
};
