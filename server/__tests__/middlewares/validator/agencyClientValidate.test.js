/**
 * Tests for agency client registration validation.
 *
 * The phone rules used to force exactly 10 bare digits, which silently dropped
 * every client's country code. These cover the corrected behaviour.
 */

const { validationResult } = require('express-validator');
const { validateAgencyClientRegistration } = require('../../../middlewares/validator/agencyClientValidate.js');

const baseBody = { firstname: 'John', lastname: 'Doe', phone: '+19876543210', email: 'client@test.com' };

const runValidation = async (body) => {
  const req = { body: { ...baseBody, ...body } };
  for (const middleware of validateAgencyClientRegistration.slice(0, -1)) {
    await middleware(req, {}, () => {});
  }
  return { req, errors: validationResult(req) };
};

describe('agencyClientValidate', () => {
  describe('phone validation', () => {
    it('should pass with a country code', async () => {
      const { errors } = await runValidation({ phone: '+91 9876543210' });
      expect(errors.array().find(e => e.path === 'phone')).toBeUndefined();
    });

    it('should keep the country code instead of trimming it', async () => {
      const { req } = await runValidation({ phone: '+91 98765-43210' });
      expect(req.body.phone).toBe('+919876543210');
    });

    it('should still accept a bare 10-digit number', async () => {
      const { errors } = await runValidation({ phone: '9876543210' });
      expect(errors.array().find(e => e.path === 'phone')).toBeUndefined();
    });

    it('should fail with an empty phone', async () => {
      const { errors } = await runValidation({ phone: '' });
      expect(errors.array().find(e => e.path === 'phone')).toBeDefined();
    });

    it('should fail with letters in the phone', async () => {
      const { errors } = await runValidation({ phone: '+91 98765abcde' });
      expect(errors.array().find(e => e.path === 'phone')).toBeDefined();
    });

    it('should fail with fewer than 10 digits', async () => {
      const { errors } = await runValidation({ phone: '+91 12345' });
      expect(errors.array().find(e => e.path === 'phone')).toBeDefined();
    });

    it('should fail with more than 15 digits', async () => {
      const { errors } = await runValidation({ phone: '+911234567890123456' });
      expect(errors.array().find(e => e.path === 'phone')).toBeDefined();
    });
  });

  describe('other fields', () => {
    it('should pass with a valid payload', async () => {
      const { errors } = await runValidation({});
      expect(errors.isEmpty()).toBe(true);
    });

    it('should fail with an invalid email', async () => {
      const { errors } = await runValidation({ email: 'not-an-email' });
      expect(errors.array().find(e => e.path === 'email')).toBeDefined();
    });

    it('should fail with numbers in the firstname', async () => {
      const { errors } = await runValidation({ firstname: 'John123' });
      expect(errors.array().find(e => e.path === 'firstname')).toBeDefined();
    });
  });
});
