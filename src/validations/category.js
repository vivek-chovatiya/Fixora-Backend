const Joi = require('joi');

const createCategory = {
  body: Joi.object({
    name: Joi.string().max(100).trim().required(),
    slug: Joi.string().max(100).trim().lowercase(),
    icon: Joi.string().max(200).allow(null, ''),
    description: Joi.string().max(1000).trim().allow(''),
    sortOrder: Joi.number().integer().default(0),
    isVisible: Joi.boolean().default(true),
  }),
};

const updateCategory = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    name: Joi.string().max(100).trim(),
    slug: Joi.string().max(100).trim().lowercase(),
    icon: Joi.string().max(200).allow(null, ''),
    description: Joi.string().max(1000).trim().allow(''),
    sortOrder: Joi.number().integer(),
    isVisible: Joi.boolean(),
    status: Joi.string().valid('ACTIVE', 'INACTIVE'),
  }),
};

const listCategories = {
  body: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().max(100).trim().allow(''),
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
