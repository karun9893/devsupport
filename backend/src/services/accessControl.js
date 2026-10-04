'use strict';

const AppError = require('../utils/AppError');
const { USER_ROLES, PROJECT_ROLES } = require('../config/constants');
const { idEquals } = require('../utils/objectId');

/**
 * Project-scoped authorization primitives (Phase 1 §2 RBAC matrix).
 *
 * Interpretation (documented in PHASE_2_IMPLEMENTATION_NOTES.md, C-6):
 *  - "Team Lead (in assigned project)" privileges are granted by
 *    projectRole = Lead on that project's roster.
 *  - Only users whose system role is Admin or Team Lead may hold projectRole = Lead.
 *  - Non-members (non-Admin) receive 404, never 403, so project existence
 *    cannot be probed (Phase 1 §5.2.2 / §12.2).
 */

/**
 * @param {{ id: string, role: string }} actor
 * @param {object} project - Project document
 */
function resolveProjectAccess(actor, project) {
  const member = project.members.find((m) => idEquals(m.userId, actor.id)) || null;
  return Object.freeze({
    isAdmin: actor.role === USER_ROLES.ADMIN,
    isMember: Boolean(member),
    isLead: Boolean(member && member.projectRole === PROJECT_ROLES.LEAD),
    member,
  });
}

function assertCanViewProject(access, notFoundCode = 'PROJECT_NOT_FOUND', notFoundMessage = 'Project not found.') {
  if (!access.isAdmin && !access.isMember) {
    throw AppError.notFound(notFoundCode, notFoundMessage);
  }
}

function assertCanManageProject(access) {
  assertCanViewProject(access);
  if (!access.isAdmin && !access.isLead) {
    throw AppError.forbidden('INSUFFICIENT_PROJECT_ROLE', 'Only the project Lead or an Admin can perform this action.');
  }
}

function assertProjectWritable(project) {
  if (project.isArchived()) {
    throw AppError.conflict('PROJECT_ARCHIVED', 'This project is archived and read-only.');
  }
}

module.exports = { resolveProjectAccess, assertCanViewProject, assertCanManageProject, assertProjectWritable };
