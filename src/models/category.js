const mongoose = require('mongoose');

const categorySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
    icon: { type: String, default: null },
    image: { type: String, default: null },
    description: { type: String, default: '', trim: true },
    sortOrder: { type: Number, default: 0 },
    isVisible: { type: Boolean, default: true },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('Category', categorySchema, 'categories');
