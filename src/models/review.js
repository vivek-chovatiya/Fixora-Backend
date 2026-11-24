const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema(
  {
    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: true,
    },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, default: '', trim: true },
    images: [{ type: String }],
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// One request = one review (PROJECT_BIBLE §11.7).
reviewSchema.index(
  { serviceRequestId: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false } }
);

module.exports = mongoose.model('Review', reviewSchema, 'reviews');
