'use strict';

/**
 * Domain constants — single source of truth for every enum and format rule
 * defined in Phase 1 (business rules) and Phase 2 (schema design).
 * Models, services, validators and tests all import from here so that an
 * enum can never drift between layers.
 */

const deepFreeze = (obj) => Object.freeze(obj);

const USER_ROLES = deepFreeze({
  ADMIN: 'Admin',
  TEAM_LEAD: 'Team Lead',
  DEVELOPER: 'Developer',
});

const USER_STATUSES = deepFreeze({
  ACTIVE: 'Active',
  SUSPENDED: 'Suspended',
});

const PROJECT_STATUSES = deepFreeze({
  ACTIVE: 'Active',
  ARCHIVED: 'Archived',
});

const PROJECT_ROLES = deepFreeze({
  LEAD: 'Lead',
  DEVELOPER: 'Developer',
});

/** System roles that are allowed to hold the project-level `Lead` role (Phase 1 §5.1: owner is a Team Lead or Admin). */
const LEAD_ELIGIBLE_SYSTEM_ROLES = Object.freeze([USER_ROLES.ADMIN, USER_ROLES.TEAM_LEAD]);

const ISSUE_TYPES = deepFreeze({
  BUG: 'Bug',
  FEATURE: 'Feature',
  TASK: 'Task',
  INCIDENT: 'Incident',
});

const ISSUE_PRIORITIES = deepFreeze({
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  CRITICAL: 'Critical',
});

/** Phase 1 §10.3 — priority must sort by urgency, not alphabetically. */
const PRIORITY_WEIGHTS = deepFreeze({
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
});

const ISSUE_STATUSES = deepFreeze({
  OPEN: 'Open',
  IN_PROGRESS: 'In_Progress',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  REOPENED: 'Reopened',
});

/**
 * Phase 2 §5.1 — statuses that count as "active assigned work" and therefore
 * block project-member removal.
 */
const ACTIVE_ASSIGNMENT_STATUSES = Object.freeze([
  ISSUE_STATUSES.OPEN,
  ISSUE_STATUSES.IN_PROGRESS,
  ISSUE_STATUSES.REOPENED,
]);

const ACTIVITY_ENTITY_TYPES = deepFreeze({
  ISSUE: 'Issue',
  PROJECT: 'Project',
  COMMENT: 'Comment',
});

/**
 * Phase 2 §3.6 catalog, plus PROJECT_CREATED (required by Phase 1 §5.2.1) and
 * COMMENT_EDITED (required by Phase 1 §3.1.4). See docs/PHASE_2_IMPLEMENTATION_NOTES.md (C-3).
 */
const ACTIVITY_ACTIONS = deepFreeze({
  ISSUE_CREATED: 'ISSUE_CREATED',
  ISSUE_UPDATED: 'ISSUE_UPDATED',
  STATUS_CHANGED: 'STATUS_CHANGED',
  ASSIGNEE_CHANGED: 'ASSIGNEE_CHANGED',
  PRIORITY_CHANGED: 'PRIORITY_CHANGED',
  COMMENT_ADDED: 'COMMENT_ADDED',
  COMMENT_EDITED: 'COMMENT_EDITED',
  COMMENT_DELETED: 'COMMENT_DELETED',
  PROJECT_CREATED: 'PROJECT_CREATED',
  PROJECT_MEMBER_ADDED: 'PROJECT_MEMBER_ADDED',
  PROJECT_MEMBER_REMOVED: 'PROJECT_MEMBER_REMOVED',
  PROJECT_ARCHIVED: 'PROJECT_ARCHIVED',
});

/** Phase 2 §5 — explicit resolution directives for member offboarding. */
const OFFBOARDING_STRATEGIES = deepFreeze({
  TRANSFER: 'transfer',
  UNASSIGN: 'unassign',
});

// ---------------------------------------------------------------------------
// Format rules
// ---------------------------------------------------------------------------

/** Phase 2 §3.2 — project key format. */
const PROJECT_KEY_REGEX = /^[A-Z][A-Z0-9]{1,9}$/;

/** Phase 2 §3.4 — Jira-style issue key: PROJECT_KEY-<positive integer>. */
const ISSUE_KEY_REGEX = /^[A-Z][A-Z0-9]{1,9}-[1-9]\d*$/;

/**
 * Practical RFC 5322 subset (the "dot-atom" form used by the WHATWG HTML spec),
 * additionally requiring at least one dot in the domain part.
 */
const EMAIL_REGEX =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/** Case-insensitive collation used by the unique email index (Phase 2 §3.1). */
const EMAIL_COLLATION = Object.freeze({ locale: 'en', strength: 2 });

/** Phase 1 §4.1 password policy. */
const PASSWORD_POLICY = Object.freeze({
  MIN_LENGTH: 8,
  MAX_LENGTH: 64,
  SPECIAL_CHARACTERS: '!@#$%^&*',
});

const SHA256_HEX_REGEX = /^[a-f0-9]{64}$/;
const UUID_V4_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

module.exports = {
  USER_ROLES,
  USER_STATUSES,
  PROJECT_STATUSES,
  PROJECT_ROLES,
  LEAD_ELIGIBLE_SYSTEM_ROLES,
  ISSUE_TYPES,
  ISSUE_PRIORITIES,
  PRIORITY_WEIGHTS,
  ISSUE_STATUSES,
  ACTIVE_ASSIGNMENT_STATUSES,
  ACTIVITY_ENTITY_TYPES,
  ACTIVITY_ACTIONS,
  OFFBOARDING_STRATEGIES,
  PROJECT_KEY_REGEX,
  ISSUE_KEY_REGEX,
  EMAIL_REGEX,
  EMAIL_COLLATION,
  PASSWORD_POLICY,
  SHA256_HEX_REGEX,
  UUID_V4_REGEX,
};
