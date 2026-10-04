'use strict';

const AppError = require('../utils/AppError');
const tokenService = require('../services/tokenService');
const userRepository = require('../repositories/userRepository');

/**
 * Authentication middleware.
 * Verifies Bearer JWT, decodes sub/role, and checks that user is active in DB.
 */
async function authenticate(req, res, next) {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw AppError.unauthorized('MISSING_ACCESS_TOKEN', 'Authentication token required in Authorization header.');
    }

    const token = authHeader.substring(7).trim();
    if (!token) {
      throw AppError.unauthorized('MISSING_ACCESS_TOKEN', 'Bearer token cannot be empty.');
    }

    const decoded = tokenService.verifyAccessToken(token);

    // Verify user is still active in DB
    const user = await userRepository.findActiveById(decoded.sub);
    if (!user) {
      throw AppError.unauthorized('USER_INACTIVE_OR_DELETED', 'Authenticated user no longer exists or is suspended.');
    }

    req.user = {
      id: String(user._id),
      role: user.role,
      email: user.email,
      name: user.name,
      userDoc: user,
    };

    next();
  } catch (err) {
    next(err);
  }
}

/**
 * Authorize specific system roles.
 * @param  {...string} roles
 */
function authorizeRoles(...roles) {
  return (req, res, next) => {
    if (!req.user) {
      return next(AppError.unauthorized('UNAUTHENTICATED', 'Authentication required.'));
    }
    if (!roles.includes(req.user.role)) {
      return next(AppError.forbidden('FORBIDDEN_ROLE', `Role '${req.user.role}' is not authorized for this resource.`));
    }
    next();
  };
}

module.exports = { authenticate, authorizeRoles };
