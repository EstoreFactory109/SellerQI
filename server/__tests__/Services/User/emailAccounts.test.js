/**
 * Tests for multi-email accounts.
 *
 * The rules that matter:
 *  - only VERIFIED extra addresses receive mail or can be used to sign in;
 *  - a muted address is skipped for broadcast mail;
 *  - the last remaining recipient cannot be muted, or the account goes silent.
 */

const {
  normalizeEmail,
  isValidEmail,
  getMailRecipients,
  toEmailListResponse,
  countRecipientsWithout,
  generateVerificationCode,
  verificationExpiry,
  VERIFICATION_TTL_MINUTES,
} = require('../../../Services/User/emailAccounts.js');

const user = (overrides = {}) => ({
  email: 'primary@test.com',
  primaryReceivesMail: true,
  additionalEmails: [],
  createdAt: new Date('2026-01-01'),
  ...overrides,
});

describe('emailAccounts', () => {
  describe('normalizeEmail', () => {
    it('lowercases and trims', () => {
      expect(normalizeEmail('  Foo@Bar.COM ')).toBe('foo@bar.com');
    });
    it('handles non-strings', () => {
      expect(normalizeEmail(undefined)).toBe('');
      expect(normalizeEmail(null)).toBe('');
    });
  });

  describe('isValidEmail', () => {
    it.each(['a@b.com', 'first.last+tag@sub.domain.co'])('accepts %s', (e) => {
      expect(isValidEmail(e)).toBe(true);
    });
    it.each(['nope', 'a@b', 'a b@c.com', ''])('rejects %s', (e) => {
      expect(isValidEmail(e)).toBe(false);
    });
  });

  describe('getMailRecipients', () => {
    it('returns just the primary when nothing else is added', () => {
      expect(getMailRecipients(user())).toEqual(['primary@test.com']);
    });

    it('includes verified extra addresses that are switched on', () => {
      const u = user({
        additionalEmails: [{ email: 'extra@test.com', isVerified: true, receivesMail: true }],
      });
      expect(getMailRecipients(u)).toEqual(['primary@test.com', 'extra@test.com']);
    });

    it('excludes UNVERIFIED addresses even when switched on', () => {
      const u = user({
        additionalEmails: [{ email: 'pending@test.com', isVerified: false, receivesMail: true }],
      });
      expect(getMailRecipients(u)).toEqual(['primary@test.com']);
    });

    it('excludes verified addresses that are switched off', () => {
      const u = user({
        additionalEmails: [{ email: 'muted@test.com', isVerified: true, receivesMail: false }],
      });
      expect(getMailRecipients(u)).toEqual(['primary@test.com']);
    });

    it('excludes the primary when it is muted', () => {
      const u = user({
        primaryReceivesMail: false,
        additionalEmails: [{ email: 'extra@test.com', isVerified: true, receivesMail: true }],
      });
      expect(getMailRecipients(u)).toEqual(['extra@test.com']);
    });

    it('returns an empty list when everything is muted', () => {
      const u = user({ primaryReceivesMail: false });
      expect(getMailRecipients(u)).toEqual([]);
    });

    it('de-duplicates and normalises', () => {
      const u = user({
        additionalEmails: [{ email: 'PRIMARY@test.com', isVerified: true, receivesMail: true }],
      });
      expect(getMailRecipients(u)).toEqual(['primary@test.com']);
    });

    it('handles a missing user', () => {
      expect(getMailRecipients(null)).toEqual([]);
    });
  });

  describe('countRecipientsWithout', () => {
    const u = user({
      additionalEmails: [{ email: 'extra@test.com', isVerified: true, receivesMail: true }],
    });

    it('counts what would remain if an address were muted', () => {
      expect(countRecipientsWithout(u, 'extra@test.com')).toBe(1);
      expect(countRecipientsWithout(u, 'primary@test.com')).toBe(1);
    });

    it('reports zero when muting the only recipient', () => {
      expect(countRecipientsWithout(user(), 'primary@test.com')).toBe(0);
    });
  });

  describe('toEmailListResponse', () => {
    const u = user({
      additionalEmails: [
        { email: 'extra@test.com', isVerified: true, receivesMail: false, verificationCode: '123456' },
      ],
    });

    it('puts the primary first and flags it', () => {
      const [first] = toEmailListResponse(u);
      expect(first).toMatchObject({ email: 'primary@test.com', isPrimary: true, isVerified: true });
    });

    it('never leaks the verification code', () => {
      const json = JSON.stringify(toEmailListResponse(u));
      expect(json).not.toContain('123456');
      expect(json).not.toContain('verificationCode');
    });

    it('reports each address verification and mail state', () => {
      const [, extra] = toEmailListResponse(u);
      expect(extra).toMatchObject({ email: 'extra@test.com', isPrimary: false, isVerified: true, receivesMail: false });
    });
  });

  describe('verification codes', () => {
    it('is six digits', () => {
      for (let i = 0; i < 25; i += 1) {
        expect(generateVerificationCode()).toMatch(/^\d{6}$/);
      }
    });

    it('expires in the configured window', () => {
      const ms = verificationExpiry().getTime() - Date.now();
      expect(ms).toBeGreaterThan((VERIFICATION_TTL_MINUTES - 1) * 60 * 1000);
      expect(ms).toBeLessThanOrEqual(VERIFICATION_TTL_MINUTES * 60 * 1000);
    });
  });
});
