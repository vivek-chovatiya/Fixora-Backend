const Joi = require('joi');
const { phone } = require('./fields');
const { isWallClockTime } = require('../utils/indiaTime');
const { VENDOR_WORKING_DAYS } = require('../config/workingHours');

// The working week (Phase 4B contract §6): exactly the seven days, Monday first; an open day has
// both times, 24-hour HH:mm, closing later than opening (no overnight shift, no breaks); a closed
// day has none (absent or null). Errors name the path, e.g. workingHours.3.closesAt.
const wallClockTime = Joi.string()
  .custom((value, helpers) => (isWallClockTime(value) ? value : helpers.error('time.wallClock')))
  .messages({ 'time.wallClock': '{{#label}} must be a 24-hour time written HH:mm.' });

// Zero-padded HH:mm strings order the same way as the times they name.
const closingTime = wallClockTime
  .custom((value, helpers) => {
    const opensAt = helpers.state.ancestors[0].opensAt;
    const tooEarly = isWallClockTime(opensAt) && value <= opensAt;
    return tooEarly ? helpers.error('time.afterOpening') : value;
  })
  .messages({ 'time.afterOpening': '{{#label}} must be later than opensAt.' });

const noTimeOnClosedDay = Joi.valid(null).messages({
  'any.only': '{{#label}} must be left out on a closed day.',
});

// Only a valid isOpen decides the times, so a missing isOpen is reported once, as itself.
const timeFor = (openSchema) =>
  Joi.when('isOpen', {
    switch: [
      { is: true, then: openSchema.required() },
      { is: false, then: noTimeOnClosedDay },
    ],
    otherwise: Joi.any(),
  });

const workingDay = (day) =>
  Joi.object({
    day: Joi.string().valid(day).required(),
    isOpen: Joi.boolean().required(),
    opensAt: timeFor(wallClockTime),
    closesAt: timeFor(closingTime),
  }).required();

const workingHours = Joi.array()
  .ordered(...VENDOR_WORKING_DAYS.map(workingDay))
  .length(VENDOR_WORKING_DAYS.length);

const updateVendor = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    businessName: Joi.string().max(100).trim(),
    ownerName: Joi.string().max(100).trim(),
    email: Joi.string().max(254).email().lowercase().trim(),
    phone,
    categoryIds: Joi.array().items(Joi.string().hex().length(24)).max(20),
    // null or '' clears them, stored '' (Phase 4B contract §6); businessName stays required.
    address: Joi.string().max(200).trim().allow(null, ''),
    description: Joi.string().max(1000).trim().allow(null, ''),
    availability: Joi.boolean(),
    // An uploaded image of the right type or one already stored (contract §2); max 6 shop images.
    profileImage: Joi.string().max(2048).allow(null, ''),
    shopImages: Joi.array().items(Joi.string().max(2048)).max(6),
    documents: Joi.array().items(Joi.string().max(2048)).max(10),
    workingHours,
  }),
};

const updateApprovalStatus = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    approvalStatus: Joi.string().valid('PENDING', 'APPROVED', 'REJECTED').required(),
  }),
};

const listVendors = {
  body: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    search: Joi.string().max(100).trim().allow(''),
    approvalStatus: Joi.string().valid('PENDING', 'APPROVED', 'REJECTED'),
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'BLOCKED'),
    categoryId: Joi.string().hex().length(24),
  }),
};

const getById = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
};

module.exports = {
  updateVendor,
  updateApprovalStatus,
  listVendors,
  getById,
};
