'use strict';

const express = require('express');
const router = express.Router();
const commentController = require('../controllers/commentController');
const { authenticate } = require('../middleware/auth');

// All comment routes require authentication
router.use(authenticate);

// Comment modification and deletion
router.patch('/:commentId', commentController.editComment);
router.delete('/:commentId', commentController.deleteComment);

module.exports = router;
