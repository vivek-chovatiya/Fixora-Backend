const mongoose = require('mongoose');

const serviceRequestTimelineSchema = new mongoose.Schema(
  {
    serviceRequestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'ServiceRequest',
      required: true,
      index: true,
    },
    status: { type: String, required: true },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, required: true },
    userRole: { type: String, required: true },
    note: { type: String, default: '' },
    timestamp: { type: Date, default: Date.now },
    isDeleted: { type: Boolean, default: false },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ServiceRequestTimeline', serviceRequestTimelineSchema);
