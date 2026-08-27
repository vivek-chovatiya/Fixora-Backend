const Joi = require('joi');

const createRequest = {
  body: Joi.object({
    categoryId: Joi.string().hex().length(24).required(),
    subCategoryId: Joi.string().hex().length(24).required(),
    addressId: Joi.string().hex().length(24).required(),
    vendorId: Joi.string().hex().length(24).allow(null),
    description: Joi.string().trim().required(),
    images: Joi.array().items(Joi.string()).optional(),
    priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').default('MEDIUM'),
    scheduledAt: Joi.date().iso().allow(null),
    notes: Joi.string().trim().allow(''),
  }),
};

const listRequests = {
  body: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string().valid(
      'PENDING',
      'ACCEPTED',
      'ASSIGNED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'REJECTED'
    ),
    priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT'),
  }),
};

const assignTeamMember = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    assignedTeamMemberId: Joi.string().hex().length(24).required(),
  }),
};

const updateStatus = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    note: Joi.string().trim().allow(''),
  }),
};

const completeRequest = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    amount: Joi.number().min(0),
    completionImages: Joi.array().items(Joi.string()).optional(),
    note: Joi.string().trim().allow(''),
  }),
};

const getById = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
};

module.exports = {
  createRequest,
  listRequests,
  assignTeamMember,
  updateStatus,
  completeRequest,
  getById,
};
