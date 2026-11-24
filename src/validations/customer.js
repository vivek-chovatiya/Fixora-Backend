const { Joi, objectId, phone, uploadedPath, pagination, idBody } = require('./common');

const updateCustomer = {
  body: Joi.object({
    id: objectId(),
    firstName: Joi.string().trim().min(1).max(60),
    lastName: Joi.string().trim().max(60).allow(''),
    email: Joi.string().email().lowercase().trim(),
    phone: phone(),
    profileImage: uploadedPath().allow(null, ''),
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'BLOCKED'),
  }),
};

const listCustomers = {
  body: Joi.object({
    ...pagination,
    search: Joi.string().trim().max(100).allow(''),
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'BLOCKED'),
  }),
};

module.exports = { updateCustomer, listCustomers, getById: idBody };
