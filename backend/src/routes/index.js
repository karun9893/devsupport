'use strict';

const express = require('express');
const createAuthRouter = require('./authRoutes');
const userRoutes = require('./userRoutes');
const projectRoutes = require('./projectRoutes');
const issueRoutes = require('./issueRoutes');
const commentRoutes = require('./commentRoutes');

module.exports = function createApiRouter(authLimiter) {
  const router = express.Router();

  // Root API info endpoint
  router.get('/', (req, res) => {
    res.status(200).json({
      name: 'DevSupport API',
      version: '1.0.0',
      phase: 'Phase 4: REST API Implementation',
    });
  });

  // Resource routers
  router.use('/auth', createAuthRouter(authLimiter));
  router.use('/users', userRoutes);
  router.use('/projects', projectRoutes);
  router.use('/issues', issueRoutes);
  router.use('/comments', commentRoutes);

  return router;
};
