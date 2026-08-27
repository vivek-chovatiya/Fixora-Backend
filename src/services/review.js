const Review = require('../models/review');
const ServiceRequest = require('../models/servicerequest');
const Vendor = require('../models/vendor');
const ApiError = require('../utils/ApiError');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');

const reviewMapper = (review) => {
  if (!review) return null;
  return {
    id: review._id,
    serviceRequestId: review.serviceRequestId,
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

    return reviewMapper(review);
  }

  async getVendorReviews(vendorId, body = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = { vendorId, isDeleted: { $ne: true } };

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate('customerId', 'firstName lastName profileImage'),
      Review.countDocuments(filter),
    ]);

    const mapped = reviews.map(reviewMapper);
    const meta = getPaginationMetadata(total, page, limit);

    return { data: mapped, meta };
  }
}

module.exports = new ReviewService();
