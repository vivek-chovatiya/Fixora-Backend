/**
 * Attaching uploaded images to a record (Phase 4B contract §2).
 *
 * Why it exists: every image field takes values the client sends back after `POST /uploads`, and
 * every one of them must be checked the same way, or one field becomes the way to attach another
 * account's photo (or an outside URL) to a record. The fields that use it:
 *   - `images` on `POST /requests` (type `request`) — services/servicerequest.js, on create;
 *   - `profileImage` on `/customers/update` and `/vendors/update` (type `profile`);
 *   - `shopImages` on `/vendors/update` (type `shop`);
 *   - `profileImage` on `/team` and `/team/update` (type `team`).
 *
 * The decision that shaped it: a value is accepted when (a) it is, after normalising both, a
 * value already stored in that same field of that same record — so an unchanged picture, or shop
 * images re-sent in a new order, keep working, including seeded and web-view values that were
 * never uploaded (kept exactly as stored); or (b) it is the path of an Upload of the record's
 * owner and of the field's type (stored as that path). Nothing is consumed: an upload may be
 * attached to several of its owner's records.
 *
 * ⚠️ `ownerId` is the account that owns the RECORD — the customer or vendor being updated, even
 * when an administrator is the caller; for a team member, their vendor. Passing the caller's id
 * instead would let an administrator's (or anyone's) uploads land on other accounts. And `stored`
 * must be read from the record itself, never from the request body.
 */

const Upload = require('../models/upload');
const ApiError = require('../utils/ApiError');
const { ERROR_CODES } = require('../utils/errorCodes');
const { UPLOAD_URL_PREFIX } = require('../config/uploads');

const ABSOLUTE_HTTP_URL = /^https?:\/\//i;

/**
 * An absolute http(s) URL whose path starts with `/uploads/` becomes that path (query and
 * fragment dropped): the app may send back the full URL it was shown. Anything else is returned
 * unchanged and compared as it is.
 */
const normaliseImageValue = (value) => {
  if (typeof value !== 'string' || !ABSOLUTE_HTTP_URL.test(value)) return value;
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    return value;
  }
  return url.pathname.startsWith(`${UPLOAD_URL_PREFIX}/`) ? url.pathname : value;
};

const NOT_UPLOADED = 'must be an image stored on this record or uploaded by its owner.';
const REPEATED = 'repeats an earlier image.';

const refused = (problems) =>
  new ApiError(
    400,
    'Validation Failed',
    problems.map(({ field, reason }) => ({ field, message: `"${field}" ${reason}` })),
    ERROR_CODES.VALIDATION_FAILED
  );

// Which of these paths are uploads of this owner and type; one query for the whole field.
const ownedUploadPaths = async (paths, { type, ownerId }) => {
  if (paths.length === 0) return new Set();
  const rows = await Upload.find({ path: { $in: paths }, type, ownerId }).select('path').lean();
  return new Set(rows.map((row) => row.path));
};

const resolveSingle = async ({ value, field, type, ownerId, stored }) => {
  if (value === null || value === '') return null;
  if (typeof value !== 'string') throw refused([{ field, reason: NOT_UPLOADED }]);

  const normalised = normaliseImageValue(value);
  if (typeof stored === 'string' && stored !== '' && normaliseImageValue(stored) === normalised) {
    return stored;
  }

  const owned = await ownedUploadPaths([normalised], { type, ownerId });
  if (!owned.has(normalised)) throw refused([{ field, reason: NOT_UPLOADED }]);
  return normalised;
};

const resolveList = async ({ value, field, type, ownerId, stored }) => {
  // normalised stored value -> the value exactly as stored (the first, if two normalise alike)
  const storedByNormal = new Map();
  for (const entry of Array.isArray(stored) ? stored : []) {
    if (typeof entry !== 'string' || entry === '') continue;
    const key = normaliseImageValue(entry);
    if (!storedByNormal.has(key)) storedByNormal.set(key, entry);
  }

  const problems = [];
  const seen = new Set();
  const toCheck = [];
  const normalised = value.map(normaliseImageValue);

  normalised.forEach((entry, index) => {
    const entryField = `${field}.${index}`;
    if (typeof entry !== 'string' || entry === '') {
      problems.push({ index, field: entryField, reason: NOT_UPLOADED });
    } else if (seen.has(entry)) {
      problems.push({ index, field: entryField, reason: REPEATED });
    } else {
      seen.add(entry);
      if (!storedByNormal.has(entry)) toCheck.push({ index, entry });
    }
  });

  const owned = await ownedUploadPaths(
    toCheck.map(({ entry }) => entry),
    { type, ownerId }
  );
  for (const { index, entry } of toCheck) {
    if (!owned.has(entry)) {
      problems.push({ index, field: `${field}.${index}`, reason: NOT_UPLOADED });
    }
  }

  if (problems.length > 0) {
    throw refused(problems.sort((a, b) => a.index - b.index));
  }
  return normalised.map((entry) => (storedByNormal.has(entry) ? storedByNormal.get(entry) : entry));
};

/**
 * What to store in an image field, or a 400 VALIDATION_FAILED naming the refused path
 * (`profileImage`, `shopImages.0`, `images.2`).
 *
 * @param {object} options
 * @param {string|string[]|null} options.value  what the client sent: a string, an array of strings
 *   (array fields), or `null`/`""` (single fields: clears, stored `null`). `undefined` (field not
 *   sent) returns `stored` unchanged — but callers should simply skip absent fields.
 * @param {string} options.field  the body field name, used in error paths.
 * @param {'request'|'profile'|'shop'|'team'} options.type  the Upload type the field takes.
 * @param {string|object} options.ownerId  the id of the account that owns the record.
 * @param {string|string[]|null} options.stored  the field's current value on that record (`null` or
 *   `[]` for a new record).
 * @returns {Promise<string|string[]|null>}
 *
 * Array fields must hold distinct values (after normalising); their maximum count is the caller's
 * Joi schema's job. Uses: services/servicerequest.js (`images` on `POST /requests`),
 * services/customer.js, services/vendor.js, services/team.js.
 */
const resolveImageField = async ({ value, field, type, ownerId, stored }) => {
  if (value === undefined) return stored;
  if (Array.isArray(value)) return resolveList({ value, field, type, ownerId, stored });
  return resolveSingle({ value, field, type, ownerId, stored });
};

module.exports = {
  normaliseImageValue,
  resolveImageField,
};
