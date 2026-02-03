/**
 * Tests for registration validation middleware
 */

const { validationResult } = require('express-validator');
const validateSignup = require('../../../middlewares/validator/registerValidate.js');

// Helper to run validation middleware chain
const runValidation = async (req) => {
  for (const middleware of validateSignup.slice(0, -1)) {
    await middleware(req, {}, () => {});
  }
  return validationResult(req);
};

describe('registerValidate', () => {
  describe('firstname validation', () => {
    it('should pass with valid firstname', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'firstname')).toBeUndefined();
    });

    it('should fail with empty firstname', async () => {
      const req = { body: { firstname: '', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'firstname')).toBeDefined();
    });

    it('should fail with numbers in firstname', async () => {
      const req = { body: { firstname: 'John123', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'firstname')).toBeDefined();
    });

    it('should fail with firstname less than 2 characters', async () => {
      const req = { body: { firstname: 'J', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'firstname')).toBeDefined();
    });

    it('should fail with firstname more than 50 characters', async () => {
      const req = { body: { firstname: 'A'.repeat(51), lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'firstname')).toBeDefined();
    });
  });

  describe('lastname validation', () => {
    it('should pass with valid lastname', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'lastname')).toBeUndefined();
    });

    it('should fail with empty lastname', async () => {
      const req = { body: { firstname: 'John', lastname: '', phone: '1234567890', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'lastname')).toBeDefined();
    });
  });

  describe('phone validation', () => {
    it('should pass with valid 10-digit phone', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'phone')).toBeUndefined();
    });

    it('should pass with phone containing country code', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '+1-123-456-7890', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'phone')).toBeUndefined();
    });

    it('should fail with empty phone', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'phone')).toBeDefined();
    });

    it('should fail with phone less than 10 digits', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '12345', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'phone')).toBeDefined();
    });

    it('should sanitize phone to last 10 digits', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '+1-123-456-7890', email: 'test@test.com', password: 'Password1!' } };
      await runValidation(req);
      expect(req.body.phone).toBe('1234567890');
    });
  });

  describe('whatsapp validation', () => {
    it('should pass when whatsapp is not provided', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'whatsapp')).toBeUndefined();
    });

    it('should pass with valid 10-digit whatsapp', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', whatsapp: '0987654321', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'whatsapp')).toBeUndefined();
    });

    it('should fail with non-numeric whatsapp', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', whatsapp: 'abc1234567', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'whatsapp')).toBeDefined();
    });
  });

  describe('email validation', () => {
    it('should pass with valid email', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'test@example.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'email')).toBeUndefined();
    });

    it('should fail with empty email', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: '', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'email')).toBeDefined();
    });

    it('should fail with invalid email format', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'invalid-email', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'email')).toBeDefined();
    });

    it('should normalize email', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'TEST@EXAMPLE.COM', password: 'Password1!' } };
      await runValidation(req);
      expect(req.body.email).toBe('test@example.com');
    });
  });

  describe('password validation', () => {
    it('should pass with valid password', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'Password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'password')).toBeUndefined();
    });

    it('should fail with empty password', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: '' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'password')).toBeDefined();
    });

    it('should fail with password less than 8 characters', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'Pass1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'password')).toBeDefined();
    });

    it('should fail without uppercase letter', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'password1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'password')).toBeDefined();
    });

    it('should fail without lowercase letter', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'PASSWORD1!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'password')).toBeDefined();
    });

    it('should fail without number', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'Password!' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'password')).toBeDefined();
    });

    it('should fail without special character', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'Password1' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'password')).toBeDefined();
    });
  });

  describe('middleware integration', () => {
    it('should call next() when all validations pass', async () => {
      const req = { body: { firstname: 'John', lastname: 'Doe', phone: '1234567890', email: 'test@test.com', password: 'Password1!' } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      // Run all middlewares including the final one
      for (const middleware of validateSignup) {
        await middleware(req, res, next);
      }

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 400 when validation fails', async () => {
      const req = { body: { firstname: '', lastname: '', phone: '', email: '', password: '' } };
      const res = {
        status: jest.fn().mockReturnThis(),
        json: jest.fn(),
      };
      const next = jest.fn();

      // Run all middlewares including the final one
      for (const middleware of validateSignup) {
        await middleware(req, res, next);
      }

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalled();
    });
  });
});
