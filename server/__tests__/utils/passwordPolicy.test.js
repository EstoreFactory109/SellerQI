/**
 * Tests for the shared server-side password policy.
 *
 * The important one is the last block: it runs the SAME passwords through the
 * signup validator (registerValidate) and through this policy, and asserts they
 * agree. If someone later loosens or tightens one without the other, that test
 * fails instead of the two quietly diverging — which is exactly how the ESF
 * forms ended up weaker than signup in the first place.
 */

const { body, validationResult } = require('express-validator');
const {
  PASSWORD_RULES,
  isStrongPassword,
  passwordPolicyMessage,
  applyPasswordRules,
} = require('../../utils/passwordPolicy.js');
const registerValidate = require('../../middlewares/validator/registerValidate.js');

const SAMPLES = [
  'Str0ng!Pass',      // valid
  'Cl1entPass!',      // valid
  'Abcdefg1#',        // valid — symbol the old client-side regex used to reject
  'nouppercase1!',    // no uppercase
  'NOLOWERCASE1!',    // no lowercase
  'NoNumbers!!',      // no number
  'NoSpecial123',     // no special character
  'Ab1!',             // too short
  '',                 // empty
];

/** Run a single express-validator chain and report whether `password` failed. */
const runChain = async (chain, password) => {
  const req = { body: { password } };
  await chain.run(req);
  return !validationResult(req).array().some((e) => e.path === 'password');
};

describe('passwordPolicy', () => {
  describe('isStrongPassword', () => {
    it.each(['Str0ng!Pass', 'Abcdefg1#', 'aA1!aA1!'])('accepts %s', (pw) => {
      expect(isStrongPassword(pw)).toBe(true);
    });

    it.each([
      ['no uppercase', 'nouppercase1!'],
      ['no lowercase', 'NOLOWERCASE1!'],
      ['no number', 'NoNumbers!!'],
      ['no special character', 'NoSpecial123'],
      ['too short', 'Ab1!'],
    ])('rejects a password with %s', (_label, pw) => {
      expect(isStrongPassword(pw)).toBe(false);
    });

    it('handles missing input rather than throwing', () => {
      expect(isStrongPassword(undefined)).toBe(false);
      expect(isStrongPassword(null)).toBe(false);
      expect(isStrongPassword('')).toBe(false);
    });
  });

  describe('passwordPolicyMessage', () => {
    it('is empty for an acceptable password', () => {
      expect(passwordPolicyMessage('Str0ng!Pass')).toBe('');
    });

    it('names only what is missing', () => {
      const msg = passwordPolicyMessage('NoSpecial123');
      expect(msg).toContain('one special character');
      expect(msg).not.toContain('one number');
      expect(msg).not.toContain('one uppercase');
    });

    it('lists every failure for an empty password', () => {
      const msg = passwordPolicyMessage('');
      PASSWORD_RULES.forEach((rule) => expect(msg).toContain(rule.label));
    });
  });

  describe('applyPasswordRules', () => {
    it('rejects and accepts in step with isStrongPassword', async () => {
      const chain = applyPasswordRules(body('password').notEmpty());
      for (const pw of SAMPLES) {
        // eslint-disable-next-line no-await-in-loop
        expect(await runChain(chain, pw)).toBe(isStrongPassword(pw));
      }
    });
  });

  describe('agreement with the signup validator', () => {
    // registerValidate is an array of chains ending in the response handler;
    // the password chain is the one that reports on the `password` field.
    const signupPasswordChain = registerValidate.find(
      (m) => typeof m?.run === 'function' && String(m.builder?.fields ?? m.fields ?? '').includes('password')
    );

    it('finds the signup password chain', () => {
      expect(signupPasswordChain).toBeDefined();
    });

    it('accepts and rejects exactly what signup does', async () => {
      for (const pw of SAMPLES) {
        // eslint-disable-next-line no-await-in-loop
        const signupAccepts = await runChain(signupPasswordChain, pw);
        expect({ pw, accepted: signupAccepts }).toEqual({ pw, accepted: isStrongPassword(pw) });
      }
    });
  });
});
