// Push notifications (Phase 5 contract §6.2): off when FIREBASE_SERVICE_ACCOUNT_PATH is unset;
// when set, every stored notification is pushed to the recipient's tokens with the contract's exact
// message, after it is stored and without the action waiting for it; dead tokens are deleted; and
// the start-up check refuses an unusable key outside development/test.
//
// ⚠️ firebase-admin is replaced by jest.mock for this whole file — Firebase is never called, and a
// send a test did not plan for rejects loudly. The key files are throwaway ones written to the
// system temp folder (a freshly generated private key, never a real one) and removed afterwards.
jest.mock('firebase-admin/app', () => ({
  initializeApp: jest.fn((options, name) => ({ name })),
  cert: jest.fn((serviceAccount) => ({ projectId: serviceAccount.project_id })),
}));
const mockSend = jest.fn();
jest.mock('firebase-admin/messaging', () => ({
  getMessaging: jest.fn(() => ({ sendEachForMulticast: (...args) => mockSend(...args) })),
}));

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { initializeApp, cert } = require('firebase-admin/app');
const { getMessaging } = require('firebase-admin/messaging');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const clock = require('./helpers/clock');
const f = require('./helpers/fixtures');
const Notification = require('../src/models/notification');
const DeviceToken = require('../src/models/devicetoken');
const notificationService = require('../src/services/notification');
const push = require('../src/services/push');
const checkEnvironment = require('../src/config/startupChecks');
const { isInsideRepository } = require('../src/config/push');

const ROOT = path.join(__dirname, '..');
const THROWAWAY_DB = 'mongodb://127.0.0.1:27017/fixora_test_throwaway';
const KEY_DIR = path.join(os.tmpdir(), `fixora-test-push-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);

const { privateKey: PRIVATE_KEY } = crypto.generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
// A line from the middle of the key: what a leak of the key into a log would contain.
const KEY_FRAGMENT = PRIVATE_KEY.split('\n')[5];
const SERVICE_ACCOUNT = {
  type: 'service_account',
  project_id: 'fixora-test',
  private_key_id: 'abc123',
  private_key: PRIVATE_KEY,
  client_email: 'push@fixora-test.iam.gserviceaccount.com',
  client_id: '1234567890',
};

const keyFile = (name, contents) => {
  const file = path.join(KEY_DIR, name);
  fs.writeFileSync(file, typeof contents === 'string' ? contents : JSON.stringify(contents));
  return file;
};

let KEY_PATH;
const BROKEN_KEYS = {};

// Distinctive, so a search of the logs cannot match by accident. Not real FCM tokens.
const tokenNo = (n) => `fcm-push-test-${String(n).padStart(3, '0')}:APA91bH${'q'.repeat(40)}`;
const usedTokens = [];

const fcmError = (code, token) =>
  // Firebase's own error text quotes the token: none of it may reach a log.
  Object.assign(new Error(`The registration token ${token} is not valid (${code})`), { code });

// FCM's answer per token, in the order sent: 'ok' or an error code.
const answer = (outcomes) => async (message) => ({
  successCount: message.tokens.filter((t) => (outcomes[t] || 'ok') === 'ok').length,
  failureCount: message.tokens.filter((t) => (outcomes[t] || 'ok') !== 'ok').length,
  responses: message.tokens.map((t, i) =>
    (outcomes[t] || 'ok') === 'ok'
      ? { success: true, messageId: `projects/fixora-test/messages/${i}` }
      : { success: false, error: fcmError(outcomes[t], t) }
  ),
});
const delivered = () => answer({});

let category;
let customer;
let customerToken;
let vendor;
let vendorToken;

const registerDevice = async (token, accountToken = customerToken, platform = 'android') => {
  usedTokens.push(token);
  clock.advance(1000);
  const res = await api.post('/devices/register', { token, platform }, accountToken);
  expect(res.status).toBe(200);
};

const createRequest = (extra = {}) =>
  api.post(
    '/requests',
    { categoryId: String(category._id), serviceAddress: '22 Hill Road, Mumbai', ...extra },
    customerToken
  );

const usePush = (keyPath = KEY_PATH) => {
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH = keyPath;
};

beforeAll(async () => {
  fs.mkdirSync(KEY_DIR, { recursive: true });
  KEY_PATH = keyFile('fixora-test-key.json', SERVICE_ACCOUNT);
  BROKEN_KEYS.missingFile = path.join(KEY_DIR, 'no-such-key.json');
  BROKEN_KEYS.notJson = keyFile('not-json.json', 'this is not json');
  BROKEN_KEYS.wrongType = keyFile('wrong-type.json', { ...SERVICE_ACCOUNT, type: 'authorized_user' });
  BROKEN_KEYS.noPrivateKey = keyFile('no-private-key.json', { ...SERVICE_ACCOUNT, private_key: '' });
  BROKEN_KEYS.badPrivateKey = keyFile('bad-private-key.json', {
    ...SERVICE_ACCOUNT,
    private_key: '-----BEGIN PRIVATE KEY-----\nnot-a-key\n-----END PRIVATE KEY-----\n',
  });
  await db.connect();
});
afterAll(async () => {
  await db.disconnect();
  fs.rmSync(KEY_DIR, { recursive: true, force: true });
});
beforeEach(async () => {
  await db.clear();
  logs.reset();
  clock.install();
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '';
  mockSend.mockReset();
  mockSend.mockImplementation(async () => {
    throw new Error('unplanned FCM send');
  });
  category = await f.createCategory({ name: 'Electrical' });
  customer = await f.createCustomer();
  customerToken = f.tokenFor(customer, 'CUSTOMER');
  vendor = await f.createVendor([category], { businessName: 'Kumar Electricals' });
  vendorToken = f.tokenFor(vendor, 'VENDOR');
});
afterEach(async () => {
  await push.whenIdle();
  clock.restore();
  process.env.FIREBASE_SERVICE_ACCOUNT_PATH = '';
  const text = logs.all();
  for (const token of usedTokens) {
    expect(text).not.toContain(token);
  }
  expect(text).not.toContain(KEY_FRAGMENT);
  // The folder's own name: a logged Windows path would have its backslashes escaped.
  expect(text).not.toContain(path.basename(KEY_DIR));
});

describe('push off (FIREBASE_SERVICE_ACCOUNT_PATH not set)', () => {
  test('a notification is stored as before; nothing is read, sent or logged about push', async () => {
    // Tokens are stored all the same (contract §6.1), ready for the day push is configured.
    await registerDevice(tokenNo(1));
    const find = jest.spyOn(DeviceToken, 'find');
    const initCalls = initializeApp.mock.calls.length;

    const res = await createRequest();
    expect(res.status).toBe(201);
    await push.whenIdle();

    expect(await Notification.countDocuments({ userId: customer._id })).toBe(1);
    expect(find).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
    expect(initializeApp.mock.calls.length).toBe(initCalls);
    expect(logs.all()).not.toMatch(/push/i);
    find.mockRestore();
  });
});

describe('push on', () => {
  test('a stored notification is pushed to the recipient’s tokens, newest first, in the contract’s shape', async () => {
    usePush();
    await registerDevice(tokenNo(1), customerToken, 'android');
    await registerDevice(tokenNo(2), customerToken, 'ios');
    // Someone else's phone gets nothing.
    await registerDevice(tokenNo(3), f.tokenFor(await f.createCustomer(), 'CUSTOMER'));
    mockSend.mockImplementation(delivered());

    const res = await createRequest({ vendorId: String(vendor._id) });
    expect(res.status).toBe(201);
    await push.whenIdle();

    const stored = await Notification.findOne({ userId: customer._id }).lean();
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [message] = mockSend.mock.calls[0];
    expect(message).toEqual({
      tokens: [tokenNo(2), tokenNo(1)],
      notification: { title: 'Request received', body: stored.message },
      data: {
        notificationId: String(stored._id),
        type: 'SERVICE_REQUEST',
        requestId: res.body.data.id,
      },
      android: { priority: 'high', notification: { channelId: 'fixora-default' } },
    });
    expect(stored.title).toBe('Request received');
    for (const value of Object.values(message.data)) {
      expect(typeof value).toBe('string');
    }
    expect(logs.all()).toContain('push sent: 2 delivered, 0 failed');
  });

  test('Firebase starts lazily from the key file, once, and is reused', async () => {
    const lazyKey = keyFile('fixora-test-key-lazy.json', SERVICE_ACCOUNT);
    usePush(lazyKey);
    const before = initializeApp.mock.calls.length;
    mockSend.mockImplementation(delivered());

    // Nothing to push to yet: no tokens, so not even started.
    expect((await createRequest()).status).toBe(201);
    await push.whenIdle();
    expect(initializeApp.mock.calls.length).toBe(before);

    await registerDevice(tokenNo(1));
    expect((await createRequest()).status).toBe(201);
    expect((await createRequest()).status).toBe(201);
    await push.whenIdle();

    expect(initializeApp.mock.calls.length - before).toBe(1);
    const [options, name] = initializeApp.mock.calls[initializeApp.mock.calls.length - 1];
    expect(options).toEqual({ credential: { projectId: 'fixora-test' }, projectId: 'fixora-test' });
    expect(name).toMatch(/^fixora-push-\d+$/);
    expect(cert).toHaveBeenLastCalledWith(SERVICE_ACCOUNT);
    expect(getMessaging).toHaveBeenLastCalledWith({ name });
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  test('a vendor’s notification goes to that vendor’s tokens only — not the customer with the same id', async () => {
    usePush();
    const twin = await f.createCustomer({ _id: vendor._id });
    await registerDevice(tokenNo(1), vendorToken);
    await registerDevice(tokenNo(2), f.tokenFor(twin, 'CUSTOMER'));
    mockSend.mockImplementation(delivered());

    const created = await createRequest({ vendorId: String(vendor._id) });
    const cancelled = await api.post('/requests/cancel', { id: created.body.data.id }, customerToken);
    expect(cancelled.status).toBe(200);
    await push.whenIdle();

    // The customer (who has no tokens) was notified of the create; the vendor of the cancel.
    expect(mockSend).toHaveBeenCalledTimes(1);
    const [message] = mockSend.mock.calls[0];
    expect(message.tokens).toEqual([tokenNo(1)]);
    expect(message.notification.title).toBe('Request cancelled');
    expect(message.data.requestId).toBe(created.body.data.id);
  });

  test('the action does not wait for the push, and a failed push does not fail it', async () => {
    usePush();
    await registerDevice(tokenNo(1));
    let refuse;
    let settled = false;
    mockSend.mockImplementation(
      () =>
        new Promise((resolve, reject) => {
          refuse = (error) => {
            settled = true;
            reject(error);
          };
        })
    );

    const res = await createRequest();
    // Answered while the push is still unanswered by FCM.
    expect(res.status).toBe(201);
    expect(settled).toBe(false);
    expect(await Notification.countDocuments({ userId: customer._id })).toBe(1);

    // The push may still be reading the tokens; give it up to 5 s to reach FCM.
    for (let i = 0; i < 500 && !refuse; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(mockSend).toHaveBeenCalledTimes(1);
    refuse(fcmError('messaging/internal-error', tokenNo(1)));
    await push.whenIdle();

    expect(logs.all()).toContain('push not sent: messaging/internal-error');
    // A failure of the whole call is not a verdict on any token.
    expect(await DeviceToken.countDocuments({ token: tokenNo(1) })).toBe(1);
  });

  test('a send that throws at once is caught too; the error’s text never reaches the log', async () => {
    usePush();
    await registerDevice(tokenNo(1));
    mockSend.mockImplementation(() => {
      throw Object.assign(new Error(`credential ${KEY_FRAGMENT} refused for ${tokenNo(1)}`), {
        code: 'app/invalid-credential',
      });
    });

    expect((await createRequest()).status).toBe(201);
    await push.whenIdle();

    expect(logs.all()).toContain('push not sent: app/invalid-credential');
    expect(logs.all()).not.toContain('refused for');
  });

  test('tokens FCM calls dead are deleted; the others are kept', async () => {
    usePush();
    const outcomes = {
      [tokenNo(1)]: 'messaging/registration-token-not-registered',
      [tokenNo(2)]: 'messaging/invalid-registration-token',
      [tokenNo(3)]: 'messaging/invalid-argument',
      [tokenNo(4)]: 'ok',
      [tokenNo(5)]: 'messaging/internal-error',
      [tokenNo(6)]: 'messaging/mismatched-credential',
    };
    for (const token of Object.keys(outcomes)) {
      await registerDevice(token);
    }
    // Another account's token is never touched: deletion is limited to the recipient's own.
    const other = await f.createCustomer();
    await registerDevice(tokenNo(7), f.tokenFor(other, 'CUSTOMER'));
    mockSend.mockImplementation(answer(outcomes));

    expect((await createRequest()).status).toBe(201);
    await push.whenIdle();

    const left = (await DeviceToken.find({ accountId: customer._id }).lean()).map((d) => d.token).sort();
    expect(left).toEqual([tokenNo(4), tokenNo(5), tokenNo(6)]);
    expect(await DeviceToken.countDocuments({ token: tokenNo(7) })).toBe(1);

    const text = logs.all();
    expect(text).toContain('push sent: 1 delivered, 5 failed');
    expect(text).toContain('messaging/registration-token-not-registered ×1');
    expect(text).toContain('messaging/internal-error ×1');
    expect(text).toContain('3 dead tokens removed');
    expect(text).not.toContain('is not valid');
  });

  test('a single token refused with invalid-argument is deleted', async () => {
    usePush();
    await registerDevice(tokenNo(1));
    mockSend.mockImplementation(answer({ [tokenNo(1)]: 'messaging/invalid-argument' }));

    expect((await createRequest()).status).toBe(201);
    await push.whenIdle();

    expect(await DeviceToken.countDocuments()).toBe(0);
    expect(logs.all()).toContain('1 dead token removed');
  });

  test('every token of a multi-token send refused with invalid-argument: the message is suspect, none deleted', async () => {
    usePush();
    await registerDevice(tokenNo(1));
    await registerDevice(tokenNo(2));
    mockSend.mockImplementation(
      answer({ [tokenNo(1)]: 'messaging/invalid-argument', [tokenNo(2)]: 'messaging/invalid-argument' })
    );

    expect((await createRequest()).status).toBe(201);
    await push.whenIdle();

    expect(await DeviceToken.countDocuments()).toBe(2);
    expect(logs.all()).toContain('every token refused the message, none removed');
  });

  test('a notification that is not about a request carries no requestId', async () => {
    usePush();
    await registerDevice(tokenNo(1));
    mockSend.mockImplementation(delivered());

    const created = await notificationService.createNotification({
      userId: customer._id,
      userRole: 'CUSTOMER',
      title: 'Welcome',
      message: 'Thanks for joining Fixora.',
      type: 'GENERAL',
      referenceId: vendor._id,
    });
    await push.whenIdle();

    expect(mockSend.mock.calls[0][0].data).toEqual({ notificationId: String(created.id), type: 'GENERAL' });
  });

  test('a recipient with no tokens: nothing is sent and nothing logged about push', async () => {
    usePush();
    expect((await createRequest()).status).toBe(201);
    await push.whenIdle();
    expect(mockSend).not.toHaveBeenCalled();
    expect(logs.all()).not.toMatch(/push/i);
  });

  test('Firebase that cannot start is logged once (code only); the actions carry on', async () => {
    usePush(keyFile('fixora-test-key-no-start.json', SERVICE_ACCOUNT));
    initializeApp.mockImplementationOnce(() => {
      throw Object.assign(new Error(`bad credential ${KEY_FRAGMENT}`), { code: 'app/invalid-credential' });
    });
    await registerDevice(tokenNo(1));

    expect((await createRequest()).status).toBe(201);
    expect((await createRequest()).status).toBe(201);
    await push.whenIdle();

    expect(mockSend).not.toHaveBeenCalled();
    const lines = logs.all().split('\n').filter((line) => line.includes('Firebase could not start'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('Push notifications are off: Firebase could not start (app/invalid-credential).');
  });

  test('an unusable key file (test/development): push stays off with one error; the actions carry on', async () => {
    usePush(BROKEN_KEYS.notJson);
    await registerDevice(tokenNo(1));

    expect((await createRequest()).status).toBe(201);
    expect((await createRequest()).status).toBe(201);
    await push.whenIdle();

    expect(mockSend).not.toHaveBeenCalled();
    const lines = logs.all().split('\n').filter((line) => line.includes('Push notifications are off'));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('FIREBASE_SERVICE_ACCOUNT_PATH is set but the key file is not JSON.');
  });
});

describe('start-up check', () => {
  const quietLogger = () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() });
  // A delivery channel that could deliver: outside development/test, none logs an error of its own
  // (tests/otpDelivery.test.js), and here only push may speak. Not a real token.
  const base = {
    JWT_SECRET: 's',
    OTP_DELIVERY_CHANNEL: 'whatsapp',
    WHATSAPP_ACCESS_TOKEN: 'EAAG-fixora-test-token-push',
    WHATSAPP_PHONE_NUMBER_ID: '109876543210987',
    WHATSAPP_OTP_TEMPLATE_NAME: 'fixora_otp',
  };

  test('unset: one info line, push off; no warning or error', () => {
    for (const NODE_ENV of ['production', 'development']) {
      const logger = quietLogger();
      expect(() => checkEnvironment({ ...base, NODE_ENV }, logger)).not.toThrow();
      expect(logger.info).toHaveBeenCalledTimes(1);
      expect(logger.info).toHaveBeenCalledWith(
        'Push notifications are off: FIREBASE_SERVICE_ACCOUNT_PATH is not set.'
      );
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.warn).not.toHaveBeenCalled();
    }
  });

  test('production with a usable key outside the repository starts, push on', () => {
    const logger = quietLogger();
    expect(() =>
      checkEnvironment({ ...base, NODE_ENV: 'production', FIREBASE_SERVICE_ACCOUNT_PATH: KEY_PATH }, logger)
    ).not.toThrow();
    expect(logger.info).toHaveBeenCalledWith('Push notifications are on (Firebase Cloud Messaging).');
    expect(logger.error).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test.each([
    ['missingFile', 'the key file cannot be read (ENOENT)'],
    ['notJson', 'the key file is not JSON'],
    ['wrongType', 'the key file is not a service-account key'],
    ['noPrivateKey', 'the key file has no private_key'],
    ['badPrivateKey', 'the key file’s private_key is not a readable private key'],
  ])('%s: outside development/test the server refuses to start, naming no path or key', (which, phrase) => {
    for (const NODE_ENV of ['production', 'staging', undefined]) {
      let thrown;
      try {
        checkEnvironment(
          { ...base, NODE_ENV, FIREBASE_SERVICE_ACCOUNT_PATH: BROKEN_KEYS[which] },
          quietLogger()
        );
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeDefined();
      expect(thrown.message).toBe(
        `FIREBASE_SERVICE_ACCOUNT_PATH is set but ${phrase}. Refusing to start: no push notification could be sent.`
      );
      expect(thrown.message).not.toContain(KEY_DIR);
    }
  });

  test('development with an unusable key: an error line, push off, and it starts', () => {
    const logger = quietLogger();
    expect(() =>
      checkEnvironment(
        { ...base, NODE_ENV: 'development', FIREBASE_SERVICE_ACCOUNT_PATH: BROKEN_KEYS.wrongType },
        logger
      )
    ).not.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toBe(
      'FIREBASE_SERVICE_ACCOUNT_PATH is set but the key file is not a service-account key. Push notifications are off.'
    );
  });

  test('a key path inside the repository is recognised (the start-up check warns about it)', () => {
    expect(isInsideRepository(path.join(ROOT, 'keys', 'fixora-firebase-adminsdk.json'))).toBe(true);
    expect(isInsideRepository(path.join(ROOT, 'fixora-key.json'))).toBe(true);
    expect(isInsideRepository(KEY_PATH)).toBe(false);
    expect(isInsideRepository(path.join(ROOT, '..', 'Fixora-secrets', 'key.json'))).toBe(false);
  });

  test('the server itself refuses to start in production with an unreadable key', () => {
    const result = spawnSync(process.execPath, ['index.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: '5059',
        MONGO_URI: THROWAWAY_DB,
        OTP_STATIC_CODE: '',
        OTP_DELIVERY_CHANNEL: 'none',
        FIREBASE_SERVICE_ACCOUNT_PATH: BROKEN_KEYS.missingFile,
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(1);
    expect(output).toContain('FIREBASE_SERVICE_ACCOUNT_PATH is set but the key file cannot be read (ENOENT).');
    expect(output).toContain('Refusing to start');
    expect(output).not.toContain(KEY_DIR);
  });
});
