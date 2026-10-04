'use strict';

const AppError = require('../utils/AppError');
const { runInTransaction } = require('../utils/transaction');
const { toObjectId, idEquals } = require('../utils/objectId');
const {
  PROJECT_ROLES,
  LEAD_ELIGIBLE_SYSTEM_ROLES,
  ISSUE_STATUSES,
  ACTIVITY_ACTIONS,
  OFFBOARDING_STRATEGIES,
} = require('../config/constants');
const projectRepository = require('../repositories/projectRepository');
const issueRepository = require('../repositories/issueRepository');
const userRepository = require('../repositories/userRepository');
const activityService = require('./activityService');
const { assertEligibleAssignee } = require('./assignmentRules');
const {
  resolveProjectAccess,
  assertCanViewProject,
  assertCanManageProject,
  assertProjectWritable,
} = require('./accessControl');

const { serializeId } = activityService;

function mapDuplicateKeyError(err) {
  if (err && err.code === 11000) {
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0];
    if (field === 'key') return AppError.conflict('PROJECT_KEY_EXISTS', 'A project with this key already exists.');
    if (field === 'name') return AppError.conflict('PROJECT_NAME_EXISTS', 'A project with this name already exists.');
    return AppError.conflict('DUPLICATE_RESOURCE', 'A project with these details already exists.');
  }
  return err;
}

// ---------------------------------------------------------------------------
// Create / read / archive
// ---------------------------------------------------------------------------

/**
 * Phase 1 §5.2.1 — Admin or Team Lead creates a project; the creator becomes
 * owner and initial Lead. Project, its issue counter and PROJECT_CREATED audit
 * record commit atomically.
 */
async function createProject(actor, { name, key, description }) {
  if (!LEAD_ELIGIBLE_SYSTEM_ROLES.includes(actor.role)) {
    throw AppError.forbidden('FORBIDDEN', 'Only Admins and Team Leads can create projects.');
  }
  const ownerId = toObjectId(actor.id, 'actor.id');

  try {
    return await runInTransaction(async (session) => {
      const project = await projectRepository.create(
        {
          name,
          key,
          description,
          ownerId,
          members: [{ userId: ownerId, projectRole: PROJECT_ROLES.LEAD, joinedAt: new Date() }],
        },
        { session },
      );
      await projectRepository.initializeCounter(project._id, { session });
      await activityService.record(
        activityService.projectEvent({
          project,
          actorId: ownerId,
          actionType: ACTIVITY_ACTIONS.PROJECT_CREATED,
          newValue: { name: project.name, key: project.key, ownerId: serializeId(ownerId) },
        }),
        { session },
      );
      return project;
    });
  } catch (err) {
    throw mapDuplicateKeyError(err);
  }
}

async function getProject(actor, projectId) {
  const project = await projectRepository.findById(toObjectId(projectId, 'projectId'));
  if (!project) throw AppError.notFound('PROJECT_NOT_FOUND', 'Project not found.');
  assertCanViewProject(resolveProjectAccess(actor, project));
  return project;
}

/** Phase 1 §5.2.5 — soft delete: the project becomes read-only. */
async function archiveProject(actor, projectId, { reason = null } = {}) {
  const id = toObjectId(projectId, 'projectId');
  return runInTransaction(async (session) => {
    const project = await projectRepository.findById(id, { session });
    if (!project) throw AppError.notFound('PROJECT_NOT_FOUND', 'Project not found.');
    assertCanManageProject(resolveProjectAccess(actor, project));
    assertProjectWritable(project);

    const archived = await projectRepository.archive(id, { session });
    if (!archived) throw AppError.conflict('CONCURRENT_MODIFICATION', 'The project was modified concurrently. Please retry.');

    await activityService.record(
      activityService.projectEvent({
        project: archived,
        actorId: actor.id,
        actionType: ACTIVITY_ACTIONS.PROJECT_ARCHIVED,
        oldValue: { status: project.status },
        newValue: { status: archived.status },
        reason,
      }),
      { session },
    );
    return archived;
  });
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

/** Phase 1 §5.2.4 — add an Active user to the roster. */
async function addMember(actor, projectId, { userId, projectRole = PROJECT_ROLES.DEVELOPER }) {
  const pid = toObjectId(projectId, 'projectId');
  const uid = toObjectId(userId, 'userId');
  if (!Object.values(PROJECT_ROLES).includes(projectRole)) {
    throw AppError.unprocessable('VALIDATION_ERROR', `projectRole must be one of: ${Object.values(PROJECT_ROLES).join(', ')}.`);
  }

  return runInTransaction(async (session) => {
    const project = await projectRepository.findById(pid, { session });
    if (!project) throw AppError.notFound('PROJECT_NOT_FOUND', 'Project not found.');
    assertCanManageProject(resolveProjectAccess(actor, project));
    assertProjectWritable(project);

    const user = await userRepository.findActiveById(uid, { session });
    if (!user) throw AppError.unprocessable('INVALID_MEMBER', 'Only existing, active users can be added to a project.');
    if (projectRole === PROJECT_ROLES.LEAD && !LEAD_ELIGIBLE_SYSTEM_ROLES.includes(user.role)) {
      throw AppError.unprocessable('INVALID_PROJECT_ROLE', 'Only Team Leads or Admins can hold the project Lead role.');
    }
    if (project.findMember(uid)) throw AppError.conflict('MEMBER_ALREADY_EXISTS', 'User is already a member of this project.');

    const member = { userId: uid, projectRole, joinedAt: new Date() };
    const updated = await projectRepository.addMember(pid, member, { session });
    if (!updated) throw AppError.conflict('MEMBER_ALREADY_EXISTS', 'User is already a member of this project.');

    await activityService.record(
      activityService.projectEvent({
        project: updated,
        actorId: actor.id,
        actionType: ACTIVITY_ACTIONS.PROJECT_MEMBER_ADDED,
        newValue: { userId: serializeId(uid), projectRole },
      }),
      { session },
    );
    return updated;
  });
}

function validateOffboardingDirective(targetUserId, { strategy, transferToUserId }) {
  const allowed = Object.values(OFFBOARDING_STRATEGIES);
  if (strategy !== undefined && strategy !== null && !allowed.includes(strategy)) {
    throw AppError.unprocessable('INVALID_OFFBOARDING_STRATEGY', `strategy must be one of: ${allowed.join(', ')}.`);
  }
  if (strategy === OFFBOARDING_STRATEGIES.TRANSFER) {
    if (!transferToUserId) {
      throw AppError.unprocessable('INVALID_TRANSFER_TARGET', 'transferToUserId is required when strategy is "transfer".');
    }
    const target = toObjectId(transferToUserId, 'transferToUserId');
    if (idEquals(target, targetUserId)) {
      throw AppError.unprocessable('INVALID_TRANSFER_TARGET', 'Issues cannot be transferred to the member being removed.');
    }
    return target;
  }
  if (transferToUserId) {
    throw AppError.unprocessable('INVALID_OFFBOARDING_STRATEGY', 'transferToUserId is only valid with strategy "transfer".');
  }
  return null;
}

/**
 * Phase 2 §5 — member offboarding.
 *
 * 1. Default (no strategy): if the member has active assigned issues
 *    (Open / In_Progress / Reopened) the removal is BLOCKED with
 *    400 MEMBER_HAS_ACTIVE_ISSUES and the blocking issues are returned.
 * 2. strategy = "transfer": every blocking issue is reassigned to
 *    `transferToUserId` (who must be an active project member).
 * 3. strategy = "unassign": every blocking issue is unassigned; In_Progress
 *    issues return to Open (Phase 1 §7.3 / T2), see implementation notes C-2.
 *
 * All issue updates, their ASSIGNEE_CHANGED / STATUS_CHANGED audit records, the
 * roster change and PROJECT_MEMBER_REMOVED commit in ONE ACID transaction.
 */
async function removeMember(actor, projectId, userId, directive = {}) {
  const pid = toObjectId(projectId, 'projectId');
  const uid = toObjectId(userId, 'userId');
  const strategy = directive.strategy || null;
  const transferTo = validateOffboardingDirective(uid, directive);

  return runInTransaction(async (session) => {
    const project = await projectRepository.findById(pid, { session });
    if (!project) throw AppError.notFound('PROJECT_NOT_FOUND', 'Project not found.');
    assertCanManageProject(resolveProjectAccess(actor, project));
    assertProjectWritable(project);

    const member = project.findMember(uid);
    if (!member) throw AppError.notFound('MEMBER_NOT_FOUND', 'User is not a member of this project.');
    if (idEquals(project.ownerId, uid)) {
      throw AppError.unprocessable('CANNOT_REMOVE_PROJECT_OWNER', 'The project owner cannot be removed. Transfer ownership first.');
    }

    const activeIssues = await issueRepository.findActiveAssignedToUser(pid, uid, { session });

    if (activeIssues.length > 0 && !strategy) {
      throw AppError.badRequest(
        'MEMBER_HAS_ACTIVE_ISSUES',
        "Cannot remove member with active assigned issues. Choose 'transfer' or 'unassign' strategy.",
        {
          activeCount: activeIssues.length,
          blockingIssues: activeIssues.map((i) => ({ id: String(i._id), key: i.key, title: i.title, status: i.status })),
        },
      );
    }

    if (transferTo) {
      await assertEligibleAssignee(project, transferTo, {
        session,
        code: 'INVALID_TRANSFER_TARGET',
        message: 'transferToUserId must be an active member of this project.',
      });
    }

    const reason = `Member offboarding: user ${String(uid)} removed from project (strategy: ${strategy || 'none'}).`;
    const auditEntries = [];
    const affectedIssues = [];

    for (const issue of activeIssues) {
      const set = { assigneeId: transferTo };
      const statusChange = !transferTo && issue.status === ISSUE_STATUSES.IN_PROGRESS;
      if (statusChange) set.status = ISSUE_STATUSES.OPEN;

      const updated = await issueRepository.updateWithVersion(
        issue._id,
        issue.version,
        { assigneeId: uid, status: issue.status },
        { $set: set },
        { session },
      );
      if (!updated) {
        throw AppError.conflict('VERSION_CONFLICT', `Issue ${issue.key} was modified concurrently. Please retry the removal.`);
      }

      auditEntries.push(
        activityService.issueEvent({
          issue: updated,
          actorId: actor.id,
          actionType: ACTIVITY_ACTIONS.ASSIGNEE_CHANGED,
          oldValue: serializeId(uid),
          newValue: serializeId(transferTo),
          reason,
        }),
      );
      if (statusChange) {
        auditEntries.push(
          activityService.issueEvent({
            issue: updated,
            actorId: actor.id,
            actionType: ACTIVITY_ACTIONS.STATUS_CHANGED,
            oldValue: issue.status,
            newValue: updated.status,
            reason,
          }),
        );
      }
      affectedIssues.push({ id: String(updated._id), key: updated.key, status: updated.status, assigneeId: serializeId(updated.assigneeId) });
    }

    const updatedProject = await projectRepository.removeMember(pid, uid, { session });
    if (!updatedProject) throw AppError.conflict('CONCURRENT_MODIFICATION', 'The project roster changed concurrently. Please retry.');

    auditEntries.push(
      activityService.projectEvent({
        project: updatedProject,
        actorId: actor.id,
        actionType: ACTIVITY_ACTIONS.PROJECT_MEMBER_REMOVED,
        oldValue: { userId: serializeId(uid), projectRole: member.projectRole },
        newValue: {
          strategy: strategy || 'none',
          transferToUserId: serializeId(transferTo),
          affectedIssueKeys: affectedIssues.map((i) => i.key),
        },
      }),
    );
    await activityService.recordMany(auditEntries, { session });

    return { project: updatedProject, removedUserId: String(uid), strategy: strategy || 'none', affectedIssues };
  });
}

module.exports = {
  createProject,
  getProject,
  archiveProject,
  addMember,
  removeMember,
  // exported for unit tests
  _internal: { validateOffboardingDirective },
};
