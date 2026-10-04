'use strict';

const mongoose = require('mongoose');
const { connectDatabase, disconnectDatabase } = require('../src/config/database');
const { User, Project, Counter, Issue, Comment, Activity, RefreshToken } = require('../src/models');
const { hashPassword } = require('../src/services/authService');
const { USER_ROLES, USER_STATUSES, PROJECT_ROLES, ISSUE_TYPES, ISSUE_PRIORITIES, ISSUE_STATUSES } = require('../src/config/constants');
const logger = require('../src/utils/logger');

async function seed(options = {}) {
  const shouldReset = options.reset || process.argv.includes('--reset');

  try {
    logger.info('Connecting to database for seeding...');
    await connectDatabase();

    if (shouldReset) {
      logger.warn('Resetting existing database collections...');
      await Promise.all([
        User.deleteMany({}),
        Project.deleteMany({}),
        Counter.deleteMany({}),
        Issue.deleteMany({}),
        Comment.deleteMany({}),
        Activity.deleteMany({}),
        RefreshToken.deleteMany({}),
      ]);
      logger.info('Collections wiped.');
    }

    const defaultPassword = 'Password123!';
    const passwordHash = await hashPassword(defaultPassword);

    logger.info('Creating standard role seed users...');
    const admin = await User.findOneAndUpdate(
      { email: 'admin@devsupport.local' },
      {
        $setOnInsert: {
          name: 'System Admin',
          email: 'admin@devsupport.local',
          passwordHash,
          role: USER_ROLES.ADMIN,
          status: USER_STATUSES.ACTIVE,
        },
      },
      { upsert: true, new: true },
    );

    const lead = await User.findOneAndUpdate(
      { email: 'lead@devsupport.local' },
      {
        $setOnInsert: {
          name: 'Sarah Team Lead',
          email: 'lead@devsupport.local',
          passwordHash,
          role: USER_ROLES.TEAM_LEAD,
          status: USER_STATUSES.ACTIVE,
        },
      },
      { upsert: true, new: true },
    );

    const dev = await User.findOneAndUpdate(
      { email: 'dev@devsupport.local' },
      {
        $setOnInsert: {
          name: 'Alex Developer',
          email: 'dev@devsupport.local',
          passwordHash,
          role: USER_ROLES.DEVELOPER,
          status: USER_STATUSES.ACTIVE,
        },
      },
      { upsert: true, new: true },
    );

    logger.info('Seeding sample project...');
    const project = await Project.findOneAndUpdate(
      { key: 'DEV' },
      {
        $setOnInsert: {
          name: 'Core Platform Engine',
          key: 'DEV',
          description: 'DevSupport core platform bug and incident management project.',
          ownerId: lead._id,
          members: [
            { userId: lead._id, projectRole: PROJECT_ROLES.LEAD, joinedAt: new Date() },
            { userId: dev._id, projectRole: PROJECT_ROLES.DEVELOPER, joinedAt: new Date() },
          ],
        },
      },
      { upsert: true, new: true },
    );

    logger.info('Initializing project sequence counter...');
    await Counter.findOneAndUpdate(
      { _id: Counter.counterIdFor(project._id) },
      { $setOnInsert: { projectId: project._id, seq: 1 } },
      { upsert: true, new: true },
    );

    logger.info('Seeding sample baseline issue...');
    await Issue.findOneAndUpdate(
      { key: 'DEV-1' },
      {
        $setOnInsert: {
          key: 'DEV-1',
          issueNumber: 1,
          projectId: project._id,
          title: 'Initialize application database schema and connection',
          description: 'Setup Node.js Express backend with MongoDB and Mongoose collections.',
          type: ISSUE_TYPES.TASK,
          priority: ISSUE_PRIORITIES.HIGH,
          status: ISSUE_STATUSES.OPEN,
          reporterId: lead._id,
          assigneeId: dev._id,
        },
      },
      { upsert: true, new: true },
    );

    logger.info('Database seeded successfully!');
    logger.info(`Credentials:
  Admin: admin@devsupport.local / ${defaultPassword}
  Lead:  lead@devsupport.local / ${defaultPassword}
  Dev:   dev@devsupport.local / ${defaultPassword}`);
  } catch (err) {
    logger.error('Seeding failed:', err);
    throw err;
  } finally {
    await disconnectDatabase();
  }
}

if (require.main === module) {
  seed().catch(() => process.exit(1));
}

module.exports = seed;
