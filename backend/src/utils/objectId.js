'use strict';

const mongoose = require('mongoose');
const AppError = require('./AppError');

function isValidObjectId(value) {
  if (value instanceof mongoose.Types.ObjectId) return true;
  return typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value);
}

/**
 * Validates and converts to ObjectId, throwing a 400 INVALID_ID otherwise.
 * @param {*} value
 * @param {string} field - field name for the error message
 */
function toObjectId(value, field = 'id') {
  if (!isValidObjectId(value)) {
    throw AppError.badRequest('INVALID_ID', `${field} must be a valid 24-character hex ObjectId.`);
  }
  return value instanceof mongoose.Types.ObjectId ? value : new mongoose.Types.ObjectId(value);
}

/** Null-safe ObjectId/string equality. */
function idEquals(a, b) {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

module.exports = { isValidObjectId, toObjectId, idEquals };
