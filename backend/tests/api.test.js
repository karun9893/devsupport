'use strict';

const request = require('supertest');
const app = require('../src/app');
const { setupTestDb, teardownTestDb, clearTestDb } = require('./setup');
const { User, Project, Issue, Comment, Activity, RefreshToken } = require('../src/models');
const { USER_ROLES, PROJECT_ROLES } = require('../src/config/constants');
const authService = require('../src/services/authService');

describe('DevSupport Phase 4 — REST API Integration Tests', () => {
  beforeAll(async () => {
    await setupTestDb();
  }, 60000);

  afterAll(async () => {
    await teardownTestDb();
  });

  beforeEach(async () => {
    await clearTestDb();
  });

  describe('API Root & Health Checks', () => {
    test('GET /health returns 200 with db status ok', async () => {
      const res = await request(app).get('/health');
      expect(res.status).toBe(200);
      expect(res.body.status).toBe('ok');
      expect(res.body.database).toBe('connected');
    });

    test('GET /api/v1 returns 200 with API metadata', async () => {
      const res = await request(app).get('/api/v1');
      expect(res.status).toBe(200);
      expect(res.body.name).toBe('DevSupport API');
      expect(res.body.phase).toContain('Phase 4');
    });

    test('404 catch-all handles undefined routes with canonical envelope', async () => {
      const res = await request(app).get('/api/v1/unknown-endpoint');
      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('ROUTE_NOT_FOUND');
    });
  });

  describe('Authentication Endpoints (/api/v1/auth)', () => {
    test('POST /api/v1/auth/register creates Developer and returns 201', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'Password123!',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.email).toBe('jane@example.com');
      expect(res.body.data.role).toBe(USER_ROLES.DEVELOPER);
      expect(res.body.data.status).toBe('Active');
    });

    test('POST /api/v1/auth/register fails on duplicate email with 409', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'Password123!',
        });

      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Clone',
          email: 'JANE@example.com',
          password: 'Password123!',
        });

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    test('POST /api/v1/auth/login succeeds with valid credentials', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'Password123!',
        });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'jane@example.com',
          password: 'Password123!',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.accessToken).toBeDefined();
      expect(res.body.data.refreshToken).toBeDefined();
      expect(res.body.data.tokenType).toBe('Bearer');
      expect(res.body.data.user.email).toBe('jane@example.com');
    });

    test('POST /api/v1/auth/login returns 401 on wrong password', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'Password123!',
        });

      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'jane@example.com',
          password: 'WrongPassword123!',
        });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
    });

    test('POST /api/v1/auth/refresh rotates token pair', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'Password123!',
        });

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'jane@example.com',
          password: 'Password123!',
        });

      const refreshToken = loginRes.body.data.refreshToken;

      const refreshRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(refreshRes.status).toBe(200);
      expect(refreshRes.body.success).toBe(true);
      expect(refreshRes.body.data.accessToken).toBeDefined();
      expect(refreshRes.body.data.refreshToken).toBeDefined();
      expect(refreshRes.body.data.refreshToken).not.toBe(refreshToken);
    });

    test('POST /api/v1/auth/logout and reuse detection', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'Password123!',
        });

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'jane@example.com',
          password: 'Password123!',
        });

      const refreshToken = loginRes.body.data.refreshToken;

      const logoutRes = await request(app)
        .post('/api/v1/auth/logout')
        .send({ refreshToken });

      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);

      // Attempting to refresh with revoked token should trigger reuse detection
      const reuseRes = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expect(reuseRes.status).toBe(401);
      expect(reuseRes.body.error.code).toBe('REFRESH_TOKEN_REUSE_DETECTED');
    });

    test('GET /api/v1/auth/me returns current user profile', async () => {
      await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'Password123!',
        });

      const loginRes = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'jane@example.com',
          password: 'Password123!',
        });

      const token = loginRes.body.data.accessToken;

      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expect(meRes.status).toBe(200);
      expect(meRes.body.success).toBe(true);
      expect(meRes.body.data.email).toBe('jane@example.com');
    });
  });

  describe('User Governance Endpoints (/api/v1/users)', () => {
    let adminToken;
    let devToken;
    let devUserId;

    beforeEach(async () => {
      // Seed Admin
      const adminPassHash = await authService.hashPassword('Admin12345!');
      const adminUser = await User.create({
        name: 'Super Admin',
        email: 'admin@devsupport.local',
        passwordHash: adminPassHash,
        role: USER_ROLES.ADMIN,
      });

      const adminLogin = await authService.login({
        email: 'admin@devsupport.local',
        password: 'Admin12345!',
      });
      adminToken = adminLogin.accessToken;

      // Seed Developer
      const devRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Bob Dev',
          email: 'bob@devsupport.local',
          password: 'Password123!',
        });
      devUserId = devRes.body.data.id;

      const devLogin = await authService.login({
        email: 'bob@devsupport.local',
        password: 'Password123!',
      });
      devToken = devLogin.accessToken;
    });

    test('GET /api/v1/users returns paginated user list', async () => {
      const res = await request(app)
        .get('/api/v1/users')
        .set('Authorization', `Bearer ${devToken}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.data)).toBe(true);
      expect(res.body.pagination).toBeDefined();
      expect(res.body.pagination.totalRecords).toBeGreaterThanOrEqual(2);
    });

    test('PATCH /api/v1/users/:userId/status suspends user when called by Admin', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${devUserId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'Suspended' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('Suspended');

      // Suspended user can no longer authenticate
      const meRes = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${devToken}`);

      expect(meRes.status).toBe(401);
      expect(meRes.body.error.code).toBe('USER_INACTIVE_OR_DELETED');
    });

    test('PATCH /api/v1/users/:userId/status fails with 403 when called by Developer', async () => {
      const res = await request(app)
        .patch(`/api/v1/users/${devUserId}/status`)
        .set('Authorization', `Bearer ${devToken}`)
        .send({ status: 'Suspended' });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
    });
  });

  describe('Project, Issue & Comment Lifecycle Flows', () => {
    let leadToken;
    let leadUserId;
    let devToken;
    let devUserId;
    let projectId;
    let issueId;

    beforeEach(async () => {
      // Create Team Lead user
      const leadHash = await authService.hashPassword('LeadPass123!');
      const leadUser = await User.create({
        name: 'Alice Lead',
        email: 'alice@devsupport.local',
        passwordHash: leadHash,
        role: USER_ROLES.TEAM_LEAD,
      });
      leadUserId = String(leadUser._id);

      const leadLogin = await authService.login({
        email: 'alice@devsupport.local',
        password: 'LeadPass123!',
      });
      leadToken = leadLogin.accessToken;

      // Create Developer user
      const devRes = await request(app)
        .post('/api/v1/auth/register')
        .send({
          name: 'Charlie Dev',
          email: 'charlie@devsupport.local',
          password: 'Password123!',
        });
      devUserId = devRes.body.data.id;

      const devLogin = await authService.login({
        email: 'charlie@devsupport.local',
        password: 'Password123!',
      });
      devToken = devLogin.accessToken;

      // Lead creates project
      const projRes = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${leadToken}`)
        .send({
          name: 'Billing Platform',
          key: 'BILL',
          description: 'Billing microservice',
        });
      projectId = projRes.body.data.id;

      // Add Charlie Dev as Developer member
      await request(app)
        .post(`/api/v1/projects/${projectId}/members`)
        .set('Authorization', `Bearer ${leadToken}`)
        .send({
          userId: devUserId,
          projectRole: PROJECT_ROLES.DEVELOPER,
        });
    });

    test('POST & GET /api/v1/projects works with access control', async () => {
      const getRes = await request(app)
        .get(`/api/v1/projects/${projectId}`)
        .set('Authorization', `Bearer ${devToken}`);

      expect(getRes.status).toBe(200);
      expect(getRes.body.data.key).toBe('BILL');
      expect(getRes.body.data.members.length).toBe(2);

      const listRes = await request(app)
        .get('/api/v1/projects')
        .set('Authorization', `Bearer ${devToken}`);

      expect(listRes.status).toBe(200);
      expect(listRes.body.data.length).toBe(1);
    });

    test('POST /api/v1/projects fails with 403 when called by Developer', async () => {
      const res = await request(app)
        .post('/api/v1/projects')
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          name: 'Rogue Project',
          key: 'ROGUE',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN_ROLE');
    });

    test('Issue creation, assignment, transition and query by key', async () => {
      // Charlie Dev creates an issue
      const issueRes = await request(app)
        .post(`/api/v1/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          title: 'Invoice calculation error',
          description: 'Discounts are calculated improperly when coupon code is applied.',
          type: 'Bug',
          priority: 'High',
        });

      expect(issueRes.status).toBe(201);
      expect(issueRes.body.data.key).toBe('BILL-1');
      expect(issueRes.body.data.status).toBe('Open');
      expect(issueRes.body.data.assigneeId).toBeNull();
      issueId = issueRes.body.data.id;

      // Query issue by Jira key
      const keyRes = await request(app)
        .get('/api/v1/issues/BILL-1')
        .set('Authorization', `Bearer ${devToken}`);

      expect(keyRes.status).toBe(200);
      expect(keyRes.body.data.id).toBe(issueId);

      // Transition T1: Open -> In_Progress (Developer claims ticket)
      const transRes = await request(app)
        .post(`/api/v1/issues/${issueId}/transitions`)
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          toStatus: 'In_Progress',
          expectedVersion: 0,
        });

      expect(transRes.status).toBe(200);
      expect(transRes.body.data.status).toBe('In_Progress');
      expect(transRes.body.data.assigneeId).toBe(devUserId);
      expect(transRes.body.data.version).toBe(1);

      // OCC conflict test: submit transition with stale version 0
      const staleRes = await request(app)
        .post(`/api/v1/issues/${issueId}/transitions`)
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          toStatus: 'Resolved',
          expectedVersion: 0,
        });

      expect(staleRes.status).toBe(409);
      expect(staleRes.body.error.code).toBe('VERSION_CONFLICT');

      // T3: In_Progress -> Resolved
      const resolvedRes = await request(app)
        .post(`/api/v1/issues/${issueId}/transitions`)
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          toStatus: 'Resolved',
          expectedVersion: 1,
        });

      expect(resolvedRes.status).toBe(200);
      expect(resolvedRes.body.data.status).toBe('Resolved');

      // T4: Developer cannot close (T4 actors are lead and admin only -> TRANSITION_FORBIDDEN)
      const devCloseRes = await request(app)
        .post(`/api/v1/issues/${issueId}/transitions`)
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          toStatus: 'Closed',
          expectedVersion: 2,
        });

      expect(devCloseRes.status).toBe(403);
      expect(devCloseRes.body.error.code).toBe('TRANSITION_FORBIDDEN');

      // T4: QA gate - Lead who is also the assignee CANNOT self-close (SELF_CLOSE_FORBIDDEN)
      // Reassign to Lead first
      await request(app)
        .put(`/api/v1/issues/${issueId}/assignee`)
        .set('Authorization', `Bearer ${leadToken}`)
        .send({
          assigneeId: leadUserId,
          expectedVersion: 2,
        });

      const leadSelfCloseRes = await request(app)
        .post(`/api/v1/issues/${issueId}/transitions`)
        .set('Authorization', `Bearer ${leadToken}`)
        .send({
          toStatus: 'Closed',
          expectedVersion: 3,
        });

      expect(leadSelfCloseRes.status).toBe(403);
      expect(leadSelfCloseRes.body.error.code).toBe('SELF_CLOSE_FORBIDDEN');

      // Reassign back to Dev, then Lead can independently close it
      await request(app)
        .put(`/api/v1/issues/${issueId}/assignee`)
        .set('Authorization', `Bearer ${leadToken}`)
        .send({
          assigneeId: devUserId,
          expectedVersion: 3,
        });

      const leadCloseRes = await request(app)
        .post(`/api/v1/issues/${issueId}/transitions`)
        .set('Authorization', `Bearer ${leadToken}`)
        .send({
          toStatus: 'Closed',
          expectedVersion: 4,
        });

      expect(leadCloseRes.status).toBe(200);
      expect(leadCloseRes.body.data.status).toBe('Closed');
    });

    test('Comment lifecycle & activity audit records', async () => {
      // Create issue first
      const issueRes = await request(app)
        .post(`/api/v1/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${leadToken}`)
        .send({
          title: 'Memory leak in worker queue',
          description: 'Worker memory grows linearly with job throughput.',
          type: 'Bug',
        });
      const currentIssueId = issueRes.body.data.id;

      // Post comment
      const commentRes = await request(app)
        .post(`/api/v1/issues/${currentIssueId}/comments`)
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          content: 'Investigated worker queue heap dumps.',
        });

      expect(commentRes.status).toBe(201);
      expect(commentRes.body.data.content).toBe('Investigated worker queue heap dumps.');
      const commentId = commentRes.body.data.id;

      // List comments
      const listCommentsRes = await request(app)
        .get(`/api/v1/issues/${currentIssueId}/comments`)
        .set('Authorization', `Bearer ${devToken}`);

      expect(listCommentsRes.status).toBe(200);
      expect(listCommentsRes.body.data.length).toBe(1);

      // Edit comment
      const editCommentRes = await request(app)
        .patch(`/api/v1/comments/${commentId}`)
        .set('Authorization', `Bearer ${devToken}`)
        .send({
          content: 'Investigated worker queue heap dumps. Confirmed closure leak.',
        });

      expect(editCommentRes.status).toBe(200);
      expect(editCommentRes.body.data.isEdited).toBe(true);

      // Delete comment
      const deleteCommentRes = await request(app)
        .delete(`/api/v1/comments/${commentId}`)
        .set('Authorization', `Bearer ${devToken}`);

      expect(deleteCommentRes.status).toBe(200);
      expect(deleteCommentRes.body.data.message).toBe('Comment deleted successfully.');

      // Check issue activity audit timeline
      const actRes = await request(app)
        .get(`/api/v1/issues/${currentIssueId}/activity`)
        .set('Authorization', `Bearer ${devToken}`);

      expect(actRes.status).toBe(200);
      expect(actRes.body.data.length).toBeGreaterThanOrEqual(4); // ISSUE_CREATED, COMMENT_ADDED, COMMENT_EDITED, COMMENT_DELETED

      // Check project-wide activity
      const projActRes = await request(app)
        .get(`/api/v1/projects/${projectId}/activity`)
        .set('Authorization', `Bearer ${leadToken}`);

      expect(projActRes.status).toBe(200);
      expect(projActRes.body.data.length).toBeGreaterThanOrEqual(4);
    });

    test('Offboarding member with active assigned issues', async () => {
      // Create issue and assign to Developer
      const issueRes = await request(app)
        .post(`/api/v1/projects/${projectId}/issues`)
        .set('Authorization', `Bearer ${leadToken}`)
        .send({
          title: 'Pending task for developer',
          description: 'This task needs resolution before offboarding.',
          type: 'Task',
          assigneeId: devUserId,
        });

      // Attempt to remove member without strategy -> blocked with 400 MEMBER_HAS_ACTIVE_ISSUES
      const blockRes = await request(app)
        .delete(`/api/v1/projects/${projectId}/members/${devUserId}`)
        .set('Authorization', `Bearer ${leadToken}`);

      expect(blockRes.status).toBe(400);
      expect(blockRes.body.error.code).toBe('MEMBER_HAS_ACTIVE_ISSUES');
      expect(blockRes.body.error.details.blockingIssues.length).toBe(1);

      // Remove with unassign strategy -> success
      const unassignRes = await request(app)
        .delete(`/api/v1/projects/${projectId}/members/${devUserId}`)
        .set('Authorization', `Bearer ${leadToken}`)
        .send({ strategy: 'unassign' });

      expect(unassignRes.status).toBe(200);
      expect(unassignRes.body.data.strategy).toBe('unassign');
      expect(unassignRes.body.data.affectedIssues.length).toBe(1);
    });
  });
});
