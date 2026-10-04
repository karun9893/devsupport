'use strict';

const app = require('./app');
const env = require('./config/env');
const { connectDatabase, disconnectDatabase, assertTransactionSupport } = require('./config/database');
const logger = require('./utils/logger');

let server;

async function startServer() {
  try {
    logger.info('Connecting to MongoDB...');
    await connectDatabase();

    // Verify replica set transaction capability in development / staging / production
    if (!env.isTest) {
      try {
        await assertTransactionSupport();
        logger.info('MongoDB Replica Set / Transaction Support verified.');
      } catch (txnErr) {
        logger.warn(txnErr.message);
      }
    }

    server = app.listen(env.port, () => {
      logger.info(`DevSupport backend listening on port ${env.port} [${env.nodeEnv}]`);
    });
  } catch (err) {
    logger.error('Failed to start server:', err);
    process.exit(1);
  }
}

// Graceful shutdown handling
async function shutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  if (server) {
    server.close(async () => {
      logger.info('HTTP server closed.');
      try {
        await disconnectDatabase();
        logger.info('Database connection closed.');
        process.exit(0);
      } catch (err) {
        logger.error('Error during database disconnection:', err);
        process.exit(1);
      }
    });
  } else {
    process.exit(0);
  }
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

if (require.main === module) {
  startServer();
}

module.exports = { startServer, shutdown };
