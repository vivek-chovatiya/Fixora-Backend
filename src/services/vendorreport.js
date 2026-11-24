const mongoose = require('mongoose');
const ServiceRequest = require('../models/servicerequest');
const Review = require('../models/review');
const clock = require('../utils/clock');
const { TIME_ZONE, periodWindow } = require('../utils/indiaTime');
const serviceRequestService = require('./servicerequest');

/**
 * The signed-in vendor's report for today, this week or this month (PROJECT_BIBLE.md section 42,
 * section 30's Today's Requests; Phase 4B contract §5): five plain figures and a rating.
 *
 * Why it exists: the app sends only the period and computes no dates, so where a day, a week and
 * a month begin is decided here — in India time, the week from Monday — and the dashboard's
 * Today's Requests is this report's `today` total, one figure counted one way.
 *
 * The decisions that shaped it: `totalRequests` is exactly what the vendor's two lists
 * (`/requests/list` and `/requests/list { declined: true }`) hold, limited to requests created in
 * the window — built from the lists' own conditions, never a second copy of them. Completed,
 * rejected and cancelled count when they happened, so they can exceed the total. Older records
 * without the 4B timestamps fall back: a reject or cancel to `updatedAt`, a decline to the
 * request's `createdAt`.
 *
 * ⚠️ Nothing financial, ever (section 42: no financial analytics in Phase 1; earnings are Phase
 * 2's). Do not add an amount, a sum or a payment count here.
 */

const notDeleted = { isDeleted: { $ne: true } };

const within = ({ from, to }) => ({ $gte: from, $lt: to });

// A record from before 4B has no rejectedAt / cancelledAt: its last change stands in for it.
const happenedIn = (field, window) => ({
  $or: [{ [field]: within(window) }, { [field]: null, updatedAt: within(window) }],
});

class VendorReportService {
  async getReport(caller, period) {
    const window = periodWindow(period, clock.now());
    const viewer = await serviceRequestService.withCategories(caller);
    const vendorId = new mongoose.Types.ObjectId(String(viewer.id));

    const [totalRequests, completedRequests, rejected, declined, cancelledRequests, rating] =
      await Promise.all([
        ServiceRequest.countDocuments({
          ...notDeleted,
          createdAt: within(window),
          $or: [
            serviceRequestService.vendorListCondition(viewer),
            serviceRequestService.vendorListCondition(viewer, { declined: true }),
          ],
        }),
        ServiceRequest.countDocuments({
          ...notDeleted,
          vendorId,
          status: 'COMPLETED',
          completedAt: within(window),
        }),
        // Directed requests this vendor rejected back to the customer.
        ServiceRequest.countDocuments({
          ...notDeleted,
          vendorId,
          status: 'REJECTED',
          ...happenedIn('rejectedAt', window),
        }),
        // Open broadcasts this vendor declined, at their own decline time.
        ServiceRequest.countDocuments({
          ...notDeleted,
          $or: [
            { declines: { $elemMatch: { vendorId, at: within(window) } } },
            {
              declinedBy: vendorId,
              'declines.vendorId': { $ne: vendorId },
              createdAt: within(window),
            },
          ],
        }),
        ServiceRequest.countDocuments({
          ...notDeleted,
          vendorId,
          status: 'CANCELLED',
          ...happenedIn('cancelledAt', window),
        }),
        Review.aggregate([
          {
            $match: {
              vendorId,
              status: 'ACTIVE',
              isDeleted: { $ne: true },
              createdAt: within(window),
            },
          },
          { $group: { _id: null, mean: { $avg: '$rating' }, count: { $sum: 1 } } },
        ]),
      ]);

    const ratings = rating[0];
    return {
      period,
      totalRequests,
      completedRequests,
      rejectedRequests: rejected + declined,
      cancelledRequests,
      // Rounded as services/review.js rounds a vendor's overall rating.
      averageRating: ratings ? Math.round(ratings.mean * 10) / 10 : null,
      ratingCount: ratings ? ratings.count : 0,
      from: window.from.toISOString(),
      to: window.to.toISOString(),
      timeZone: TIME_ZONE,
    };
  }
}

module.exports = new VendorReportService();
