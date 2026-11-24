const mongoose = require('mongoose');

/** Immutable request history (PROJECT_BIBLE §10.5). Entries are only ever appended. */
const serviceRequestTimelineSchema = new mongoose.Schema(
  {
    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: true,
      index: true,
    },
    status: { type: String, required: true },
    title: { type: String, required: true },
    note: { type: String, default: '' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    userRole: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model(
  'ServiceRequestTimeline',
  serviceRequestTimelineSchema,
  'service_request_timeline'
);
