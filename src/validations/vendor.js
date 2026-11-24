const { Joi, objectId, phone, uploadedPath, pagination, idBody } = require('./common');
const { APPROVAL_STATUSES, REPORT_PERIODS, REPORT_PERIOD } = require('../constants');

const updateVendor = {
  body: Joi.object({
    id: objectId(),
    businessName: Joi.string().trim().min(2).max(120),
    ownerName: Joi.string().trim().min(2).max(120),
    email: Joi.string().email().lowercase().trim(),
    phone: phone(),
    categoryIds: Joi.array().items(objectId()).min(1),
    address: Joi.string().trim().min(3).max(300),
    description: Joi.string().trim().max(1000).allow(''),
    workingAreas: Joi.array().items(Joi.string().trim().max(80)).max(20),
    workingHours: Joi.string().trim().max(120).allow(''),
    availability: Joi.boolean(),
    profileImage: uploadedPath().allow(null, ''),
    shopImages: Joi.array().items(uploadedPath()).max(10),
    documents: Joi.array().items(uploadedPath()).max(10),
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'BLOCKED'),
  }),
};

const updateApprovalStatus = {
  body: Joi.object({
    id: objectId().required(),
    approvalStatus: Joi.string().valid(...APPROVAL_STATUSES).required(),
    note: Joi.string().trim().max(500).allow(''),
  }),
};

const listVendors = {
  body: Joi.object({
    ...pagination,
    search: Joi.string().trim().max(100).allow(''),
    approvalStatus: Joi.string().valid(...APPROVAL_STATUSES),
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'BLOCKED'),
    categoryId: objectId(),
  }),
};

const recommended = {
  body: Joi.object({
    categoryId: objectId().required(),
    subCategoryId: objectId(),
    addressId: objectId(),
  }),
};

const report = {
  body: Joi.object({
    period: Joi.string().valid(...REPORT_PERIODS).default(REPORT_PERIOD.TODAY),
  }),
};

module.exports = { updateVendor, updateApprovalStatus, listVendors, recommended, report, getById: idBody };
