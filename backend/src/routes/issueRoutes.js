'use strict';

const express = require('express');
const router = express.Router();
const issueController = require('../controllers/issueController');
const commentController = require('../controllers/commentController');
const activityController = require('../controllers/activityController');
const { authenticate } = require('../middleware/auth');

// All issue routes require authentication
router.use(authenticate);

// Single issue access & mutations
router.get('/:issueId', issueController.getIssue);
router.post('/:issueId/transitions', issueController.transitionIssue);
router.put('/:issueId/assignee', issueController.assignIssue);
router.patch('/:issueId/priority', issueController.changePriority);

// Comments on issue
router.post('/:issueId/comments', commentController.addComment);
router.get('/:issueId/comments', commentController.listComments);

// Activity timeline for issue
router.get('/:issueId/activity', activityController.getIssueActivity);

module.exports = router;
