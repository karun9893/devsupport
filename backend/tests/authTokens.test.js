'use strict';

const { setupTestDb, teardownTestDb, clearTestDb } = require('./setup');
const { User, RefreshToken } = require('../src/models');
const { USER_ROLES } = require('../src/config/constants');
const { register, login, refresh } = require('../src/services/authService');
const { sha256Hex } = require('../src/utils/crypto');

describe('Dual-Token Auth & Token Family Rotation', () => {
  beforeAll(async () => {
    await setupTestDb();
  }, 60000);

  afterAll(async () => {
    await teardownTestDb();
  });

  afterEach(async () => {
    await clearTestDb();
  });

  it('performs standard login and rotates refresh token cleanly', async () => {
    const user = await register({
      name: 'Test Dev',
      email: 'authdev@example.com',
      password: 'Password123!',
    });

    const loginRes = await login({
      email: 'authdev@example.com',
      password: 'Password123!',
    });

    expect(loginRes.accessToken).toBeDefined();
    expect(loginRes.refreshToken).toBeDefined();
    expect(loginRes.tokenType).toBe('Bearer');

    // Verify token was stored hashed
    const hashed = sha256Hex(loginRes.refreshToken);
    const tokenDoc = await RefreshToken.findOne({ tokenHash: hashed });
    expect(tokenDoc).not.toBeNull();
    expect(tokenDoc.isRevoked).toBe(false);

    // Rotate token
    const refreshRes = await refresh({ refreshToken: loginRes.refreshToken });
    expect(refreshRes.accessToken).toBeDefined();
    expect(refreshRes.refreshToken).not.toBe(loginRes.refreshToken);

    // Verify old token is now marked isRevoked: true
    const oldDoc = await RefreshToken.findOne({ tokenHash: hashed });
    expect(oldDoc.isRevoked).toBe(true);
  });

  it('detects refresh token reuse and immediately invalidates the entire token family', async () => {
    await register({
      name: 'Test Dev 2',
      email: 'authdev2@example.com',
      password: 'Password123!',
    });

    const loginRes = await login({
      email: 'authdev2@example.com',
      password: 'Password123!',
    });

    const stolenToken = loginRes.refreshToken;

    // Legitimate user rotates token
    const firstRefresh = await refresh({ refreshToken: stolenToken });
    expect(firstRefresh.refreshToken).toBeDefined();

    // Attacker tries to use the already-rotated token (reuse attempt)
    await expect(refresh({ refreshToken: stolenToken })).rejects.toMatchObject({
      statusCode: 401,
      code: 'REFRESH_TOKEN_REUSE_DETECTED',
    });

    // Legitimate user's new token should also now be invalidated
    await expect(refresh({ refreshToken: firstRefresh.refreshToken })).rejects.toMatchObject({
      statusCode: 401,
      code: 'REFRESH_TOKEN_REUSE_DETECTED',
    });
  });
});
