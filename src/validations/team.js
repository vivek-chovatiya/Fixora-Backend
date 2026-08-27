const Joi = require('joi');

const createTeamMember = {
  body: Joi.object({
    name: Joi.string().trim().required(),
    phone: Joi.string().trim().required(),
    designation: Joi.string().trim().default('Technician'),
    profileImage: Joi.string().allow(null, ''),
  }),
};

const updateTeamMember = {
  body: Joi.object({
    id: Joi.string().hex().length(24).required(),
    name: Joi.string().trim(),
    phone: Joi.string().trim(),
    designation: Joi.string().trim(),
    profileImage: Joi.string().allow(null, ''),
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
