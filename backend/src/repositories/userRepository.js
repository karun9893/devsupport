'use strict';

const { User } = require('../models');
const { EMAIL_COLLATION, USER_STATUSES } = require('../config/constants');

/** Data access for users. Pure persistence — no business rules. */

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

async function create(data, { session } = {}) {
  const user = new User(data);
  await user.save({ session });
  return user;
}

/**
 * Case-insensitive lookup; the collation matches the unique index so the query is index-backed.
 * @param {string} email
 * @param {{ withPassword?: boolean, session?: object }} [options]
 */
async function findByEmail(email, { withPassword = false, session } = {}) {
  const query = User.findOne({ email: normalizeEmail(email) }).collation(EMAIL_COLLATION).session(session || null);
  if (withPassword) query.select('+passwordHash');
  return query.exec();
}

async function findById(id, { session } = {}) {
  return User.findById(id).session(session || null).exec();
}

async function findActiveById(id, { session } = {}) {
  return User.findOne({ _id: id, status: USER_STATUSES.ACTIVE }).session(session || null).exec();
}

async function touchLastLogin(id, at = new Date()) {
  await User.updateOne({ _id: id }, { $set: { lastLoginAt: at } }).exec();
}

async function setStatus(id, status, { session } = {}) {
  return User.findByIdAndUpdate(id, { $set: { status } }, { new: true, runValidators: true, session }).exec();
}

module.exports = { normalizeEmail, create, findByEmail, findById, findActiveById, touchLastLogin, setStatus };
