const Joi = require('joi');

const createSubCategory = {
  body: Joi.object({
    categoryId: Joi.string().hex().length(24).required(),
    name: Joi.string().max(100).trim().required(),
    slug: Joi.string().max(100).trim().lowercase(),
    icon: Joi.string().max(200).allow(null, ''),
    description: Joi.string().max(1000).trim().allow(''),
    estimatedDuration: Joi.number().integer().min(0).default(60),
    estimatedPrice: Joi.number().min(0).default(0),
    isVisible: Joi.boolean().default(true),
  }),
};

const updateSubCategory = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    categoryId: Joi.string().hex().length(24),
    name: Joi.string().max(100).trim(),
    slug: Joi.string().max(100).trim().lowercase(),
    icon: Joi.string().max(200).allow(null, ''),
    description: Joi.string().max(1000).trim().allow(''),
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
  createSubCategory,
  updateSubCategory,
  listSubCategories,
  getById,
};
