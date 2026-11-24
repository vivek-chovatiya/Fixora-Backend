const { Joi, objectId, uploadedPath, pagination } = require('./common');

const createReview = {
  body: Joi.object({
    serviceRequestId: objectId().required(),
    rating: Joi.number().integer().min(1).max(5).required(),
    comment: Joi.string().trim().max(1000).allow(''),
    images: Joi.array().items(uploadedPath()).max(5),
  }),
};

const listVendorReviews = {
  body: Joi.object({ vendorId: objectId(), ...pagination }),
};

const vendorSummary = { body: Joi.object({ vendorId: objectId() }) };

module.exports = { createReview, listVendorReviews, vendorSummary };
