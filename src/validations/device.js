// Bodies of POST /devices/register and /devices/unregister (Phase 5 contract §6.1).
//
// The token is trimmed (a stray space from the client is never part of an FCM token), so a blank
// one is empty and refused. `platform` is exactly "android" or "ios", lower case as the contract
// writes it.
//
// It refuses every other key (stripped by the validation middleware), so nothing in the body can
// name another account: the owner is always the caller's token.
//
// ⚠️ Never give a rule here a message that quotes the value: these messages reach the response and
// the warning log, and the value is a push token.
const Joi = require('joi');

const TOKEN_MAX_LENGTH = 4096;
const PLATFORMS = ['android', 'ios'];

const token = Joi.string().trim().max(TOKEN_MAX_LENGTH).required();

const registerDevice = {
  body: Joi.object({
    token,
    platform: Joi.string()
      .valid(...PLATFORMS)
      .required(),
  }),
};

const unregisterDevice = {
  body: Joi.object({
    token,
  }),
};

module.exports = {
  registerDevice,
  unregisterDevice,
};
