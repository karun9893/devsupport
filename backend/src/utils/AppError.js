'use strict';

/**
 * Operational (expected) error carrying an HTTP status and a stable,
 * machine-readable error code (Phase 1 §12 error envelope).
 */
class AppError extends Error {
  /**
   * @param {number} statusCode
   * @param {string} code - stable UPPER_SNAKE_CASE identifier
   * @param {string} message - safe, client-facing message
   * @param {object|Array} [details]
   */
  constructor(statusCode, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.code = code;
    this.details = details === undefined ? [] : details;
    this.isOperational = true;
  }

  static badRequest(code, message, details) {
    return new AppError(400, code, message, details);
  }

  static unauthorized(code, message) {
    return new AppError(401, code, message);
  }

  static forbidden(code, message) {
    return new AppError(403, code, message);
  }

  static notFound(code, message) {
    return new AppError(404, code, message);
  }

  static conflict(code, message, details) {
    return new AppError(409, code, message, details);
  }

  static unprocessable(code, message, details) {
    return new AppError(422, code, message, details);
  }
}

module.exports = AppError;
