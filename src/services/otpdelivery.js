const ApiError = require('../utils/ApiError');
const logger = require('../utils/logger');
const { ERROR_CODES } = require('../utils/errorCodes');
const { maskPhoneForLog, normalisePhone } = require('../utils/phone');
const {
  OTP_DELIVERY_CHANNELS,
  deliveryChannelFrom,
  missingWhatsAppSettings,
  whatsAppSettingsFrom,
} = require('../config/otpDelivery');

// The one place a one-time code leaves the backend (PROJECT_BIBLE.md section 7A.1: delivery is a
// backend concern the app never sees). Two channels, chosen by env only (config/otpDelivery.js;
// Phase 5 contract §2):
//
//   NONE      nothing is sent, only recorded — the behaviour before WhatsApp; with OTP_STATIC_CODE
//             set in development the tester already knows the code.
//   WHATSAPP  Meta's WhatsApp Cloud API: an AUTHENTICATION template message whose body parameter
//             and copy-code button parameter are both the code (Meta requires it twice).
//
// `channelFor` says, before anything is spent, which channel a code for that number would use —
// or refuses with 503 OTP_DELIVERY_FAILED when it could not be delivered at all (unknown channel,
// missing settings, a number WhatsApp cannot be addressed at). services/otp.js asks it first, so a
// stand-in challenge for an unknown vendor number fails or succeeds exactly like a real one.
//
// It refuses to retry, queue or fall back to another channel: a code the provider did not accept
// is a 503 the caller hands straight back to the user.
//
// ⚠️ Never log `code` or the access token, and never let the provider's error text (which can
// quote the request, the number included) reach a log or a response: only the HTTP status and
// Meta's numeric error code are kept.

// Well inside the app's own 30-second request timeout, so the app sees our 503, not its timeout.
const WHATSAPP_TIMEOUT_MS = 10 * 1000;
const GRAPH_API_ORIGIN = 'https://graph.facebook.com';

const deliveryFailed = () =>
  new ApiError(
    503,
    'We could not send the verification code. Please try again.',
    null,
    ERROR_CODES.OTP_DELIVERY_FAILED
  );

// The contract sends Indian numbers only: 91 followed by the 10-digit number. A number already
// carrying 91 is kept; anything else cannot be addressed.
const toIndianE164 = (phone) => {
  const digits = normalisePhone(String(phone || ''));
  if (/^\d{10}$/.test(digits)) return `91${digits}`;
  if (/^91\d{10}$/.test(digits)) return digits;
  return null;
};

// Meta's numeric error code and subcode only; any text in the body is dropped unread.
const providerErrorCodes = async (response) => {
  try {
    const body = await response.json();
    const error = body && body.error;
    return [error && error.code, error && error.error_subcode]
      .map((value) => (value === undefined || value === null ? '' : String(value)))
      .filter((value) => /^\d{1,9}$/.test(value))
      .join('/');
  } catch (error) {
    return '';
  }
};

const templateMessage = ({ to, code, templateName, language }) => ({
  messaging_product: 'whatsapp',
  recipient_type: 'individual',
  to,
  type: 'template',
  template: {
    name: templateName,
    language: { code: language },
    components: [
      { type: 'body', parameters: [{ type: 'text', text: code }] },
      { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
    ],
  },
});

class OtpDeliveryService {
  // 'NONE' | 'WHATSAPP' for a code to this number, or 503 OTP_DELIVERY_FAILED when none could go.
  channelFor(phone) {
    const channel = deliveryChannelFrom(process.env);
    if (!channel) {
      logger.error('otp not sent: OTP_DELIVERY_CHANNEL must be "none" or "whatsapp".');
      throw deliveryFailed();
    }
    if (channel === OTP_DELIVERY_CHANNELS.WHATSAPP) {
      const missing = missingWhatsAppSettings(process.env);
      if (missing.length) {
        logger.error(`otp not sent by WhatsApp: ${missing.join(', ')} not set.`);
        throw deliveryFailed();
      }
      if (!toIndianE164(phone)) {
        logger.warn(`otp not sent by WhatsApp to ${maskPhoneForLog(phone)}: not an Indian number.`);
        throw deliveryFailed();
      }
    }
    return channel;
  }

  // Sends the code and answers the channel used, or throws 503 OTP_DELIVERY_FAILED.
  // eslint-disable-next-line no-unused-vars
  async deliver({ phone, code, purpose }) {
    const channel = this.channelFor(phone);
    if (channel === OTP_DELIVERY_CHANNELS.WHATSAPP) {
      await this.sendWhatsApp({ phone, code });
      logger.info(`otp issued for ${maskPhoneForLog(phone)} by WhatsApp`);
      return channel;
    }
    logger.info(`otp issued for ${maskPhoneForLog(phone)}`);
    return channel;
  }

  async sendWhatsApp({ phone, code }) {
    const settings = whatsAppSettingsFrom(process.env);
    const url = `${GRAPH_API_ORIGIN}/${encodeURIComponent(settings.apiVersion)}/${encodeURIComponent(
      settings.phoneNumberId
    )}/messages`;
    const masked = maskPhoneForLog(phone);

    let response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${settings.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(
          templateMessage({
            to: toIndianE164(phone),
            code,
            templateName: settings.templateName,
            language: settings.language,
          })
        ),
        signal: AbortSignal.timeout(WHATSAPP_TIMEOUT_MS),
      });
    } catch (error) {
      // A network error's message can carry the URL; its name is enough to tell the cases apart.
      const timedOut = Boolean(error) && ['TimeoutError', 'AbortError'].includes(error.name);
      const reason = timedOut
        ? `no answer within ${WHATSAPP_TIMEOUT_MS / 1000} s`
        : `request failed (${error && error.name})`;
      logger.error(`whatsapp otp delivery failed for ${masked}: ${reason}`);
      throw deliveryFailed();
    }

    if (!response.ok) {
      const codes = await providerErrorCodes(response);
      logger.error(
        `whatsapp otp delivery failed for ${masked}: HTTP ${response.status}${
          codes ? `, provider error ${codes}` : ''
        }`
      );
      throw deliveryFailed();
    }

    // Read and dropped so the connection is released; the message id is of no use to us yet.
    await response.arrayBuffer().catch(() => null);
  }
}

const otpDelivery = new OtpDeliveryService();

module.exports = otpDelivery;
module.exports.WHATSAPP_TIMEOUT_MS = WHATSAPP_TIMEOUT_MS;
module.exports.toIndianE164 = toIndianE164;
