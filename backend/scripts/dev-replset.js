'use strict';

/**
 * Script to start or configure a local single-node replica set on Windows/Linux/macOS
 * for development when a replica set is needed for multi-document ACID transactions.
 */
const { execSync } = require('child_process');
const logger = require('../src/utils/logger');

logger.info(`
To run MongoDB as a single-node replica set for local development:
1. Stop any standalone MongoDB service:
   Stop-Service MongoDB
2. Start mongod with --replSet rs0:
   mongod --dbpath "C:\\data\\db" --replSet rs0 --port 27017
3. In mongosh run:
   rs.initiate()
4. Your connection string will be:
   mongodb://localhost:27017/devsupport?replicaSet=rs0
`);
