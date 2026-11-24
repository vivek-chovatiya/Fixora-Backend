const mongoose = require('mongoose');
const { UPLOAD_TYPE_NAMES, UPLOAD_OWNER_ROLES } = require('../config/uploads');

// One stored image file (Phase 4B contract §1): the proof that an account uploaded it.
//
// Why it exists: an image field takes a path the client sends back after POST /uploads, and that
// path is accepted only when the field already holds it or it is one of these rows, owned by the
// record's owner and of the field's type (services/uploadAttach.js). Without the row, a client
// could attach another account's picture, or any URL at all.
//
// The decision that shaped it: one row per file, written only after every file of the call has
// been processed and saved (all or nothing). Attaching consumes nothing, so an upload may be used
// on several of its owner's records.
//
// ⚠️ Never add the client's file name, or anything read from the original file's metadata: the
// name can carry a person's name and the metadata a home's GPS position, which is exactly what
// processing throws away.
const uploadSchema = new mongoose.Schema(
  {
    // '/uploads/<type>/<32 hex>.<jpg|png|webp>': what every record stores and every answer returns.
    path: { type: String, required: true, unique: true },
    type: { type: String, enum: UPLOAD_TYPE_NAMES, required: true },
    ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
    ownerRole: { type: String, enum: UPLOAD_OWNER_ROLES, required: true },
    // Of the stored (processed) file.
    mimeType: { type: String, required: true },
    sizeBytes: { type: Number, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

module.exports = mongoose.model('Upload', uploadSchema);
