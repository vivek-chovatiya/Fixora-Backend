// Accounts and categories created straight in the database, the way the seed creates them.
const bcrypt = require('bcryptjs');
const Admin = require('../../src/models/admin');
const Category = require('../../src/models/category');
const Customer = require('../../src/models/customer');
const Vendor = require('../../src/models/vendor');
const { generateToken } = require('../../src/utils/token');

let sequence = 0;
const next = () => {
  sequence += 1;
  return sequence;
};

const createCategory = async (overrides = {}) => {
  const n = next();
  return Category.create({ name: `Category ${n}`, slug: `category-${n}`, ...overrides });
};

const createAdmin = async () => {
  const n = next();
  const admin = await Admin.create({
    name: 'Test Admin',
    email: `admin${n}@fixora.test`,
    phone: `+1800555${String(n).padStart(4, '0')}`,
    password: await bcrypt.hash('Password123!', 4),
  });
  return { admin, token: generateToken({ id: String(admin._id), role: 'ADMIN' }) };
};

// Phone accounts have proved their phone (phoneVerifiedAt); pass phoneVerifiedAt: null for an
// email sign-up whose phone was never proved (requests contract §8).
const createPhoneCustomer = async (overrides = {}) =>
  Customer.create({
    firstName: 'Asha',
    lastName: 'Patel',
    phone: '9876543210',
    phoneVerifiedAt: new Date(),
    ...overrides,
  });

// A vendor who registered by phone: phone proved, so they can sign in by one-time code. (No auth
// code since the Phase 5 contract §1; pass `authCodeHash` to model an older vendor still holding one.)
const createPhoneVendor = async (overrides = {}) =>
  Vendor.create({
    businessName: 'Kumar Electricals',
    ownerName: 'Ravi Kumar',
    ownerFirstName: 'Ravi',
    ownerLastName: 'Kumar',
    phone: '9000000001',
    phoneVerifiedAt: new Date(),
    approvalStatus: 'APPROVED',
    status: 'ACTIVE',
    ...overrides,
  });

const tokenFor = (account, role) =>
  generateToken({ id: String(account._id), role, v: account.tokenVersion || 0 });

module.exports = {
  createCategory,
  createAdmin,
  createPhoneCustomer,
  createPhoneVendor,
  tokenFor,
};

// ----------------------------------------------------
// Requests (requests contract, 17/11/2026)
// ----------------------------------------------------
const Address = require('../../src/models/address');
const ServiceRequest = require('../../src/models/servicerequest');
const SubCategory = require('../../src/models/subcategory');
const TeamMember = require('../../src/models/team');

let phoneSeq = 0;
const nextPhone = (prefix) => {
  phoneSeq += 1;
  return `${prefix}${String(phoneSeq).padStart(4, '0')}`;
};

const createSubCategory = async (category, overrides = {}) => {
  const n = next();
  return SubCategory.create({
    categoryId: category._id,
    name: `Option ${n}`,
    slug: `option-${n}`,
    ...overrides,
  });
};

// An ACTIVE + APPROVED vendor offering the given categories, with a unique phone.
const createVendor = async (categories = [], overrides = {}) =>
  Vendor.create({
    businessName: `Vendor ${next()}`,
    ownerName: 'Ravi Kumar',
    ownerFirstName: 'Ravi',
    ownerLastName: 'Kumar',
    phone: nextPhone('900001'),
    email: `vendor${next()}@example.com`,
    categoryIds: categories.map((c) => c._id),
    phoneVerifiedAt: new Date(),
    approvalStatus: 'APPROVED',
    status: 'ACTIVE',
    ...overrides,
  });

const createCustomer = async (overrides = {}) =>
  Customer.create({
    firstName: 'Asha',
    lastName: 'Patel',
    phone: nextPhone('987601'),
    email: `customer${next()}@example.com`,
    phoneVerifiedAt: new Date(),
    ...overrides,
  });

const createAddress = async (customer, overrides = {}) =>
  Address.create({
    customerId: customer._id,
    title: 'Home',
    addressLine1: '14 Lake View Road',
    addressLine2: 'Flat 3B',
    city: 'Pune',
    state: 'MH',
    pincode: '411001',
    ...overrides,
  });

// A request written straight to the database (for the states a test needs to start from).
const createRequest = async (customer, category, overrides = {}) =>
  ServiceRequest.create({
    requestNumber: `REQ-T${String(next()).padStart(8, '0')}`,
    customerId: customer._id,
    categoryId: category._id,
    serviceAddress: '14 Lake View Road, Flat 3B, Koregaon Park, Pune 411001',
    serviceAddressDetails: {
      line1: '14 Lake View Road',
      line2: 'Flat 3B',
      area: 'Koregaon Park',
      city: 'Pune',
      pincode: '411001',
    },
    serviceArea: 'Koregaon Park',
    description: 'Ceiling fan hums and runs slow.',
    status: 'PENDING',
    ...overrides,
  });

const createTeamMember = async (vendor, overrides = {}) =>
  TeamMember.create({ vendorId: vendor._id, name: 'Suresh', designation: 'Electrician', ...overrides });

module.exports.createSubCategory = createSubCategory;
module.exports.createVendor = createVendor;
module.exports.createCustomer = createCustomer;
module.exports.createAddress = createAddress;
module.exports.createRequest = createRequest;
module.exports.createTeamMember = createTeamMember;
