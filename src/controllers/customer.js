const customerService = require('../services/customer');
const ApiResponse = require('../utils/ApiResponse');

class CustomerController {
  async getById(req, res, next) {
    try {
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
      const customer = await customerService.updateCustomer(req.body.id, req.body);
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
