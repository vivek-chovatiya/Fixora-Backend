const mongoose = require('mongoose');

const subCategorySchema = new mongoose.Schema(
  {
    categoryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Category',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, lowercase: true, trim: true, index: true },
    icon: { type: String, default: null },
    description: { type: String, default: '', trim: true },
    estimatedDuration: { type: Number, default: 60 },
    estimatedPrice: { type: Number, default: 0 },
    isVisible: { type: Boolean, default: true },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE'], default: 'ACTIVE' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('SubCategory', subCategorySchema, 'sub_categories');
