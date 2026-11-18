const { generateToken } = require('../utils/token');

// The session the mobile app receives from every phone sign-in path, in the contract's shape:
//   { token, role: 'CUSTOMER' | 'VENDOR', user: { id, firstName, lastName, email?, phone,
//     avatarUrl?, role: 'customer' | 'vendor' } }
// `user.role` is lower-case to match the app's UserRole; `id` is the Mongo id as a string; a
// vendor's names are the owner's. GET /auth/me returns the same user fields (services/auth.js).
//
// ⚠️ This is the only mapper allowed to build a session user. It must never spread a document:
// a vendor document can hold `authCodeHash`.

const splitName = (fullName = '') => {
  const parts = String(fullName).trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || '', lastName: parts.slice(1).join(' ') };
};

// Accepts a Mongoose document or one of the existing mapper outputs (customerMapper, vendorMapper).
const toSessionUser = (account, role) => {
  const user = {
    id: String(account._id || account.id),
    firstName: '',
    lastName: '',
    phone: account.phone,
    role: role === 'VENDOR' ? 'vendor' : 'customer',
  };

  if (role === 'VENDOR') {
    // Vendors registered by email only have ownerName.
    const fallback = splitName(account.ownerName);
    user.firstName = account.ownerFirstName || fallback.firstName;
    user.lastName = account.ownerFirstName ? account.ownerLastName || '' : fallback.lastName;
  } else {
    user.firstName = account.firstName || '';
    user.lastName = account.lastName || '';
  }

  if (account.email) {
    user.email = account.email;
  }
  if (account.profileImage) {
    user.avatarUrl = account.profileImage;
  }

  return user;
};

const createSession = (account, role) => ({
  token: generateToken({ id: String(account._id), role, v: account.tokenVersion || 0 }),
  role,
  user: toSessionUser(account, role),
});

module.exports = {
  toSessionUser,
  createSession,
};
