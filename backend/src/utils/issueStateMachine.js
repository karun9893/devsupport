'use strict';

const { ISSUE_STATUSES: S } = require('../config/constants');

/**
 * Deterministic issue lifecycle — Phase 1 §6.2 / §6.3 (transitions T1–T8).
 *
 * Actor capabilities:
 *   - 'assignee' : the caller is the issue's current assignee
 *                  (or, for `autoClaim` transitions on an unassigned issue,
 *                  an enrolled member who will claim it in the same operation)
 *   - 'member'   : the caller is enrolled in the issue's project
 *   - 'lead'     : the caller holds projectRole = Lead in the project
 *   - 'admin'    : the caller's system role is Admin
 *
 * Flags:
 *   - requiresAssignee    : resulting state must have an active, enrolled assignee
 *   - autoClaim           : an unassigned issue is self-assigned to the caller
 *                           ("developer must self-assign concurrently", T1)
 *   - requiresReason      : a non-empty reason must be supplied (T2, T5)
 *   - forbidAssigneeActor : the current assignee may never perform it (T4)
 */
const TRANSITIONS = Object.freeze({
  [`${S.OPEN}->${S.IN_PROGRESS}`]: Object.freeze({
    id: 'T1',
    actors: ['assignee', 'lead', 'admin'],
    requiresAssignee: true,
    autoClaim: true,
  }),
  [`${S.IN_PROGRESS}->${S.OPEN}`]: Object.freeze({
    id: 'T2',
    actors: ['assignee', 'lead', 'admin'],
    requiresReason: true,
  }),
  [`${S.IN_PROGRESS}->${S.RESOLVED}`]: Object.freeze({
    id: 'T3',
    actors: ['assignee', 'lead', 'admin'],
  }),
  [`${S.RESOLVED}->${S.CLOSED}`]: Object.freeze({
    id: 'T4',
    actors: ['lead', 'admin'],
    forbidAssigneeActor: true,
  }),
  [`${S.OPEN}->${S.CLOSED}`]: Object.freeze({
    id: 'T5',
    actors: ['lead', 'admin'],
    requiresReason: true,
  }),
  [`${S.RESOLVED}->${S.REOPENED}`]: Object.freeze({
    id: 'T6',
    actors: ['member', 'lead', 'admin'],
  }),
  [`${S.CLOSED}->${S.REOPENED}`]: Object.freeze({
    id: 'T7',
    actors: ['lead', 'admin'],
  }),
  [`${S.REOPENED}->${S.IN_PROGRESS}`]: Object.freeze({
    id: 'T8',
    actors: ['assignee', 'lead', 'admin'],
    requiresAssignee: true,
    autoClaim: true,
  }),
});

/** @returns {object|null} the transition rule, or null when the transition is invalid. */
function getTransition(fromStatus, toStatus) {
  return TRANSITIONS[`${fromStatus}->${toStatus}`] || null;
}

/** @returns {string[]} statuses reachable from `fromStatus`. */
function allowedTargets(fromStatus) {
  return Object.keys(TRANSITIONS)
    .filter((k) => k.startsWith(`${fromStatus}->`))
    .map((k) => k.split('->')[1]);
}

/** Statuses in which an issue must always have an assignee (Phase 1 T1/T8 invariant). */
const STATUSES_REQUIRING_ASSIGNEE = Object.freeze([S.IN_PROGRESS]);

module.exports = { TRANSITIONS, getTransition, allowedTargets, STATUSES_REQUIRING_ASSIGNEE };
