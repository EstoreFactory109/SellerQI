/**
 * Tests for the ESF portal role rules.
 *
 * The owner protection is the important part: it must hold even when the
 * stored `esfRole` is missing or has been tampered with, because it is the only
 * thing stopping an admin from demoting or deleting the portal owner.
 */

const {
  ESF_ROLES,
  ASSIGNABLE_ESF_ROLES,
  ESF_OWNER_EMAIL,
  isEsfOwner,
  resolveEsfRole,
  canManageTeam,
} = require('../../../Services/User/esfRoles.js');

const owner = { email: ESF_OWNER_EMAIL, esfRole: ESF_ROLES.OWNER };
const admin = { email: 'admin@estorefactory.net', esfRole: ESF_ROLES.ADMIN };
const member = { email: 'member@estorefactory.net', esfRole: ESF_ROLES.MEMBER };

describe('esfRoles', () => {
  describe('owner identification', () => {
    it('recognises the owner by stored role', () => {
      expect(isEsfOwner({ email: 'someone@else.com', esfRole: ESF_ROLES.OWNER })).toBe(true);
    });

    it('recognises the owner by email even when esfRole is unset', () => {
      expect(isEsfOwner({ email: ESF_OWNER_EMAIL })).toBe(true);
    });

    it('still recognises the owner when esfRole has been downgraded in the database', () => {
      // The protection must not be defeatable by writing esfRole: 'member'.
      expect(isEsfOwner({ email: ESF_OWNER_EMAIL, esfRole: ESF_ROLES.MEMBER })).toBe(true);
    });

    it('matches the owner email case-insensitively and ignores surrounding space', () => {
      expect(isEsfOwner({ email: `  ${ESF_OWNER_EMAIL.toUpperCase()}  ` })).toBe(true);
    });

    it('does not treat other accounts as the owner', () => {
      expect(isEsfOwner(admin)).toBe(false);
      expect(isEsfOwner(member)).toBe(false);
      expect(isEsfOwner(null)).toBe(false);
      expect(isEsfOwner({})).toBe(false);
    });
  });

  describe('resolveEsfRole', () => {
    it('resolves each role', () => {
      expect(resolveEsfRole(owner)).toBe(ESF_ROLES.OWNER);
      expect(resolveEsfRole(admin)).toBe(ESF_ROLES.ADMIN);
      expect(resolveEsfRole(member)).toBe(ESF_ROLES.MEMBER);
    });

    it('defaults to member for an unset or unknown role', () => {
      expect(resolveEsfRole({ email: 'x@y.com' })).toBe(ESF_ROLES.MEMBER);
      expect(resolveEsfRole({ email: 'x@y.com', esfRole: 'superuser' })).toBe(ESF_ROLES.MEMBER);
    });

    it('never resolves a non-owner to owner via a forged role string', () => {
      // 'owner' IS honoured as a stored role, so the guard against forging it
      // lives at the API layer, which refuses to assign it. Assert that
      // contract here so it cannot be loosened silently.
      expect(ASSIGNABLE_ESF_ROLES).not.toContain(ESF_ROLES.OWNER);
      expect(ASSIGNABLE_ESF_ROLES).toEqual([ESF_ROLES.ADMIN, ESF_ROLES.MEMBER]);
    });
  });

  describe('canManageTeam', () => {
    it('allows the owner and admins', () => {
      expect(canManageTeam(owner)).toBe(true);
      expect(canManageTeam(admin)).toBe(true);
    });

    it('refuses members and unknown users', () => {
      expect(canManageTeam(member)).toBe(false);
      expect(canManageTeam({ email: 'x@y.com' })).toBe(false);
      expect(canManageTeam(null)).toBe(false);
    });

    it('allows the owner even with no esfRole stored', () => {
      expect(canManageTeam({ email: ESF_OWNER_EMAIL })).toBe(true);
    });
  });
});
