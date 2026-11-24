const mongoose = require('mongoose');

const customerSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, trim: true, default: '' },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, unique: true, trim: true, index: true },
    password: { type: String, required: true, select: false },
    profileImage: { type: String, default: null },
    defaultAddress: { type: mongoose.Schema.Types.ObjectId, ref: 'Address', default: null },
    isVerified: { type: Boolean, default: false },
    lastLogin: { type: Date, default: null },
    resetCodeHash: { type: String, default: null, select: false },
    resetCodeExpiresAt: { type: Date, default: null, select: false },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'BLOCKED'], default: 'ACTIVE' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Customer', customerSchema, 'customers');
