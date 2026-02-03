/**
 * Tests for login validation middleware
 */

const { validationResult } = require('express-validator');
const validateLogin = require('../../../middlewares/validator/LoginValidate.js');

// Helper to run validation middleware chain
const runValidation = async (req) => {
  for (const middleware of validateLogin.slice(0, -1)) {
    await middleware(req, {}, () => {});
  }
  return validationResult(req);
};

describe('loginValidate', () => {
  describe('email validation', () => {
    it('should pass with valid email', async () => {
      const req = { body: { email: 'test@example.com', password: 'Password123!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'email')).toBeUndefined();
    });

    it('should fail with empty email', async () => {
      const req = { body: { email: '', password: 'Password123!' } };
      const errors = await runValidation(req);
      const emailError = errors.array().find(e => e.path === 'email');
      expect(emailError).toBeDefined();
      expect(emailError.msg).toBe('Email is required');
    });

    it('should fail with invalid email format', async () => {
      const req = { body: { email: 'invalid-email', password: 'Password123!' } };
      const errors = await runValidation(req);
      const emailError = errors.array().find(e => e.path === 'email');
      expect(emailError).toBeDefined();
      expect(emailError.msg).toBe('Invalid email format');
    });

    it('should fail with email without domain', async () => {
      const req = { body: { email: 'test@', password: 'Password123!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'email')).toBeDefined();
    });

    it('should pass with complex valid email', async () => {
      const req = { body: { email: 'user.name+tag@subdomain.example.com', password: 'Password123!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'email')).toBeUndefined();
    });

    it('should trim whitespace from email', async () => {
      const req = { body: { email: '  test@example.com  ', password: 'Password123!' } };
      await runValidation(req);
      expect(req.body.email.includes(' ')).toBe(false);
    });
  });

  describe('password validation', () => {
    it('should pass with valid password (8+ chars)', async () => {
      const req = { body: { email: 'test@example.com', password: 'Password123!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'password')).toBeUndefined();
    });

    it('should fail with empty password', async () => {
      const req = { body: { email: 'test@example.com', password: '' } };
      const errors = await runValidation(req);
      const passwordError = errors.array().find(e => e.path === 'password');
      expect(passwordError).toBeDefined();
      expect(passwordError.msg).toBe('Password is required');
    });

    it('should fail with password less than 8 characters', async () => {
      const req = { body: { email: 'test@example.com', password: 'Pass1!' } };
      const errors = await runValidation(req);
      const passwordError = errors.array().find(e => e.path === 'password');
      expect(passwordError).toBeDefined();
      expect(passwordError.msg).toBe('Password must be at least 8 characters long');
    });

    it('should pass with exactly 8 characters', async () => {
      const req = { body: { email: 'test@example.com', password: '12345678' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'password')).toBeUndefined();
    });

    it('should pass with very long password', async () => {
      const req = { body: { email: 'test@example.com', password: 'A'.repeat(100) } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'password')).toBeUndefined();
    });

    it('should trim whitespace from password', async () => {
      const req = { body: { email: 'test@example.com', password: '  Password123!  ' } };
      await runValidation(req);
      expect(req.body.password.startsWith(' ')).toBe(false);
      expect(req.body.password.endsWith(' ')).toBe(false);
    });
  });

  describe('combined validation', () => {
    it('should return multiple errors for multiple invalid fields', async () => {
      const req = { body: { email: '', password: '' } };
      const errors = await runValidation(req);
      const errorPaths = errors.array().map(e => e.path);
      expect(errorPaths).toContain('email');
      expect(errorPaths).toContain('password');
    });

    it('should pass with all valid fields', async () => {
      const req = { body: { email: 'valid@example.com', password: 'ValidPass123!' } };
      const errors = await runValidation(req);
      expect(errors.isEmpty()).toBe(true);
    });
  });

  describe('middleware integration', () => {
    it('should call next() when all validations pass', async () => {
      const req = { body: { email: 'test@example.com', password: 'Password123!' } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      for (const middleware of validateLogin) {
        await middleware(req, res, next);
      }

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 400 when validation fails', async () => {
      const req = { body: { email: 'invalid', password: 'short' } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      for (const middleware of validateLogin) {
        await middleware(req, res, next);
      }

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalled();
      expect(res.json.mock.calls[0][0]).toHaveProperty('errors');
    });
  });
});
