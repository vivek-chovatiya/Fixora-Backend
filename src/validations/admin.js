const { Joi, phone, password, idBody } = require('./common');

const createAdmin = {
  body: Joi.object({
    name: Joi.string().trim().required(),
    email: Joi.string().email().lowercase().trim().required(),
    phone: phone().required(),
    password: password().required(),
  }),
};

module.exports = { createAdmin, getById: idBody };
