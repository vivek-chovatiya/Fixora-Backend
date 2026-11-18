const Joi = require('joi');
const { phone } = require('./fields');

const updateVendor = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    businessName: Joi.string().max(100).trim(),
    ownerName: Joi.string().max(100).trim(),
    email: Joi.string().max(254).email().lowercase().trim(),
    phone,
    categoryIds: Joi.array().items(Joi.string().hex().length(24)).max(20),
    address: Joi.string().max(200).trim(),
    description: Joi.string().max(1000).trim(),
    availability: Joi.boolean(),
    profileImage: Joi.string().max(2048).allow(null, ''),
    shopImages: Joi.array().items(Joi.string().max(2048)).max(10),
    documents: Joi.array().items(Joi.string().max(2048)).max(10),
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
    search: Joi.string().max(100).trim().allow(''),
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

// Administrator reissue of a vendor's permanent auth code (PROJECT_BIBLE.md section 7A.2,
// amended 21/10/2026).
const regenerateAuthCode = getById;

module.exports = {
  updateVendor,
  updateApprovalStatus,
  listVendors,
  getById,
  regenerateAuthCode,
};
