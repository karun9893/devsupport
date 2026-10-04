'use strict';

const AppError = require('../utils/AppError');
const { runInTransaction } = require('../utils/transaction');
const { toObjectId, idEquals } = require('../utils/objectId');
const { getTransition, allowedTargets, STATUSES_REQUIRING_ASSIGNEE } = require('../utils/issueStateMachine');
const { ISSUE_STATUSES, ISSUE_PRIORITIES, ACTIVITY_ACTIONS } = require('../config/constants');
const projectRepository = require('../repositories/projectRepository');
const issueRepository = require('../repositories/issueRepository');
const activityService = require('./activityService');
const { assertEligibleAssignee } = require('./assignmentRules');
const { resolveProjectAccess, assertCanViewProject, assertProjectWritable } = require('./accessControl');

const { serializeId } = activityService;

/**
 * Issue domain service — Phase 1 §6 / §7, Phase 2 §4 / §6.
 *
 * Every mutation:
 *  - is authorised against the project roster,
 *  - is applied with an optimistic-concurrency (version-matched) atomic update,
 *  - commits together with its audit record(s) in one transaction.
 */

const ISSUE_NOT_FOUND = ['ISSUE_NOT_FOUND', 'Issue not found.'];

async function loadIssueContext(actor, issueId) {
  const issue = await issueRepository.findById(toObjectId(issueId, 'issueId'));
  if (!issue) throw AppError.notFound(...ISSUE_NOT_FOUND);
  const project = await projectRepository.findById(issue.projectId);
  if (!project) throw AppError.notFound(...ISSUE_NOT_FOUND);
  const access = resolveProjectAccess(actor, project);
  // Non-members get 404 for issues as well (no existence probing).
  assertCanViewProject(access, ...ISSUE_NOT_FOUND);
  return { issue, project, access };
}

/**
 * Resolves the version the caller expects. If the client supplied one that is
 * already stale, fail fast; otherwise the version we just read is used, which
 * still protects the read→write window inside this request.
 */
function resolveExpectedVersion(issue, expectedVersion) {
  if (expectedVersion === undefined || expectedVersion === null) return issue.version;
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw AppError.unprocessable('VALIDATION_ERROR', 'expectedVersion must be a non-negative integer.');
  }
  if (expectedVersion !== issue.version) throw versionConflict(issue);
  return expectedVersion;
}

function versionConflict(issue) {
  return AppError.conflict(
    'VERSION_CONFLICT',
    'The issue was modified by another user. Please refresh and retry.',
    issue ? { issueId: String(issue._id), key: issue.key } : [],
  );
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

/**
 * Phase 1 §7.1 — any enrolled member (or Admin) can create an issue in an
 * Active project. Developers may only assign a new issue to themselves.
 *
 * The issue number is allocated by the atomic counter OUTSIDE the transaction
 * (Phase 2 §4 / §8.1: avoids hot-document write conflicts). If the insert later
 * fails the number is skipped (a gap) — numbers are unique, not necessarily
 * contiguous, exactly like Jira.
 */
async function createIssue(actor, projectId, { title, description, type, priority, assigneeId = null }) {
  const pid = toObjectId(projectId, 'projectId');
  const project = await projectRepository.findById(pid);
  if (!project) throw AppError.notFound('PROJECT_NOT_FOUND', 'Project not found.');
  const access = resolveProjectAccess(actor, project);
  assertCanViewProject(access);
  assertProjectWritable(project);

  let assignee = null;
  if (assigneeId) {
    assignee = toObjectId(assigneeId, 'assigneeId');
    if (!access.isAdmin && !access.isLead && !idEquals(assignee, actor.id)) {
      throw AppError.forbidden('ASSIGNMENT_FORBIDDEN', 'Developers can only assign issues to themselves.');
    }
    await assertEligibleAssignee(project, assignee);
  }

  const issueNumber = await issueRepository.nextIssueNumber(pid);
  const key = `${project.key}-${issueNumber}`;

  return runInTransaction(async (session) => {
    const issue = await issueRepository.create(
      {
        key,
        issueNumber,
        projectId: pid,
        title,
        description,
        type,
        priority: priority || ISSUE_PRIORITIES.MEDIUM,
        status: ISSUE_STATUSES.OPEN,
        reporterId: actor.id,
        assigneeId: assignee,
      },
      { session },
    );
    await activityService.record(
      activityService.issueEvent({
        issue,
        actorId: actor.id,
        actionType: ACTIVITY_ACTIONS.ISSUE_CREATED,
        newValue: {
          key: issue.key,
          title: issue.title,
          type: issue.type,
          priority: issue.priority,
          status: issue.status,
          assigneeId: serializeId(issue.assigneeId),
        },
      }),
      { session },
    );
    return issue;
  });
}

// ---------------------------------------------------------------------------
// Assignment
// ---------------------------------------------------------------------------

/**
 * Phase 1 §7.2.
 *  - Lead / Admin: assign, reassign or unassign to any eligible member.
 *  - Developer  : claim an unassigned issue, or release their own assignment.
 *  - Invariant  : an In_Progress issue cannot be left without an assignee
 *                 (move it back to Open first — transition T2).
 */
async function assignIssue(actor, issueId, { assigneeId = null, expectedVersion } = {}) {
  const { issue, project, access } = await loadIssueContext(actor, issueId);
  assertProjectWritable(project);

  const next = assigneeId ? toObjectId(assigneeId, 'assigneeId') : null;
  const current = issue.assigneeId || null;
  if ((next === null && current === null) || idEquals(next, current)) return issue; // no-op, nothing to audit

  if (!access.isAdmin && !access.isLead) {
    const isClaim = current === null && idEquals(next, actor.id);
    const isRelease = idEquals(current, actor.id) && next === null;
    if (!isClaim && !isRelease) {
      throw AppError.forbidden('ASSIGNMENT_FORBIDDEN', 'Developers can only claim unassigned issues or release their own assignment.');
    }
  }

  if (next === null && STATUSES_REQUIRING_ASSIGNEE.includes(issue.status)) {
    throw AppError.unprocessable('ASSIGNEE_REQUIRED', `An issue in status ${issue.status} must keep an assignee. Move it back to Open first.`);
  }
  if (next !== null) await assertEligibleAssignee(project, next);

  const version = resolveExpectedVersion(issue, expectedVersion);

  return runInTransaction(async (session) => {
    const updated = await issueRepository.updateWithVersion(issue._id, version, {}, { $set: { assigneeId: next } }, { session });
    if (!updated) throw versionConflict(issue);
    await activityService.record(
      activityService.issueEvent({
        issue: updated,
        actorId: actor.id,
        actionType: ACTIVITY_ACTIONS.ASSIGNEE_CHANGED,
        oldValue: serializeId(current),
        newValue: serializeId(next),
      }),
      { session },
    );
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Lifecycle transitions
// ---------------------------------------------------------------------------

/**
 * Applies a lifecycle transition (Phase 1 §6.3, T1–T8). See utils/issueStateMachine.js.
 */
async function transitionIssue(actor, issueId, { toStatus, expectedVersion, reason = null } = {}) {
  const { issue, project, access } = await loadIssueContext(actor, issueId);
  assertProjectWritable(project);

  if (!Object.values(ISSUE_STATUSES).includes(toStatus)) {
    throw AppError.unprocessable('VALIDATION_ERROR', `toStatus must be one of: ${Object.values(ISSUE_STATUSES).join(', ')}.`);
  }
  const rule = getTransition(issue.status, toStatus);
  const version = resolveExpectedVersion(issue, expectedVersion);

  if (!rule) {
    throw AppError.unprocessable('INVALID_STATUS_TRANSITION', `Transition ${issue.status} -> ${toStatus} is not allowed.`, {
      from: issue.status,
      allowed: allowedTargets(issue.status),
    });
  }

  const isUnassigned = !issue.assigneeId;
  const willClaim = Boolean(rule.autoClaim && isUnassigned && access.isMember);
  const capabilities = {
    admin: access.isAdmin,
    lead: access.isLead,
    member: access.isMember,
    assignee: isUnassigned ? willClaim : idEquals(issue.assigneeId, actor.id),
  };
  if (!rule.actors.some((cap) => capabilities[cap])) {
    throw AppError.forbidden('TRANSITION_FORBIDDEN', `You are not permitted to move this issue from ${issue.status} to ${toStatus}.`);
  }

  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (rule.requiresReason && !trimmedReason) {
    throw AppError.unprocessable('REASON_REQUIRED', `A reason is required for ${issue.status} -> ${toStatus}.`);
  }

  if (rule.forbidAssigneeActor && idEquals(issue.assigneeId, actor.id)) {
    throw AppError.forbidden('SELF_CLOSE_FORBIDDEN', 'The assignee cannot close their own issue; independent verification is required.');
  }

  const set = { status: toStatus };
  if (rule.requiresAssignee) {
    if (isUnassigned) {
      if (!willClaim) {
        throw AppError.unprocessable('ASSIGNEE_REQUIRED', `An issue must have an assignee before moving to ${toStatus}.`);
      }
      await assertEligibleAssignee(project, actor.id);
      set.assigneeId = toObjectId(actor.id, 'actor.id');
    } else {
      // The existing assignee must still be an active, enrolled member (Phase 1 T8).
      await assertEligibleAssignee(project, issue.assigneeId, {
        code: 'ASSIGNEE_NOT_ELIGIBLE',
        message: 'The current assignee is no longer an active member of this project. Reassign the issue first.',
      });
    }
  }

  return runInTransaction(async (session) => {
    const updated = await issueRepository.updateWithVersion(issue._id, version, { status: issue.status }, { $set: set }, { session });
    if (!updated) throw versionConflict(issue);

    const entries = [];
    if (set.assigneeId) {
      entries.push(
        activityService.issueEvent({
          issue: updated,
          actorId: actor.id,
          actionType: ACTIVITY_ACTIONS.ASSIGNEE_CHANGED,
          oldValue: null,
          newValue: serializeId(set.assigneeId),
          reason: `Self-assigned while moving to ${toStatus}.`,
        }),
      );
    }
    entries.push(
      activityService.issueEvent({
        issue: updated,
        actorId: actor.id,
        actionType: ACTIVITY_ACTIONS.STATUS_CHANGED,
        oldValue: issue.status,
        newValue: updated.status,
        reason: trimmedReason || null,
      }),
    );
    await activityService.recordMany(entries, { session });
    return updated;
  });
}

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

/** Phase 1 §2.2 — Lead/Admin, or a Developer who reported or is assigned to the issue. */
async function changePriority(actor, issueId, { priority, expectedVersion } = {}) {
  const { issue, project, access } = await loadIssueContext(actor, issueId);
  assertProjectWritable(project);

  if (!Object.values(ISSUE_PRIORITIES).includes(priority)) {
    throw AppError.unprocessable('VALIDATION_ERROR', `priority must be one of: ${Object.values(ISSUE_PRIORITIES).join(', ')}.`);
  }
  const isOwnIssue = idEquals(issue.reporterId, actor.id) || idEquals(issue.assigneeId, actor.id);
  if (!access.isAdmin && !access.isLead && !isOwnIssue) {
    throw AppError.forbidden('PRIORITY_CHANGE_FORBIDDEN', 'Developers can only change the priority of issues they reported or are assigned to.');
  }
  if (priority === issue.priority) return issue;

  const version = resolveExpectedVersion(issue, expectedVersion);

  return runInTransaction(async (session) => {
    const updated = await issueRepository.updateWithVersion(issue._id, version, {}, { $set: { priority } }, { session });
    if (!updated) throw versionConflict(issue);
    await activityService.record(
      activityService.issueEvent({
        issue: updated,
        actorId: actor.id,
        actionType: ACTIVITY_ACTIONS.PRIORITY_CHANGED,
        oldValue: issue.priority,
        newValue: updated.priority,
      }),
      { session },
    );
    return updated;
  });
}

async function getIssue(actor, issueId) {
  const { issue } = await loadIssueContext(actor, issueId);
  return issue;
}

module.exports = { createIssue, assignIssue, transitionIssue, changePriority, getIssue };
