/**
 * Tests for the ESF staff portal validators.
 *
 * The important distinction covered here: ESF *clients* have no password (they
 * are only reachable by impersonation), while ESF *staff* must have one, since
 * they sign in at /esf-login directly.
 */

const { validationResult } = require('express-validator');
const {
  validateEsfLogin,
  validateEsfClient,
  validateEsfUser,
} = require('../../../middlewares/validator/esfValidate.js');

const run = async (chain, body) => {
  const req = { body: { ...body } };
  // Every chain ends with the response handler; run only the rules.
  for (const middleware of chain.slice(0, -1)) {
    await middleware(req, {}, () => {});
  }
  return { req, errors: validationResult(req) };
};

const errorFor = (errors, path) => errors.array().find((e) => e.path === path);

const clientBody = {
  firstname: 'Priya',
  lastname: 'Shah',
  phone: '+19876543210',
  email: 'client@test.com',
};
const staffBody = { ...clientBody, email: 'staff@estorefactory.net', password: 'S3cretPass' };

describe('esfValidate', () => {
  describe('validateEsfClient', () => {
    it('passes with a valid payload and no password', async () => {
      const { errors } = await run(validateEsfClient, clientBody);
      expect(errors.isEmpty()).toBe(true);
    });

    it('keeps the country code on the phone', async () => {
      const { req } = await run(validateEsfClient, { ...clientBody, phone: '+91 98765-43210' });
      expect(req.body.phone).toBe('+919876543210');
    });

    it('accepts a bare 10-digit number', async () => {
      const { errors } = await run(validateEsfClient, { ...clientBody, phone: '9876543210' });
      expect(errorFor(errors, 'phone')).toBeUndefined();
    });

    it.each([
      ['empty', ''],
      ['letters', '+91 98765abcde'],
      ['too short', '+91 12345'],
      ['too long', '+911234567890123456'],
    ])('rejects a phone that is %s', async (_label, phone) => {
      const { errors } = await run(validateEsfClient, { ...clientBody, phone });
      expect(errorFor(errors, 'phone')).toBeDefined();
    });

    it('rejects an invalid email', async () => {
      const { errors } = await run(validateEsfClient, { ...clientBody, email: 'not-an-email' });
      expect(errorFor(errors, 'email')).toBeDefined();
    });

    it('rejects a numeric first name', async () => {
      const { errors } = await run(validateEsfClient, { ...clientBody, firstname: 'Pr1ya' });
      expect(errorFor(errors, 'firstname')).toBeDefined();
    });

    it('rejects a one-character last name', async () => {
      const { errors } = await run(validateEsfClient, { ...clientBody, lastname: 'S' });
      expect(errorFor(errors, 'lastname')).toBeDefined();
    });
  });

  describe('validateEsfUser', () => {
    it('passes with a valid staff payload', async () => {
      const { errors } = await run(validateEsfUser, staffBody);
      expect(errors.isEmpty()).toBe(true);
    });

    it('requires a password, unlike a client', async () => {
      const { password, ...withoutPassword } = staffBody;
      const { errors } = await run(validateEsfUser, withoutPassword);
      expect(errorFor(errors, 'password')).toBeDefined();
    });

    it('rejects a password shorter than 8 characters', async () => {
      const { errors } = await run(validateEsfUser, { ...staffBody, password: 'short' });
      expect(errorFor(errors, 'password')).toBeDefined();
    });
  });

  describe('validateEsfLogin', () => {
    it('passes with an email and password', async () => {
      const { errors } = await run(validateEsfLogin, { email: 'staff@estorefactory.net', password: 'S3cretPass' });
      expect(errors.isEmpty()).toBe(true);
    });

    it('rejects a missing password', async () => {
      const { errors } = await run(validateEsfLogin, { email: 'staff@estorefactory.net', password: '' });
      expect(errorFor(errors, 'password')).toBeDefined();
    });

    it('rejects a malformed email', async () => {
      const { errors } = await run(validateEsfLogin, { email: 'nope', password: 'S3cretPass' });
      expect(errorFor(errors, 'email')).toBeDefined();
    });
  });
});
