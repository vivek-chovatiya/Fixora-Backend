const express = require('express');
const router = express.Router();

// Middlewares
const authenticate = require('../middlewares/auth');
const authorize = require('../middlewares/role');
const validate = require('../middlewares/validation');

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
  validate(customerValidation.getById),
  customerController.getById
);
router.post(
  '/customers/update',
  authenticate,
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
router.post('/vendors/list', validate(vendorValidation.listVendors), vendorController.getAll);
router.post('/vendors/detail', validate(vendorValidation.getById), vendorController.getById);
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
  authorize(['VENDOR', 'ADMIN']),
  validate(serviceRequestValidation.updateStatus),
  serviceRequestController.reject
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
  authorize(['VENDOR', 'ADMIN']),
  validate(serviceRequestValidation.completeRequest),
  serviceRequestController.completeWork
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

// ----------------------------------------------------
// Notification Routes (No :id params in URL)
// ----------------------------------------------------
router.get('/notifications', authenticate, notificationController.getAll);
router.post('/notifications/list', authenticate, notificationController.getAll);
router.post('/notifications/read', authenticate, notificationController.markAsRead);

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
