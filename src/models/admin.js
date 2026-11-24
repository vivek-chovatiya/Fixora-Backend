const mongoose = require('mongoose');

const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    phone: { type: String, required: true, unique: true, trim: true, index: true },
    password: { type: String, required: true, select: false },
    role: { type: String, default: 'ADMIN' },
    resetCodeHash: { type: String, default: null, select: false },
    resetCodeExpiresAt: { type: Date, default: null, select: false },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Admin', adminSchema, 'admins');
