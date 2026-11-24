const reviewService = require('../services/review');
const ApiResponse = require('../utils/ApiResponse');
const { wrapController } = require('../utils/asyncHandler');
const { ROLE } = require('../constants');

/** Vendors always see their own reviews; everyone else must name a vendor. */
const resolveVendorId = (req) =>
  req.user && req.user.role === ROLE.VENDOR && !req.body.vendorId ? req.user.id : req.body.vendorId;

class ReviewController {
  async create(req, res) {
    const review = await reviewService.createReview(req.user.id, req.body);
    return ApiResponse.created(res, 'Thank you! Your review has been submitted.', review);
  }

  async getVendorReviews(req, res) {
    const { data, meta } = await reviewService.getVendorReviews(resolveVendorId(req), req.body);
    return ApiResponse.success(res, 'Reviews retrieved successfully.', data, meta);
  }

  async getVendorSummary(req, res) {
    const summary = await reviewService.getVendorReviewSummary(resolveVendorId(req));
    return ApiResponse.success(res, 'Review summary retrieved successfully.', summary);
  }
}

module.exports = wrapController(new ReviewController());
