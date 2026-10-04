'use strict';

const mongoose = require('mongoose');
const env = require('./env');
const logger = require('../utils/logger');

/**
 * MongoDB connection lifecycle.
 *
 * DevSupport REQUIRES a replica set (or sharded cluster): Phase 2 §5.3 mandates
 * multi-document ACID transactions for member offboarding, and the audit trail
 * is committed in the same transaction as each domain mutation. A standalone
 * `mongod` is rejected at startup with an actionable message.
 */

mongoose.set('strictQuery', true);

let listenersAttached = false;

function attachConnectionListeners() {
  if (listenersAttached) return;
  listenersAttached = true;
  const conn = mongoose.connection;
  conn.on('connected', () => logger.info('MongoDB connected', { host: conn.host, db: conn.name }));
  conn.on('reconnected', () => logger.warn('MongoDB reconnected'));
  conn.on('disconnected', () => logger.warn('MongoDB disconnected'));
  conn.on('error', (err) => logger.error('MongoDB connection error', err));
}

/**
 * @param {object} [options]
 * @param {string} [options.uri] - defaults to MONGODB_URI
 * @param {string} [options.dbName]
 */
async function connectDatabase({ uri = env.mongodbUri, dbName } = {}) {
  attachConnectionListeners();
  try {
    await mongoose.connect(uri, {
      dbName,
      autoIndex: env.autoIndex,
      serverSelectionTimeoutMS: 10_000,
    });
  } catch (err) {
    // Never echo the URI (it may contain credentials); logger.redact covers the message.
    const error = new Error(`Unable to connect to MongoDB: ${logger.redact(err.message)}`);
    error.code = 'DB_CONNECTION_FAILED';
    throw error;
  }
  return mongoose.connection;
}

/**
 * Throws unless the connected deployment supports multi-document transactions.
 */
async function assertTransactionSupport(connection = mongoose.connection) {
  const hello = await connection.db.admin().command({ hello: 1 });
  const supportsTransactions = Boolean(hello.setName) || hello.msg === 'isdbgrid';
  if (!supportsTransactions) {
    const error = new Error(
      'MongoDB is running as a standalone server. DevSupport requires a replica set for ' +
        'multi-document transactions. Run `npm run db:replset` for a local single-node replica set, ' +
        'or point MONGODB_URI at a replica set (e.g. ...?replicaSet=rs0).',
    );
    error.code = 'DB_TRANSACTIONS_UNSUPPORTED';
    throw error;
  }
}

/**
 * Creates every collection and synchronises its declared indexes.
 * Used by the index-sync script, the seed script and the test harness.
 */
async function syncAllIndexes() {
  // Loaded lazily so this module has no import-order coupling with the models.
  const models = require('../models');
  for (const model of Object.values(models)) {
    try {
      await model.createCollection();
    } catch (err) {
      if (err.code !== 48 /* NamespaceExists */) throw err;
    }
    await model.syncIndexes();
  }
}

async function disconnectDatabase() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
}

function isDatabaseConnected() {
  return mongoose.connection.readyState === 1;
}

module.exports = {
  connectDatabase,
  assertTransactionSupport,
  syncAllIndexes,
  disconnectDatabase,
  isDatabaseConnected,
};
