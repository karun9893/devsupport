'use strict';

const AppError = require('../utils/AppError');
const { idEquals } = require('../utils/objectId');
const userRepository = require('../repositories/userRepository');

/**
 * Phase 1 §7.2 eligible-assignee invariant: the target must be
 *   (1) an Active user, and (2) enrolled in THIS project.
 *
 * @param {object} project - Project document (roster is read from it)
 * @param {*} userId
 * @param {{ session?: object, code?: string, message?: string }} [options]
 * @returns {Promise<object>} the user document
 */
async function assertEligibleAssignee(project, userId, { session, code = 'INVALID_ASSIGNEE', message } = {}) {
  const errorMessage = message || 'Assignee must be an active enrolled member of this project.';
  const enrolled = project.members.some((m) => idEquals(m.userId, userId));
  if (!enrolled) throw AppError.unprocessable(code, errorMessage);

  const user = await userRepository.findActiveById(userId, { session });
  if (!user) throw AppError.unprocessable(code, errorMessage);
  return user;
}

module.exports = { assertEligibleAssignee };
