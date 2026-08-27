const mongoose = require('mongoose');
const logger = require('../core/logger/logger');

const connectDB = async () => {
  try {
    const mongoUri = process.env.MONGO_URI || 'mongodb://localhost:27017/fixora';

    mongoose.connection.on('connected', () => {
      logger.info('Database connected successfully.');
    });

    mongoose.connection.on('error', (err) => {
      logger.error(`Database connection error: ${err.message}`);
    });

    mongoose.connection.on('disconnected', () => {
      logger.warn('Database disconnected.');
    });

    await mongoose.connect(mongoUri);
  } catch (error) {
    logger.error(`Failed to connect to Database: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
