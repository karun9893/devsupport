'use strict';

/**
 * Common request validators for Phase 2 / Phase 3 foundation.
 */

const AppError = require('../utils/AppError');
const {
  EMAIL_REGEX,
  PASSWORD_POLICY,
  PROJECT_KEY_REGEX,
  ISSUE_TYPES,
  ISSUE_PRIORITIES,
  ISSUE_STATUSES,
} = require('../config/constants');
const { isValidObjectId } = require('../utils/objectId');

function validateEmail(email) {
  if (!email || typeof email !== 'string' || !EMAIL_REGEX.test(email.trim())) {
    throw AppError.unprocessable('INVALID_EMAIL', 'A valid email address is required.');
  }
  return email.trim().toLowerCase();
}

function validatePassword(password) {
  if (!password || typeof password !== 'string') {
    throw AppError.unprocessable('INVALID_PASSWORD', 'Password is required.');
  }
  if (password.length < PASSWORD_POLICY.MIN_LENGTH || password.length > PASSWORD_POLICY.MAX_LENGTH) {
    throw AppError.unprocessable(
      'INVALID_PASSWORD',
      `Password must be between ${PASSWORD_POLICY.MIN_LENGTH} and ${PASSWORD_POLICY.MAX_LENGTH} characters.`,
    );
  }
  // At least 1 uppercase, 1 lowercase, 1 digit, 1 special character
  const hasUpper = /[A-Z]/.test(password);
  const hasLower = /[a-z]/.test(password);
  const hasDigit = /[0-9]/.test(password);
  const hasSpecial = /[!@#$%^&*]/.test(password);

  if (!hasUpper || !hasLower || !hasDigit || !hasSpecial) {
    throw AppError.unprocessable(
      'INVALID_PASSWORD',
      'Password must contain at least 1 uppercase letter, 1 lowercase letter, 1 numeric digit, and 1 special symbol (!@#$%^&*).',
    );
  }
  return password;
}

function validateProjectKey(key) {
  if (!key || typeof key !== 'string' || !PROJECT_KEY_REGEX.test(key.trim())) {
    throw AppError.unprocessable(
      'INVALID_PROJECT_KEY',
      'Project key must be 2-10 uppercase alphanumeric characters starting with a letter (e.g. DEV, PAY).',
    );
  }
  return key.trim().toUpperCase();
}

function validateIssueType(type) {
  if (!Object.values(ISSUE_TYPES).includes(type)) {
    throw AppError.unprocessable('INVALID_ISSUE_TYPE', `Type must be one of: ${Object.values(ISSUE_TYPES).join(', ')}`);
  }
  return type;
}

function validateIssuePriority(priority) {
  if (!Object.values(ISSUE_PRIORITIES).includes(priority)) {
    throw AppError.unprocessable(
      'INVALID_ISSUE_PRIORITY',
      `Priority must be one of: ${Object.values(ISSUE_PRIORITIES).join(', ')}`,
    );
  }
  return priority;
}

module.exports = {
  validateEmail,
  validatePassword,
  validateProjectKey,
  validateIssueType,
  validateIssuePriority,
};
