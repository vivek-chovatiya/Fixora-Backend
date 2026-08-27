const addressService = require('../services/address');
const ApiResponse = require('../utils/ApiResponse');

class AddressController {
  async create(req, res, next) {
    try {
      const address = await addressService.createAddress(req.user.id, req.body);
      return ApiResponse.created(res, 'Address added successfully.', address);
    } catch (error) {
      next(error);
    }
  }

  async getAll(req, res, next) {
    try {
      const addresses = await addressService.getCustomerAddresses(req.user.id);
      return ApiResponse.success(res, 'Addresses retrieved successfully.', addresses);
    } catch (error) {
      next(error);
    }
  }

  async getById(req, res, next) {
    try {
      const address = await addressService.getAddressById(req.body.id, req.user.id);
      return ApiResponse.success(res, 'Address details retrieved successfully.', address);
    } catch (error) {
      next(error);
    }
  }

  async update(req, res, next) {
    try {
      const address = await addressService.updateAddress(req.body.id, req.user.id, req.body);
      return ApiResponse.success(res, 'Address updated successfully.', address);
    } catch (error) {
      next(error);
    }
  }

  async setDefault(req, res, next) {
    try {
      const address = await addressService.setDefaultAddress(req.body.id, req.user.id);
      return ApiResponse.success(res, 'Default address updated successfully.', address);
    } catch (error) {
      next(error);
    }
  }

  async remove(req, res, next) {
    try {
      await addressService.deleteAddress(req.body.id, req.user.id);
      return ApiResponse.success(res, 'Address deleted successfully.', null);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AddressController();
