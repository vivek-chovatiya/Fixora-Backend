const customerService = require('../services/customer');
const ApiResponse = require('../utils/ApiResponse');
const { wrapController } = require('../utils/asyncHandler');
const { ROLE } = require('../constants');

class CustomerController {
  async getById(req, res) {
    const id = req.user.role === ROLE.ADMIN ? req.body.id : req.user.id;
    const customer = await customerService.getCustomerById(id);
    return ApiResponse.success(res, 'Customer details retrieved successfully.', customer);
  }

  async getAll(req, res) {
    const { data, meta } = await customerService.getAllCustomers(req.body);
    return ApiResponse.success(res, 'Customer list retrieved successfully.', data, meta);
  }

  async update(req, res) {
    const customer = await customerService.updateCustomer(req.user, req.body);
    return ApiResponse.success(res, 'Profile updated successfully.', customer);
  }

  async remove(req, res) {
    await customerService.deleteCustomer(req.body.id);
    return ApiResponse.success(res, 'Customer deleted successfully.', null);
  }
}

module.exports = wrapController(new CustomerController());
