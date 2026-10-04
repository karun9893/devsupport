'use strict';

const crypto = require('crypto');

/** 64 bytes of CSPRNG output (≈512 bits) — Phase 2 §2.1. */
function generateOpaqueToken(bytes = 64) {
  return crypto.randomBytes(bytes).toString('hex');
}

/** One-way SHA-256 digest (hex). Used for refresh-token storage (Phase 2 §2.1). */
function sha256Hex(value) {
  return crypto.createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function generateUuid() {
  return crypto.randomUUID();
}

module.exports = { generateOpaqueToken, sha256Hex, generateUuid };
