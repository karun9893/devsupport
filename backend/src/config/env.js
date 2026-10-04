'use strict';

const path = require('path');

/**
 * Environment configuration.
 *
 * - Loads backend/.env (except under NODE_ENV=test, where the test harness
 *   owns the environment).
 * - Validates every required variable up-front and fails fast with a clear,
 *   credential-free message.
 */

if (process.env.NODE_ENV !== 'test') {
  // dotenv never overrides variables that are already set in the real environment.
  require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
}

const DURATION_UNITS_MS = { s: 1000, m: 60 * 1000, h: 60 * 60 * 1000, d: 24 * 60 * 60 * 1000 };

/**
 * Parses durations such as "15m", "7d", "30s", "12h" into milliseconds.
 * @param {string} value
 * @param {string} name - variable name, used in error messages
 * @returns {number}
 */
function parseDuration(value, name) {
  const match = /^(\d+)([smhd])$/.exec(String(value).trim());
  if (!match) {
    throw new Error(`Invalid duration for ${name}: "${value}". Use formats like 30s, 15m, 12h, 7d.`);
  }
  const ms = Number(match[1]) * DURATION_UNITS_MS[match[2]];
  if (ms <= 0) throw new Error(`${name} must be a positive duration.`);
  return ms;
}

function parseInteger(value, name, { min, max } = {}) {
  const n = Number(value);
  if (!Number.isInteger(n)) throw new Error(`${name} must be an integer (received "${value}").`);
  if (min !== undefined && n < min) throw new Error(`${name} must be >= ${min}.`);
  if (max !== undefined && n > max) throw new Error(`${name} must be <= ${max}.`);
  return n;
}

function loadConfig(source = process.env) {
  const errors = [];
  const nodeEnv = (source.NODE_ENV || 'development').trim();
  const isTest = nodeEnv === 'test';
  const isProduction = nodeEnv === 'production';

  const required = (name, fallback) => {
    const v = source[name];
    if (v === undefined || String(v).trim() === '') {
      if (fallback !== undefined) return fallback;
      errors.push(`Missing required environment variable: ${name}`);
      return undefined;
    }
    return String(v).trim();
  };

  const mongodbUri = required('MONGODB_URI', isTest ? 'mongodb://127.0.0.1:27017/devsupport_test' : undefined);
  const jwtAccessSecret = required(
    'JWT_ACCESS_SECRET',
    isTest ? 'test-fallback-secret-at-least-32-chars-long' : undefined,
  );

  // Phase 1 §11.1 — HMAC secret must carry >= 256 bits of entropy (>= 32 bytes).
  if (jwtAccessSecret && Buffer.byteLength(jwtAccessSecret, 'utf8') < 32) {
    errors.push('JWT_ACCESS_SECRET must be at least 32 bytes (256 bits).');
  }

  let config;
  try {
    // Phase 1 §4.1 / §11.1 — bcrypt cost factor must be >= 12. Lower values are
    // tolerated only under NODE_ENV=test to keep the suite fast.
    const bcryptSaltRounds = parseInteger(source.BCRYPT_SALT_ROUNDS || '12', 'BCRYPT_SALT_ROUNDS', {
      min: isTest ? 4 : 12,
      max: 15,
    });

    config = Object.freeze({
      nodeEnv,
      isTest,
      isProduction,
      port: parseInteger(source.PORT || '5000', 'PORT', { min: 1, max: 65535 }),
      mongodbUri,
      // Production index builds are run explicitly via `npm run db:sync-indexes`.
      autoIndex: source.MONGODB_AUTO_INDEX
        ? source.MONGODB_AUTO_INDEX === 'true'
        : !isProduction,
      jwt: Object.freeze({
        accessSecret: jwtAccessSecret,
        issuer: (source.JWT_ISSUER || 'DevSupport-API').trim(),
        accessTokenTtlMs: parseDuration(source.ACCESS_TOKEN_EXPIRES_IN || '15m', 'ACCESS_TOKEN_EXPIRES_IN'),
      }),
      refreshTokenTtlMs: parseDuration(source.REFRESH_TOKEN_EXPIRES_IN || '7d', 'REFRESH_TOKEN_EXPIRES_IN'),
      bcryptSaltRounds,
      corsOrigin: (source.CORS_ORIGIN || 'http://localhost:5173').trim(),
      authRateLimit: Object.freeze({
        windowMs: parseDuration(source.AUTH_RATE_LIMIT_WINDOW || '15m', 'AUTH_RATE_LIMIT_WINDOW'),
        max: parseInteger(source.AUTH_RATE_LIMIT_MAX || '5', 'AUTH_RATE_LIMIT_MAX', { min: 1 }),
      }),
    });
  } catch (err) {
    errors.push(err.message);
  }

  if (errors.length > 0) {
    const error = new Error(`Invalid environment configuration:\n  - ${errors.join('\n  - ')}`);
    error.code = 'ENV_CONFIG_INVALID';
    throw error;
  }
  return config;
}

const env = loadConfig();

module.exports = {
  ...env,
  loadConfig,
  parseDuration,
};
