const Joi = require('joi');

// `designation` is the role the app shows (Phase 5 contract §4): optional, '' (or null) for none,
// and no default role for a new member.
const createTeamMember = {
  body: Joi.object({
    name: Joi.string().max(100).trim().required(),
    phone: Joi.string().max(20).trim().allow('', null),
    designation: Joi.string().max(100).trim().allow('', null).default(''),
    profileImage: Joi.string().max(2048).allow(null, ''),
  }),
};

const updateTeamMember = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    name: Joi.string().max(100).trim(),
    // null or '' clears the phone; leaving it out keeps it (requests contract §7).
    phone: Joi.string().max(20).trim().allow('', null),
    // '' or null clears the role; leaving it out keeps it.
    designation: Joi.string().max(100).trim().allow('', null),
    profileImage: Joi.string().max(2048).allow(null, ''),
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'ON_LEAVE'),
  }),
};

const getById = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
  }),
};

module.exports = {
  createTeamMember,
  updateTeamMember,
  getById,
};
