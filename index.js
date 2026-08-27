require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const connectDB = require('./src/config/db');
const routes = require('./src/routes');
const errorHandler = require('./src/middlewares/error');
const ApiError = require('./src/utils/ApiError');
const logger = require('./src/utils/logger');

const app = express();
const PORT = process.env.PORT || 5000;

// Security and Request Parsing
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static('uploads'));

// Request logging middleware
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.url}`);
  next();
});

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
  // Connect to Database
  await connectDB();

  // Start listening
  app.listen(PORT, () => {
    logger.info(`Server running in ${process.env.NODE_ENV || 'development'} mode on port ${PORT}`);
  });
};

startServer();

module.exports = app;
