const ApiError = require('./ApiError');

// "Your own record only, unless you are an administrator" (requests contract §2). A record that is
// someone else's answers 404, never 403, so the caller cannot confirm it exists.
const assertSelfOrAdmin = (user, targetId, notFoundMessage) => {
  if (user && user.role === 'ADMIN') return;
  if (!user || String(user.id) !== String(targetId)) {
    throw new ApiError(404, notFoundMessage);
  }
};

// Fields only an administrator may change, removed from anyone else's update.
const withoutAdminFields = (user, payload, fields) => {
  if (user && user.role === 'ADMIN') return payload;
  const cleaned = { ...payload };
  for (const field of fields) {
    delete cleaned[field];
  }
  return cleaned;
};

module.exports = {
  assertSelfOrAdmin,
  withoutAdminFields,
};
