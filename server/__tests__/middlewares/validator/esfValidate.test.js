/**
 * Tests for the ESF staff portal validators.
 *
 * ESF clients must have a password (they sign in at the main login page) held to
 * the SAME strength rules as the normal signup page. Staff join by invitation
 * with nothing but their address, and sign in with an emailed link afterwards.
 */

const { validationResult } = require('express-validator');
const {
  validateEsfLogin,
  validateEsfClient,
  validateEsfInvite,
  validateEsfNickname,
  validateEsfLoginLink,
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
  password: 'Cl1entPass!',
};

describe('esfValidate', () => {
  describe('validateEsfClient', () => {
    it('passes with a valid payload', async () => {
      const { errors } = await run(validateEsfClient, clientBody);
      expect(errors.isEmpty()).toBe(true);
    });

    it('requires a password so the client can sign in', async () => {
      const { password, ...withoutPassword } = clientBody;
      const { errors } = await run(validateEsfClient, withoutPassword);
      expect(errorFor(errors, 'password')).toBeDefined();
    });

    it('rejects a password shorter than 8 characters', async () => {
      const { errors } = await run(validateEsfClient, { ...clientBody, password: 'short' });
      expect(errorFor(errors, 'password')).toBeDefined();
    });


    it.each([
      ['no uppercase', 'cl1entpass!'],
      ['no lowercase', 'CL1ENTPASS!'],
      ['no number', 'ClientPass!'],
      ['no special character', 'Cl1entPass'],
      ['too short', 'Cl1!aA'],
    ])('rejects a password with %s', async (_label, password) => {
      const { errors } = await run(validateEsfClient, { ...clientBody, password });
      expect(errorFor(errors, 'password')).toBeDefined();
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

  describe('validateEsfInvite', () => {
    it('passes with just an email', async () => {
      const { errors } = await run(validateEsfInvite, { email: 'new@estorefactory.net' });
      expect(errors.isEmpty()).toBe(true);
    });

    it('accepts an assignable role', async () => {
      const { errors } = await run(validateEsfInvite, { email: 'new@estorefactory.net', role: 'admin' });
      expect(errorFor(errors, 'role')).toBeUndefined();
    });

    it('refuses to invite someone straight to owner', async () => {
      const { errors } = await run(validateEsfInvite, { email: 'new@estorefactory.net', role: 'owner' });
      expect(errorFor(errors, 'role')).toBeDefined();
    });

    it('rejects a malformed email', async () => {
      const { errors } = await run(validateEsfInvite, { email: 'nope' });
      expect(errorFor(errors, 'email')).toBeDefined();
    });
  });

  describe('validateEsfInvite nickname', () => {
    it('accepts an optional nickname', async () => {
      const { errors } = await run(validateEsfInvite, { email: 'new@estorefactory.net', name: "Priya O'Neil" });
      expect(errors.isEmpty()).toBe(true);
    });

    it('treats an empty nickname as none', async () => {
      const { errors } = await run(validateEsfInvite, { email: 'new@estorefactory.net', name: '' });
      expect(errors.isEmpty()).toBe(true);
    });

    it('rejects a nickname with symbols', async () => {
      const { errors } = await run(validateEsfInvite, { email: 'new@estorefactory.net', name: '<script>' });
      expect(errorFor(errors, 'name')).toBeDefined();
    });
  });

  describe('validateEsfNickname', () => {
    it('rejects a one-character name', async () => {
      const { errors } = await run(validateEsfNickname, { name: 'P' });
      expect(errorFor(errors, 'name')).toBeDefined();
    });

    it('allows clearing the name', async () => {
      const { errors } = await run(validateEsfNickname, { name: '' });
      expect(errors.isEmpty()).toBe(true);
    });
  });

  describe('validateEsfLoginLink', () => {
    it('needs a valid email', async () => {
      const { errors } = await run(validateEsfLoginLink, { email: 'nope' });
      expect(errorFor(errors, 'email')).toBeDefined();
    });
  });

  describe('validateEsfLogin', () => {
    it('passes with an email and password', async () => {
      const { errors } = await run(validateEsfLogin, { email: 'staff@estorefactory.net', password: 'S3cretPass!' });
      expect(errors.isEmpty()).toBe(true);
    });

    it('rejects a missing password', async () => {
      const { errors } = await run(validateEsfLogin, { email: 'staff@estorefactory.net', password: '' });
      expect(errorFor(errors, 'password')).toBeDefined();
    });

    it('rejects a malformed email', async () => {
      const { errors } = await run(validateEsfLogin, { email: 'nope', password: 'S3cretPass!' });
      expect(errorFor(errors, 'email')).toBeDefined();
    });
  });
});
