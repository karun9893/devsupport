'use strict';

const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const env = require('../config/env');

/**
 * Global centralized error handling middleware.
 * Enforces standardized JSON error envelope per Phase 1 §12 / Phase 2.
 */
function errorHandler(err, req, res, next) {
  // If response headers already sent, delegate to Express default handler
  if (res.headersSent) {
    return next(err);
  }

  let statusCode = 500;
  let code = 'INTERNAL_SERVER_ERROR';
  let message = 'An unexpected internal server error occurred.';
  let details = [];

  // 1. Handled Operational Errors
  if (err instanceof AppError || err.isOperational) {
    statusCode = err.statusCode || 500;
    code = err.code || 'OPERATIONAL_ERROR';
    message = err.message;
    details = err.details || [];
  }
  // 2. Mongoose / MongoDB Duplicate Key Error (E11000)
  else if (err.code === 11000) {
    statusCode = 409;
    code = 'DUPLICATE_RESOURCE';
    const field = Object.keys(err.keyPattern || err.keyValue || {})[0] || 'field';
    message = `A resource with this ${field} already exists.`;
    details = [{ field, value: err.keyValue ? err.keyValue[field] : undefined }];
  }
  // 3. Mongoose Validation Errors
  else if (err.name === 'ValidationError') {
    statusCode = 422;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed for one or more fields.';
    details = Object.keys(err.errors || {}).map((path) => ({
      field: path,
      message: err.errors[path].message,
    }));
  }
  // 4. Mongoose CastError (e.g., malformed ObjectId)
  else if (err.name === 'CastError') {
    statusCode = 400;
    code = 'INVALID_IDENTIFIER';
    message = `Invalid value for ${err.path}: ${err.value}`;
  }
  // 5. Append-Only Audit Violation
  else if (err.name === 'AppendOnlyViolationError' || err.code === 'APPEND_ONLY_VIOLATION') {
    statusCode = 403;
    code = 'APPEND_ONLY_VIOLATION';
    message = err.message;
  }
  // 6. JWT Errors
  else if (err.name === 'JsonWebTokenError') {
    statusCode = 401;
    code = 'INVALID_ACCESS_TOKEN';
    message = 'Access token is malformed or invalid.';
  } else if (err.name === 'TokenExpiredError') {
    statusCode = 401;
    code = 'ACCESS_TOKEN_EXPIRED';
    message = 'Access token has expired.';
  }
  // 7. Generic / Programming / Unhandled Errors
  else {
    logger.error('Unhandled Server Exception', err);
    if (!env.isProduction) {
      details = [{ stack: err.stack, originalMessage: err.message }];
    }
  }

  return res.status(statusCode).json({
    success: false,
    error: {
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
    },
  });
}

module.exports = errorHandler;
