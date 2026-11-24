const mongoose = require('mongoose');

const vendorSchema = new mongoose.Schema(
  {
    businessName: { type: String, required: true, trim: true },
    ownerName: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, unique: true, trim: true, index: true },
    password: { type: String, required: true, select: false },
    categoryIds: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Category' }],
    address: { type: String, required: true, trim: true },
    description: { type: String, default: '' },
    workingAreas: [{ type: String, trim: true }],
    workingHours: { type: String, default: '', trim: true },
    approvalNote: { type: String, default: '' },
    lastLogin: { type: Date, default: null },
    resetCodeHash: { type: String, default: null, select: false },
    resetCodeExpiresAt: { type: Date, default: null, select: false },
    profileImage: { type: String, default: null },
    shopImages: [{ type: String }],
    documents: [{ type: String }],
    averageRating: { type: Number, default: 0, min: 0, max: 5 },
    totalReviews: { type: Number, default: 0 },
    approvalStatus: { type: String, enum: ['PENDING', 'APPROVED', 'REJECTED'], default: 'PENDING' },
    availability: { type: Boolean, default: true },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'BLOCKED'], default: 'ACTIVE' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

vendorSchema.index({ approvalStatus: 1, status: 1, availability: 1, categoryIds: 1 });

module.exports = mongoose.model('Vendor', vendorSchema, 'vendors');
