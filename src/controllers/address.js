const addressService = require('../services/address');
const ApiResponse = require('../utils/ApiResponse');
const { wrapController } = require('../utils/asyncHandler');

class AddressController {
  async create(req, res) {
    const address = await addressService.createAddress(req.user.id, req.body);
    return ApiResponse.created(res, 'Address added successfully.', address);
  }

  async getAll(req, res) {
    const addresses = await addressService.getCustomerAddresses(req.user.id);
    return ApiResponse.success(res, 'Addresses retrieved successfully.', addresses, {
      total: addresses.length,
    });
  }

  async getById(req, res) {
    const address = await addressService.getAddressById(req.body.id, req.user.id);
    return ApiResponse.success(res, 'Address details retrieved successfully.', address);
  }

  async update(req, res) {
    const address = await addressService.updateAddress(req.body.id, req.user.id, req.body);
    return ApiResponse.success(res, 'Address updated successfully.', address);
  }

  async setDefault(req, res) {
    const address = await addressService.setDefaultAddress(req.body.id, req.user.id);
    return ApiResponse.success(res, 'Default address updated successfully.', address);
  }

  async remove(req, res) {
    await addressService.deleteAddress(req.body.id, req.user.id);
    return ApiResponse.success(res, 'Address deleted successfully.', null);
  }
}

module.exports = wrapController(new AddressController());
