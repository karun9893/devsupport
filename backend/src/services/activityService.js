'use strict';

const activityRepository = require('../repositories/activityRepository');
const { ACTIVITY_ENTITY_TYPES } = require('../config/constants');

/**
 * Audit-trail entry builders. Services build entries with these helpers and
 * persist them with `record`/`recordMany` INSIDE the same transaction as the
 * mutation they describe, so a mutation can never commit without its audit record.
 */

const serializeId = (v) => (v === null || v === undefined ? null : String(v));

function issueEvent({ issue, actorId, actionType, oldValue = null, newValue = null, reason = null }) {
  return {
    entityType: ACTIVITY_ENTITY_TYPES.ISSUE,
    entityId: issue._id,
    projectId: issue.projectId,
    actorId,
    actionType,
    details: { oldValue, newValue, reason },
  };
}

function projectEvent({ project, actorId, actionType, oldValue = null, newValue = null, reason = null }) {
  return {
    entityType: ACTIVITY_ENTITY_TYPES.PROJECT,
    entityId: project._id,
    projectId: project._id,
    actorId,
    actionType,
    details: { oldValue, newValue, reason },
  };
}

async function record(entry, { session } = {}) {
  return activityRepository.record(entry, { session });
}

async function recordMany(entries, { session } = {}) {
  return activityRepository.recordMany(entries, { session });
}

async function listForEntity(entityId, options) {
  return activityRepository.findByEntity(entityId, options);
}

async function listForProject(projectId, options) {
  return activityRepository.findByProject(projectId, options);
}

module.exports = { serializeId, issueEvent, projectEvent, record, recordMany, listForEntity, listForProject };
