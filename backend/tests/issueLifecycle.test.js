'use strict';

const { setupTestDb, teardownTestDb, clearTestDb } = require('./setup');
const { User, Project, Issue, Activity } = require('../src/models');
const {
  USER_ROLES,
  PROJECT_ROLES,
  ISSUE_TYPES,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
  ACTIVITY_ACTIONS,
} = require('../src/config/constants');
const {
  createIssue,
  assignIssue,
  transitionIssue,
  changePriority,
  getIssue,
} = require('../src/services/issueService');

describe('Issue Lifecycle, State Machine & Optimistic Concurrency', () => {
  let lead, dev1, dev2, outsider, admin;
  let project;
  let leadActor, dev1Actor, dev2Actor, outsiderActor, adminActor;

  beforeAll(async () => {
    await setupTestDb();
  }, 60000);

  afterAll(async () => {
    await teardownTestDb();
  });

  afterEach(async () => {
    await clearTestDb();
  });

  beforeEach(async () => {
    lead = await User.create({
      name: 'Team Lead Sarah',
      email: 'lead@devsupport.local',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.TEAM_LEAD,
    });
    dev1 = await User.create({
      name: 'Dev Alex',
      email: 'dev1@devsupport.local',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.DEVELOPER,
    });
    dev2 = await User.create({
      name: 'Dev Bob',
      email: 'dev2@devsupport.local',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.DEVELOPER,
    });
    outsider = await User.create({
      name: 'Dev Outsider',
      email: 'outsider@devsupport.local',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.DEVELOPER,
    });
    admin = await User.create({
      name: 'System Admin',
      email: 'admin@devsupport.local',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.ADMIN,
    });

    project = await Project.create({
      name: 'Core Platform',
      key: 'CORE',
      ownerId: lead._id,
      members: [
        { userId: lead._id, projectRole: PROJECT_ROLES.LEAD },
        { userId: dev1._id, projectRole: PROJECT_ROLES.DEVELOPER },
        { userId: dev2._id, projectRole: PROJECT_ROLES.DEVELOPER },
      ],
    });

    leadActor = { id: String(lead._id), role: lead.role };
    dev1Actor = { id: String(dev1._id), role: dev1.role };
    dev2Actor = { id: String(dev2._id), role: dev2.role };
    outsiderActor = { id: String(outsider._id), role: outsider.role };
    adminActor = { id: String(admin._id), role: admin.role };
  });

  describe('Section 6: Issue Creation & Validation', () => {
    it('creates an issue with default Medium priority and Open status', async () => {
      const issue = await createIssue(dev1Actor, project._id, {
        title: 'Crash on user registration',
        description: 'Steps to reproduce: submit form without nickname.',
        type: ISSUE_TYPES.BUG,
      });

      expect(issue.key).toBe('CORE-1');
      expect(issue.issueNumber).toBe(1);
      expect(issue.status).toBe(ISSUE_STATUSES.OPEN);
      expect(issue.priority).toBe(ISSUE_PRIORITIES.MEDIUM);
      expect(issue.version).toBe(0);
      expect(issue.assigneeId).toBeNull();
    });

    it('rejects creation from non-enrolled user with 404 (preventing probing)', async () => {
      await expect(
        createIssue(outsiderActor, project._id, {
          title: 'Unauthorized issue',
          description: 'Should never be created.',
          type: ISSUE_TYPES.BUG,
        }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: 'PROJECT_NOT_FOUND',
      });
    });

    it('prevents developers from assigning to other users upon creation', async () => {
      await expect(
        createIssue(dev1Actor, project._id, {
          title: 'Dev assigning to someone else',
          description: 'Developer trying to delegate work.',
          type: ISSUE_TYPES.TASK,
          assigneeId: dev2._id,
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'ASSIGNMENT_FORBIDDEN',
      });
    });
  });

  describe('Section 7 & 8: Issue Lifecycle Transitions (T1 - T8)', () => {
    it('executes full happy path: Open -> In_Progress -> Resolved -> Closed', async () => {
      // 1. Create issue
      const issue = await createIssue(leadActor, project._id, {
        title: 'Implement search feature',
        description: 'Full text search using MongoDB indexes.',
        type: ISSUE_TYPES.FEATURE,
      });

      // 2. Open -> In_Progress (T1: auto-claim by dev1)
      const inProgress = await transitionIssue(dev1Actor, issue._id, {
        toStatus: ISSUE_STATUSES.IN_PROGRESS,
      });
      expect(inProgress.status).toBe(ISSUE_STATUSES.IN_PROGRESS);
      expect(String(inProgress.assigneeId)).toBe(String(dev1._id));
      expect(inProgress.version).toBe(1);

      // 3. In_Progress -> Resolved (T3 by dev1)
      const resolved = await transitionIssue(dev1Actor, issue._id, {
        toStatus: ISSUE_STATUSES.RESOLVED,
      });
      expect(resolved.status).toBe(ISSUE_STATUSES.RESOLVED);
      expect(resolved.version).toBe(2);

      // 4. Developer CANNOT close the issue directly (Phase 1 §6.3 / T4 invariant)
      await expect(
        transitionIssue(dev1Actor, issue._id, {
          toStatus: ISSUE_STATUSES.CLOSED,
        }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'TRANSITION_FORBIDDEN',
      });

      // 5. Team Lead verifies and closes the issue (T4)
      const closed = await transitionIssue(leadActor, issue._id, {
        toStatus: ISSUE_STATUSES.CLOSED,
      });
      expect(closed.status).toBe(ISSUE_STATUSES.CLOSED);
      expect(closed.version).toBe(3);
    });

    it('reopens closed issue (T7) and verification-failed issue (T6)', async () => {
      const issue = await createIssue(leadActor, project._id, {
        title: 'Fix edge case in auth token expiration',
        description: 'Investigate token TTL behavior.',
        type: ISSUE_TYPES.BUG,
        assigneeId: dev1._id,
      });

      // Move to In_Progress -> Resolved
      await transitionIssue(dev1Actor, issue._id, { toStatus: ISSUE_STATUSES.IN_PROGRESS });
      await transitionIssue(dev1Actor, issue._id, { toStatus: ISSUE_STATUSES.RESOLVED });

      // T6: Verification failed in test/staging -> Reopened
      const reopenedFromResolved = await transitionIssue(dev2Actor, issue._id, {
        toStatus: ISSUE_STATUSES.REOPENED,
      });
      expect(reopenedFromResolved.status).toBe(ISSUE_STATUSES.REOPENED);

      // T8: Resume work on Reopened
      await transitionIssue(dev1Actor, issue._id, { toStatus: ISSUE_STATUSES.IN_PROGRESS });
      await transitionIssue(dev1Actor, issue._id, { toStatus: ISSUE_STATUSES.RESOLVED });
      await transitionIssue(leadActor, issue._id, { toStatus: ISSUE_STATUSES.CLOSED });

      // T7: Production regression on Closed issue (Lead only)
      await expect(
        transitionIssue(dev1Actor, issue._id, { toStatus: ISSUE_STATUSES.REOPENED }),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: 'TRANSITION_FORBIDDEN',
      });

      const reopenedFromClosed = await transitionIssue(leadActor, issue._id, {
        toStatus: ISSUE_STATUSES.REOPENED,
      });
      expect(reopenedFromClosed.status).toBe(ISSUE_STATUSES.REOPENED);
    });

    it('requires a reason when relinquishing (In_Progress -> Open, T2) or discarding (Open -> Closed, T5)', async () => {
      const issue = await createIssue(leadActor, project._id, {
        title: 'Task requiring reason',
        description: 'Detailed description.',
        type: ISSUE_TYPES.TASK,
      });

      // Move to In_Progress
      await transitionIssue(dev1Actor, issue._id, { toStatus: ISSUE_STATUSES.IN_PROGRESS });

      // Attempt T2 without reason
      await expect(
        transitionIssue(dev1Actor, issue._id, { toStatus: ISSUE_STATUSES.OPEN }),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'REASON_REQUIRED',
      });

      // Provide valid reason
      const reverted = await transitionIssue(dev1Actor, issue._id, {
        toStatus: ISSUE_STATUSES.OPEN,
        reason: 'Blocked by external API dependency.',
      });
      expect(reverted.status).toBe(ISSUE_STATUSES.OPEN);

      // Attempt T5 without reason (Lead only)
      await expect(
        transitionIssue(leadActor, issue._id, { toStatus: ISSUE_STATUSES.CLOSED }),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'REASON_REQUIRED',
      });

      // Provide reason for discarding duplicate/won't fix
      const discarded = await transitionIssue(leadActor, issue._id, {
        toStatus: ISSUE_STATUSES.CLOSED,
        reason: 'Duplicate of ticket CORE-99.',
      });
      expect(discarded.status).toBe(ISSUE_STATUSES.CLOSED);
    });

    it('rejects invalid state machine transitions with 422', async () => {
      const issue = await createIssue(leadActor, project._id, {
        title: 'Invalid transition test',
        description: 'Checking state machine rejection.',
        type: ISSUE_TYPES.TASK,
      });

      // Cannot jump from Open directly to Resolved
      await expect(
        transitionIssue(leadActor, issue._id, { toStatus: ISSUE_STATUSES.RESOLVED }),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: 'INVALID_STATUS_TRANSITION',
      });
    });
  });

  describe('Section 8: Optimistic Concurrency Control (OCC)', () => {
    it('detects concurrent modifications and returns 409 Conflict when version is stale', async () => {
      const issue = await createIssue(leadActor, project._id, {
        title: 'Concurrent editing ticket',
        description: 'Testing OCC version checks.',
        type: ISSUE_TYPES.TASK,
      });

      // Both Client A and Client B read the issue at version 0
      const initialVersion = issue.version;
      expect(initialVersion).toBe(0);

      // Client A updates successfully -> version becomes 1
      const clientAUpdate = await transitionIssue(dev1Actor, issue._id, {
        toStatus: ISSUE_STATUSES.IN_PROGRESS,
        expectedVersion: 0,
      });
      expect(clientAUpdate.version).toBe(1);

      // Client B attempts to update with stale expectedVersion 0
      await expect(
        transitionIssue(dev2Actor, issue._id, {
          toStatus: ISSUE_STATUSES.OPEN,
          expectedVersion: 0,
          reason: 'Attempting to change status with stale version',
        }),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: 'VERSION_CONFLICT',
      });

      // Verify the issue state remains what Client A set
      const currentIssue = await getIssue(leadActor, issue._id);
      expect(currentIssue.version).toBe(1);
      expect(currentIssue.status).toBe(ISSUE_STATUSES.IN_PROGRESS);
    });
  });
});
