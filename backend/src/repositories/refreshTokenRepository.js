'use strict';

const { RefreshToken } = require('../models');

/** Data access for hashed refresh tokens. Raw tokens never reach this layer. */

async function create({ userId, tokenHash, familyId, expiresAt }, { session } = {}) {
  const doc = new RefreshToken({ userId, tokenHash, familyId, expiresAt });
  await doc.save({ session });
  return doc;
}

/**
 * Atomically consumes an active (non-revoked, unexpired) token by flipping
 * `isRevoked` to true. Exactly one concurrent caller can succeed.
 * @returns {Promise<object|null>} the token record as it was BEFORE consumption, or null.
 */
async function consumeActive(tokenHash, now = new Date(), { session } = {}) {
  return RefreshToken.findOneAndUpdate(
    { tokenHash, isRevoked: false, expiresAt: { $gt: now } },
    { $set: { isRevoked: true } },
    { new: false, session },
  ).exec();
}

async function findByHash(tokenHash, { session } = {}) {
  return RefreshToken.findOne({ tokenHash }).session(session || null).exec();
}

/** Revokes every token in a family (reuse detection / logout). */
async function revokeFamily(familyId, { session } = {}) {
  const res = await RefreshToken.updateMany({ familyId, isRevoked: false }, { $set: { isRevoked: true } }, { session }).exec();
  return res.modifiedCount;
}

/** Revokes every session of a user (e.g. on suspension). */
async function revokeAllForUser(userId, { session } = {}) {
  const res = await RefreshToken.updateMany({ userId, isRevoked: false }, { $set: { isRevoked: true } }, { session }).exec();
  return res.modifiedCount;
}

module.exports = { create, consumeActive, findByHash, revokeFamily, revokeAllForUser };
