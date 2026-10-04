'use strict';

const { Project, Counter } = require('../models');
const { PROJECT_STATUSES } = require('../config/constants');

/** Data access for projects. Roster invariants are encoded into guarded update filters. */

async function create(data, { session } = {}) {
  const project = new Project(data);
  await project.save({ session });
  return project;
}

async function findById(id, { session } = {}) {
  return Project.findById(id).session(session || null).exec();
}

/**
 * Atomically appends a member. The filter guarantees the project is Active and
 * the user is not already enrolled, so concurrent duplicate adds cannot both win.
 * @returns {Promise<object|null>} the updated project, or null if a guard failed.
 */
async function addMember(projectId, member, { session } = {}) {
  return Project.findOneAndUpdate(
    { _id: projectId, status: PROJECT_STATUSES.ACTIVE, 'members.userId': { $ne: member.userId } },
    { $push: { members: member } },
    { new: true, runValidators: true, session },
  ).exec();
}

/**
 * Atomically removes a member. The filter refuses to remove the owner; since the
 * owner is always a Lead, the "at least one Lead" invariant is preserved.
 * @returns {Promise<object|null>} the updated project, or null if a guard failed.
 */
async function removeMember(projectId, userId, { session } = {}) {
  return Project.findOneAndUpdate(
    {
      _id: projectId,
      status: PROJECT_STATUSES.ACTIVE,
      ownerId: { $ne: userId },
      'members.userId': userId,
    },
    { $pull: { members: { userId } } },
    { new: true, session },
  ).exec();
}

async function archive(projectId, { session } = {}) {
  return Project.findOneAndUpdate(
    { _id: projectId, status: PROJECT_STATUSES.ACTIVE },
    { $set: { status: PROJECT_STATUSES.ARCHIVED } },
    { new: true, session },
  ).exec();
}

/** Creates the project's issue counter at seq 0 (idempotent). */
async function initializeCounter(projectId, { session } = {}) {
  await Counter.updateOne(
    { _id: Counter.counterIdFor(projectId) },
    { $setOnInsert: { projectId, seq: 0 } },
    { upsert: true, session },
  ).exec();
}

module.exports = { create, findById, addMember, removeMember, archive, initializeCounter };
