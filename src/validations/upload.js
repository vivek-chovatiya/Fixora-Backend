const { Joi } = require('./common');
const { UPLOAD_TYPES, UPLOAD_TYPE } = require('../constants');

const upload = {
  body: Joi.object({ type: Joi.string().valid(...UPLOAD_TYPES).default(UPLOAD_TYPE.REQUEST) }),
};

module.exports = { upload };
