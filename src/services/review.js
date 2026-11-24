const mongoose = require('mongoose');
const Review = require('../models/review');
const vendorService = require('./vendor');
const notificationService = require('./notification');
const serviceRequestService = require('./servicerequest');
const logger = require('../utils/logger');
const { getPagination, getPaginationMetadata } = require('../utils/pagination');
const { fullName } = require('../utils/text');
const { ROLE, NOTIFICATION_TYPE } = require('../constants');

const NOT_DELETED = { isDeleted: { $ne: true } };

const reviewMapper = (review) => {
  if (!review) return null;
  const customer =
    review.customerId && review.customerId._id
      ? {
          id: review.customerId._id,
          name: fullName(review.customerId.firstName, review.customerId.lastName),
          profileImage: review.customerId.profileImage || null,
        }
      : null;
  return {
    id: review._id,
    serviceRequestId: review.serviceRequestId,
    vendorId: review.vendorId,
    customer,
    rating: review.rating,
    comment: review.comment,
    images: review.images || [],
    createdAt: review.createdAt,
  };
};

const toObjectId = (id) => new mongoose.Types.ObjectId(String(id));

class ReviewService {
  /** One request = one review, and only after completion (PROJECT_BIBLE §11.7). */
  async createReview(customerId, payload) {
    const request = await serviceRequestService.assertReviewable(payload.serviceRequestId, customerId);

    const review = await Review.create({
      serviceRequestId: request._id,
      customerId,
      vendorId: request.vendorId,
      rating: payload.rating,
      comment: payload.comment || '',
      images: payload.images || [],
    });

    await serviceRequestService.markReviewed(request._id, customerId);
    await this.recalculateVendorRating(request.vendorId);

    await notificationService.notify({
      userId: request.vendorId,
      userRole: ROLE.VENDOR,
      type: NOTIFICATION_TYPE.REVIEW,
      title: 'New review received',
      message: `You received a ${payload.rating}-star review for ${request.requestNumber}.`,
      referenceId: request._id,
    });

    logger.info(`Review submitted for ${request.requestNumber}`);
    const populated = await Review.findById(review._id).populate(
      'customerId',
      'firstName lastName profileImage'
    );
    return reviewMapper(populated);
  }

  async recalculateVendorRating(vendorId) {
    const [stats] = await Review.aggregate([
      { $match: { vendorId: toObjectId(vendorId), isDeleted: { $ne: true } } },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    const averageRating = stats ? Math.round(stats.avg * 10) / 10 : 0;
    const totalReviews = stats ? stats.count : 0;
    await vendorService.updateRating(vendorId, averageRating, totalReviews);
  }

  async getReviewForRequest(serviceRequestId) {
    const review = await Review.findOne({ serviceRequestId, ...NOT_DELETED }).populate(
      'customerId',
      'firstName lastName profileImage'
    );
    return reviewMapper(review);
  }

  async getVendorReviews(vendorId, body = {}) {
    const { page, limit, skip } = getPagination(body);
    const filter = { vendorId, ...NOT_DELETED };

    const [reviews, total] = await Promise.all([
      Review.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate('customerId', 'firstName lastName profileImage'),
      Review.countDocuments(filter),
    ]);

    return { data: reviews.map(reviewMapper), meta: getPaginationMetadata(total, page, limit) };
  }

  /** Average, total and 1–5 star breakdown with percentages (App PROJECT_BIBLE §41). */
  async getVendorReviewSummary(vendorId) {
    const rows = await Review.aggregate([
      { $match: { vendorId: toObjectId(vendorId), isDeleted: { $ne: true } } },
      { $group: { _id: '$rating', count: { $sum: 1 } } },
    ]);
    const totalReviews = rows.reduce((sum, r) => sum + r.count, 0);
    const totalScore = rows.reduce((sum, r) => sum + r._id * r.count, 0);
    const breakdown = [5, 4, 3, 2, 1].map((stars) => {
      const count = (rows.find((r) => r._id === stars) || { count: 0 }).count;
      return {
        stars,
        count,
        percentage: totalReviews ? Math.round((count / totalReviews) * 100) : 0,
      };
    });
    return {
      averageRating: totalReviews ? Math.round((totalScore / totalReviews) * 10) / 10 : 0,
      totalReviews,
      breakdown,
    };
  }

  async getAverageSince(vendorId, since) {
    const [stats] = await Review.aggregate([
      {
        $match: {
          vendorId: toObjectId(vendorId),
          isDeleted: { $ne: true },
          createdAt: { $gte: since },
        },
      },
      { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
    ]);
    return {
      averageRating: stats ? Math.round(stats.avg * 10) / 10 : 0,
      totalReviews: stats ? stats.count : 0,
    };
  }
}

module.exports = new ReviewService();
