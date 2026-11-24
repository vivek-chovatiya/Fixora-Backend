const mongoose = require('mongoose');
const {
  REQUEST_STATUSES,
  REQUEST_STATUS,
  PRIORITIES,
  PRIORITY,
  DISPATCH_MODES,
  DISPATCH_MODE,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  PAYMENT_STATUS,
} = require('../constants');

const { ObjectId } = mongoose.Schema.Types;

const serviceRequestSchema = new mongoose.Schema(
  {
    requestNumber: { type: String, required: true, unique: true, index: true },
    customerId: { type: ObjectId, ref: 'Customer', required: true, index: true },

    /** The vendor who owns the work. Only set once a vendor has accepted. */
    vendorId: { type: ObjectId, ref: 'Vendor', default: null, index: true },

    /** Routing (App PROJECT_BIBLE §18A). Not a status. */
    dispatchMode: { type: String, enum: DISPATCH_MODES, default: DISPATCH_MODE.OPEN, index: true },
    /** For DIRECTED dispatch: the vendor the customer chose. */
    requestedVendorId: { type: ObjectId, ref: 'Vendor', default: null, index: true },
    /** Vendors who declined this request; it is hidden from their "New" list. */
    declines: [
      {
        _id: false,
        vendorId: { type: ObjectId, ref: 'Vendor', required: true },
        reason: { type: String, default: '' },
        at: { type: Date, default: Date.now },
      },
    ],

    assignedTeamMemberId: { type: ObjectId, ref: 'TeamMember', default: null },
    categoryId: { type: ObjectId, ref: 'Category', required: true, index: true },
    subCategoryId: { type: ObjectId, ref: 'SubCategory', required: true, index: true },
    addressId: { type: ObjectId, ref: 'Address', required: true },
    /** Snapshot of the address at creation time, so history survives address edits/deletes. */
    serviceAddress: { type: String, required: true },

    description: { type: String, required: true, trim: true },
    notes: { type: String, default: '', trim: true },
    images: [{ type: String }],
    priority: { type: String, enum: PRIORITIES, default: PRIORITY.MEDIUM, index: true },
    preferredDate: { type: Date, default: null },
    preferredTime: { type: String, default: '' },

    status: {
      type: String,
      enum: REQUEST_STATUSES,
      default: REQUEST_STATUS.PENDING_VENDOR,
      index: true,
    },

    acceptedAt: { type: Date, default: null },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    cancelReason: { type: String, default: '' },

    // Offline payment record (Phase 1 — no gateway)
    estimatedAmount: { type: Number, default: 0 },
    finalAmount: { type: Number, default: null },
    paymentMethod: { type: String, enum: [...PAYMENT_METHODS, null], default: null },
    paymentStatus: { type: String, enum: PAYMENT_STATUSES, default: PAYMENT_STATUS.PENDING },
    completionNotes: { type: String, default: '' },
    completionImages: [{ type: String }],

    isReviewed: { type: Boolean, default: false },

    createdBy: { type: ObjectId, default: null },
    updatedBy: { type: ObjectId, default: null },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

serviceRequestSchema.index({ status: 1, dispatchMode: 1, categoryId: 1, createdAt: -1 });
serviceRequestSchema.index({ 'declines.vendorId': 1 });

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema, 'service_requests');
