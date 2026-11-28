// Push notifications by Firebase Cloud Messaging, HTTP v1 through `firebase-admin` (Phase 5 contract
// §6.2; a Phase 2 item the owner approved on 28/11/2026). Every in-app notification the backend
// stores (services/notification.js createNotification, the one place) is also pushed to the
// recipient account's device tokens.
//
// Off unless FIREBASE_SERVICE_ACCOUNT_PATH is set (config/push.js): then nothing is read, nothing
// is logged and firebase-admin is never even loaded. On, Firebase is started lazily on the first
// push, from that key file only.
//
// It refuses to retry, queue or delay anything: `sendForNotification` is started after the
// notification is stored and never awaited by the action that created it, and it never rejects —
// every failure is caught and logged as a count and an FCM error code.
//
// Tokens FCM answers as dead (not registered, invalid) are deleted. ⚠️ `messaging/invalid-argument`
// is also FCM's answer to a malformed message, so the message is built only here, from the stored
// notification's strings; when every token of a multi-token send is refused with it, the message is
// the likelier fault and nothing is deleted. Never log a token, the key or a Firebase error message
// (it can quote the token): counts and error codes only.
const DeviceToken = require('../models/devicetoken');
const logger = require('../utils/logger');
const { pushKeyPathFrom, readServiceAccount } = require('../config/push');

const ANDROID_CHANNEL_ID = 'fixora-default';
const INVALID_ARGUMENT = 'messaging/invalid-argument';
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
  INVALID_ARGUMENT,
]);

// The Firebase app for the key file in use. `messaging` stays null when that key could not start
// Firebase, so the failure is logged once per key path, not once per notification.
let firebase = null;
let appSequence = 0;

// Firebase error codes look like "messaging/registration-token-not-registered"; anything else is
// reduced to the error's class name, so no free text reaches a log.
const codeOf = (error) => {
  if (error && typeof error.code === 'string' && /^[a-z-]+\/[a-z-]+$/.test(error.code)) {
    return error.code;
  }
  return (error && error.name) || 'Error';
};

const messagingFor = (keyPath) => {
  if (firebase && firebase.keyPath === keyPath) return firebase.messaging;

  firebase = { keyPath, messaging: null };
  const { serviceAccount, problem } = readServiceAccount(keyPath);
  if (problem) {
    logger.error(`Push notifications are off: FIREBASE_SERVICE_ACCOUNT_PATH is set but ${problem}.`);
    return null;
  }
  try {
    // Loaded here, not at the top: with push off the dependency is never loaded at all.
    const { initializeApp, cert } = require('firebase-admin/app');
    const { getMessaging } = require('firebase-admin/messaging');
    appSequence += 1;
    const app = initializeApp(
      { credential: cert(serviceAccount), projectId: serviceAccount.project_id },
      `fixora-push-${appSequence}`
    );
    firebase.messaging = getMessaging(app);
  } catch (error) {
    logger.error(`Push notifications are off: Firebase could not start (${codeOf(error)}).`);
  }
  return firebase.messaging;
};

/**
 * The FCM message for a stored notification (contract §6.2). `data` holds strings and ids only;
 * `requestId` only for a notification about a service request, the one kind that refers to one.
 */
const pushMessageFor = (notification, tokens) => {
  const data = {
    notificationId: String(notification._id),
    type: String(notification.type),
  };
  if (notification.type === 'SERVICE_REQUEST' && notification.referenceId) {
    data.requestId = String(notification.referenceId);
  }
  return {
    tokens,
    notification: { title: notification.title, body: notification.message },
    data,
    android: { priority: 'high', notification: { channelId: ANDROID_CHANNEL_ID } },
  };
};

// "messaging/x ×2, messaging/y ×1": how many tokens failed with each code.
const summariseCodes = (codes) =>
  Object.entries(
    codes.reduce((counts, code) => ({ ...counts, [code]: (counts[code] || 0) + 1 }), {})
  )
    .map(([code, count]) => `${code} ×${count}`)
    .join(', ');

const deliver = async (notification, keyPath) => {
  // The recipient's tokens first: Firebase is started only once there is a phone to push to.
  const recipient = { accountId: notification.userId, role: notification.userRole };
  const devices = await DeviceToken.find(recipient)
    .sort({ lastSeenAt: -1, _id: -1 })
    .select('token')
    .lean();
  if (!devices.length) return;

  const messaging = messagingFor(keyPath);
  if (!messaging) return;

  const tokens = devices.map((device) => device.token);
  const result = await messaging.sendEachForMulticast(pushMessageFor(notification, tokens));

  const failedCodes = [];
  const dead = [];
  result.responses.forEach((response, index) => {
    if (response.success) return;
    const code = codeOf(response.error);
    failedCodes.push(code);
    if (DEAD_TOKEN_CODES.has(code)) dead.push(tokens[index]);
  });

  const messageRefused =
    tokens.length > 1 &&
    failedCodes.length === tokens.length &&
    failedCodes.every((code) => code === INVALID_ARGUMENT);

  let removed = 0;
  if (dead.length && !messageRefused) {
    removed = (await DeviceToken.deleteMany({ ...recipient, token: { $in: dead } })).deletedCount;
  }

  const delivered = result.responses.length - failedCodes.length;
  const failures = failedCodes.length ? ` (${summariseCodes(failedCodes)})` : '';
  let cleanup = '';
  if (messageRefused) cleanup = '; every token refused the message, none removed';
  else if (removed) cleanup = `; ${removed} dead token${removed === 1 ? '' : 's'} removed`;
  const line = `push sent: ${delivered} delivered, ${failedCodes.length} failed${failures}${cleanup}`;
  if (failedCodes.length) logger.warn(line);
  else logger.info(line);
};

// Pushes in flight, so a test (or a shutdown) can wait for them; nothing else reads it.
const inFlight = new Set();

/**
 * Pushes a stored notification to its recipient's devices. Call it after the notification is
 * stored and do not await it. It never rejects; with push off it does nothing at all.
 */
const sendForNotification = (notification) => {
  const keyPath = pushKeyPathFrom();
  if (!keyPath || !notification) return Promise.resolve();

  // Started on the next turn of the event loop, so even the first push's key read and Firebase
  // start-up happen after the action that stored the notification has moved on.
  const sending = new Promise((resolve) => setImmediate(resolve))
    .then(() => deliver(notification, keyPath))
    .catch((error) => {
      logger.warn(`push not sent: ${codeOf(error)}`);
    })
    .finally(() => {
      inFlight.delete(sending);
    });
  inFlight.add(sending);
  return sending;
};

/** Resolves once every push started so far has finished. */
const whenIdle = () => Promise.all([...inFlight]).then(() => undefined);

module.exports = {
  ANDROID_CHANNEL_ID,
  pushMessageFor,
  sendForNotification,
  whenIdle,
};
