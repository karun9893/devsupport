'use strict';

const { Issue, Counter } = require('../models');
const { ACTIVE_ASSIGNMENT_STATUSES } = require('../config/constants');

/** Data access for issues, including the OCC-guarded update primitive. */

async function create(data, { session } = {}) {
  const issue = new Issue(data);
  await issue.save({ session });
  return issue;
}

async function findById(id, { session } = {}) {
  return Issue.findById(id).session(session || null).exec();
}

/** Active (Open / In_Progress / Reopened) issues assigned to a user within one project. */
async function findActiveAssignedToUser(projectId, userId, { session } = {}) {
  return Issue.find({ projectId, assigneeId: userId, status: { $in: ACTIVE_ASSIGNMENT_STATUSES } })
    .sort({ issueNumber: 1 })
    .session(session || null)
    .exec();
}

/**
 * Optimistic-concurrency update (Phase 2 §6.1).
 * Matches on `_id` AND the expected `version` (plus any extra guard predicates),
 * applies the update and increments `version` in the same atomic operation.
 *
 * @param {*} issueId
 * @param {number} expectedVersion
 * @param {object} guard - additional filter predicates (e.g. { status: 'Open' })
 * @param {object} update - MongoDB update document (must not touch `version`)
 * @returns {Promise<object|null>} updated issue, or null when the version/guard no longer matches
 */
async function updateWithVersion(issueId, expectedVersion, guard, update, { session } = {}) {
  return Issue.findOneAndUpdate(
    { ...guard, _id: issueId, version: expectedVersion },
    { ...update, $inc: { ...(update.$inc || {}), version: 1 } },
    { new: true, runValidators: true, session },
  ).exec();
}

/** Atomic issue-number allocation (Phase 2 §4). */
async function nextIssueNumber(projectId, { session } = {}) {
  return Counter.nextSequence(projectId, { session });
}

module.exports = { create, findById, findActiveAssignedToUser, updateWithVersion, nextIssueNumber };
