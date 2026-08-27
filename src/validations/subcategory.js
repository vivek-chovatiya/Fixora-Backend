const Joi = require('joi');

const createSubCategory = {
  body: Joi.object({
    categoryId: Joi.string().hex().length(24).required(),
    name: Joi.string().trim().required(),
    slug: Joi.string().trim().lowercase(),
    icon: Joi.string().allow(null, ''),
    description: Joi.string().trim().allow(''),
    estimatedDuration: Joi.number().integer().min(0).default(60),
    estimatedPrice: Joi.number().min(0).default(0),
    isVisible: Joi.boolean().default(true),
  }),
};

const updateSubCategory = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    categoryId: Joi.string().hex().length(24),
    name: Joi.string().trim(),
    slug: Joi.string().trim().lowercase(),
    icon: Joi.string().allow(null, ''),
    description: Joi.string().trim().allow(''),
    estimatedDuration: Joi.number().integer().min(0),
    estimatedPrice: Joi.number().min(0),
    isVisible: Joi.boolean(),
    status: Joi.string().valid('ACTIVE', 'INACTIVE'),
  }),
};

const listSubCategories = {
  body: Joi.object({
    categoryId: Joi.string().hex().length(24),
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
  createSubCategory,
  updateSubCategory,
  listSubCategories,
  getById,
};
