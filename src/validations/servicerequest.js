const Joi = require('joi');
const { PAYMENT_METHOD_IDS } = require('../config/paymentMethods');
const { isCalendarDate, isWallClockTime } = require('../utils/indiaTime');

const objectId = Joi.string().hex().length(24);

// The customer's preferred date and time, each optional and independent (Phase 4B §3). `null` or
// "" means none; the service tells "sent as none" from "not sent" (a web view's scheduledAt).
const preferredDate = Joi.string()
  .allow(null, '')
  .custom((value, helpers) => (isCalendarDate(value) ? value : helpers.error('date.calendar')))
  .messages({ 'date.calendar': '{{#label}} must be a real date written YYYY-MM-DD.' });

const preferredTime = Joi.string()
  .allow(null, '')
  .custom((value, helpers) => (isWallClockTime(value) ? value : helpers.error('time.wallClock')))
  .messages({ 'time.wallClock': '{{#label}} must be a 24-hour time written HH:mm.' });

// Rupees, as the app sends them: at most two decimal places, refused — never rounded — beyond
// that. Joi's precision() would round 10.555 to 10.56 and record money nobody typed.
const RUPEES_MAX = 1000000;
const rupees = Joi.number()
  .min(0)
  .max(RUPEES_MAX)
  .custom((value, helpers) =>
    Math.round(value * 100) / 100 === value ? value : helpers.error('number.twoDecimals')
  )
  .messages({ 'number.twoDecimals': '{{#label}} must have at most 2 decimal places.' });

// Any of these on a completion is a payment record, which needs an amount above zero.
const PAYMENT_RECORD_FIELDS = ['currency', 'paymentStatus', 'paymentMethodId', 'completionNotes'];
const paymentMethodId = Joi.string().valid(...PAYMENT_METHOD_IDS);

// Fields fixed when the work was completed; record-payment may not touch them.
const fixedOnceCompleted = Joi.any()
  .forbidden()
  .messages({ 'any.unknown': '{{#label}} cannot be changed once the work is completed.' });

// Stored on the request only, never in the address book (requests contract §6).
const serviceAddressDetails = Joi.object({
  line1: Joi.string().trim().max(200).allow(''),
  line2: Joi.string().trim().max(200).allow(''),
  landmark: Joi.string().trim().max(200).allow(''),
  area: Joi.string().trim().max(120).allow(''),
  city: Joi.string().trim().max(120).allow(''),
  pincode: Joi.string().trim().max(12).allow(''),
  latitude: Joi.number().min(-90).max(90).allow(null),
  longitude: Joi.number().min(-180).max(180).allow(null),
});

const createRequest = {
  body: Joi.object({
    categoryId: objectId.required(),
    subCategoryId: objectId.empty(['', null]),
    addressId: objectId.empty(['', null]),
    vendorId: objectId.empty(['', null]),
    // Required when no saved address is chosen: the request records where the work is, as given.
    serviceAddress: Joi.string()
      .trim()
      .max(500)
      .empty('')
      .when('addressId', { not: Joi.exist(), then: Joi.required() }),
    serviceAddressDetails: serviceAddressDetails.allow(null),
    description: Joi.string().trim().max(1000).allow('').default(''),
    // Paths from POST /uploads (type `request`), checked by services/uploadAttach.js, which also
    // refuses a repeat after normalising (Phase 4B §2).
    images: Joi.array().items(Joi.string().max(2048)).max(5).optional(),
    priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT').default('MEDIUM'),
    preferredDate,
    preferredTime,
    // The web views' field; ignored whenever preferredDate or preferredTime is sent.
    scheduledAt: Joi.date().iso().optional().allow(null),
    notes: Joi.string().max(500).trim().optional().allow(''),
  }),
};

const listRequests = {
  body: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string().valid(
      'PENDING',
      'ACCEPTED',
      'ASSIGNED',
      'IN_PROGRESS',
      'COMPLETED',
      'CANCELLED',
      'REJECTED'
    ),
    priority: Joi.string().valid('LOW', 'MEDIUM', 'HIGH', 'URGENT'),
    // Vendors only: the open broadcast requests this vendor declined (requests contract §2, §4).
    declined: Joi.boolean(),
  }),
};

const assignTeamMember = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    assignedTeamMemberId: Joi.string().hex().length(24).required(),
  }),
};

const updateStatus = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    note: Joi.string().max(500).trim().allow(''),
  }),
};

// Completing work, with the offline payment record (bible §36–§37, Phase 4B §4). `{ id, amount }`
// alone is the web views' call and records "not paid yet"; no amount (or 0) and no payment field
// completes with no record, as before 4B.
const completeRequest = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    amount: PAYMENT_RECORD_FIELDS.reduce(
      (schema, field) =>
        schema.when(field, {
          is: Joi.exist().invalid(''),
          then: Joi.number().greater(0).required(),
        }),
      rupees
    ).messages({
      'number.greater': '{{#label}} must be more than 0 when a payment is recorded.',
      'any.required': '{{#label}} is required when a payment is recorded.',
    }),
    currency: Joi.string().valid('INR'),
    paymentStatus: Joi.string().valid('PENDING', 'PAID'),
    paymentMethodId: paymentMethodId.when('paymentStatus', {
      is: 'PAID',
      then: Joi.required(),
      otherwise: Joi.forbidden(),
    }),
    // The vendor's own notes, never shown to the customer; `note` is the timeline entry they read.
    completionNotes: Joi.string().trim().max(500).allow(''),
    completionImages: Joi.array().items(Joi.string().max(2048)).max(10).optional(),
    note: Joi.string().max(500).trim().allow(''),
  }),
};

// "Not paid yet" → "Paid", once (bible §37 amended 21/10/2026). Nothing else in the record moves.
const recordPayment = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    paymentStatus: Joi.string().valid('PAID').required(),
    paymentMethodId: paymentMethodId.required(),
    amount: fixedOnceCompleted,
    currency: fixedOnceCompleted,
    completionNotes: fixedOnceCompleted,
    note: fixedOnceCompleted,
    completionImages: fixedOnceCompleted,
  }),
};

const listPaymentMethods = {
  body: Joi.object({}),
};

// The signed-in vendor's report (bible §42, Phase 4B §5); whose it is comes from the token.
const vendorReport = {
  body: Joi.object({
    period: Joi.string().valid('today', 'week', 'month').required(),
  }),
};

// Customer cancel, allowed until a professional accepts (requests contract §5).
const cancelRequest = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    reason: Joi.string().trim().max(500).allow(''),
  }),
};

const getById = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
};

module.exports = {
  createRequest,
  listRequests,
  assignTeamMember,
  updateStatus,
  completeRequest,
  recordPayment,
  listPaymentMethods,
  vendorReport,
  cancelRequest,
  getById,
};
