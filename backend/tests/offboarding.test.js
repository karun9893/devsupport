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
  OFFBOARDING_STRATEGIES,
} = require('../src/config/constants');
const { createIssue } = require('../src/services/issueService');
const { removeMember } = require('../src/services/projectService');

describe('Member Offboarding Engine', () => {
  beforeAll(async () => {
    await setupTestDb();
  }, 60000);

  afterAll(async () => {
    await teardownTestDb();
  });

  afterEach(async () => {
    await clearTestDb();
  });

  it('blocks member removal with 400 when member has active assigned issues', async () => {
    const lead = await User.create({
      name: 'Lead Bob',
      email: 'bob@example.com',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.TEAM_LEAD,
    });
    const dev = await User.create({
      name: 'Dev Charlie',
      email: 'charlie@example.com',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.DEVELOPER,
    });

    const project = await Project.create({
      name: 'Mobile Core',
      key: 'MOB',
      ownerId: lead._id,
      members: [
        { userId: lead._id, projectRole: PROJECT_ROLES.LEAD },
        { userId: dev._id, projectRole: PROJECT_ROLES.DEVELOPER },
      ],
    });

    const actor = { id: String(lead._id), role: lead.role };

    // Create active issue assigned to dev
    const issue = await createIssue(actor, project._id, {
      title: 'Fix mobile crash on splash',
      description: 'Crashes on iOS 17 device startup.',
      type: ISSUE_TYPES.BUG,
      priority: ISSUE_PRIORITIES.HIGH,
      assigneeId: dev._id,
    });

    // Attempt removal without strategy
    await expect(removeMember(actor, project._id, dev._id)).rejects.toMatchObject({
      statusCode: 400,
      code: 'MEMBER_HAS_ACTIVE_ISSUES',
      details: expect.objectContaining({
        activeCount: 1,
        blockingIssues: expect.arrayContaining([
          expect.objectContaining({ id: String(issue._id), key: issue.key }),
        ]),
      }),
    });
  });

  it('atomically unassigns active issues when strategy="unassign" is provided', async () => {
    const lead = await User.create({
      name: 'Lead Bob',
      email: 'bob2@example.com',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.TEAM_LEAD,
    });
    const dev = await User.create({
      name: 'Dev Charlie',
      email: 'charlie2@example.com',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.DEVELOPER,
    });

    const project = await Project.create({
      name: 'Mobile Core 2',
      key: 'MOB2',
      ownerId: lead._id,
      members: [
        { userId: lead._id, projectRole: PROJECT_ROLES.LEAD },
        { userId: dev._id, projectRole: PROJECT_ROLES.DEVELOPER },
      ],
    });

    const actor = { id: String(lead._id), role: lead.role };

    const issue = await createIssue(actor, project._id, {
      title: 'Fix mobile crash on splash 2',
      description: 'Crashes on iOS 17 device startup.',
      type: ISSUE_TYPES.BUG,
      priority: ISSUE_PRIORITIES.HIGH,
      assigneeId: dev._id,
    });

    const result = await removeMember(actor, project._id, dev._id, {
      strategy: OFFBOARDING_STRATEGIES.UNASSIGN,
    });

    expect(result.removedUserId).toBe(String(dev._id));

    // Verify issue is unassigned
    const updatedIssue = await Issue.findById(issue._id);
    expect(updatedIssue.assigneeId).toBeNull();

    // Verify audit record emitted
    const audit = await Activity.findOne({
      entityId: issue._id,
      actionType: ACTIVITY_ACTIONS.ASSIGNEE_CHANGED,
    });
    expect(audit).not.toBeNull();
    expect(audit.details.oldValue).toBe(String(dev._id));
    expect(audit.details.newValue).toBeNull();
  });

  it('succeeds directly when member has no active assigned issues (Case 1)', async () => {
    const lead = await User.create({
      name: 'Lead Dave',
      email: 'dave@example.com',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.TEAM_LEAD,
    });
    const dev = await User.create({
      name: 'Dev Emma',
      email: 'emma@example.com',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.DEVELOPER,
    });

    const project = await Project.create({
      name: 'Clean Proj',
      key: 'CLN',
      ownerId: lead._id,
      members: [
        { userId: lead._id, projectRole: PROJECT_ROLES.LEAD },
        { userId: dev._id, projectRole: PROJECT_ROLES.DEVELOPER },
      ],
    });

    const actor = { id: String(lead._id), role: lead.role };
    const res = await removeMember(actor, project._id, dev._id);
    expect(res.removedUserId).toBe(String(dev._id));

    const updated = await Project.findById(project._id);
    expect(updated.findMember(dev._id)).toBeNull();
  });

  it('atomically transfers active issues when strategy="transfer" is provided (Case 4)', async () => {
    const lead = await User.create({
      name: 'Lead Frank',
      email: 'frank@example.com',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.TEAM_LEAD,
    });
    const devA = await User.create({
      name: 'Dev Greg',
      email: 'greg@example.com',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.DEVELOPER,
    });
    const devB = await User.create({
      name: 'Dev Helen',
      email: 'helen@example.com',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.DEVELOPER,
    });

    const project = await Project.create({
      name: 'Transfer Proj',
      key: 'TRN',
      ownerId: lead._id,
      members: [
        { userId: lead._id, projectRole: PROJECT_ROLES.LEAD },
        { userId: devA._id, projectRole: PROJECT_ROLES.DEVELOPER },
        { userId: devB._id, projectRole: PROJECT_ROLES.DEVELOPER },
      ],
    });

    const actor = { id: String(lead._id), role: lead.role };
    const issue = await createIssue(actor, project._id, {
      title: 'Transferable issue',
      description: 'Will be transferred from Greg to Helen.',
      type: ISSUE_TYPES.BUG,
      assigneeId: devA._id,
    });

    const res = await removeMember(actor, project._id, devA._id, {
      strategy: OFFBOARDING_STRATEGIES.TRANSFER,
      transferToUserId: devB._id,
    });

    expect(res.removedUserId).toBe(String(devA._id));

    const updatedIssue = await Issue.findById(issue._id);
    expect(String(updatedIssue.assigneeId)).toBe(String(devB._id));
  });

  it('rejects transfer when transfer target is not an enrolled member (Case 5)', async () => {
    const lead = await User.create({
      name: 'Lead Ian',
      email: 'ian@example.com',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.TEAM_LEAD,
    });
    const dev = await User.create({
      name: 'Dev Jack',
      email: 'jack@example.com',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.DEVELOPER,
    });
    const outsider = await User.create({
      name: 'Dev NonMember',
      email: 'nonmember@example.com',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.DEVELOPER,
    });

    const project = await Project.create({
      name: 'Bad Target Proj',
      key: 'BAD',
      ownerId: lead._id,
      members: [
        { userId: lead._id, projectRole: PROJECT_ROLES.LEAD },
        { userId: dev._id, projectRole: PROJECT_ROLES.DEVELOPER },
      ],
    });

    const actor = { id: String(lead._id), role: lead.role };
    await createIssue(actor, project._id, {
      title: 'Issue to transfer',
      description: 'Cannot transfer to outsider.',
      type: ISSUE_TYPES.TASK,
      assigneeId: dev._id,
    });

    await expect(
      removeMember(actor, project._id, dev._id, {
        strategy: OFFBOARDING_STRATEGIES.TRANSFER,
        transferToUserId: outsider._id,
      }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: 'INVALID_TRANSFER_TARGET',
    });
  });
});
