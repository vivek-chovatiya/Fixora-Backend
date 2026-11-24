const { Joi, objectId, pagination, idBody } = require('./common');

const createSubCategory = {
  body: Joi.object({
    categoryId: objectId().required(),
    name: Joi.string().trim().min(2).max(80).required(),
    slug: Joi.string().trim().lowercase().max(80),
    icon: Joi.string().trim().max(60).allow(null, ''),
    description: Joi.string().trim().max(300).allow(''),
    estimatedDuration: Joi.number().integer().min(0).default(60),
    estimatedPrice: Joi.number().min(0).default(0),
    isVisible: Joi.boolean().default(true),
  }),
};

const updateSubCategory = {
  body: Joi.object({
    id: objectId().required(),
    categoryId: objectId(),
    name: Joi.string().trim().min(2).max(80),
    slug: Joi.string().trim().lowercase().max(80),
    icon: Joi.string().trim().max(60).allow(null, ''),
    description: Joi.string().trim().max(300).allow(''),
    estimatedDuration: Joi.number().integer().min(0),
    estimatedPrice: Joi.number().min(0),
    isVisible: Joi.boolean(),
    status: Joi.string().valid('ACTIVE', 'INACTIVE'),
  }),
};

const listSubCategories = {
  body: Joi.object({
    categoryId: objectId(),
    ...pagination,
    limit: Joi.number().integer().min(1).max(100).default(100),
    search: Joi.string().trim().max(100).allow(''),
    status: Joi.string().valid('ACTIVE', 'INACTIVE'),
  }),
};

module.exports = { createSubCategory, updateSubCategory, listSubCategories, getById: idBody };
