const mongoose = require('mongoose');
const logger = require('../utils/logger');
const config = require('./index');

const connectDB = async (uri = config.mongoUri) => {
  mongoose.connection.on('connected', () => logger.info('Database connected successfully.'));
  mongoose.connection.on('error', (err) => logger.error(`Database connection error: ${err.message}`));
  mongoose.connection.on('disconnected', () => logger.warn('Database disconnected.'));

  try {
    await mongoose.connect(uri);
  } catch (error) {
    logger.error(`Failed to connect to Database: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
