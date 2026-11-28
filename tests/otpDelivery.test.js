// One-time codes by WhatsApp (Phase 5 contract §2): the Cloud API adapter, `deliveryChannel` on
// every challenge, 503 OTP_DELIVERY_FAILED, the refused-send budget, and the start-up check.
//
// ⚠️ `fetch` is replaced in every test — the real Graph API is never called. A call a test did not
// plan for rejects loudly instead of reaching Meta.
const path = require('path');
const { spawnSync } = require('child_process');
const logs = require('./helpers/logs');
const api = require('./helpers/api');
const db = require('./helpers/db');
const clock = require('./helpers/clock');
const f = require('./helpers/fixtures');
const OtpChallenge = require('../src/models/otpchallenge');
const RateBudget = require('../src/models/ratebudget');
const VendorRegistration = require('../src/models/vendorregistration');
const checkEnvironment = require('../src/config/startupChecks');
const { WHATSAPP_TIMEOUT_MS } = require('../src/services/otpdelivery');
const { OTP_FAILED_SENDS_PER_DAY } = require('../src/services/otp');

const OTP = '123456';
const PHONE = '9876543210';
const VENDOR_PHONE = '9000000001';
const UNKNOWN_PHONE = '9111111111';
// Distinctive, so a search of the logs and responses cannot match by accident. Not a real token.
const TOKEN = 'EAAG-fixora-test-token-0f3c9a';
const PHONE_NUMBER_ID = '109876543210987';
const ROOT = path.join(__dirname, '..');
const THROWAWAY_DB = 'mongodb://127.0.0.1:27017/fixora_test_throwaway';

const WHATSAPP_ENV = {
  OTP_DELIVERY_CHANNEL: 'whatsapp',
  WHATSAPP_ACCESS_TOKEN: TOKEN,
  WHATSAPP_PHONE_NUMBER_ID: PHONE_NUMBER_ID,
  WHATSAPP_OTP_TEMPLATE_NAME: 'fixora_otp',
};
const DELIVERY_SETTINGS = {
  OTP_DELIVERY_CHANNEL: 'none',
  WHATSAPP_ACCESS_TOKEN: '',
  WHATSAPP_PHONE_NUMBER_ID: '',
  WHATSAPP_OTP_TEMPLATE_NAME: '',
  WHATSAPP_OTP_TEMPLATE_LANGUAGE: '',
  WHATSAPP_API_VERSION: '',
};

const useWhatsApp = (overrides = {}) => Object.assign(process.env, WHATSAPP_ENV, overrides);

const json = (status, body) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const accepted = () =>
  json(200, {
    messaging_product: 'whatsapp',
    contacts: [{ input: '919876543210', wa_id: '919876543210' }],
    messages: [{ id: 'wamid.HBgMOTE5ODc2NTQzMjEwFQIAERgS' }],
  });
// Meta's error text quotes the number (and here, a code): none of it may reach a log or response.
const refused = () =>
  json(400, {
    error: {
      message: '(#131030) Recipient phone number 919876543210 not in allowed list (code 123456)',
      type: 'OAuthException',
      code: 131030,
      error_subcode: 2494010,
      fbtrace_id: 'AbCdEfGhIjK',
    },
  });

const requestCustomer = (phone = PHONE) => api.post('/auth/customer/otp/request', { phone });
const verifyCustomer = (code = OTP, phone = PHONE) =>
  api.post('/auth/customer/otp/verify', { phone, code });
const requestVendorSignIn = (phone = VENDOR_PHONE) =>
  api.post('/auth/vendor/signin/otp/request', { phone });

const sentBodies = (fetchMock) => fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));

const DELIVERY_FAILED = {
  success: false,
  message: 'We could not send the verification code. Please try again.',
  code: 'OTP_DELIVERY_FAILED',
  errors: null,
  data: null,
};
const RATE_LIMITED = {
  success: false,
  message: 'Too many codes requested for this number. Please try again later.',
  code: 'RATE_LIMITED',
  errors: null,
  data: null,
};
const DAY_SECONDS = 24 * 60 * 60;

const budgetCount = async (key) => {
  const budget = await RateBudget.findOne({ key });
  return budget ? budget.count : 0;
};

// Ten refused sends through `request`, each a 503 that reached the provider.
const spendRefusedSends = async (request) => {
  fetchMock.mockImplementation(async () => refused());
  for (let attempt = 1; attempt <= OTP_FAILED_SENDS_PER_DAY; attempt += 1) {
    expect((await request()).status).toBe(503);
  }
};

let fetchMock;

beforeAll(db.connect);
afterAll(db.disconnect);
beforeEach(async () => {
  await db.clear();
  logs.reset();
  clock.install();
  process.env.OTP_STATIC_CODE = OTP;
  Object.assign(process.env, DELIVERY_SETTINGS);
  fetchMock = jest.spyOn(global, 'fetch').mockRejectedValue(new Error('unexpected network call'));
});
afterEach(() => {
  clock.restore();
  jest.restoreAllMocks();
  process.env.OTP_STATIC_CODE = '';
  Object.assign(process.env, DELIVERY_SETTINGS);
});

describe('OTP_DELIVERY_CHANNEL=none (the default)', () => {
  test('nothing is sent, and the challenge says NONE', async () => {
    const res = await requestCustomer();
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryChannel).toBe('NONE');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(logs.all()).toContain('otp issued for ••••3210');
  });
});

describe('OTP_DELIVERY_CHANNEL=whatsapp', () => {
  test('sends an authentication template with the code as the body and copy-code button parameter', async () => {
    useWhatsApp();
    fetchMock.mockImplementation(async () => accepted());

    const res = await requestCustomer();
    expect(res.status).toBe(200);
    expect(res.body.data.deliveryChannel).toBe('WHATSAPP');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://graph.facebook.com/v27.0/${PHONE_NUMBER_ID}/messages`);
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(init.body)).toEqual({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: '919876543210',
      type: 'template',
      template: {
        name: 'fixora_otp',
        language: { code: 'en' },
        components: [
          { type: 'body', parameters: [{ type: 'text', text: OTP }] },
          { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: OTP }] },
        ],
      },
    });

    // The code that went out signs in.
    expect((await verifyCustomer()).status).toBe(200);

    const text = logs.all();
    expect(text).toContain('otp issued for ••••3210 by WhatsApp');
    expect(text).not.toContain(OTP);
    expect(text).not.toContain(TOKEN);
  });

  test('every challenge response says WHATSAPP: customer, vendor sign in, vendor register and resend', async () => {
    useWhatsApp();
    fetchMock.mockImplementation(async () => accepted());
    await f.createPhoneVendor({ phone: VENDOR_PHONE });
    const category = await f.createCategory();

    const customer = await requestCustomer();
    const signIn = await requestVendorSignIn();
    const registered = await api.post('/auth/vendor/register', {
      businessName: 'Sharma Plumbing',
      ownerFirstName: 'Anil',
      ownerLastName: 'Sharma',
      phone: '9000000003',
      serviceCategoryIds: [String(category._id)],
    });
    clock.advance(31000);
    const resent = await api.post('/auth/vendor/otp/request', {
      registrationId: registered.body.data.registrationId,
    });

    expect(customer.body.data.deliveryChannel).toBe('WHATSAPP');
    expect(signIn.body.data.deliveryChannel).toBe('WHATSAPP');
    expect(registered.status).toBe(201);
    expect(registered.body.data.challenge.deliveryChannel).toBe('WHATSAPP');
    expect(resent.body.data.deliveryChannel).toBe('WHATSAPP');
    expect(sentBodies(fetchMock).map((body) => body.to)).toEqual([
      '919876543210',
      '919000000001',
      '919000000003',
      '919000000003',
    ]);
  });

  test('a number with no vendor account gets the same answer, and nothing is sent to it', async () => {
    useWhatsApp();
    fetchMock.mockImplementation(async () => accepted());
    await f.createPhoneVendor({ phone: VENDOR_PHONE });

    const known = await requestVendorSignIn(VENDOR_PHONE);
    const unknown = await requestVendorSignIn(UNKNOWN_PHONE);

    expect(unknown.status).toBe(known.status);
    expect(unknown.body.message).toBe(known.body.message);
    expect(Object.keys(unknown.body.data).sort()).toEqual(Object.keys(known.body.data).sort());
    expect(unknown.body.data.deliveryChannel).toBe('WHATSAPP');
    expect(sentBodies(fetchMock).map((body) => body.to)).toEqual(['919000000001']);
  });

  test('the template language and API version come from the environment; a 91-prefixed number is kept', async () => {
    useWhatsApp({ WHATSAPP_OTP_TEMPLATE_LANGUAGE: 'en_US', WHATSAPP_API_VERSION: 'v28.0' });
    fetchMock.mockImplementation(async () => accepted());

    await requestCustomer('919876543210');
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe(`https://graph.facebook.com/v28.0/${PHONE_NUMBER_ID}/messages`);
    const [body] = sentBodies(fetchMock);
    expect(body.to).toBe('919876543210');
    expect(body.template.language).toEqual({ code: 'en_US' });
  });
});

describe('503 OTP_DELIVERY_FAILED', () => {
  test('the provider refusing: 503, the code is not counted, the user can ask again at once', async () => {
    useWhatsApp();
    fetchMock.mockImplementation(async () => refused());

    const res = await requestCustomer();
    expect(res.status).toBe(503);
    expect(res.body).toEqual(DELIVERY_FAILED);
    expect(res.headers['retry-after']).toBeUndefined();

    // Not counted as sent: no challenge left, the day's send handed back.
    expect(await OtpChallenge.countDocuments()).toBe(0);
    expect((await RateBudget.findOne({ key: `otp-send:${PHONE}` })).count).toBe(0);
    expect((await verifyCustomer()).body.code).toBe('OTP_EXPIRED');

    // At once — no resend wait — and this time it goes.
    fetchMock.mockImplementation(async () => accepted());
    const again = await requestCustomer();
    expect(again.status).toBe(200);
    expect((await verifyCustomer()).status).toBe(200);
  });

  test('the provider’s error text, the code, the number and the token never reach a log or response', async () => {
    useWhatsApp();
    fetchMock.mockImplementation(async () => refused());

    const res = await requestCustomer();
    const text = logs.all();
    expect(text).toContain('whatsapp otp delivery failed for ••••3210: HTTP 400, provider error 131030/2494010');
    expect(text).toContain('[Operational Error]');
    expect(text).not.toContain('[Unhandled Error]');
    for (const value of ['not in allowed list', 'OAuthException', 'AbCdEfGhIjK', OTP, TOKEN, PHONE]) {
      expect({ value, inLog: text.includes(value), inResponse: res.text.includes(value) }).toEqual({
        value,
        inLog: false,
        inResponse: false,
      });
    }
  });

  test('a provider fault with a body that is not JSON is a 503 too', async () => {
    useWhatsApp();
    fetchMock.mockImplementation(async () => new Response('<html>Bad Gateway</html>', { status: 502 }));

    const res = await requestCustomer();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('OTP_DELIVERY_FAILED');
    expect(logs.all()).toContain('whatsapp otp delivery failed for ••••3210: HTTP 502');
    expect(logs.all()).not.toContain('Bad Gateway');
  });

  test('no answer within the timeout is a 503', async () => {
    useWhatsApp();
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = jest.spyOn(AbortSignal, 'timeout').mockImplementation(() => realTimeout(20));
    // A provider that never answers: only the abort ends the call.
    fetchMock.mockImplementation(
      (url, init) =>
        new Promise((resolve, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason));
        })
    );

    const res = await requestCustomer();
    expect(timeout).toHaveBeenCalledWith(WHATSAPP_TIMEOUT_MS);
    expect(WHATSAPP_TIMEOUT_MS).toBe(10000);
    expect(res.status).toBe(503);
    expect(res.body).toEqual(DELIVERY_FAILED);
    expect(logs.all()).toContain('whatsapp otp delivery failed for ••••3210: no answer within 10 s');
    expect(await OtpChallenge.countDocuments()).toBe(0);
  });

  test('a network failure is a 503', async () => {
    useWhatsApp();
    fetchMock.mockRejectedValue(new TypeError('fetch failed'));

    const res = await requestCustomer();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('OTP_DELIVERY_FAILED');
    expect(logs.all()).toContain('whatsapp otp delivery failed for ••••3210: request failed (TypeError)');
  });

  test('missing settings: 503 before anything is spent, for a vendor and an unknown number alike', async () => {
    useWhatsApp({ WHATSAPP_ACCESS_TOKEN: '' });
    await f.createPhoneVendor({ phone: VENDOR_PHONE });

    const customer = await requestCustomer();
    const known = await requestVendorSignIn(VENDOR_PHONE);
    const unknown = await requestVendorSignIn(UNKNOWN_PHONE);
    for (const res of [customer, known, unknown]) {
      expect(res.status).toBe(503);
      expect(res.body).toEqual(DELIVERY_FAILED);
    }
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await OtpChallenge.countDocuments()).toBe(0);
    expect(await RateBudget.countDocuments()).toBe(0);
    expect(logs.all()).toContain('otp not sent by WhatsApp: WHATSAPP_ACCESS_TOKEN not set.');
  });

  test('a number WhatsApp cannot address (not Indian) is a 503, without calling the provider', async () => {
    useWhatsApp();
    for (const phone of ['18005550100', '1234567']) {
      const res = await requestCustomer(phone);
      expect(res.status).toBe(503);
      expect(res.body.code).toBe('OTP_DELIVERY_FAILED');
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('an OTP_DELIVERY_CHANNEL that is neither none nor whatsapp is a 503', async () => {
    process.env.OTP_DELIVERY_CHANNEL = 'sms';
    const res = await requestCustomer();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('OTP_DELIVERY_FAILED');
    expect(logs.all()).not.toContain('"sms"');
  });

  test('vendor registration: a refused code leaves no registration behind; registering again works at once', async () => {
    useWhatsApp();
    fetchMock.mockImplementation(async () => refused());
    const category = await f.createCategory();
    const body = {
      businessName: 'Sharma Plumbing',
      ownerFirstName: 'Anil',
      ownerLastName: 'Sharma',
      phone: '9000000003',
      serviceCategoryIds: [String(category._id)],
    };

    const failed = await api.post('/auth/vendor/register', body);
    expect(failed.status).toBe(503);
    expect(failed.body).toEqual(DELIVERY_FAILED);
    expect(await VendorRegistration.countDocuments()).toBe(0);

    fetchMock.mockImplementation(async () => accepted());
    const registered = await api.post('/auth/vendor/register', body);
    expect(registered.status).toBe(201);
    const verified = await api.post('/auth/vendor/otp/verify', {
      registrationId: registered.body.data.registrationId,
      code: OTP,
    });
    expect(verified.status).toBe(200);
  });

  test('a refused resend leaves no live code; the next request goes at once', async () => {
    useWhatsApp();
    fetchMock.mockImplementation(async () => accepted());
    await requestCustomer();
    clock.advance(31000);

    fetchMock.mockImplementation(async () => refused());
    expect((await requestCustomer()).status).toBe(503);
    expect((await verifyCustomer()).body.code).toBe('OTP_EXPIRED');

    fetchMock.mockImplementation(async () => accepted());
    expect((await requestCustomer()).status).toBe(200);
    expect((await verifyCustomer()).status).toBe(200);
  });
});

// Review fix 28/11/2026: a refused send is handed back to the day, so without a budget of its own a
// failing provider could be called for someone's number without end.
describe('refused sends have a budget of their own', () => {
  test('each refused send counts; the 11th is refused with 429 RATE_LIMITED without calling the provider', async () => {
    useWhatsApp();
    expect(OTP_FAILED_SENDS_PER_DAY).toBe(10);
    await spendRefusedSends(() => requestCustomer());
    expect(fetchMock).toHaveBeenCalledTimes(10);
    expect(await budgetCount(`otp-send-failed:${PHONE}`)).toBe(10);
    // Each was still handed back to the day (contract §2: the user may ask again at once).
    expect(await budgetCount(`otp-send:${PHONE}`)).toBe(0);

    const eleventh = await requestCustomer();
    expect(eleventh.status).toBe(429);
    expect(eleventh.body).toEqual(RATE_LIMITED);
    const retryAfter = Number(eleventh.headers['retry-after']);
    expect(retryAfter).toBeGreaterThan(DAY_SECONDS - 60);
    expect(retryAfter).toBeLessThanOrEqual(DAY_SECONDS);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    // The refusal itself spends nothing: no challenge, no day's send.
    expect(await OtpChallenge.countDocuments()).toBe(0);
    expect(await budgetCount(`otp-send:${PHONE}`)).toBe(0);

    // A recovered provider is not called either until the window has passed, and then it is.
    fetchMock.mockImplementation(async () => accepted());
    expect((await requestCustomer()).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(10);
    clock.advance(DAY_SECONDS * 1000);
    expect((await requestCustomer()).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(11);
    expect((await verifyCustomer()).status).toBe(200);
  });

  test('sends that go out are not counted: with deliveries in between, the 11th refused one is still the one stopped', async () => {
    useWhatsApp();
    fetchMock.mockImplementation(async () => accepted());
    for (let send = 1; send <= 3; send += 1) {
      expect((await requestCustomer()).status).toBe(200);
      clock.advance(31000);
    }
    expect(await budgetCount(`otp-send-failed:${PHONE}`)).toBe(0);

    fetchMock.mockImplementation(async () => refused());
    for (let attempt = 1; attempt <= 9; attempt += 1) {
      expect((await requestCustomer()).status).toBe(503);
    }
    fetchMock.mockImplementation(async () => accepted());
    expect((await requestCustomer()).status).toBe(200);
    expect((await verifyCustomer()).status).toBe(200);
    expect(await budgetCount(`otp-send-failed:${PHONE}`)).toBe(9);
    clock.advance(31000);

    fetchMock.mockImplementation(async () => refused());
    expect((await requestCustomer()).status).toBe(503);
    expect((await requestCustomer()).status).toBe(429);
    expect(fetchMock).toHaveBeenCalledTimes(3 + 9 + 1 + 1);
  });

  test('a spent budget answers the same for a vendor number and a number with no vendor account', async () => {
    useWhatsApp();
    await f.createPhoneVendor({ phone: VENDOR_PHONE });
    // The vendor's by vendor sign in; the other number's by customer codes (a decoy sends nothing,
    // so it can never spend the budget itself).
    await spendRefusedSends(() => requestVendorSignIn(VENDOR_PHONE));
    await spendRefusedSends(() => requestCustomer(UNKNOWN_PHONE));
    expect(fetchMock).toHaveBeenCalledTimes(20);

    fetchMock.mockImplementation(async () => accepted());
    const known = await requestVendorSignIn(VENDOR_PHONE);
    const unknown = await requestVendorSignIn(UNKNOWN_PHONE);
    for (const res of [known, unknown]) {
      expect(res.status).toBe(429);
      expect(res.body).toEqual(RATE_LIMITED);
      expect(res.headers['retry-after']).toMatch(/^\d+$/);
    }
    expect(fetchMock).toHaveBeenCalledTimes(20);
  });

  test('a spent budget stops a vendor registration before anything is created', async () => {
    useWhatsApp();
    const category = await f.createCategory();
    await spendRefusedSends(() => requestCustomer('9000000003'));
    fetchMock.mockImplementation(async () => accepted());
    const create = jest.spyOn(VendorRegistration, 'create');

    const res = await api.post('/auth/vendor/register', {
      businessName: 'Sharma Plumbing',
      ownerFirstName: 'Anil',
      ownerLastName: 'Sharma',
      phone: '9000000003',
      serviceCategoryIds: [String(category._id)],
    });
    expect(res.status).toBe(429);
    expect(res.body).toEqual(RATE_LIMITED);
    expect(create).not.toHaveBeenCalled();
    expect(await VendorRegistration.countDocuments()).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(10);
  });
});

describe('start-up check', () => {
  const quietLogger = () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() });
  const base = { JWT_SECRET: 's' };

  test.each([['production'], ['staging'], [undefined]])(
    'NODE_ENV %s with whatsapp and a setting missing refuses to start, naming the setting only',
    (NODE_ENV) => {
      const env = { ...base, NODE_ENV, ...WHATSAPP_ENV, WHATSAPP_PHONE_NUMBER_ID: '', WHATSAPP_OTP_TEMPLATE_NAME: ' ' };
      let thrown;
      try {
        checkEnvironment(env, quietLogger());
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeDefined();
      expect(thrown.message).toContain('WHATSAPP_PHONE_NUMBER_ID, WHATSAPP_OTP_TEMPLATE_NAME are not set');
      expect(thrown.message).toContain('Refusing to start');
      expect(thrown.message).not.toContain(TOKEN);
    }
  );

  test('production with an unknown channel refuses to start without echoing the value', () => {
    expect(() =>
      checkEnvironment({ ...base, NODE_ENV: 'production', OTP_DELIVERY_CHANNEL: 'sms-gateway' }, quietLogger())
    ).toThrow('OTP_DELIVERY_CHANNEL must be "none" or "whatsapp".');
    try {
      checkEnvironment({ ...base, NODE_ENV: 'production', OTP_DELIVERY_CHANNEL: 'sms-gateway' }, quietLogger());
    } catch (error) {
      expect(error.message).not.toContain('sms-gateway');
    }
  });

  test('development with a setting missing logs an error and starts', () => {
    const logger = quietLogger();
    const env = { ...base, NODE_ENV: 'development', ...WHATSAPP_ENV, WHATSAPP_OTP_TEMPLATE_NAME: '' };
    expect(() => checkEnvironment(env, logger)).not.toThrow();
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error.mock.calls[0][0]).toContain('WHATSAPP_OTP_TEMPLATE_NAME is not set');
    expect(logger.error.mock.calls[0][0]).not.toContain(TOKEN);
  });

  test('production with every WhatsApp setting starts quietly', () => {
    const logger = quietLogger();
    expect(() => checkEnvironment({ ...base, NODE_ENV: 'production', ...WHATSAPP_ENV }, logger)).not.toThrow();
    expect(logger.error).not.toHaveBeenCalled();
  });

  // Review fix 28/11/2026: no channel outside development/test means codes nobody receives. It
  // starts (a staging server may come up before its provider), but says so once, as an error.
  test.each([['production'], ['staging'], [undefined]])(
    'NODE_ENV %s with no channel (unset, none or NONE) starts, with one error line saying codes cannot be delivered',
    (NODE_ENV) => {
      for (const channel of [
        {},
        { OTP_DELIVERY_CHANNEL: '' },
        { OTP_DELIVERY_CHANNEL: 'none' },
        { OTP_DELIVERY_CHANNEL: 'NONE' },
      ]) {
        const logger = quietLogger();
        expect(() => checkEnvironment({ ...base, NODE_ENV, ...channel }, logger)).not.toThrow();
        expect(logger.error).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalledWith(
          'OTP_DELIVERY_CHANNEL is none or not set: sign-in codes cannot be delivered until a delivery channel is configured, so customers and vendors cannot sign in by phone.'
        );
      }
    }
  );

  test('development and test with no channel log no error (the static code is how testers sign in)', () => {
    for (const NODE_ENV of ['development', 'test']) {
      for (const channel of [{}, { OTP_DELIVERY_CHANNEL: 'none' }]) {
        const logger = quietLogger();
        expect(() => checkEnvironment({ ...base, NODE_ENV, ...channel }, logger)).not.toThrow();
        expect(logger.error).not.toHaveBeenCalled();
      }
    }
  });

  test('the server itself refuses to start in production with whatsapp half set up', () => {
    const result = spawnSync(process.execPath, ['index.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        PORT: '5058',
        MONGO_URI: THROWAWAY_DB,
        OTP_STATIC_CODE: '',
        OTP_DELIVERY_CHANNEL: 'whatsapp',
        WHATSAPP_ACCESS_TOKEN: TOKEN,
        WHATSAPP_PHONE_NUMBER_ID: '',
        WHATSAPP_OTP_TEMPLATE_NAME: '',
      },
      encoding: 'utf8',
      timeout: 20000,
    });
    const output = `${result.stdout}${result.stderr}`;
    expect(result.status).toBe(1);
    expect(output).toContain('Refusing to start');
    expect(output).not.toContain(TOKEN);
  });
});
