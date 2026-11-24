const config = require('./src/config');
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const connectDB = require('./src/config/db');
const routes = require('./src/routes');
const errorHandler = require('./src/middlewares/error');
const { uploadDir } = require('./src/middlewares/upload');
const ApiError = require('./src/utils/ApiError');
const logger = require('./src/utils/logger');
const { ERROR_CODE } = require('./src/constants');

const app = express();

// Security and request parsing.
// Uploaded images are loaded by the mobile/web client from another origin.
app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use('/uploads', express.static(uploadDir, { fallthrough: false, index: false }));

app.use(
  '/api',
  rateLimit({
    windowMs: config.rateLimit.windowMs,
    limit: config.rateLimit.apiMax,
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next) =>
      next(new ApiError(429, 'Too many requests. Please slow down.', null, ERROR_CODE.RATE_LIMITED)),
  })
);

app.use((req, res, next) => {
  logger.info(`${req.method} ${req.originalUrl}`);
  next();
});

app.use('/api/v1', routes);

app.use((req, res, next) => {
  next(new ApiError(404, `Endpoint ${req.originalUrl} not found.`));
});

app.use(errorHandler);

const startServer = async () => {
  await connectDB();
  app.listen(config.port, () => {
    logger.info(`Server running in ${config.env} mode on port ${config.port}`);
  });
};

if (require.main === module) {
  startServer();
}

module.exports = app;
