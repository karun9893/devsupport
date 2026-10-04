'use strict';

const jwt = require('jsonwebtoken');
const env = require('../config/env');
const AppError = require('../utils/AppError');
const logger = require('../utils/logger');
const { generateOpaqueToken, sha256Hex, generateUuid } = require('../utils/crypto');
const { runInTransaction } = require('../utils/transaction');
const refreshTokenRepository = require('../repositories/refreshTokenRepository');
const userRepository = require('../repositories/userRepository');

/**
 * Dual-token authentication — Phase 2 §2.
 *
 *  Access token : HS256 JWT, 15 minutes, claims { sub, role, iss, iat, exp }.
 *  Refresh token: 64 random bytes (hex), 7 days, stored ONLY as SHA-256(token),
 *                 grouped in a family (one per login), single-use with rotation.
 *  Reuse        : presenting an already-rotated token revokes the whole family.
 */

const JWT_ALGORITHM = 'HS256';

function signAccessToken(user) {
  return jwt.sign({ role: user.role }, env.jwt.accessSecret, {
    algorithm: JWT_ALGORITHM,
    subject: String(user._id),
    issuer: env.jwt.issuer,
    expiresIn: Math.floor(env.jwt.accessTokenTtlMs / 1000),
  });
}

/**
 * @returns {{ sub: string, role: string, iss: string, iat: number, exp: number }}
 * @throws AppError 401 on any verification failure
 */
function verifyAccessToken(token) {
  try {
    return jwt.verify(token, env.jwt.accessSecret, {
      algorithms: [JWT_ALGORITHM], // pin algorithm: blocks "alg: none" / alg-confusion attacks
      issuer: env.jwt.issuer,
    });
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      throw AppError.unauthorized('ACCESS_TOKEN_EXPIRED', 'Access token has expired.');
    }
    throw AppError.unauthorized('INVALID_ACCESS_TOKEN', 'Access token is invalid.');
  }
}

/**
 * Issues a fresh access token + refresh token. When `familyId` is omitted a new
 * family (i.e. a new login session) is started.
 */
async function issueTokenPair(user, { familyId = generateUuid(), session } = {}) {
  const refreshToken = generateOpaqueToken(64);
  const refreshTokenExpiresAt = new Date(Date.now() + env.refreshTokenTtlMs);

  await refreshTokenRepository.create(
    { userId: user._id, tokenHash: sha256Hex(refreshToken), familyId, expiresAt: refreshTokenExpiresAt },
    { session },
  );

  return {
    accessToken: signAccessToken(user),
    tokenType: 'Bearer',
    accessTokenExpiresIn: Math.floor(env.jwt.accessTokenTtlMs / 1000),
    refreshToken,
    refreshTokenExpiresAt: refreshTokenExpiresAt.toISOString(),
  };
}

/**
 * Rotates a refresh token. Consumption of the old token and insertion of its
 * successor commit atomically; family revocation on reuse is committed
 * OUTSIDE that transaction so it can never be rolled back.
 */
async function rotateRefreshToken(rawRefreshToken) {
  if (typeof rawRefreshToken !== 'string' || rawRefreshToken.length === 0) {
    throw AppError.unauthorized('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token.');
  }
  const tokenHash = sha256Hex(rawRefreshToken);

  const outcome = await runInTransaction(async (session) => {
    const consumed = await refreshTokenRepository.consumeActive(tokenHash, new Date(), { session });

    if (!consumed) {
      const existing = await refreshTokenRepository.findByHash(tokenHash, { session });
      if (existing && existing.isRevoked) return { kind: 'reuse', familyId: existing.familyId, userId: existing.userId };
      return { kind: 'invalid' };
    }

    const user = await userRepository.findById(consumed.userId, { session });
    if (!user || !user.isActive()) return { kind: 'inactive', familyId: consumed.familyId };

    const tokens = await issueTokenPair(user, { familyId: consumed.familyId, session });
    return { kind: 'rotated', tokens, user };
  });

  switch (outcome.kind) {
    case 'rotated':
      return { ...outcome.tokens, user: outcome.user.toJSON() };
    case 'reuse': {
      const revoked = await refreshTokenRepository.revokeFamily(outcome.familyId);
      logger.warn('Refresh token reuse detected; token family revoked', {
        familyId: outcome.familyId,
        userId: String(outcome.userId),
        revoked,
      });
      throw AppError.unauthorized('REFRESH_TOKEN_REUSE_DETECTED', 'Token reuse detected. All sessions for this login have been terminated.');
    }
    case 'inactive':
      await refreshTokenRepository.revokeFamily(outcome.familyId);
      throw AppError.forbidden('ACCOUNT_SUSPENDED', 'Your account has been deactivated. Contact your system administrator.');
    default:
      throw AppError.unauthorized('INVALID_REFRESH_TOKEN', 'Invalid or expired refresh token.');
  }
}

/** Logout: revokes the presented token's whole family. Idempotent; never reveals token validity. */
async function revokeRefreshToken(rawRefreshToken) {
  if (typeof rawRefreshToken !== 'string' || rawRefreshToken.length === 0) return;
  const existing = await refreshTokenRepository.findByHash(sha256Hex(rawRefreshToken));
  if (existing) await refreshTokenRepository.revokeFamily(existing.familyId);
}

module.exports = { signAccessToken, verifyAccessToken, issueTokenPair, rotateRefreshToken, revokeRefreshToken };
