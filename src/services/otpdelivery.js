const logger = require('../utils/logger');
const { maskPhoneForLog } = require('../utils/phone');

// The one place a one-time code leaves the backend — the seam an SMS or WhatsApp provider plugs
// into later (PROJECT_BIBLE.md section 7A.1: delivery is a backend concern the app never sees).
// No provider is wired yet (owner decision 17/11/2026), so delivery only records that a code went
// out; with OTP_STATIC_CODE set the tester already knows it.
//
// ⚠️ Never log `code`, here or in a provider adapter, and never let a provider's error message
// (which may quote the request) reach a log or a response unfiltered.
class OtpDeliveryService {
  // eslint-disable-next-line no-unused-vars
  async deliver({ phone, code, purpose }) {
    logger.info(`otp issued for ${maskPhoneForLog(phone)}`);
  }
}

module.exports = new OtpDeliveryService();
