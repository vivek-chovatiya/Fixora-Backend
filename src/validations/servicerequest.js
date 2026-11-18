const Joi = require('joi');

const objectId = Joi.string().hex().length(24);

// Stored on the request only, never in the address book (requests contract §6).
const serviceAddressDetails = Joi.object({
  line1: Joi.string().trim().max(200).allow(''),
  line2: Joi.string().trim().max(200).allow(''),
  landmark: Joi.string().trim().max(200).allow(''),
  area: Joi.string().trim().max(120).allow(''),
  city: Joi.string().trim().max(120).allow(''),
  pincode: Joi.string().trim().max(12).allow(''),
  latitude: Joi.number().min(-90).max(90).allow(null),
  longitude: Joi.number().min(-180).max(180).allow(null),
});

const createRequest = {
  body: Joi.object({
    categoryId: objectId.required(),
    subCategoryId: objectId.empty(['', null]),
    addressId: objectId.empty(['', null]),
    vendorId: objectId.empty(['', null]),
    // Required when no saved address is chosen: the request records where the work is, as given.
    serviceAddress: Joi.string()
      .trim()
      .max(500)
      .empty('')
      .when('addressId', { not: Joi.exist(), then: Joi.required() }),
    serviceAddressDetails: serviceAddressDetails.allow(null),
    description: Joi.string().trim().max(1000).allow('').default(''),
    images: Joi.array().items(Joi.string().max(2048)).max(10).optional(),
    priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').default('MEDIUM'),
    scheduledAt: Joi.date().iso().optional().allow(null),
    notes: Joi.string().max(500).trim().optional().allow(''),
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
    // Vendors only: the open broadcast requests this vendor declined (requests contract §2, §4).
    declined: Joi.boolean(),
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
    note: Joi.string().max(500).trim().allow(''),
  }),
};

const completeRequest = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    amount: Joi.number().min(0),
    completionImages: Joi.array().items(Joi.string().max(2048)).max(10).optional(),
    note: Joi.string().max(500).trim().allow(''),
  }),
};

// Customer cancel, allowed until a professional accepts (requests contract §5).
const cancelRequest = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    reason: Joi.string().trim().max(500).allow(''),
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
  cancelRequest,
  getById,
};
