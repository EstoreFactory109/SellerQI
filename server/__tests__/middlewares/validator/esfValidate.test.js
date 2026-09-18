/**
 * Tests for the ESF staff portal validators.
 *
 * Both ESF clients and ESF staff must have a password: clients sign in at the
 * main login page, staff sign in at /esf-login. Both are held to the SAME
 * strength rules as the normal signup page - uppercase, lowercase, number and
 * special character - so neither form is a way past that requirement.
 */

const { validationResult } = require('express-validator');
const {
  validateEsfLogin,
  validateEsfClient,
  validateEsfInvite,
  validateEsfInviteAccept,
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
// Accepting an invite carries the person's own details only — the email and
// role come from the invitation, never the request body.
const acceptBody = { firstname: 'Priya', lastname: 'Shah', phone: '+19876543210', password: 'S3cretPass!' };

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

  describe('validateEsfInviteAccept', () => {
    it('passes with the details the invitee supplies', async () => {
      const { errors } = await run(validateEsfInviteAccept, acceptBody);
      expect(errors.isEmpty()).toBe(true);
    });

    it('requires a password meeting the signup rules', async () => {
      const { errors } = await run(validateEsfInviteAccept, { ...acceptBody, password: 'weakpass' });
      expect(errorFor(errors, 'password')).toBeDefined();
    });

    it('requires a name', async () => {
      const { errors } = await run(validateEsfInviteAccept, { ...acceptBody, firstname: '' });
      expect(errorFor(errors, 'firstname')).toBeDefined();
    });

    it('ignores any email sent in the body — it comes from the invitation', async () => {
      const { errors } = await run(validateEsfInviteAccept, { ...acceptBody, email: 'attacker@evil.com' });
      expect(errorFor(errors, 'email')).toBeUndefined();
      expect(errors.isEmpty()).toBe(true);
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
