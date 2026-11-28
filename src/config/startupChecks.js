// Checks the environment before the server starts (requests contract §8, review fixes 17/11/2026;
// Phase 5 contract §2 and §6.2, 28/11/2026).
//
//   JWT_SECRET missing              → refuse to start: there is no built-in fallback secret.
//   OTP_STATIC_CODE outside dev/test → ignored by services/otp.js; logged here as an error.
//                                     "Outside" includes NODE_ENV unset, staging and production.
//   OTP_STATIC_CODE in dev/test      → a warning, so nobody forgets it is on.
//   OTP_DELIVERY_CHANNEL not none/whatsapp, or whatsapp with a WhatsApp setting missing
//                                   → outside dev/test: refuse to start, since no code could ever
//                                     be delivered. In dev/test: an error log; every code request
//                                     then answers 503 OTP_DELIVERY_FAILED.
//   OTP_DELIVERY_CHANNEL none or unset (review fix 28/11/2026)
//                                   → outside dev/test: one error line, and it starts. Codes are
//                                     random there and sent to nobody, so nobody can sign in by
//                                     phone — but a staging server may rightly come up before its
//                                     provider is set up, so this is not a refusal. In dev/test:
//                                     nothing (the static code is how testers sign in).
//   FIREBASE_SERVICE_ACCOUNT_PATH unset (Phase 5 contract §6.2)
//                                   → one info line: push notifications are off.
//   FIREBASE_SERVICE_ACCOUNT_PATH set but the key file unreadable or not a service-account key
//                                   → outside dev/test: refuse to start. In dev/test: an error
//                                     log; push stays off. A usable key inside the repository
//                                     → a warning (it belongs outside, where it cannot be committed).
//
// ⚠️ Never log the values themselves — only the names of the settings that are wrong. For the
// push key, not even the path: the problem is a fixed phrase from config/push.js.
const {
  OTP_DELIVERY_CHANNELS,
  deliveryChannelFrom,
  missingWhatsAppSettings,
} = require('./otpDelivery');
const { isInsideRepository, pushKeyPathFrom, readServiceAccount } = require('./push');

const STATIC_CODE_ENVIRONMENTS = ['development', 'test'];

// Fixed wording (no value, no path), so an operator can search the logs for it.
const NO_DELIVERY_CHANNEL =
  'OTP_DELIVERY_CHANNEL is none or not set: sign-in codes cannot be delivered until a delivery channel is configured, so customers and vendors cannot sign in by phone.';

// Whether the codes could be delivered at all; a reason when they could not.
const deliveryProblem = (env) => {
  const channel = deliveryChannelFrom(env);
  if (!channel) {
    return 'OTP_DELIVERY_CHANNEL must be "none" or "whatsapp".';
  }
  if (channel === OTP_DELIVERY_CHANNELS.WHATSAPP) {
    const missing = missingWhatsAppSettings(env);
    if (missing.length) {
      return `OTP_DELIVERY_CHANNEL is whatsapp but ${missing.join(', ')} ${
        missing.length === 1 ? 'is' : 'are'
      } not set.`;
    }
  }
  return null;
};

// Push is optional: unset is today's behaviour. Set, it must work — the owner turned it on on
// purpose, and a server that silently sends nothing would look like a working one.
const checkPush = (env, logger, isDevelopmentOrTest) => {
  const keyPath = pushKeyPathFrom(env);
  if (!keyPath) {
    logger.info('Push notifications are off: FIREBASE_SERVICE_ACCOUNT_PATH is not set.');
    return;
  }

  const { problem } = readServiceAccount(keyPath);
  if (problem) {
    const reason = `FIREBASE_SERVICE_ACCOUNT_PATH is set but ${problem}.`;
    if (!isDevelopmentOrTest) {
      throw new Error(`${reason} Refusing to start: no push notification could be sent.`);
    }
    logger.error(`${reason} Push notifications are off.`);
    return;
  }

  if (isInsideRepository(keyPath)) {
    logger.warn(
      'FIREBASE_SERVICE_ACCOUNT_PATH points inside the repository. Move the key file outside it so it can never be committed.'
    );
  }
  logger.info('Push notifications are on (Firebase Cloud Messaging).');
};

const checkEnvironment = (env, logger) => {
  if (!env.JWT_SECRET) {
    throw new Error('JWT_SECRET is not set. Refusing to start without it.');
  }

  const isDevelopmentOrTest = STATIC_CODE_ENVIRONMENTS.includes(env.NODE_ENV);

  if (env.OTP_STATIC_CODE) {
    if (!isDevelopmentOrTest) {
      logger.error(
        `OTP_STATIC_CODE is set but ignored: NODE_ENV is "${env.NODE_ENV || 'unset'}", and it only applies in development or test. One-time codes are random. Remove it.`
      );
    } else {
      logger.warn(
        'OTP_STATIC_CODE is set: every one-time code is the static development code. Never set it in production.'
      );
    }
  }

  const problem = deliveryProblem(env);
  if (problem) {
    if (!isDevelopmentOrTest) {
      throw new Error(`${problem} Refusing to start: no one-time code could be delivered.`);
    }
    logger.error(`${problem} One-time code requests will answer OTP_DELIVERY_FAILED.`);
  } else if (!isDevelopmentOrTest && deliveryChannelFrom(env) === OTP_DELIVERY_CHANNELS.NONE) {
    // Every request would answer 200 with a code nobody receives: a server that looks healthy
    // while no one can sign in. This line is the only sign of it.
    logger.error(NO_DELIVERY_CHANNEL);
  }

  checkPush(env, logger, isDevelopmentOrTest);
};

module.exports = checkEnvironment;
