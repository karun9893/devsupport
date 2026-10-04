'use strict';

const mongoose = require('mongoose');
const { SHA256_HEX_REGEX, UUID_V4_REGEX } = require('../config/constants');

/**
 * RefreshToken — Phase 2 §2 / §3.7.
 * Stores ONLY the SHA-256 digest of each opaque refresh token, grouped into a
 * token family (one family per login) for rotation and reuse detection.
 */
const refreshTokenSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, immutable: true },
    tokenHash: {
      type: String,
      required: true,
      immutable: true,
      match: [SHA256_HEX_REGEX, 'tokenHash must be a 64-character SHA-256 hex digest.'],
    },
    familyId: {
      type: String,
      required: true,
      immutable: true,
      match: [UUID_V4_REGEX, 'familyId must be a UUIDv4.'],
    },
    isRevoked: { type: Boolean, required: true, default: false },
    expiresAt: { type: Date, required: true, immutable: true },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
    versionKey: false,
  },
);

refreshTokenSchema.index({ tokenHash: 1 }, { unique: true, name: 'uniq_tokenHash' });
refreshTokenSchema.index({ familyId: 1 }, { name: 'familyId' });
// TTL: MongoDB's background monitor deletes documents once expiresAt has passed.
// (It runs ~every 60s, so the service ALSO checks expiresAt explicitly.)
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, name: 'ttl_expiresAt' });

module.exports = mongoose.models.RefreshToken || mongoose.model('RefreshToken', refreshTokenSchema);
