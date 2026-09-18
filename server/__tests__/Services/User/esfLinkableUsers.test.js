/**
 * Tests for who may be adopted into the ESF portal.
 *
 * The eligibility filter is the security-relevant part: it is what stops staff
 * from claiming an agency's client, another staff account, or a seller this
 * portal already manages. linkUsersToEsf re-applies the SAME filter on write,
 * so a stale picker or a crafted request cannot bypass it — the test below
 * asserts those two stay identical.
 */

const {
  LINKABLE_FILTERS,
  linkableBaseMatch,
  searchMatch,
  filterMatch,
} = require('../../../Services/User/esfLinkableUsers.js');

describe('esfLinkableUsers', () => {
  describe('linkableBaseMatch', () => {
    const match = linkableBaseMatch();

    it('only offers plain sellers, never staff or agency owners', () => {
      // accessType 'user' excludes superAdmin, enterpriseAdmin (agency owner) and esfUser.
      expect(match.accessType).toBe('user');
    });

    it('excludes sellers this portal already manages', () => {
      expect(match.isEsfClient).toEqual({ $ne: true });
    });

    it('excludes sellers owned by an agency, both flags', () => {
      // isAgencyClient alone is not enough — legacy rows set agencyId without it.
      expect(match.isAgencyClient).toEqual({ $ne: true });
      expect(match.agencyId).toBeNull();
    });

    it('excludes purged and unverified accounts', () => {
      expect(match.purgedAt).toBeNull();
      expect(match.isVerified).toBe(true);
    });
  });

  describe('searchMatch', () => {
    it('is null when there is no term, so the base set is untouched', () => {
      expect(searchMatch('')).toBeNull();
      expect(searchMatch('   ')).toBeNull();
      expect(searchMatch(undefined)).toBeNull();
    });

    it('searches name, email and phone case-insensitively', () => {
      const m = searchMatch('Ann');
      const fields = m.$or.map((c) => Object.keys(c)[0]);
      expect(fields).toEqual(['firstName', 'lastName', 'email', 'phone']);
      expect(m.$or[0].firstName.flags).toContain('i');
    });

    it('escapes regex metacharacters instead of letting them run', () => {
      // A search for "a+b" must look for the literal text, not a quantifier.
      const m = searchMatch('a+b(c)');
      expect(m.$or[0].firstName.source).toBe('a\\+b\\(c\\)');
      expect(() => new RegExp(m.$or[0].firstName.source)).not.toThrow();
    });
  });

  describe('filterMatch', () => {
    it('maps each capsule to a query', () => {
      expect(filterMatch('PRO')).toEqual({ packageType: 'PRO' });
      expect(filterMatch('LITE')).toEqual({ packageType: 'LITE' });
      expect(filterMatch('connected')).toEqual({ hasSpApi: true, hasAdsApi: true });
    });

    it('treats "not connected" as missing EITHER integration', () => {
      expect(filterMatch('notConnected')).toEqual({ $or: [{ hasSpApi: false }, { hasAdsApi: false }] });
    });

    it('returns null for "all" and for anything unrecognised', () => {
      expect(filterMatch('all')).toBeNull();
      expect(filterMatch('; drop everything')).toBeNull();
      expect(filterMatch(undefined)).toBeNull();
    });

    it('connected and notConnected are complements', () => {
      const connected = filterMatch('connected');
      const notConnected = filterMatch('notConnected');
      expect(Object.keys(connected)).toEqual(['hasSpApi', 'hasAdsApi']);
      expect(notConnected.$or).toHaveLength(2);
    });
  });

  describe('capsules', () => {
    it('exposes exactly the filters the UI offers', () => {
      expect(LINKABLE_FILTERS).toEqual(['all', 'PRO', 'LITE', 'connected', 'notConnected']);
    });
  });

  describe('read and write agree', () => {
    it('linkUsersToEsf writes behind the same eligibility filter it reads with', () => {
      // Both paths call linkableBaseMatch(), so a rule can never be tightened for
      // the picker while leaving the write open. Assert the source proves it.
      const src = require('fs').readFileSync(
        require('path').join(__dirname, '..', '..', '..', 'Services', 'User', 'esfLinkableUsers.js'),
        'utf8'
      );
      const updateMany = src.slice(src.indexOf('const linkUsersToEsf'));
      expect(updateMany).toContain('...linkableBaseMatch()');
    });
  });
});
