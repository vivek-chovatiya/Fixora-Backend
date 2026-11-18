const Joi = require('joi');

const createReview = {
  body: Joi.object({
    serviceRequestId: Joi.string().hex().length(24).required(),
    rating: Joi.number().integer().min(1).max(5).required(),
    comment: Joi.string().max(500).trim().allow(''),
    images: Joi.array().items(Joi.string().max(2048)).max(10).optional(),
  }),
};

const listVendorReviews = {
  body: Joi.object({
    vendorId: Joi.string().hex().length(24).required(),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

const reviewForRequest = {
  body: Joi.object({
    requestId: Joi.string().hex().length(24).required(),
  }),
};

const getById = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
};

module.exports = {
  createReview,
  listVendorReviews,
  reviewForRequest,
  getById,
};
