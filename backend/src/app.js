'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const errorHandler = require('./middleware/errorHandler');
const AppError = require('./utils/AppError');
const { isDatabaseConnected } = require('./config/database');

const app = express();

// Security HTTP headers
app.use(helmet());

// CORS configuration
app.use(
  cors({
    origin: env.corsOrigin,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);

// Body parser
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// Auth rate limiter for brute-force protection
const authLimiter = env.isTest
  ? (req, res, next) => next()
  : rateLimit({
      windowMs: env.authRateLimit.windowMs,
      max: env.authRateLimit.max,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (req, res, next) => {
        next(
          AppError.badRequest(
            'RATE_LIMIT_EXCEEDED',
            'Too many authentication attempts. Please try again after 15 minutes.',
          ),
        );
      },
    });

// Liveness / Health check
app.get('/health', (req, res) => {
  const dbStatus = isDatabaseConnected() ? 'connected' : 'disconnected';
  res.status(200).json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    database: dbStatus,
  });
});

// Root API information endpoint & routes
const createApiRouter = require('./routes');
app.use('/api/v1', createApiRouter(authLimiter));

// 404 Route Not Found Catch-all
app.use((req, res, next) => {
  next(AppError.notFound('ROUTE_NOT_FOUND', `Cannot ${req.method} ${req.originalUrl}`));
});

// Centralized error handling
app.use(errorHandler);

module.exports = app;
module.exports.authLimiter = authLimiter;
