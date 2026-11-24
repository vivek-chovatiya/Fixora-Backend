const Address = require('../models/address');
const Customer = require('../models/customer');
const ApiError = require('../utils/ApiError');

const formatFullAddress = (address) =>
  [address.addressLine1, address.addressLine2, address.city, address.state]
    .filter(Boolean)
    .join(', ') + (address.pincode ? ` - ${address.pincode}` : '');

const addressMapper = (address) => {
  if (!address) return null;
  return {
    id: address._id,
    title: address.title,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    state: address.state,
    pincode: address.pincode,
    latitude: address.latitude,
    longitude: address.longitude,
    isDefault: address.isDefault,
    fullAddress: formatFullAddress(address),
    createdAt: address.createdAt,
    updatedAt: address.updatedAt,
  };
};

const ownedFilter = (id, customerId) => ({ _id: id, customerId, isDeleted: { $ne: true } });

class AddressService {
  async createAddress(customerId, payload) {
    const existingCount = await Address.countDocuments({ customerId, isDeleted: { $ne: true } });
    // The first address is always the default.
    const isDefault = existingCount === 0 ? true : Boolean(payload.isDefault);

    if (isDefault) {
      await Address.updateMany({ customerId, isDeleted: { $ne: true } }, { isDefault: false });
    }

    const address = await Address.create({ ...payload, isDefault, customerId });

    if (isDefault) {
      await Customer.findByIdAndUpdate(customerId, { defaultAddress: address._id });
    }

    return addressMapper(address);
  }

  async getCustomerAddresses(customerId) {
    const addresses = await Address.find({ customerId, isDeleted: { $ne: true } }).sort({
      isDefault: -1,
      createdAt: -1,
    });
    return addresses.map(addressMapper);
  }

  /** Raw document, ownership enforced. Used by the service request module. */
  async getOwnedAddressDocument(id, customerId) {
    const address = await Address.findOne(ownedFilter(id, customerId));
    if (!address) {
      throw new ApiError(400, 'Please select a valid service address.', [
        { field: 'addressId', message: 'Please select a valid service address.' },
      ]);
    }
    return address;
  }

  async getAddressById(id, customerId) {
    const address = await Address.findOne(ownedFilter(id, customerId));
    if (!address) {
      throw new ApiError(404, 'Address not found.');
    }
    return addressMapper(address);
  }

  async updateAddress(id, customerId, payload) {
    const address = await Address.findOne(ownedFilter(id, customerId));
    if (!address) {
      throw new ApiError(404, 'Address not found.');
    }

    const update = { ...payload };
    delete update.id;

    if (update.isDefault === true) {
      await Address.updateMany({ customerId, isDeleted: { $ne: true } }, { isDefault: false });
      await Customer.findByIdAndUpdate(customerId, { defaultAddress: id });
    } else if (update.isDefault === false && address.isDefault) {
      // A default must always exist while addresses exist; use setDefault on another address.
      delete update.isDefault;
    }

    const updated = await Address.findByIdAndUpdate(id, update, { new: true });
    return addressMapper(updated);
  }

  async setDefaultAddress(id, customerId) {
    const address = await Address.findOne(ownedFilter(id, customerId));
    if (!address) {
      throw new ApiError(404, 'Address not found.');
    }

    await Address.updateMany({ customerId, isDeleted: { $ne: true } }, { isDefault: false });
    const updated = await Address.findByIdAndUpdate(id, { isDefault: true }, { new: true });
    await Customer.findByIdAndUpdate(customerId, { defaultAddress: id });

    return addressMapper(updated);
  }

  async deleteAddress(id, customerId) {
    const address = await Address.findOne(ownedFilter(id, customerId));
    if (!address) {
      throw new ApiError(404, 'Address not found.');
    }
    await Address.findByIdAndUpdate(id, { isDeleted: true, deletedAt: new Date(), isDefault: false });

    if (address.isDefault) {
      const next = await Address.findOne({ customerId, isDeleted: { $ne: true } }).sort({
        createdAt: -1,
      });
      if (next) {
        await Address.findByIdAndUpdate(next._id, { isDefault: true });
      }
      await Customer.findByIdAndUpdate(customerId, { defaultAddress: next ? next._id : null });
    }
    return true;
  }
}

module.exports = new AddressService();
module.exports.addressMapper = addressMapper;
module.exports.formatFullAddress = formatFullAddress;
