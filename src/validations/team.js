const { Joi, objectId, phone, uploadedPath, idBody } = require('./common');
const { TEAM_MEMBER_STATUSES } = require('../constants');

const createTeamMember = {
  body: Joi.object({
    name: Joi.string().trim().min(2).max(80).required(),
    phone: phone().required(),
    designation: Joi.string().trim().max(60).default('Technician'),
    profileImage: uploadedPath().allow(null, ''),
  }),
};

const updateTeamMember = {
  body: Joi.object({
    id: objectId().required(),
    name: Joi.string().trim().min(2).max(80),
    phone: phone(),
    designation: Joi.string().trim().max(60),
    profileImage: uploadedPath().allow(null, ''),
    status: Joi.string().valid(...TEAM_MEMBER_STATUSES),
  }),
};

module.exports = { createTeamMember, updateTeamMember, getById: idBody };
