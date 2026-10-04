'use strict';

const AppError = require('../utils/AppError');
const { USER_ROLES, USER_STATUSES } = require('../config/constants');
const { toObjectId } = require('../utils/objectId');
const userRepository = require('../repositories/userRepository');
const refreshTokenRepository = require('../repositories/refreshTokenRepository');

/**
 * Admin user-management primitives needed by the persistence foundation.
 * (Full user-management endpoints are specified in Phase 3.)
 */

/**
 * Activates/suspends a user. Suspension also revokes every refresh-token family,
 * so the user loses access within one access-token lifetime (≤ 15 min); the
 * authenticate middleware additionally re-checks status on every request.
 */
async function setUserStatus(actor, userId, status) {
  if (actor.role !== USER_ROLES.ADMIN) {
    throw AppError.forbidden('FORBIDDEN', 'Only an Admin can change account status.');
  }
  if (!Object.values(USER_STATUSES).includes(status)) {
    throw AppError.unprocessable('VALIDATION_ERROR', `status must be one of: ${Object.values(USER_STATUSES).join(', ')}.`);
  }
  const user = await userRepository.setStatus(toObjectId(userId, 'userId'), status);
  if (!user) throw AppError.notFound('USER_NOT_FOUND', 'User not found.');
  if (status === USER_STATUSES.SUSPENDED) await refreshTokenRepository.revokeAllForUser(user._id);
  return user.toJSON();
}

module.exports = { setUserStatus };
