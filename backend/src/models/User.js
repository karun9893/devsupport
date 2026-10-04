'use strict';

const mongoose = require('mongoose');
const { USER_ROLES, USER_STATUSES, EMAIL_REGEX, EMAIL_COLLATION } = require('../config/constants');
const { buildToJSON } = require('./plugins/toJSON');

/**
 * User — Phase 2 §3.1.
 * The plain-text password never reaches this layer; only a bcrypt hash is stored.
 */
const userSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, 'Name is required.'],
      trim: true,
      minlength: [2, 'Name must be at least 2 characters.'],
      maxlength: [60, 'Name must be at most 60 characters.'],
    },
    email: {
      type: String,
      required: [true, 'Email is required.'],
      trim: true,
      lowercase: true, // pre-save normalisation invariant
      maxlength: [254, 'Email must be at most 254 characters.'],
      match: [EMAIL_REGEX, 'Email address is invalid.'],
    },
    passwordHash: {
      type: String,
      required: [true, 'Password hash is required.'],
      minlength: [60, 'Password hash must be a bcrypt hash.'],
      select: false, // never loaded unless explicitly requested
    },
    role: {
      type: String,
      required: true,
      enum: { values: Object.values(USER_ROLES), message: 'Invalid role: {VALUE}.' },
      default: USER_ROLES.DEVELOPER,
    },
    status: {
      type: String,
      required: true,
      enum: { values: Object.values(USER_STATUSES), message: 'Invalid status: {VALUE}.' },
      default: USER_STATUSES.ACTIVE,
    },
    lastLoginAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    // Serialization invariant: passwordHash is stripped even if it was explicitly selected.
    toJSON: buildToJSON(['passwordHash']),
  },
);

// Case-insensitive unique email (defence-in-depth on top of lowercase normalisation).
userSchema.index({ email: 1 }, { unique: true, collation: EMAIL_COLLATION, name: 'uniq_email_ci' });
userSchema.index({ role: 1, status: 1 }, { name: 'role_status' });

userSchema.methods.isActive = function isActive() {
  return this.status === USER_STATUSES.ACTIVE;
};

module.exports = mongoose.models.User || mongoose.model('User', userSchema);
