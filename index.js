require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const connectDB = require('./src/config/db');
const syncAccountIndexes = require('./src/config/indexes');
const runStartupMigrations = require('./src/config/migrations');
const checkEnvironment = require('./src/config/startupChecks');
const parseTrustProxy = require('./src/config/trustProxy');
const { uploadRoot } = require('./src/config/uploads');
const routes = require('./src/routes');
const errorHandler = require('./src/middlewares/error');
const authRateLimit = require('./src/middlewares/authRateLimit');
const ApiError = require('./src/utils/ApiError');
const logger = require('./src/utils/logger');

const app = express();
const PORT = process.env.PORT || 5000;

// Behind a proxy, read the real client IP from X-Forwarded-For (env TRUST_PROXY: hop count or false)
app.set('trust proxy', parseTrustProxy(process.env.TRUST_PROXY));

// Security and Request Parsing
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
// Uploaded images (Phase 4B contract §1): the same directory POST /uploads writes to, no index
// pages, and readable by the web views' <img> from another origin (helmet's same-origin default
// would block them), with that header on these files only. Public to anyone holding the URL (an
// open item).
app.use(
  '/uploads',
  express.static(uploadRoot(), {
    index: false,
    setHeaders: (res) => res.set('Cross-Origin-Resource-Policy', 'cross-origin'),
  })
);

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

// Per-IP limit on every /auth/* route (requests contract §8)
app.use('/api/v1/auth', authRateLimit);

// API Routes (v1)
app.use('/api/v1', routes);

// 404 Handler
app.use((req, res, next) => {
  next(new ApiError(404, `Endpoint ${req.originalUrl} not found.`));
});

// Global Error Handler
app.use(errorHandler);

// Start Server & Connect to DB
const startServer = async () => {
  // Refuse to start without JWT_SECRET, or (outside development/test) with a one-time code
  // delivery channel that cannot deliver; flag OTP_STATIC_CODE (ignored in production)
  try {
    checkEnvironment(process.env, logger);
  } catch (error) {
    logger.error(error.message);
    process.exit(1);
  }

  // Connect to Database
  await connectDB();

  // One-time data fixes (phone normalisation, phone-verified backfill), then the indexes that
  // depend on them; neither stops the server on a problem, both log it
  await runStartupMigrations();
  await syncAccountIndexes();

  // Start listening
  app.listen(PORT, () => {
    logger.info(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });
};

// Only connect and listen when run directly (node index.js); the test suite imports the app.
if (require.main === module) {
  startServer();
}

module.exports = app;
