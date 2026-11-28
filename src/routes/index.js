const express = require('express');
const router = express.Router();

// Middlewares
const authenticate = require('../middlewares/auth');
const optionalAuthenticate = require('../middlewares/optionalAuth');
const authorize = require('../middlewares/role');
const validate = require('../middlewares/validation');
const receiveUploadFiles = require('../middlewares/upload');

// Controllers
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
const deviceController = require('../controllers/device');

// Validations
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
const deviceValidation = require('../validations/device');

// ----------------------------------------------------
// Health Check
// ----------------------------------------------------
router.get('/health', (req, res) => {
  res.json({ success: true, message: 'Fixora API is healthy and running.' });
});

// ----------------------------------------------------
// Authentication Routes
// ----------------------------------------------------
router.post('/auth/login', validate(authValidation.login), authController.login);
router.post(
  '/auth/register/customer',
  validate(authValidation.registerCustomer),
  authController.registerCustomer
);
router.post(
  '/auth/register/vendor',
  validate(authValidation.registerVendor),
  authController.registerVendor
);
router.get('/auth/me', authenticate, authController.me);
router.post('/auth/logout', authenticate, authController.logout);

// Phone sign in by one-time code — customer, vendor registration and vendor sign in (shared
// contract, owner decision 17/11/2026; PROJECT_BIBLE.md section 7A). The vendor's permanent auth
// code and its routes were removed by the Phase 5 contract §1 (owner decision 28/11/2026).
router.post(
  '/auth/customer/otp/request',
  validate(authValidation.requestCustomerOtp),
  authController.requestCustomerOtp
);
router.post(
  '/auth/customer/otp/verify',
  validate(authValidation.verifyCustomerOtp),
  authController.verifyCustomerOtp
);
router.post(
  '/auth/vendor/register',
  validate(authValidation.registerVendorByPhone),
  authController.registerVendorByPhone
);
router.post(
  '/auth/vendor/otp/request',
  validate(authValidation.requestVendorOtp),
  authController.requestVendorOtp
);
router.post(
  '/auth/vendor/otp/verify',
  validate(authValidation.verifyVendorOtp),
  authController.verifyVendorOtp
);
router.post(
  '/auth/vendor/signin/otp/request',
  validate(authValidation.requestVendorSignInOtp),
  authController.requestVendorSignInOtp
);
router.post(
  '/auth/vendor/signin/otp/verify',
  validate(authValidation.verifyVendorSignInOtp),
  authController.verifyVendorSignInOtp
);

// ----------------------------------------------------
// Customer Routes (No :id params in URL)
// ----------------------------------------------------
router.post(
  '/customers/list',
  authenticate,
  authorize(['ADMIN']),
  validate(customerValidation.listCustomers),
  customerController.getAll
);
router.post(
  '/customers/detail',
  authenticate,
  authorize(['CUSTOMER', 'ADMIN']),
  validate(customerValidation.getById),
  customerController.getById
);
router.post(
  '/customers/update',
  authenticate,
  authorize(['CUSTOMER', 'ADMIN']),
  validate(customerValidation.updateCustomer),
  customerController.update
);
router.delete(
  '/customers/delete',
  authenticate,
  authorize(['ADMIN']),
  validate(customerValidation.getById),
  customerController.remove
);

// ----------------------------------------------------
// Vendor Routes (No :id params in URL)
// ----------------------------------------------------
// Public; an administrator's token unlocks the full record (requests contract §3).
router.post(
  '/vendors/list',
  optionalAuthenticate,
  validate(vendorValidation.listVendors),
  vendorController.getAll
);
router.post(
  '/vendors/detail',
  optionalAuthenticate,
  validate(vendorValidation.getById),
  vendorController.getById
);
router.post(
  '/vendors/update',
  authenticate,
  authorize(['VENDOR', 'ADMIN']),
  validate(vendorValidation.updateVendor),
  vendorController.update
);
router.post(
  '/vendors/approval-status',
  authenticate,
  authorize(['ADMIN']),
  validate(vendorValidation.updateApprovalStatus),
  vendorController.updateApprovalStatus
);
router.delete(
  '/vendors/delete',
  authenticate,
  authorize(['ADMIN']),
  validate(vendorValidation.getById),
  vendorController.remove
);
// The signed-in vendor's own report, counted from the requests (Phase 4B contract §5)
router.post(
  '/vendors/report',
  authenticate,
  authorize(['VENDOR']),
  validate(serviceRequestValidation.vendorReport),
  serviceRequestController.vendorReport
);

// ----------------------------------------------------
// Team Member Routes (No :id params in URL)
// ----------------------------------------------------
router.post(
  '/team',
  authenticate,
  authorize(['VENDOR']),
  validate(teamValidation.createTeamMember),
  teamController.create
);
router.get('/team', authenticate, authorize(['VENDOR']), teamController.getAll);
router.post(
  '/team/detail',
  authenticate,
  authorize(['VENDOR']),
  validate(teamValidation.getById),
  teamController.getById
);
router.post(
  '/team/update',
  authenticate,
  authorize(['VENDOR']),
  validate(teamValidation.updateTeamMember),
  teamController.update
);
router.delete(
  '/team/delete',
  authenticate,
  authorize(['VENDOR']),
  validate(teamValidation.getById),
  teamController.remove
);

// ----------------------------------------------------
// Category Routes (No :id params in URL)
// ----------------------------------------------------
router.post(
  '/categories',
  authenticate,
  authorize(['ADMIN']),
  validate(categoryValidation.createCategory),
  categoryController.create
);
router.get('/categories', categoryController.getAll);
router.post(
  '/categories/list',
  validate(categoryValidation.listCategories),
  categoryController.getAll
);
router.post('/categories/detail', validate(categoryValidation.getById), categoryController.getById);
router.post(
  '/categories/update',
  authenticate,
  authorize(['ADMIN']),
  validate(categoryValidation.updateCategory),
  categoryController.update
);
router.delete(
  '/categories/delete',
  authenticate,
  authorize(['ADMIN']),
  validate(categoryValidation.getById),
  categoryController.remove
);

// ----------------------------------------------------
// Sub-Category Routes (No :id params in URL)
// ----------------------------------------------------
router.post(
  '/subcategories',
  authenticate,
  authorize(['ADMIN']),
  validate(subCategoryValidation.createSubCategory),
  subCategoryController.create
);
router.get('/subcategories', subCategoryController.getAll);
router.post(
  '/subcategories/list',
  validate(subCategoryValidation.listSubCategories),
  subCategoryController.getAll
);
router.post(
  '/subcategories/detail',
  validate(subCategoryValidation.getById),
  subCategoryController.getById
);
router.post(
  '/subcategories/update',
  authenticate,
  authorize(['ADMIN']),
  validate(subCategoryValidation.updateSubCategory),
  subCategoryController.update
);
router.delete(
  '/subcategories/delete',
  authenticate,
  authorize(['ADMIN']),
  validate(subCategoryValidation.getById),
  subCategoryController.remove
);

// ----------------------------------------------------
// Customer Address Routes (No :id params in URL)
// ----------------------------------------------------
router.post(
  '/addresses',
  authenticate,
  authorize(['CUSTOMER']),
  validate(addressValidation.createAddress),
  addressController.create
);
router.get('/addresses', authenticate, authorize(['CUSTOMER']), addressController.getAll);
router.post(
  '/addresses/detail',
  authenticate,
  authorize(['CUSTOMER']),
  validate(addressValidation.getById),
  addressController.getById
);
router.post(
  '/addresses/update',
  authenticate,
  authorize(['CUSTOMER']),
  validate(addressValidation.updateAddress),
  addressController.update
);
router.post(
  '/addresses/default',
  authenticate,
  authorize(['CUSTOMER']),
  validate(addressValidation.getById),
  addressController.setDefault
);
router.delete(
  '/addresses/delete',
  authenticate,
  authorize(['CUSTOMER']),
  validate(addressValidation.getById),
  addressController.remove
);

// ----------------------------------------------------
// Service Request Routes (No :id params in URL)
// ----------------------------------------------------
router.post(
  '/requests',
  authenticate,
  authorize(['CUSTOMER']),
  validate(serviceRequestValidation.createRequest),
  serviceRequestController.create
);
router.post(
  '/requests/list',
  authenticate,
  validate(serviceRequestValidation.listRequests),
  serviceRequestController.getAll
);
router.post(
  '/requests/detail',
  authenticate,
  validate(serviceRequestValidation.getById),
  serviceRequestController.getById
);
router.post(
  '/requests/accept',
  authenticate,
  authorize(['VENDOR']),
  validate(serviceRequestValidation.getById),
  serviceRequestController.accept
);
router.post(
  '/requests/reject',
  authenticate,
  authorize(['VENDOR']),
  validate(serviceRequestValidation.updateStatus),
  serviceRequestController.reject
);
router.post(
  '/requests/cancel',
  authenticate,
  authorize(['CUSTOMER']),
  validate(serviceRequestValidation.cancelRequest),
  serviceRequestController.cancel
);
router.post(
  '/requests/assign',
  authenticate,
  authorize(['VENDOR']),
  validate(serviceRequestValidation.assignTeamMember),
  serviceRequestController.assignTeam
);
router.post(
  '/requests/start',
  authenticate,
  authorize(['VENDOR']),
  validate(serviceRequestValidation.updateStatus),
  serviceRequestController.startWork
);
router.post(
  '/requests/complete',
  authenticate,
  authorize(['VENDOR']),
  validate(serviceRequestValidation.completeRequest),
  serviceRequestController.completeWork
);
// "Not paid yet" → "Paid", once, by the vendor holding the work (Phase 4B contract §4)
router.post(
  '/requests/record-payment',
  authenticate,
  authorize(['VENDOR']),
  validate(serviceRequestValidation.recordPayment),
  serviceRequestController.recordPayment
);
// The configured offline payment methods, in order (PROJECT_BIBLE.md section 37)
router.post(
  '/payment-methods/list',
  authenticate,
  authorize(['VENDOR', 'ADMIN']),
  validate(serviceRequestValidation.listPaymentMethods),
  serviceRequestController.listPaymentMethods
);

// ----------------------------------------------------
// Review Routes (No :id params in URL)
// ----------------------------------------------------
router.post(
  '/reviews',
  authenticate,
  authorize(['CUSTOMER']),
  validate(reviewValidation.createReview),
  reviewController.create
);
router.post(
  '/reviews/vendor',
  validate(reviewValidation.listVendorReviews),
  reviewController.getVendorReviews
);
// A customer's own review of their own request (requests contract §8)
router.post(
  '/reviews/detail',
  authenticate,
  authorize(['CUSTOMER']),
  validate(reviewValidation.reviewForRequest),
  reviewController.getForRequest
);

// ----------------------------------------------------
// Notification Routes (No :id params in URL)
// ----------------------------------------------------
router.get('/notifications', authenticate, notificationController.getAll);
router.post(
  '/notifications/list',
  authenticate,
  validate(notificationValidation.listNotifications),
  notificationController.getAll
);
router.post(
  '/notifications/read',
  authenticate,
  validate(notificationValidation.markAsRead),
  notificationController.markAsRead
);
// Soft delete from the caller's own inbox (Phase 4B contract §8)
router.post(
  '/notifications/delete',
  authenticate,
  validate(notificationValidation.deleteNotification),
  notificationController.remove
);
// The caller's whole inbox at once: mark every unread read, or clear it (Phase 5 contract §3)
router.post(
  '/notifications/read-all',
  authenticate,
  validate(notificationValidation.markAllAsRead),
  notificationController.markAllAsRead
);
router.post(
  '/notifications/delete-all',
  authenticate,
  validate(notificationValidation.deleteAllNotifications),
  notificationController.removeAll
);

// ----------------------------------------------------
// Upload Routes (Phase 4B contract §1)
// ----------------------------------------------------
// multipart/form-data: `type` + 1–5 `files`. The files are received only after the role check, and
// `type` is validated only once the whole body is parsed (the part order does not matter).
router.post(
  '/uploads',
  authenticate,
  authorize(['CUSTOMER', 'VENDOR']),
  receiveUploadFiles,
  validate(uploadValidation.createUpload),
  uploadController.create
);

// ----------------------------------------------------
// Device Routes (Phase 5 contract §6.1)
// ----------------------------------------------------
// The signed-in customer's or vendor's push token. Stored even while push sending is off, so the
// tokens are ready the day Firebase is configured.
router.post(
  '/devices/register',
  authenticate,
  authorize(['CUSTOMER', 'VENDOR']),
  validate(deviceValidation.registerDevice),
  deviceController.register
);
router.post(
  '/devices/unregister',
  authenticate,
  authorize(['CUSTOMER', 'VENDOR']),
  validate(deviceValidation.unregisterDevice),
  deviceController.unregister
);

// ----------------------------------------------------
// Admin Routes (No :id params in URL)
// ----------------------------------------------------
router.post(
  '/admin',
  authenticate,
  authorize(['ADMIN']),
  validate(adminValidation.createAdmin),
  adminController.create
);
router.get('/admin/dashboard', authenticate, authorize(['ADMIN']), adminController.getDashboard);
router.post(
  '/admin/detail',
  authenticate,
  authorize(['ADMIN']),
  validate(adminValidation.getById),
  adminController.getById
);

module.exports = router;
