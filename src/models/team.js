const mongoose = require('mongoose');

const teamMemberSchema = new mongoose.Schema(
  {
    vendorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Vendor', required: true, index: true },
    name: { type: String, required: true, trim: true },
    // Optional (PROJECT_BIBLE.md section 39; requests contract §7).
    phone: { type: String, trim: true, default: '' },
    designation: { type: String, default: 'Technician', trim: true },
    profileImage: { type: String, default: null },
    status: { type: String, enum: ['ACTIVE', 'INACTIVE', 'ON_LEAVE'], default: 'ACTIVE' },
    isDeleted: { type: Boolean, default: false, index: true },
    deletedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports = mongoose.model('TeamMember', teamMemberSchema);
