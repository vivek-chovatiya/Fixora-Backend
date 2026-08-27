const Joi = require('joi');

const updateVendor = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    businessName: Joi.string().trim(),
    ownerName: Joi.string().trim(),
    email: Joi.string().email().lowercase().trim(),
    phone: Joi.string().trim(),
    categoryIds: Joi.array().items(Joi.string().hex().length(24)),
    address: Joi.string().trim(),
    description: Joi.string().trim(),
    availability: Joi.boolean(),
    profileImage: Joi.string().allow(null, ''),
    shopImages: Joi.array().items(Joi.string()),
    documents: Joi.array().items(Joi.string()),
  }),
};

const updateApprovalStatus = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    approvalStatus: Joi.string().valid('PENDING', 'APPROVED', 'REJECTED').required(),
  }),
};

const listVendors = {
  body: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().trim().allow(''),
    approvalStatus: Joi.string().valid('PENDING', 'APPROVED', 'REJECTED'),
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'BLOCKED'),
    categoryId: Joi.string().hex().length(24),
  }),
};

const getById = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
};

module.exports = {
  updateVendor,
  updateApprovalStatus,
  listVendors,
  getById,
};
