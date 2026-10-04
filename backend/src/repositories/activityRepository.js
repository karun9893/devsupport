'use strict';

const { Activity } = require('../models');

/** Append-only data access for the audit trail. Exposes NO update/delete functions by design. */

async function recordMany(entries, { session } = {}) {
  if (!entries || entries.length === 0) return [];
  // `ordered: true` so a single invalid entry fails the whole batch (and its transaction).
  return Activity.insertMany(entries, { session, ordered: true });
}

async function record(entry, { session } = {}) {
  const [doc] = await recordMany([entry], { session });
  return doc;
}

async function findByEntity(entityId, { limit = 50, skip = 0 } = {}) {
  return Activity.find({ entityId }).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).exec();
}

async function findByProject(projectId, { limit = 50, skip = 0 } = {}) {
  return Activity.find({ projectId }).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit).exec();
}

module.exports = { record, recordMany, findByEntity, findByProject };
