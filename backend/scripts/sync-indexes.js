'use strict';

const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase, syncAllIndexes } = require('../src/config/database');
const logger = require('../src/utils/logger');

async function main() {
  try {
    logger.info('Connecting to database for index synchronization...');
    await connectDatabase();
    logger.info('Synchronizing all collection indexes according to Phase 2 specifications...');
    await syncAllIndexes();
    logger.info('All collection indexes successfully verified and synchronized!');
  } catch (err) {
    logger.error('Index synchronization failed:', err);
    process.exit(1);
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
