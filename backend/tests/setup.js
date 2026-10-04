'use strict';

const mongoose = require('mongoose');
const { MongoMemoryReplSet } = require('mongodb-memory-server');
const { syncAllIndexes } = require('../src/config/database');

let replSet;

/**
 * Initializes an in-memory MongoDB replica set for Jest tests.
 * Fully supports multi-document transactions!
 */
async function setupTestDb() {
  process.env.NODE_ENV = 'test';
  process.env.JWT_ACCESS_SECRET = 'test-secret-key-that-is-at-least-32-characters-long';
  process.env.BCRYPT_SALT_ROUNDS = '4';

  const binaryOptions = {};
  const systemMongod = 'C:\\Program Files\\MongoDB\\Server\\8.2\\bin\\mongod.exe';
  if (require('fs').existsSync(systemMongod)) {
    binaryOptions.systemBinary = systemMongod;
  }

  replSet = await MongoMemoryReplSet.create({
    binary: binaryOptions,
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  const uri = replSet.getUri();
  process.env.MONGODB_URI = uri;

  await mongoose.connect(uri);
  await syncAllIndexes();
}

async function teardownTestDb() {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  if (replSet) {
    await replSet.stop();
  }
}

async function clearTestDb() {
  const collections = mongoose.connection.collections;
  for (const key of Object.keys(collections)) {
    await collections[key].deleteMany({});
  }
}

module.exports = { setupTestDb, teardownTestDb, clearTestDb };
