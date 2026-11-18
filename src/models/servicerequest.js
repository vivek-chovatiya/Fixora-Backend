const mongoose = require('mongoose');

// Where the work happens, as the customer gave it (requests contract §6). Stored on the request
// only — never copied into the address book.
const serviceAddressDetailsSchema = new mongoose.Schema(
  {
    line1: { type: String, trim: true },
    line2: { type: String, trim: true },
    landmark: { type: String, trim: true },
    area: { type: String, trim: true },
    city: { type: String, trim: true },
    pincode: { type: String, trim: true },
    latitude: { type: Number },
    longitude: { type: Number },
  },
  { _id: false }
);

const serviceRequestSchema = new mongoose.Schema(
  {
    requestNumber: { type: String, required: true, unique: true, index: true },
    customerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Customer',
      required: true,
      index: true,
    },
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', default: null, index: true },
    // Vendors who declined this open broadcast request: it stays PENDING for everyone else and
    // leaves only their list (requests contract §4). Never shown to customers or other vendors.
    declinedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Vendor' }],
    assignedTeamMemberId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'TeamMember',
      default: null,
    },
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
      index: true,
    },
    subCategoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'SubCategory', default: null },
    // Set only when the customer picked a saved address; a typed one lives in serviceAddress.
    addressId: { type: mongoose.Schema.Types.ObjectId, ref: 'Address', default: null },
    serviceAddress: { type: String, required: true },
    serviceAddressDetails: { type: serviceAddressDetailsSchema, default: undefined },
    // The area/locality alone: all a vendor sees before they hold the work (bible §32).
    serviceArea: { type: String, trim: true, default: '' },
    description: { type: String, trim: true, default: '' },
    images: [{ type: String }],
    completionImages: [{ type: String }],
    priority: { type: String, enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'], default: 'MEDIUM' },
    status: {
      type: String,
      enum: [
        'PENDING',
        'ACCEPTED',
        'ASSIGNED',
        'IN_PROGRESS',
        'COMPLETED',
        'CANCELLED',
        'REJECTED',
      ],
      default: 'PENDING',
      index: true,
    },
    paymentStatus: { type: String, enum: ['PENDING', 'PAID'], default: 'PENDING' },
    paymentMode: { type: String, enum: ['CASH', 'ONLINE'], default: 'CASH' },
    amount: { type: Number, default: 0 },
    scheduledAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    notes: { type: String, default: '' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema);
