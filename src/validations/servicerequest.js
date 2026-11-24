const { Joi, objectId, uploadedPath, pagination, idBody } = require('./common');
const {
  PRIORITIES,
  PRIORITY,
  REQUEST_STATUSES,
  VENDOR_REQUEST_VIEWS,
  CUSTOMER_REQUEST_VIEWS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
} = require('../constants');

const createRequest = {
  body: Joi.object({
    categoryId: objectId().required(),
    subCategoryId: objectId().required(),
    addressId: objectId().required(),
    /** Optional — absent means open dispatch (App PROJECT_BIBLE §18A). */
    vendorId: objectId().allow(null, ''),
    description: Joi.string().trim().min(10).max(2000).required().messages({
      'string.min': 'Please describe the problem in at least 10 characters.',
    }),
    notes: Joi.string().trim().max(1000).allow(''),
    images: Joi.array().items(uploadedPath()).max(5),
    priority: Joi.string().valid(...PRIORITIES).default(PRIORITY.MEDIUM),
    preferredDate: Joi.date().iso().min('now').allow(null).messages({
      'date.min': 'Preferred date cannot be in the past.',
    }),
    preferredTime: Joi.string().trim().max(40).allow(''),
  }),
};

const listRequests = {
  body: Joi.object({
    ...pagination,
    view: Joi.string().valid(...new Set([...VENDOR_REQUEST_VIEWS, ...CUSTOMER_REQUEST_VIEWS])),
    status: Joi.string().valid(...REQUEST_STATUSES),
    priority: Joi.string().valid(...PRIORITIES),
  }),
};

const assignTeamMember = {
  body: Joi.object({
    id: objectId().required(),
    assignedTeamMemberId: objectId().required(),
  }),
};

const withReason = {
  body: Joi.object({
    id: objectId().required(),
    reason: Joi.string().trim().max(500).allow(''),
  }),
};

const completeRequest = {
  body: Joi.object({
    id: objectId().required(),
    finalAmount: Joi.number().min(0).max(10000000).required(),
    paymentMethod: Joi.string().valid(...PAYMENT_METHODS).required(),
    paymentStatus: Joi.string().valid(...PAYMENT_STATUSES).required(),
    completionNotes: Joi.string().trim().max(1000).allow(''),
    completionImages: Joi.array().items(uploadedPath()).max(5),
  }),
};

module.exports = {
  createRequest,
  listRequests,
  assignTeamMember,
  rejectRequest: withReason,
  cancelRequest: withReason,
  completeRequest,
  getById: idBody,
};
