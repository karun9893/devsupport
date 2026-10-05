'use strict';

const express = require('express');
const router = express.Router();
const projectController = require('../controllers/projectController');
const issueController = require('../controllers/issueController');
const activityController = require('../controllers/activityController');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { USER_ROLES } = require('../config/constants');

// All project routes require authentication
router.use(authenticate);

// Project management
router.post('/', authorizeRoles(USER_ROLES.ADMIN, USER_ROLES.TEAM_LEAD), projectController.createProject);
router.get('/', projectController.listProjects);
router.get('/:projectId', projectController.getProject);
router.post('/:projectId/archive', projectController.archiveProject);

// Member management
router.post('/:projectId/members', projectController.addMember);
router.delete('/:projectId/members/:userId', projectController.removeMember);

// Project-scoped issues
router.post('/:projectId/issues', issueController.createIssue);
router.get('/:projectId/issues', issueController.listProjectIssues);

// Project-wide activity
router.get('/:projectId/activity', activityController.getProjectActivity);

module.exports = router;
