'use strict';

const mongoose = require('mongoose');
const { setupTestDb, teardownTestDb, clearTestDb } = require('./setup');
const { User, Project, Counter, Issue, Activity, RefreshToken } = require('../src/models');
const { USER_ROLES, USER_STATUSES, PROJECT_ROLES, ISSUE_TYPES, ISSUE_PRIORITIES, ISSUE_STATUSES } = require('../src/config/constants');
const { hashPassword } = require('../src/services/authService');

describe('Mongoose Models & Schema Constraints', () => {
  beforeAll(async () => {
    await setupTestDb();
  }, 60000);

  afterAll(async () => {
    await teardownTestDb();
  });

  afterEach(async () => {
    await clearTestDb();
  });

  describe('User Model', () => {
    it('enforces case-insensitive email uniqueness', async () => {
      const hash = await hashPassword('Password123!');
      await User.create({
        name: 'User One',
        email: 'TEST@EXAMPLE.COM',
        passwordHash: hash,
        role: USER_ROLES.DEVELOPER,
      });

      await expect(
        User.create({
          name: 'User Two',
          email: 'test@example.com',
          passwordHash: hash,
          role: USER_ROLES.DEVELOPER,
        }),
      ).rejects.toThrow();
    });

    it('strips passwordHash upon JSON serialization', async () => {
      const hash = await hashPassword('Password123!');
      const user = await User.create({
        name: 'User Safe',
        email: 'safe@example.com',
        passwordHash: hash,
        role: USER_ROLES.DEVELOPER,
      });

      const json = user.toJSON();
      expect(json.passwordHash).toBeUndefined();
      expect(json.id).toBeDefined();
    });
  });

  describe('Project Model', () => {
    it('validates project key format and rejects invalid keys', async () => {
      const user = await User.create({
        name: 'Lead User',
        email: 'lead@example.com',
        passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
        role: USER_ROLES.TEAM_LEAD,
      });

      // Invalid: lower case
      await expect(
        Project.create({
          name: 'Project Lower',
          key: 'dev',
          ownerId: user._id,
          members: [{ userId: user._id, projectRole: PROJECT_ROLES.LEAD }],
        }),
      ).rejects.toThrow();

      // Valid: Uppercase alphanumeric
      const valid = await Project.create({
        name: 'Project Good',
        key: 'DEV1',
        ownerId: user._id,
        members: [{ userId: user._id, projectRole: PROJECT_ROLES.LEAD }],
      });
      expect(valid.key).toBe('DEV1');
    });

    it('requires owner to be an enrolled Lead member', async () => {
      const user = await User.create({
        name: 'Lead User',
        email: 'lead2@example.com',
        passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
        role: USER_ROLES.TEAM_LEAD,
      });

      // Owner enrolled only as Developer
      await expect(
        Project.create({
          name: 'Project Dev Only',
          key: 'DEVO',
          ownerId: user._id,
          members: [{ userId: user._id, projectRole: PROJECT_ROLES.DEVELOPER }],
        }),
      ).rejects.toThrow();
    });
  });

  describe('Activity Model (Append-Only Guard)', () => {
    it('prevents updates and deletions on audit logs', async () => {
      const user = await User.create({
        name: 'Audit User',
        email: 'audit@example.com',
        passwordHash: 'hash123456789012345678901234567890123456789012345678901234567890',
      });
      const project = await Project.create({
        name: 'Audit Proj',
        key: 'AUD',
        ownerId: user._id,
        members: [{ userId: user._id, projectRole: PROJECT_ROLES.LEAD }],
      });

      const entry = await Activity.create({
        entityType: 'Project',
        entityId: project._id,
        projectId: project._id,
        actorId: user._id,
        actionType: 'PROJECT_CREATED',
        details: { note: 'test' },
      });

      // Try updateOne
      await expect(Activity.updateOne({ _id: entry._id }, { $set: { actionType: 'HACKED' } })).rejects.toThrow(
        /append-only/i,
      );

      // Try deleteOne
      await expect(Activity.deleteOne({ _id: entry._id })).rejects.toThrow(/append-only/i);
    });
  });
});
