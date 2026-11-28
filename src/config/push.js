/**
 * Push notification settings, read from the environment only (Phase 5 contract §6.2).
 *
 * Why it exists: the push sender (services/push.js) and the start-up check
 * (config/startupChecks.js) must judge FIREBASE_SERVICE_ACCOUNT_PATH and the key file one way. Kept
 * apart, the server could start happily on a key the sender then cannot use.
 *
 *   FIREBASE_SERVICE_ACCOUNT_PATH   the Firebase service-account JSON key file, kept OUTSIDE the
 *                                   repository. Empty (default) = push off: device tokens are still
 *                                   stored, nothing is sent, and nothing else changes.
 *
 * The environment is read on every call, never cached, so a test can switch push on and off.
 *
 * It refuses to fetch a key from anywhere else (no GOOGLE_APPLICATION_CREDENTIALS, no metadata
 * server): push is on only when the owner has pointed this one setting at a key.
 *
 * ⚠️ Never log or return the key file's contents, and never echo a parse or crypto error message
 * (either can quote the file). A problem is reported as a fixed sentence naming the setting only.
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const REPOSITORY_ROOT = path.resolve(__dirname, '..', '..');
const REQUIRED_KEY_FIELDS = Object.freeze(['project_id', 'client_email', 'private_key']);

/** The key file's path as set, trimmed; '' when push is off. */
const pushKeyPathFrom = (env = process.env) =>
  String(env.FIREBASE_SERVICE_ACCOUNT_PATH || '').trim();

const isFilledString = (value) => typeof value === 'string' && value.trim() !== '';

/**
 * Reads and checks the key file without any network call.
 * `{ serviceAccount }` when it can be used, `{ problem }` (a fixed phrase) when it cannot.
 */
const readServiceAccount = (keyPath) => {
  let text;
  try {
    text = fs.readFileSync(path.resolve(keyPath), 'utf8');
  } catch (error) {
    // The fs code only (ENOENT, EACCES, EISDIR …): its message would quote the path.
    return { problem: `the key file cannot be read (${error.code || error.name})` };
  }

  let key;
  try {
    key = JSON.parse(text);
  } catch (error) {
    return { problem: 'the key file is not JSON' };
  }
  if (!key || typeof key !== 'object' || key.type !== 'service_account') {
    return { problem: 'the key file is not a service-account key' };
  }

  const missing = REQUIRED_KEY_FIELDS.filter((name) => !isFilledString(key[name]));
  if (missing.length) {
    return { problem: `the key file has no ${missing.join(', ')}` };
  }

  try {
    crypto.createPrivateKey(key.private_key);
  } catch (error) {
    return { problem: 'the key file’s private_key is not a readable private key' };
  }

  return { serviceAccount: key };
};

/** True when the key file sits inside this repository, where it could be committed. */
const isInsideRepository = (keyPath) => {
  const relative = path.relative(REPOSITORY_ROOT, path.resolve(keyPath));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
};

module.exports = {
  pushKeyPathFrom,
  readServiceAccount,
  isInsideRepository,
};
