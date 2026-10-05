'use strict';

const authService = require('../services/authService');
const { validateEmail, validatePassword } = require('../validators/commonValidators');
const { sendSuccess } = require('../utils/response');
const AppError = require('../utils/AppError');

async function register(req, res, next) {
  try {
    const { name, email, password } = req.body || {};

    if (!name || typeof name !== 'string' || name.trim().length < 2 || name.trim().length > 60) {
      throw AppError.unprocessable('VALIDATION_ERROR', 'Name must be between 2 and 60 characters.');
    }

    const validatedEmail = validateEmail(email);
    const validatedPassword = validatePassword(password);

    const user = await authService.register({
      name: name.trim(),
      email: validatedEmail,
      password: validatedPassword,
    });

    return sendSuccess(res, 201, user);
  } catch (err) {
    next(err);
  }
}

async function login(req, res, next) {
  try {
    const { email, password } = req.body || {};

    if (!email || typeof email !== 'string' || !password || typeof password !== 'string') {
      throw AppError.unauthorized('INVALID_CREDENTIALS', 'Invalid email or password.');
    }

    const result = await authService.login({
      email: email.trim(),
      password,
    });

    return sendSuccess(res, 200, result);
  } catch (err) {
    next(err);
  }
}

async function refresh(req, res, next) {
  try {
    const { refreshToken } = req.body || {};

    if (!refreshToken || typeof refreshToken !== 'string' || !refreshToken.trim()) {
      throw AppError.unauthorized('INVALID_REFRESH_TOKEN', 'Refresh token is required.');
    }

    const result = await authService.refresh({ refreshToken: refreshToken.trim() });
    return sendSuccess(res, 200, result);
  } catch (err) {
    next(err);
  }
}

async function logout(req, res, next) {
  try {
    const { refreshToken } = req.body || {};

    if (refreshToken && typeof refreshToken === 'string' && refreshToken.trim()) {
      await authService.logout({ refreshToken: refreshToken.trim() });
    }

    return sendSuccess(res, 200, {
      message: 'Logged out successfully. Session tokens revoked.',
    });
  } catch (err) {
    next(err);
  }
}

async function me(req, res, next) {
  try {
    const user = await authService.getCurrentUser(req.user.id);
    return sendSuccess(res, 200, user);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  register,
  login,
  refresh,
  logout,
  me,
};
