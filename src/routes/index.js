const express = require('express');
const rateLimit = require('express-rate-limit');

const config = require('../config');
const authenticate = require('../middlewares/auth');
const authorize = require('../middlewares/role');
const validate = require('../middlewares/validation');
const upload = require('../middlewares/upload');
const requireApprovedVendor = require('../middlewares/approvedVendor');
const { ROLE, ERROR_CODE } = require('../constants');

const authController = require('../controllers/auth');
const customerController = require('../controllers/customer');
const vendorController = require('../controllers/vendor');
const teamController = require('../controllers/team');
const categoryController = require('../controllers/category');
const subCategoryController = require('../controllers/subcategory');
const addressController = require('../controllers/address');
const serviceRequestController = require('../controllers/servicerequest');
const reviewController = require('../controllers/review');
const notificationController = require('../controllers/notification');
const adminController = require('../controllers/admin');
const uploadController = require('../controllers/upload');
const metaController = require('../controllers/meta');

const authValidation = require('../validations/auth');
const customerValidation = require('../validations/customer');
const vendorValidation = require('../validations/vendor');
const teamValidation = require('../validations/team');
const categoryValidation = require('../validations/category');
const subCategoryValidation = require('../validations/subcategory');
const addressValidation = require('../validations/address');
const serviceRequestValidation = require('../validations/servicerequest');
const reviewValidation = require('../validations/review');
const adminValidation = require('../validations/admin');
const notificationValidation = require('../validations/notification');
const uploadValidation = require('../validations/upload');

const router = express.Router();

const { CUSTOMER, VENDOR, ADMIN } = ROLE;

const authLimiter = rateLimit({
  windowMs: config.rateLimit.windowMs,
  limit: config.rateLimit.authMax,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many attempts. Please wait a few minutes and try again.',
    code: ERROR_CODE.RATE_LIMITED,
    data: null,
    meta: {},
    errors: null,
  },
});

/** Optional auth: attaches req.user when a valid token is present, never rejects. */
const optionalAuth = (req, res, next) =>
  req.headers.authorization ? authenticate(req, res, () => next()) : next();

// ----------------------------------------------------
// Health
// ----------------------------------------------------
router.get('/health', (req, res) => {
  res.json({ success: true, message: 'Fixora API is healthy.', data: { status: 'ok' }, meta: {}, errors: null });
});

router.get('/meta', metaController.get);

// ----------------------------------------------------
// Authentication
// ----------------------------------------------------
router.post('/auth/login', authLimiter, validate(authValidation.login), authController.login);
router.post('/auth/register/customer', authLimiter, validate(authValidation.registerCustomer), authController.registerCustomer);
router.post('/auth/register/vendor', authLimiter, validate(authValidation.registerVendor), authController.registerVendor);
router.post('/auth/forgot-password', authLimiter, validate(authValidation.forgotPassword), authController.forgotPassword);
router.post('/auth/reset-password', authLimiter, validate(authValidation.resetPassword), authController.resetPassword);
router.post('/auth/change-password', authenticate, validate(authValidation.changePassword), authController.changePassword);
router.get('/auth/me', authenticate, authController.me);
router.post('/auth/logout', authenticate, authController.logout);

// ----------------------------------------------------
// Uploads (multipart/form-data, field "files")
// ----------------------------------------------------
router.post('/uploads', authenticate, upload.array('files', config.upload.maxFilesPerUpload), validate(uploadValidation.upload), uploadController.upload);

// ----------------------------------------------------
// Customers
// ----------------------------------------------------
router.post('/customers/list', authenticate, authorize([ADMIN]), validate(customerValidation.listCustomers), customerController.getAll);
router.post('/customers/detail', authenticate, authorize([CUSTOMER, ADMIN]), validate({ body: customerValidation.getById.body.fork(['id'], (s) => s.optional()) }), customerController.getById);
router.post('/customers/update', authenticate, authorize([CUSTOMER, ADMIN]), validate(customerValidation.updateCustomer), customerController.update);
router.delete('/customers/delete', authenticate, authorize([ADMIN]), validate(customerValidation.getById), customerController.remove);

// ----------------------------------------------------
// Vendors
// ----------------------------------------------------
router.post('/vendors/recommended', authenticate, authorize([CUSTOMER]), validate(vendorValidation.recommended), vendorController.recommended);
router.post('/vendors/public', validate(vendorValidation.getById), vendorController.getPublicById);
router.get('/vendors/dashboard', authenticate, authorize([VENDOR]), requireApprovedVendor, vendorController.dashboard);
router.post('/vendors/reports', authenticate, authorize([VENDOR]), requireApprovedVendor, validate(vendorValidation.report), vendorController.report);
router.post('/vendors/list', authenticate, authorize([ADMIN]), validate(vendorValidation.listVendors), vendorController.getAll);
router.post('/vendors/detail', authenticate, authorize([ADMIN]), validate(vendorValidation.getById), vendorController.getById);
router.post('/vendors/update', authenticate, authorize([VENDOR, ADMIN]), validate(vendorValidation.updateVendor), vendorController.update);
router.post('/vendors/approval-status', authenticate, authorize([ADMIN]), validate(vendorValidation.updateApprovalStatus), vendorController.updateApprovalStatus);
router.delete('/vendors/delete', authenticate, authorize([ADMIN]), validate(vendorValidation.getById), vendorController.remove);

// ----------------------------------------------------
// Team
// ----------------------------------------------------
router.post('/team', authenticate, authorize([VENDOR]), validate(teamValidation.createTeamMember), teamController.create);
router.get('/team', authenticate, authorize([VENDOR]), teamController.getAll);
router.post('/team/detail', authenticate, authorize([VENDOR]), validate(teamValidation.getById), teamController.getById);
router.post('/team/update', authenticate, authorize([VENDOR]), validate(teamValidation.updateTeamMember), teamController.update);
router.delete('/team/delete', authenticate, authorize([VENDOR]), validate(teamValidation.getById), teamController.remove);

// ----------------------------------------------------
// Categories (public reads show visible + active only)
// ----------------------------------------------------
router.get('/categories', categoryController.getAll);
router.post('/categories/list', validate(categoryValidation.listCategories), categoryController.getAll);
router.post('/categories/detail', validate(categoryValidation.getById), categoryController.getById);
router.post('/categories/admin-list', authenticate, authorize([ADMIN]), validate(categoryValidation.listCategories), categoryController.getAllAdmin);
router.post('/categories', authenticate, authorize([ADMIN]), validate(categoryValidation.createCategory), categoryController.create);
router.post('/categories/update', authenticate, authorize([ADMIN]), validate(categoryValidation.updateCategory), categoryController.update);
router.delete('/categories/delete', authenticate, authorize([ADMIN]), validate(categoryValidation.getById), categoryController.remove);

// ----------------------------------------------------
// Sub-categories
// ----------------------------------------------------
router.get('/subcategories', subCategoryController.getAll);
router.post('/subcategories/list', validate(subCategoryValidation.listSubCategories), subCategoryController.getAll);
router.post('/subcategories/detail', validate(subCategoryValidation.getById), subCategoryController.getById);
router.post('/subcategories/admin-list', authenticate, authorize([ADMIN]), validate(subCategoryValidation.listSubCategories), subCategoryController.getAllAdmin);
router.post('/subcategories', authenticate, authorize([ADMIN]), validate(subCategoryValidation.createSubCategory), subCategoryController.create);
router.post('/subcategories/update', authenticate, authorize([ADMIN]), validate(subCategoryValidation.updateSubCategory), subCategoryController.update);
router.delete('/subcategories/delete', authenticate, authorize([ADMIN]), validate(subCategoryValidation.getById), subCategoryController.remove);

// ----------------------------------------------------
// Addresses
// ----------------------------------------------------
router.post('/addresses', authenticate, authorize([CUSTOMER]), validate(addressValidation.createAddress), addressController.create);
router.get('/addresses', authenticate, authorize([CUSTOMER]), addressController.getAll);
router.post('/addresses/detail', authenticate, authorize([CUSTOMER]), validate(addressValidation.getById), addressController.getById);
router.post('/addresses/update', authenticate, authorize([CUSTOMER]), validate(addressValidation.updateAddress), addressController.update);
router.post('/addresses/default', authenticate, authorize([CUSTOMER]), validate(addressValidation.getById), addressController.setDefault);
router.delete('/addresses/delete', authenticate, authorize([CUSTOMER]), validate(addressValidation.getById), addressController.remove);

// ----------------------------------------------------
// Service requests
// ----------------------------------------------------
router.post('/requests', authenticate, authorize([CUSTOMER]), validate(serviceRequestValidation.createRequest), serviceRequestController.create);
router.post('/requests/list', authenticate, validate(serviceRequestValidation.listRequests), serviceRequestController.getAll);
router.post('/requests/detail', authenticate, validate(serviceRequestValidation.getById), serviceRequestController.getById);
router.post('/requests/cancel', authenticate, authorize([CUSTOMER, ADMIN]), validate(serviceRequestValidation.cancelRequest), serviceRequestController.cancel);
router.post('/requests/accept', authenticate, authorize([VENDOR]), requireApprovedVendor, validate(serviceRequestValidation.getById), serviceRequestController.accept);
router.post('/requests/reject', authenticate, authorize([VENDOR, ADMIN]), validate(serviceRequestValidation.rejectRequest), serviceRequestController.reject);
router.post('/requests/assign', authenticate, authorize([VENDOR]), requireApprovedVendor, validate(serviceRequestValidation.assignTeamMember), serviceRequestController.assignTeam);
router.post('/requests/start', authenticate, authorize([VENDOR]), requireApprovedVendor, validate(serviceRequestValidation.getById), serviceRequestController.startWork);
router.post('/requests/complete', authenticate, authorize([VENDOR]), requireApprovedVendor, validate(serviceRequestValidation.completeRequest), serviceRequestController.completeWork);

// ----------------------------------------------------
// Reviews
// ----------------------------------------------------
router.post('/reviews', authenticate, authorize([CUSTOMER]), validate(reviewValidation.createReview), reviewController.create);
router.post('/reviews/vendor', optionalAuth, validate(reviewValidation.listVendorReviews), reviewController.getVendorReviews);
router.post('/reviews/summary', optionalAuth, validate(reviewValidation.vendorSummary), reviewController.getVendorSummary);

// ----------------------------------------------------
// Notifications
// ----------------------------------------------------
router.get('/notifications', authenticate, notificationController.getAll);
router.post('/notifications/list', authenticate, validate(notificationValidation.list), notificationController.getAll);
router.get('/notifications/unread-count', authenticate, notificationController.unreadCount);
router.post('/notifications/read', authenticate, validate(notificationValidation.markRead), notificationController.markAsRead);
router.post('/notifications/read-all', authenticate, notificationController.markAllAsRead);

// ----------------------------------------------------
// Admin
// ----------------------------------------------------
router.post('/admin', authenticate, authorize([ADMIN]), validate(adminValidation.createAdmin), adminController.create);
router.get('/admin/dashboard', authenticate, authorize([ADMIN]), adminController.getDashboard);
router.post('/admin/detail', authenticate, authorize([ADMIN]), validate(adminValidation.getById), adminController.getById);

module.exports = router;
