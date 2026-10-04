'use strict';

const bcrypt = require('bcryptjs');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const { USER_ROLES } = require('../config/constants');
const userRepository = require('../repositories/userRepository');
const tokenService = require('./tokenService');

/**
 * Authentication use-cases — Phase 1 §4 with Phase 2 §2 token model.
 */

const INVALID_CREDENTIALS_MESSAGE = 'Invalid email or password.';
const DUPLICATE_EMAIL_MESSAGE = 'An account with this email address already exists.';

// Lazily computed bcrypt hash used to equalise response timing when the email is unknown.
let dummyHashPromise = null;
function getDummyHash() {
  if (!dummyHashPromise) dummyHashPromise = bcrypt.hash('devsupport-timing-equaliser', env.bcryptSaltRounds);
  return dummyHashPromise;
}

async function hashPassword(plain) {
  return bcrypt.hash(plain, env.bcryptSaltRounds);
}

/**
 * Open self-registration. Always creates a Developer (Phase 1 §4.1: elevated
 * roles can only be provisioned by an Admin).
 */
async function register({ name, email, password }) {
  const passwordHash = await hashPassword(password);
  try {
    const user = await userRepository.create({
      name,
      email: userRepository.normalizeEmail(email),
      passwordHash,
      role: USER_ROLES.DEVELOPER,
    });
    return user.toJSON();
  } catch (err) {
    if (err && err.code === 11000) throw AppError.conflict('EMAIL_ALREADY_EXISTS', DUPLICATE_EMAIL_MESSAGE);
    throw err;
  }
}

/**
 * Login. Unknown email and wrong password produce the SAME 401 and comparable
 * latency (no account enumeration). The suspended check runs only AFTER the
 * password is verified, so account status is disclosed solely to its owner.
 */
async function login({ email, password }) {
  const user = await userRepository.findByEmail(email, { withPassword: true });

  if (!user) {
    await bcrypt.compare(String(password), await getDummyHash());
    throw AppError.unauthorized('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);
  }

  const passwordMatches = await bcrypt.compare(String(password), user.passwordHash);
  if (!passwordMatches) throw AppError.unauthorized('INVALID_CREDENTIALS', INVALID_CREDENTIALS_MESSAGE);

  if (!user.isActive()) {
    throw AppError.forbidden('ACCOUNT_SUSPENDED', 'Your account has been deactivated. Contact your system administrator.');
  }

  await userRepository.touchLastLogin(user._id);
  const tokens = await tokenService.issueTokenPair(user);
  return { ...tokens, user: user.toJSON() };
}

async function refresh({ refreshToken }) {
  return tokenService.rotateRefreshToken(refreshToken);
}

async function logout({ refreshToken }) {
  await tokenService.revokeRefreshToken(refreshToken);
}

async function getCurrentUser(userId) {
  const user = await userRepository.findActiveById(userId);
  if (!user) throw AppError.unauthorized('INVALID_ACCESS_TOKEN', 'Authenticated user no longer exists or is inactive.');
  return user.toJSON();
}

module.exports = { hashPassword, register, login, refresh, logout, getCurrentUser };
