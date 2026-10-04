'use strict';

const { setupTestDb, teardownTestDb, clearTestDb } = require('./setup');
const { User, Project } = require('../src/models');
const { USER_ROLES, PROJECT_ROLES, ISSUE_TYPES, ISSUE_PRIORITIES } = require('../src/config/constants');
const { createIssue } = require('../src/services/issueService');

describe('Issue Atomic Numbering & Concurrency', () => {
  beforeAll(async () => {
    await setupTestDb();
  }, 60000);

  afterAll(async () => {
    await teardownTestDb();
  });

  afterEach(async () => {
    await clearTestDb();
  });

  it('generates sequential Jira-style keys DEV-1, DEV-2 under concurrent load without collision', async () => {
    const lead = await User.create({
      name: 'Lead Alice',
      email: 'alice@example.com',
      passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      role: USER_ROLES.TEAM_LEAD,
    });

    const project = await Project.create({
      name: 'Core Engine',
      key: 'DEV',
      ownerId: lead._id,
      members: [{ userId: lead._id, projectRole: PROJECT_ROLES.LEAD }],
    });

    const actor = { id: String(lead._id), role: lead.role };

    // Concurrently create 10 issues
    const promises = Array.from({ length: 10 }).map((_, idx) =>
      createIssue(actor, project._id, {
        title: `Concurrent Issue #${idx + 1}`,
        description: `Description for issue #${idx + 1} with required length.`,
        type: ISSUE_TYPES.TASK,
        priority: ISSUE_PRIORITIES.MEDIUM,
      }),
    );

    const createdIssues = await Promise.all(promises);

    const keys = createdIssues.map((i) => i.key);
    const uniqueKeys = new Set(keys);

    expect(keys.length).toBe(10);
    expect(uniqueKeys.size).toBe(10);

    const issueNumbers = createdIssues.map((i) => i.issueNumber).sort((a, b) => a - b);
    expect(issueNumbers).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });
});
