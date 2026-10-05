'use strict';

const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate } = require('../middleware/auth');

module.exports = function createAuthRouter(authLimiter) {
  // Public auth endpoints protected by rate limiting
  if (authLimiter) {
    router.post('/register', authLimiter, authController.register);
    router.post('/login', authLimiter, authController.login);
  } else {
    router.post('/register', authController.register);
    router.post('/login', authController.login);
  }

  router.post('/refresh', authController.refresh);
  router.post('/logout', authController.logout);

  // Protected caller identity endpoint
  router.get('/me', authenticate, authController.me);

  return router;
};
