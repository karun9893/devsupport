'use strict';

const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const { authenticate, authorizeRoles } = require('../middleware/auth');
const { USER_ROLES } = require('../config/constants');

// All user routes require authentication
router.use(authenticate);

// GET /api/v1/users - Authenticated users can list active users; Admin can list all
router.get('/', userController.listUsers);

// PATCH /api/v1/users/:userId/status - Admin only
router.patch('/:userId/status', authorizeRoles(USER_ROLES.ADMIN), userController.updateUserStatus);

module.exports = router;
