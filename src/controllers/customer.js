const customerService = require('../services/customer');
const ApiResponse = require('../utils/ApiResponse');
const { assertSelfOrAdmin, withoutAdminFields } = require('../utils/ownership');

// A customer reads and changes their own record only; an administrator any (requests contract §2).
// A customer may not change `status` (or any other administrator field).
const ADMIN_ONLY_FIELDS = ['status', 'isVerified'];

class CustomerController {
  async getById(req, res, next) {
    try {
      assertSelfOrAdmin(req.user, req.body.id, 'Customer not found.');
      const customer = await customerService.getCustomerById(req.body.id);
      return ApiResponse.success(res, 'Customer details retrieved successfully.', customer);
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const { data, meta } = await customerService.getAllCustomers(req.body);
      return ApiResponse.success(res, 'Customer list retrieved successfully.', data, meta);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      assertSelfOrAdmin(req.user, req.body.id, 'Customer not found.');
      const payload = withoutAdminFields(req.user, req.body, ADMIN_ONLY_FIELDS);
      const customer = await customerService.updateCustomer(req.body.id, payload);
      return ApiResponse.success(res, 'Customer profile updated successfully.', customer);
    } catch (error) {
      next(error);
    }
  }

  async remove(req, res, next) {
    try {
      await customerService.deleteCustomer(req.body.id);
      return ApiResponse.success(res, 'Customer deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new CustomerController();
