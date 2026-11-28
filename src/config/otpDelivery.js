/**
 * How one-time codes leave the backend, read from the environment only (Phase 5 contract §2).
 *
 * Why it exists: the delivery service (services/otpdelivery.js) and the start-up check
 * (config/startupChecks.js) must read OTP_DELIVERY_CHANNEL and the WhatsApp settings one way. Kept
 * apart, the server could start happily on settings the sender then cannot use.
 *
 *   OTP_DELIVERY_CHANNEL            none (default: today's behaviour, nothing is sent) | whatsapp
 *   WHATSAPP_ACCESS_TOKEN           Meta system-user token (required for whatsapp)
 *   WHATSAPP_PHONE_NUMBER_ID        the sending number's id in WhatsApp Manager (required)
 *   WHATSAPP_OTP_TEMPLATE_NAME      an approved AUTHENTICATION template with a copy-code button
 *   WHATSAPP_OTP_TEMPLATE_LANGUAGE  the template's language code (default en)
 *   WHATSAPP_API_VERSION            Graph API version (default below)
 *
 * The environment is read on every call, never cached, so a test can switch the channel.
 *
 * ⚠️ Never log or return a setting's value — the access token is a credential, and even the
 * channel value is only ever named, not echoed. Report a missing setting by its name.
 */

const OTP_DELIVERY_CHANNELS = Object.freeze({
  NONE: 'NONE',
  WHATSAPP: 'WHATSAPP',
});

// The env value → the label every challenge response carries as `deliveryChannel`.
const CHANNEL_BY_SETTING = Object.freeze({
  none: OTP_DELIVERY_CHANNELS.NONE,
  whatsapp: OTP_DELIVERY_CHANNELS.WHATSAPP,
});

const WHATSAPP_REQUIRED_SETTINGS = Object.freeze([
  'WHATSAPP_ACCESS_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_OTP_TEMPLATE_NAME',
]);

// The version Meta's authentication-template documentation used in November 2026. Graph versions
// stay available for about two years; set WHATSAPP_API_VERSION to move on without a release.
const WHATSAPP_DEFAULT_API_VERSION = 'v27.0';
const WHATSAPP_DEFAULT_LANGUAGE = 'en';

const setting = (env, name) => String(env[name] || '').trim();

/** 'NONE' | 'WHATSAPP', or null when OTP_DELIVERY_CHANNEL holds anything else. */
const deliveryChannelFrom = (env = process.env) => {
  const value = setting(env, 'OTP_DELIVERY_CHANNEL').toLowerCase() || 'none';
  return CHANNEL_BY_SETTING[value] || null;
};

/** The names of the WhatsApp settings that are not set (names only, never values). */
const missingWhatsAppSettings = (env = process.env) =>
  WHATSAPP_REQUIRED_SETTINGS.filter((name) => !setting(env, name));

const whatsAppSettingsFrom = (env = process.env) => ({
  accessToken: setting(env, 'WHATSAPP_ACCESS_TOKEN'),
  phoneNumberId: setting(env, 'WHATSAPP_PHONE_NUMBER_ID'),
  templateName: setting(env, 'WHATSAPP_OTP_TEMPLATE_NAME'),
  language: setting(env, 'WHATSAPP_OTP_TEMPLATE_LANGUAGE') || WHATSAPP_DEFAULT_LANGUAGE,
  apiVersion: setting(env, 'WHATSAPP_API_VERSION') || WHATSAPP_DEFAULT_API_VERSION,
});

module.exports = {
  OTP_DELIVERY_CHANNELS,
  WHATSAPP_REQUIRED_SETTINGS,
  WHATSAPP_DEFAULT_API_VERSION,
  WHATSAPP_DEFAULT_LANGUAGE,
  deliveryChannelFrom,
  missingWhatsAppSettings,
  whatsAppSettingsFrom,
};
