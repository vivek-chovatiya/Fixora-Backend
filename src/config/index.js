/**
 * Config Service
 *
 * The only place that reads process.env. Every other file imports values from here.
 */
require('dotenv').config();

const toInt = (value, fallback) => {
  const parsed = parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
};

const env = process.env.NODE_ENV || 'development';

const config = Object.freeze({
  env,
  isProduction: env === 'production',
  isDevelopment: env === 'development',
  isTest: env === 'test',
  port: toInt(process.env.PORT, 5000),
  appName: process.env.APP_NAME || 'Fixora',
  mongoUri: process.env.MONGO_URI || 'mongodb://localhost:27017/fixora',
  jwt: Object.freeze({
    secret: process.env.JWT_SECRET || 'fixora_secret_key_change_in_production',
    expiresIn: process.env.JWT_EXPIRES || '7d',
  }),
  bcryptSaltRounds: toInt(process.env.BCRYPT_SALT_ROUNDS, 12),
  upload: Object.freeze({
    path: process.env.UPLOAD_PATH || 'uploads',
    maxFileSizeBytes: toInt(process.env.UPLOAD_MAX_SIZE_BYTES, 5 * 1024 * 1024),
    maxFilesPerUpload: toInt(process.env.UPLOAD_MAX_FILES, 5),
  }),
  passwordReset: Object.freeze({
    codeTtlMinutes: toInt(process.env.PASSWORD_RESET_TTL_MINUTES, 15),
  }),
  rateLimit: Object.freeze({
    windowMs: toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
    authMax: toInt(process.env.RATE_LIMIT_AUTH_MAX, 100),
    apiMax: toInt(process.env.RATE_LIMIT_API_MAX, 2000),
  }),
  /** Calling code applied to local (country-less) phone numbers. Phase 1 is single-country. */
  defaultCallingCode: process.env.DEFAULT_CALLING_CODE || '91',
  logLevel: process.env.LOG_LEVEL || 'info',
});

module.exports = config;
