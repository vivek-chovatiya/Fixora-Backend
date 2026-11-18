const reviewService = require('../services/review');
const ApiResponse = require('../utils/ApiResponse');

class ReviewController {
  async create(req, res, next) {
    try {
      const review = await reviewService.createReview(req.user.id, req.body);
      return ApiResponse.created(res, 'Review submitted successfully.', review);
    } catch (error) {
      next(error);
    }
  }

  async getForRequest(req, res, next) {
    try {
      const review = await reviewService.getReviewForRequest(req.user.id, req.body.requestId);
      return ApiResponse.success(res, 'Review retrieved successfully.', review);
    } catch (error) {
      next(error);
    }
  }

  async getVendorReviews(req, res, next) {
    try {
      const { data, meta } = await reviewService.getVendorReviews(req.body.vendorId, req.body);
      return ApiResponse.success(res, 'Vendor reviews retrieved successfully.', data, meta);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new ReviewController();
