const Address = require('../models/address');
const Customer = require('../models/customer');
const ApiError = require('../utils/ApiError');

const addressMapper = (address) => {
  if (!address) return null;
  return {
    id: address._id,
    customerId: address.customerId,
    title: address.title,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    latitude: address.latitude,
    longitude: address.longitude,
    isDefault: address.isDefault,
    fullAddress: `${address.addressLine1}${address.addressLine2 ? ', ' + address.addressLine2 : ''}, ${address.city}, ${address.state} - ${address.pincode}`,
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
};

class AddressService {
  async createAddress(customerId, payload) {
    if (payload.isDefault) {
      await Address.updateMany({ customerId, isDeleted: { $ne: true } }, { isDefault: false });
    }

    const address = await Address.create({
      ...payload,
      customerId,
    });

    if (payload.isDefault) {
      await Customer.findByIdAndUpdate(customerId, { defaultAddress: address._id });
    }

    return addressMapper(address);
  }

  async getCustomerAddresses(customerId) {
    const addresses = await Address.find({ customerId, isDeleted: { $ne: true } }).sort({
      createdAt: -1,
    });
    return addresses.map(addressMapper);
  }

  async getAddressById(id, customerId) {
    const address = await Address.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!address || address.customerId.toString() !== customerId.toString()) {
      throw new ApiError(404, 'Address not found.');
    }
    return addressMapper(address);
  }

  async updateAddress(id, customerId, payload) {
    const address = await Address.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!address || address.customerId.toString() !== customerId.toString()) {
      throw new ApiError(404, 'Address not found.');
    }

    if (payload.isDefault) {
      await Address.updateMany({ customerId, isDeleted: { $ne: true } }, { isDefault: false });
      await Customer.findByIdAndUpdate(customerId, { defaultAddress: id });
    }

    const updated = await Address.findByIdAndUpdate(id, payload, { new: true });
    return addressMapper(updated);
  }

  async setDefaultAddress(id, customerId) {
    const address = await Address.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!address || address.customerId.toString() !== customerId.toString()) {
      throw new ApiError(404, 'Address not found.');
    }

    await Address.updateMany({ customerId, isDeleted: { $ne: true } }, { isDefault: false });
    const updated = await Address.findByIdAndUpdate(id, { isDefault: true }, { new: true });
    await Customer.findByIdAndUpdate(customerId, { defaultAddress: id });

    return addressMapper(updated);
  }

  async deleteAddress(id, customerId) {
    const address = await Address.findOne({ _id: id, isDeleted: { $ne: true } });
    if (!address || address.customerId.toString() !== customerId.toString()) {
      throw new ApiError(404, 'Address not found.');
    }
    await Address.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date() });
    return true;
  }
}

module.exports = new AddressService();
