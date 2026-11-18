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
    // `state` is optional (requests contract §7), so it is left out rather than printed empty.
    fullAddress: [
      address.addressLine1,
      address.addressLine2,
      address.city,
      [address.state, address.pincode].filter(Boolean).join(' - '),
    ]
      .filter(Boolean)
      .join(', '),
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
};

// A cleared part is stored as '' whether the client sent null or ''.
const CLEARABLE_PARTS = ['addressLine2', 'city', 'state', 'pincode'];
const withClearedParts = (payload) => {
  const cleaned = { ...payload };
  for (const part of CLEARABLE_PARTS) {
    if (cleaned[part] === null) cleaned[part] = '';
  }
  return cleaned;
};

class AddressService {
  async createAddress(customerId, payload) {
    if (payload.isDefault) {
      await Address.updateMany({ customerId, isDeleted: { $ne: true } }, { isDefault: false });
    }

    const address = await Address.create({
      ...withClearedParts(payload),
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

    const updated = await Address.findByIdAndUpdate(id, withClearedParts(payload), { new: true });
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
