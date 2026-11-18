const Joi = require('joi');

// Ids are checked here so a malformed one answers 400 VALIDATION_FAILED, never a 500
// (requests contract §8).
const listNotifications = {
  body: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

const markAsRead = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
};

module.exports = {
  listNotifications,
  markAsRead,
};
