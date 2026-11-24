const { Joi, objectId, uploadedPath, pagination, idBody } = require('./common');

const createCategory = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(80).required(),
    slug: Joi.string().trim().lowercase().max(80),
    icon: Joi.string().trim().max(60).allow(null, ''),
    image: uploadedPath().allow(null, ''),
    description: Joi.string().trim().max(300).allow(''),
    sortOrder: Joi.number().integer().default(0),
    isVisible: Joi.boolean().default(true),
  }),
};

const updateCategory = {
  body: Joi.object({
    id: objectId().required(),
    name: Joi.string().trim().min(2).max(80),
    slug: Joi.string().trim().lowercase().max(80),
    icon: Joi.string().trim().max(60).allow(null, ''),
    image: uploadedPath().allow(null, ''),
    description: Joi.string().trim().max(300).allow(''),
    sortOrder: Joi.number().integer(),
    isVisible: Joi.boolean(),
    status: Joi.string().valid('ACTIVE', 'INACTIVE'),
  }),
};

const listCategories = {
  body: Joi.object({
    ...pagination,
    limit: Joi.number().integer().min(1).max(100).default(100),
    search: Joi.string().trim().max(100).allow(''),
    status: Joi.string().valid('ACTIVE', 'INACTIVE'),
  }),
};

module.exports = { createCategory, updateCategory, listCategories, getById: idBody };
