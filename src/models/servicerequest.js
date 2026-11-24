const mongoose = require('mongoose');
const { PAYMENT_MODES } = require('../config/paymentMethods');

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
    // When each of those vendors declined (Phase 4B §5: reports count a decline when it happened).
    // Pushed in the same conditional update that adds the vendor to declinedBy; a decline from
    // before 4B has no entry here. Admin views only, like declinedBy.
    declines: [
      {
        _id: false,
        vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true },
        at: { type: Date, required: true },
      },
    ],
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
    // The offline payment record (bible §36–§37, Phase 4B §4). `PENDING` means "not paid yet".
    // `paymentMode` holds the method id once paid (config/paymentMethods.js); while PENDING it is
    // the old default and means nothing. The record exists from `paymentRecordedAt`; what each
    // party sees of it is built in services/requestview.js, never read from these fields directly.
    paymentStatus: { type: String, enum: ['PENDING', 'PAID'], default: 'PENDING' },
    paymentMode: { type: String, enum: PAYMENT_MODES, default: 'CASH' },
    amount: { type: Number, default: 0 },
    currency: { type: String, default: null },
    paymentMethodLabel: { type: String, default: null },
    // The vendor's own notes on the finished job — never shown to the customer.
    completionNotes: { type: String, default: '' },
    paymentRecordedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
    // The customer's preferred date (YYYY-MM-DD) and time (HH:mm), India wall-clock, as sent
    // (Phase 4B §3). `scheduledAt` is derived from them for the web views.
    preferredDate: { type: String, default: null },
    preferredTime: { type: String, default: null },
    scheduledAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
    // Set by a directed reject and by a cancel, so reports count them when they happened.
    rejectedAt: { type: Date, default: null },
    cancelledAt: { type: Date, default: null },
    notes: { type: String, default: '' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('ServiceRequest', serviceRequestSchema);
