/**
 * What may be uploaded, by whom, how big, and where it is kept (Phase 4B contract §1).
 *
 * Why it exists: the upload route, the Upload model, the attach checks (services/uploadAttach.js)
 * and the file server in index.js must agree on one list of types, one set of limits and one
 * directory. Kept apart, the server could write files to one folder and serve another.
 *
 * The decision that shaped it: each upload `type` names the image field it is for, and only the
 * role that owns that field may upload it (a customer has no shop, a vendor sends no request
 * photos). The stored path is host-free (`/uploads/<type>/<name>.<ext>`) because the emulator,
 * a phone on the LAN and the web views reach the same server by different hosts.
 *
 * ⚠️ `uploadRoot()` is read by index.js (serving) and services/upload.js (writing): never give
 * either its own directory, or uploads succeed and then answer 404. Renaming a type strands every
 * stored path that contains it.
 */

// type -> the roles that may upload it.
const UPLOAD_TYPES = Object.freeze({
  request: Object.freeze(['CUSTOMER']),
  profile: Object.freeze(['CUSTOMER', 'VENDOR']),
  shop: Object.freeze(['VENDOR']),
  team: Object.freeze(['VENDOR']),
});

const UPLOAD_TYPE_NAMES = Object.freeze(Object.keys(UPLOAD_TYPES));
const UPLOAD_OWNER_ROLES = Object.freeze(['CUSTOMER', 'VENDOR']);

// As received, before processing (5 × 1024 × 1024 bytes); and per call.
const MAX_UPLOAD_FILE_BYTES = 5 * 1024 * 1024;
const MAX_UPLOAD_FILES = 5;

// Processing: the longest edge is reduced to this, never enlarged; JPEG and WebP quality.
const MAX_IMAGE_EDGE_PX = 1600;
const IMAGE_QUALITY = 80;
// Width × height a file may declare before it is decoded: a 5 MB PNG can claim a size whose
// decoded pixels would exhaust the server's memory (sharp's own default allows ~268 million).
const MAX_INPUT_PIXELS = 40000000;

// The URL prefix files are served under, outside /api/v1.
const UPLOAD_URL_PREFIX = '/uploads';

/** The directory uploads are written to and served from (relative to the working directory). */
const uploadRoot = () => process.env.UPLOAD_PATH || 'uploads';

/** Whether an account of this role may upload this type. */
const mayUpload = (role, type) =>
  Object.prototype.hasOwnProperty.call(UPLOAD_TYPES, type) && UPLOAD_TYPES[type].includes(role);

module.exports = {
  UPLOAD_TYPES,
  UPLOAD_TYPE_NAMES,
  UPLOAD_OWNER_ROLES,
  MAX_UPLOAD_FILE_BYTES,
  MAX_UPLOAD_FILES,
  MAX_IMAGE_EDGE_PX,
  IMAGE_QUALITY,
  MAX_INPUT_PIXELS,
  UPLOAD_URL_PREFIX,
  uploadRoot,
  mayUpload,
};
