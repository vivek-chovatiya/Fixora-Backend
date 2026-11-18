const Joi = require('joi');
const { phone, sixDigitCode } = require('./fields');

const login = {
  body: Joi.object({
    email: Joi.string().max(254).email().lowercase().trim().required(),
    password: Joi.string().max(128).required(),
    role: Joi.string().valid('CUSTOMER', 'VENDOR', 'ADMIN').required(),
  }),
};

const registerCustomer = {
  body: Joi.object({
    firstName: Joi.string().max(100).trim().required(),
    lastName: Joi.string().max(100).trim().allow(''),
    email: Joi.string().max(254).email().lowercase().trim().required(),
    phone: phone.required(),
    password: Joi.string().max(128).min(6).required(),
  }),
};

const registerVendor = {
  body: Joi.object({
    businessName: Joi.string().max(100).trim().required(),
    ownerName: Joi.string().max(100).trim().required(),
    email: Joi.string().max(254).email().lowercase().trim().required(),
    phone: phone.required(),
    password: Joi.string().max(128).min(6).required(),
    address: Joi.string().max(200).trim().required(),
    description: Joi.string().max(1000).trim().allow(''),
    categoryIds: Joi.array().items(Joi.string().hex().length(24)).max(20),
  }),
};

// ----------------------------------------------------
// Phone sign in (shared contract, owner decision 17/11/2026)
// ----------------------------------------------------
// registrationId is checked for shape by the service, so an unknown or malformed id gets the one
// answer the contract names (404 REGISTRATION_NOT_FOUND).
const registrationId = Joi.string().trim().max(64).required();

const requestCustomerOtp = {
  body: Joi.object({
    phone: phone.required(),
  }),
};

const verifyCustomerOtp = {
  body: Joi.object({
    phone: phone.required(),
    code: sixDigitCode.required(),
  }),
};

const registerVendorByPhone = {
  body: Joi.object({
    businessName: Joi.string().trim().max(100).required(),
    ownerFirstName: Joi.string().trim().max(100).required(),
    ownerLastName: Joi.string().trim().max(100).required(),
    phone: phone.required(),
    email: Joi.string().max(254).email().lowercase().trim().empty(['', null]),
    serviceCategoryIds: Joi.array()
      .items(Joi.string().hex().length(24))
      .min(1)
      .max(20)
      .unique()
      .required(),
  }),
};

const requestVendorOtp = {
  body: Joi.object({
    registrationId,
  }),
};

const verifyVendorOtp = {
  body: Joi.object({
    registrationId,
    code: sixDigitCode.required(),
  }),
};

const confirmVendorAuthCode = {
  body: Joi.object({
    registrationId,
    authCode: sixDigitCode.required(),
  }),
};

const regenerateVendorAuthCode = {
  body: Joi.object({
    registrationId,
  }),
};

const signInVendor = {
  body: Joi.object({
    phone: phone.required(),
    authCode: sixDigitCode.required(),
  }),
};

module.exports = {
  login,
  registerCustomer,
  registerVendor,
  requestCustomerOtp,
  verifyCustomerOtp,
  registerVendorByPhone,
  requestVendorOtp,
  verifyVendorOtp,
  confirmVendorAuthCode,
  regenerateVendorAuthCode,
  signInVendor,
};
