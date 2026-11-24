const { Joi, pagination, idBody } = require('./common');

const list = { body: Joi.object({ ...pagination }) };

module.exports = { list, markRead: idBody };
