/**
 * Tests for Token utility functions
 */

const jwt = require('jsonwebtoken');

// Mock User model before requiring Tokens
jest.mock('../../models/user-auth/userModel.js', () => ({
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  updateOne: jest.fn(),
}));

const {
  createAccessToken,
  createRefreshToken,
  revokeRefreshToken,
  createLocationToken,
  verifyAccessToken,
  refreshAccess,
  verifyLocationToken,
  MAX_REFRESH_TOKENS,
} = require('../../utils/Tokens.js');
const User = require('../../models/user-auth/userModel.js');

describe('Tokens', () => {
  const testUserId = '507f1f77bcf86cd799439011';
  const testCountry = 'US';
  const testRegion = 'na';

  beforeEach(() => {
    jest.clearAllMocks();
    // createRefreshToken records the session as it mints, so these must resolve.
    User.findByIdAndUpdate.mockResolvedValue({});
    User.updateOne.mockResolvedValue({});
  });

  describe('createAccessToken', () => {
    it('should create a valid access token for a user ID', async () => {
      const token = await createAccessToken(testUserId);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      
      // Verify token can be decoded
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.id).toBe(testUserId);
    });

    it('should return false when user ID is missing', async () => {
      const token = await createAccessToken(null);
      expect(token).toBe(false);
    });

    it('should return false when user ID is undefined', async () => {
      const token = await createAccessToken(undefined);
      expect(token).toBe(false);
    });

    it('should return false when user ID is empty string', async () => {
      const token = await createAccessToken('');
      expect(token).toBe(false);
    });

    it('should create tokens with different signatures for different users', async () => {
      const userId1 = '507f1f77bcf86cd799439011';
      const userId2 = '507f1f77bcf86cd799439022';
      
      const token1 = await createAccessToken(userId1);
      const token2 = await createAccessToken(userId2);
      
      expect(token1).not.toBe(token2);
    });
  });

  describe('createRefreshToken', () => {
    it('should create a valid refresh token for a user ID', async () => {
      const token = await createRefreshToken(testUserId);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      
      // Verify token can be decoded
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.id).toBe(testUserId);
    });

    it('should return false when user ID is missing', async () => {
      const token = await createRefreshToken(null);
      expect(token).toBe(false);
    });

    it('should return false when user ID is undefined', async () => {
      const token = await createRefreshToken(undefined);
      expect(token).toBe(false);
    });
  });

  describe('createLocationToken', () => {
    it('should create a valid location token', async () => {
      const token = await createLocationToken(testCountry, testRegion);
      
      expect(token).toBeDefined();
      expect(typeof token).toBe('string');
      
      // Verify token can be decoded
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      expect(decoded.country).toBe(testCountry);
      expect(decoded.region).toBe(testRegion);
    });

    it('should return false when country is missing', async () => {
      const token = await createLocationToken(null, testRegion);
      expect(token).toBe(false);
    });

    it('should return false when region is missing', async () => {
      const token = await createLocationToken(testCountry, null);
      expect(token).toBe(false);
    });

    it('should return false when both country and region are missing', async () => {
      const token = await createLocationToken(null, null);
      expect(token).toBe(false);
    });
  });

  describe('verifyAccessToken', () => {
    it('should verify a valid access token', async () => {
      const token = await createAccessToken(testUserId);
      const result = await verifyAccessToken(token);
      
      expect(result).toBeDefined();
      expect(result.isvalid).toBe(true);
      expect(result.tokenData).toBe(testUserId);
    });

    it('should return false when token is missing', async () => {
      const result = await verifyAccessToken(null);
      expect(result).toBe(false);
    });

    it('should return false when token is empty string', async () => {
      const result = await verifyAccessToken('');
      expect(result).toBe(false);
    });

    it('should return invalid for expired token', async () => {
      // Create an expired token
      const expiredToken = jwt.sign(
        { id: testUserId },
        process.env.JWT_SECRET,
        { expiresIn: '-1s' }
      );
      
      const result = await verifyAccessToken(expiredToken);
      
      expect(result.isvalid).toBe(false);
      expect(result.tokenData).toBe(null);
    });

    it('should return false for invalid token', async () => {
      const result = await verifyAccessToken('invalid-token');
      expect(result).toBe(false);
    });

    it('should return false for token with wrong secret', async () => {
      const wrongToken = jwt.sign({ id: testUserId }, 'wrong-secret');
      const result = await verifyAccessToken(wrongToken);
      expect(result).toBe(false);
    });
  });

  describe('verifyLocationToken', () => {
    it('should verify a valid location token', async () => {
      const token = await createLocationToken(testCountry, testRegion);
      const result = await verifyLocationToken(token);
      
      expect(result).toBeDefined();
      expect(result.country).toBe(testCountry);
      expect(result.region).toBe(testRegion);
    });

    it('should return false when token is missing', async () => {
      const result = await verifyLocationToken(null);
      expect(result).toBe(false);
    });

    it('should return false for invalid token', async () => {
      const result = await verifyLocationToken('invalid-token');
      expect(result).toBe(false);
    });
  });

  describe('refreshAccess', () => {
    it('should refresh access token for valid refresh token', async () => {
      const refreshToken = await createRefreshToken(testUserId);
      
      // Mock User.findById to return a user holding this token as a live session
      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          refreshTokens: [refreshToken],
        }),
      });
      
      const newAccessToken = await refreshAccess(refreshToken);
      
      expect(newAccessToken).toBeDefined();
      expect(typeof newAccessToken).toBe('string');
      
      // Verify new token is valid
      const decoded = jwt.verify(newAccessToken, process.env.JWT_SECRET);
      expect(decoded.id).toBe(testUserId);
    });

    it('should return false when token is missing', async () => {
      const result = await refreshAccess(null);
      expect(result).toBe(false);
    });

    it('should return false when user not found', async () => {
      const refreshToken = await createRefreshToken(testUserId);
      
      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue(null),
      });
      
      const result = await refreshAccess(refreshToken);
      expect(result).toBe(false);
    });

    it('should return false when the token is not among the active sessions', async () => {
      const refreshToken = await createRefreshToken(testUserId);

      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({
          refreshTokens: ['some-other-devices-token'],
        }),
      });

      const result = await refreshAccess(refreshToken);
      expect(result).toBe(false);
    });

    it('should return false when the user has no active sessions', async () => {
      const refreshToken = await createRefreshToken(testUserId);

      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({}),
      });

      const result = await refreshAccess(refreshToken);
      expect(result).toBe(false);
    });

    it('should return false for invalid token', async () => {
      const result = await refreshAccess('invalid-token');
      expect(result).toBe(false);
    });

    it('should reject an access token presented as a refresh token', async () => {
      const accessToken = await createAccessToken(testUserId);

      User.findById.mockReturnValue({
        select: jest.fn().mockResolvedValue({ refreshTokens: [accessToken] }),
      });

      // Even though it is signed and listed, the type claim must disqualify it.
      const result = await refreshAccess(accessToken);
      expect(result).toBe(false);
    });
  });

  describe('refresh token session bookkeeping', () => {
    it('should record the token as an active session when minting it', async () => {
      const token = await createRefreshToken(testUserId);

      expect(User.findByIdAndUpdate).toHaveBeenCalledWith(testUserId, {
        $push: { refreshTokens: { $each: [token], $slice: -MAX_REFRESH_TOKENS } },
      });
    });

    it('should still return the token when recording the session fails', async () => {
      User.findByIdAndUpdate.mockRejectedValue(new Error('db down'));

      // A transient write failure must not block the login — the access token is
      // still good for 15 days.
      const token = await createRefreshToken(testUserId);
      expect(typeof token).toBe('string');
    });

    it('should revoke a session by token without needing the user id', async () => {
      const token = await createRefreshToken(testUserId);

      const result = await revokeRefreshToken(token);

      expect(result).toBe(true);
      expect(User.updateOne).toHaveBeenCalledWith(
        { refreshTokens: token },
        { $pull: { refreshTokens: token } }
      );
    });

    it('should return false when revoking without a token', async () => {
      const result = await revokeRefreshToken(null);
      expect(result).toBe(false);
      expect(User.updateOne).not.toHaveBeenCalled();
    });
  });

  describe('token type separation', () => {
    it('should reject a refresh token presented as an access token', async () => {
      const refreshToken = await createRefreshToken(testUserId);
      const result = await verifyAccessToken(refreshToken);
      expect(result).toBe(false);
    });
  });
});
