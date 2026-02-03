/**
 * Tests for auth middleware
 * 
 * Note: These tests verify the auth middleware's behavior for various token scenarios.
 * The middleware validates access tokens and optionally admin/super admin tokens.
 */

// Re-import after each mock to ensure fresh state
let auth;
let verifyAccessToken;

beforeEach(() => {
  // Reset modules to get fresh mock state
  jest.resetModules();
  
  // Set up the mock
  jest.doMock('../../../utils/Tokens', () => ({
    verifyAccessToken: jest.fn(),
  }));
  
  // Import fresh copies
  const tokens = require('../../../utils/Tokens');
  verifyAccessToken = tokens.verifyAccessToken;
  auth = require('../../../middlewares/Auth/auth.js');
});

describe('auth middleware', () => {
  let req;
  let res;
  let next;

  beforeEach(() => {
    req = {
      cookies: {},
    };
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };
    next = jest.fn();
  });

  describe('access token validation', () => {
    it('should return 401 when access token is missing', async () => {
      await auth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401, message: 'Unauthorized' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 400 when access token is invalid', async () => {
      req.cookies.IBEXAccessToken = 'invalid-token';
      verifyAccessToken.mockResolvedValue(false);

      await auth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400, message: 'Invalid access token' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should return 401 when access token is expired', async () => {
      req.cookies.IBEXAccessToken = 'expired-token';
      verifyAccessToken.mockResolvedValue({ isvalid: false, tokenData: null });

      await auth(req, res, next);

      expect(res.status).toHaveBeenCalledWith(401);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 401, message: 'Access token expired' })
      );
      expect(next).not.toHaveBeenCalled();
    });

    it('should call next and set userId when access token is valid', async () => {
      req.cookies.IBEXAccessToken = 'valid-token';
      verifyAccessToken.mockResolvedValue({ isvalid: true, tokenData: 'user-123' });

      await auth(req, res, next);

      expect(req.userId).toBe('user-123');
      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });
  });

  describe('admin token handling', () => {
    it('should set adminId to null when no admin token', async () => {
      req.cookies.IBEXAccessToken = 'valid-token';
      verifyAccessToken.mockResolvedValue({ isvalid: true, tokenData: 'user-123' });

      await auth(req, res, next);

      expect(req.adminId).toBeNull();
    });

    it('should set adminId to null when admin token is empty string', async () => {
      req.cookies.IBEXAccessToken = 'valid-token';
      req.cookies.AdminToken = '';
      verifyAccessToken.mockResolvedValue({ isvalid: true, tokenData: 'user-123' });

      await auth(req, res, next);

      expect(req.adminId).toBeNull();
    });
  });

  describe('super admin token handling', () => {
    it('should set isSuperAdminSession to false when no super admin token', async () => {
      req.cookies.IBEXAccessToken = 'valid-token';
      verifyAccessToken.mockResolvedValue({ isvalid: true, tokenData: 'user-123' });

      await auth(req, res, next);

      expect(req.isSuperAdminSession).toBe(false);
      expect(req.superAdminId).toBeNull();
    });

    it('should set super admin flags to false when super admin token is empty', async () => {
      req.cookies.IBEXAccessToken = 'valid-token';
      req.cookies.SuperAdminToken = '';
      verifyAccessToken.mockResolvedValue({ isvalid: true, tokenData: 'user-123' });

      await auth(req, res, next);

      expect(req.isSuperAdminSession).toBe(false);
      expect(req.superAdminId).toBeNull();
    });
  });

  describe('token verification results', () => {
    it('should set userId from access token', async () => {
      req.cookies.IBEXAccessToken = 'token';
      verifyAccessToken.mockResolvedValue({ isvalid: true, tokenData: 'user-xyz' });

      await auth(req, res, next);

      expect(req.userId).toBe('user-xyz');
      expect(next).toHaveBeenCalled();
    });

    it('should handle multiple token verifications in sequence', async () => {
      // This test verifies that the middleware calls verifyAccessToken correctly
      req.cookies.IBEXAccessToken = 'access-token';
      verifyAccessToken.mockResolvedValue({ isvalid: true, tokenData: 'user-123' });

      await auth(req, res, next);

      expect(verifyAccessToken).toHaveBeenCalledWith('access-token');
      expect(req.userId).toBe('user-123');
      expect(next).toHaveBeenCalled();
    });
  });
});
