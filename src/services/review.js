const Review = require('../models/review');
const ServiceRequest = require('../models/servicerequest');
const Vendor = require('../models/vendor');
const ApiError = require('../utils/ApiError');
const { ERROR_CODES } = require('../utils/errorCodes');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');

// Every review carries the reviewed request's requestNumber beside its id (requests contract §7),
// so an app can show the reference without a second read. `serviceRequestId` stays the id.
const reviewMapper = (review, requestNumber = null) => {
  if (!review) return null;
  const request = review.serviceRequestId;
  const populated = Boolean(request && request.requestNumber !== undefined);
  return {
    id: review._id,
    serviceRequestId: populated ? request._id : request,
    requestNumber: populated ? request.requestNumber : requestNumber,
    customerId: review.customerId,
    vendorId: review.vendorId,
    rating: review.rating,
    comment: review.comment,
    images: review.images || [],
    createdAt: review.createdAt,
    updatedAt: review.updatedAt,
  };
};

class ReviewService {
  async createReview(customerId, payload) {
    const request = await ServiceRequest.findOne({
      _id: payload.serviceRequestId,
      isDeleted: { $ne: true },
    });
    if (!request || request.customerId.toString() !== customerId.toString()) {
      throw new ApiError(404, 'Service request not found.');
    }

    if (request.status !== 'COMPLETED') {
      throw new ApiError(400, 'Cannot review a service request that is not completed.');
    }

    if (!request.vendorId) {
      throw new ApiError(400, 'No vendor associated with this service request.');
    }

    const existingReview = await Review.findOne({
      serviceRequestId: payload.serviceRequestId,
      isDeleted: { $ne: true },
    });
    if (existingReview) {
      throw new ApiError(409, 'Review already submitted for this service request.');
    }

    const review = await Review.create({
      ...payload,
      customerId,
      vendorId: request.vendorId,
    });

    const vendorReviews = await Review.find({
      vendorId: request.vendorId,
      isDeleted: { $ne: true },
    });
    const totalReviews = vendorReviews.length;
    const totalRating = vendorReviews.reduce((sum, r) => sum + r.rating, 0);
    const averageRating = Math.round((totalRating / totalReviews) * 10) / 10;

    await Vendor.findByIdAndUpdate(request.vendorId, { averageRating, totalReviews });

    return reviewMapper(review, request.requestNumber);
  }

  // §8: the customer's own review of their own request. Someone else's request answers
  // REQUEST_NOT_FOUND (never confirm it exists); their own with no review yet, REVIEW_NOT_FOUND.
  async getReviewForRequest(customerId, requestId) {
    const request = await ServiceRequest.findOne({ _id: requestId, isDeleted: { $ne: true } });
    if (!request || String(request.customerId) !== String(customerId)) {
      throw new ApiError(404, 'Service request not found.', null, ERROR_CODES.REQUEST_NOT_FOUND);
    }

    const review = await Review.findOne({
      serviceRequestId: request._id,
      customerId,
      isDeleted: { $ne: true },
    });
    if (!review) {
      throw new ApiError(404, 'No review for this request yet.', null, ERROR_CODES.REVIEW_NOT_FOUND);
    }

    return reviewMapper(review, request.requestNumber);
  }

  async getVendorReviews(vendorId, body = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = { vendorId, isDeleted: { $ne: true } };

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate('customerId', 'firstName lastName profileImage')
        .populate('serviceRequestId', 'requestNumber'),
      Review.countDocuments(filter),
    ]);

    const mapped = reviews.map((review) => reviewMapper(review));
    const meta = getPaginationMetadata(total, page, limit);

    return { data: mapped, meta };
  }
}

module.exports = new ReviewService();
