/**
 * Tests for the phone-collection modal's validation middleware.
 *
 * The point of this endpoint is to capture the country code, so the cases that
 * matter most are: "+" survives sanitisation, and a bare local number is rejected.
 */

const { validationResult } = require('express-validator');
const { validateUpdatePhone } = require('../../../middlewares/validator/updatePhoneValidate.js');

// Helper to run validation middleware chain (skips the final responder)
const runValidation = async (req) => {
  for (const middleware of validateUpdatePhone.slice(0, -1)) {
    await middleware(req, {}, () => {});
  }
  return validationResult(req);
};

describe('updatePhoneValidate', () => {
  describe('phone validation', () => {
    it('should pass with a country code and local number', async () => {
      const req = { body: { phone: '+91 9876543210' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'phone')).toBeUndefined();
    });

    it('should keep the country code after sanitizing formatting characters', async () => {
      const req = { body: { phone: '+1 (123) 456-7890' } };
      await runValidation(req);
      expect(req.body.phone).toBe('+11234567890');
    });

    it('should fail when the country code is missing', async () => {
      const req = { body: { phone: '9876543210' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'phone')?.msg).toBe('Country code is required');
    });

    it('should fail with an empty phone', async () => {
      const req = { body: { phone: '' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'phone')).toBeDefined();
    });

    it('should fail with letters in the phone', async () => {
      const req = { body: { phone: '+91 98765abcde' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'phone')).toBeDefined();
    });

    it('should fail with fewer than 10 digits', async () => {
      const req = { body: { phone: '+91 98765' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'phone')).toBeDefined();
    });

    it('should fail with more than 15 digits', async () => {
      const req = { body: { phone: '+911234567890123456' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'phone')).toBeDefined();
    });

    it('should accept a long but valid E.164 number', async () => {
      const req = { body: { phone: '+905385129119' } };
      const errors = await runValidation(req);
      expect(errors.array().find(e => e.path === 'phone')).toBeUndefined();
    });
  });

  describe('middleware integration', () => {
    it('should call next() when validation passes', async () => {
      const req = { body: { phone: '+919876543210' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      for (const middleware of validateUpdatePhone) {
        await middleware(req, res, next);
      }

      expect(next).toHaveBeenCalled();
      expect(res.status).not.toHaveBeenCalled();
    });

    it('should return 400 when validation fails', async () => {
      const req = { body: { phone: '123' } };
      const res = { status: jest.fn().mockReturnThis(), json: jest.fn() };
      const next = jest.fn();

      for (const middleware of validateUpdatePhone) {
        await middleware(req, res, next);
      }

      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ statusCode: 400, message: expect.any(String) })
      );
    });
  });
});
