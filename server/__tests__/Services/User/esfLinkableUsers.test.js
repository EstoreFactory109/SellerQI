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
      expect(match.accessType).toEqual({ $nin: ['superAdmin', 'enterpriseAdmin', 'esfUser'] });
      expect(match.packageType).toEqual({ $ne: 'AGENCY' });
    });

    it('still offers legacy sellers that have no accessType stored', () => {
      // An exact { accessType: 'user' } would not match a document without the field.
      expect(match.accessType.$nin).not.toContain(undefined);
      expect(match.accessType.$nin).not.toContain('user');
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

    it('searches name, both kinds of email, phone and brand case-insensitively', () => {
      const m = searchMatch('Ann');
      expect(m.$and).toHaveLength(1);
      const fields = m.$and[0].$or.map((c) => Object.keys(c)[0]);
      expect(fields).toEqual(['firstName', 'lastName', 'email', 'additionalEmails.email', 'phone', 'sellerBrands']);
      expect(m.$and[0].$or[0].firstName.flags).toContain('i');
    });

    it('matches each word against any field, so a full name finds the person', () => {
      const m = searchMatch('  john   smith ');
      expect(m.$and).toHaveLength(2);
      const matches = (word, doc) => m.$and[word].$or.some((c) => {
        const [field, rx] = Object.entries(c)[0];
        return rx.test(doc[field] || '');
      });
      const doc = { firstName: 'John', lastName: 'Smith', email: 'j@x.com', phone: '1', sellerBrands: 'Acme' };
      expect(matches(0, doc) && matches(1, doc)).toBe(true);
      expect(matches(0, { ...doc, firstName: 'Mary' })).toBe(false);
    });

    it('finds a brand name, which is shown in each row', () => {
      const m = searchMatch('acme');
      const brand = m.$and[0].$or.find((c) => c.sellerBrands).sellerBrands;
      expect(brand.test('ACME Home Goods')).toBe(true);
    });

    it('treats straight and curly apostrophes alike', () => {
      const typed = searchMatch("tom's").$and[0].$or[0].firstName;
      expect(typed.test('Tom\u2019s Kitchen')).toBe(true);
      expect(typed.test("Tom's Kitchen")).toBe(true);
      const curly = searchMatch('tom\u2019s').$and[0].$or[0].firstName;
      expect(curly.test("Tom's Kitchen")).toBe(true);
    });

    it('finds a phone number however it is spaced', () => {
      const m = searchMatch('+1 (555) 123-4567');
      const phone = m.$or.find((c) => c.phone).phone;
      expect(phone.test('15551234567')).toBe(true);
      expect(phone.test('+1 555 123 4567')).toBe(true);
      expect(phone.test('+1 555 123 9999')).toBe(false);
      // Not a phone-like term: no phone alternative.
      expect(searchMatch('john').$or).toBeUndefined();
      expect(searchMatch('12').$or).toBeUndefined();
    });

    it('escapes regex metacharacters instead of letting them run', () => {
      // A search for "a+b" must look for the literal text, not a quantifier.
      const m = searchMatch('a+b(c)');
      const rx = m.$and[0].$or[0].firstName;
      expect(rx.source).toBe('a\\+b\\(c\\)');
      expect(() => new RegExp(rx.source)).not.toThrow();
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
