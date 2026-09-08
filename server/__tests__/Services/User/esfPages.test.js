/**
 * Tests for ESF per-member page access.
 *
 * Two things matter most here:
 *  - shared endpoints (navbar, profile, location) must NEVER map to a page, or
 *    restricting one page would break the whole app for that member;
 *  - the blocklist must sanitise unknown keys, so a stale key can neither
 *    block a page that no longer exists nor be reflected back to the UI.
 */

const {
  ESF_CLIENT_PAGES,
  ESF_PAGE_KEYS,
  sanitizeDeniedPages,
  pageKeyForApiPath,
  isPageDeniedFor,
} = require('../../../Services/User/esfPages.js');

describe('esfPages', () => {
  describe('catalogue', () => {
    it('has unique keys', () => {
      expect(new Set(ESF_PAGE_KEYS).size).toBe(ESF_PAGE_KEYS.length);
    });

    it('gives every page a label and a group so the UI can render it', () => {
      ESF_CLIENT_PAGES.forEach((page) => {
        expect(typeof page.key).toBe('string');
        expect(page.label).toBeTruthy();
        expect(page.group).toBeTruthy();
      });
    });

    it('includes the ESF-only Client Dashboard', () => {
      expect(ESF_PAGE_KEYS).toContain('client-dashboard');
    });
  });

  describe('pageKeyForApiPath', () => {
    it.each([
      ['/api/pagewise/dashboard-phase2', 'dashboard'],
      ['/api/pagewise/esf/client-dashboard?startDate=2026-08-01', 'client-dashboard'],
      ['/api/pagewise/ppc/summary', 'ppc-dashboard'],
      ['/api/pagewise/profitability/metrics', 'profitibility-dashboard'],
      ['/api/pagewise/issues/ranking', 'issues'],
      ['/api/pagewise/your-products-v3/summary', 'your-products'],
      ['/api/qmate/ask', 'qmate'],
    ])('maps %s to %s', (path, expected) => {
      expect(pageKeyForApiPath(path)).toBe(expected);
    });

    it.each([
      '/api/pagewise/navbar',
      '/api/pagewise/comparison-debug',
      '/app/profile',
      '/api/total-sales/filter',
    ])('leaves shared endpoint %s unrestricted', (path) => {
      expect(pageKeyForApiPath(path)).toBeNull();
    });

    it('prefers the longest matching prefix', () => {
      // '/api/pagewise/esf/client-dashboard' must not be captured by a shorter prefix.
      expect(pageKeyForApiPath('/api/pagewise/esf/client-dashboard')).toBe('client-dashboard');
    });

    it('handles non-string input', () => {
      expect(pageKeyForApiPath(undefined)).toBeNull();
      expect(pageKeyForApiPath(null)).toBeNull();
    });
  });

  describe('sanitizeDeniedPages', () => {
    it('drops unknown keys', () => {
      expect(sanitizeDeniedPages(['dashboard', 'not-a-page'])).toEqual(['dashboard']);
    });

    it('de-duplicates', () => {
      expect(sanitizeDeniedPages(['issues', 'issues'])).toEqual(['issues']);
    });

    it('returns an empty list for non-array input', () => {
      expect(sanitizeDeniedPages(undefined)).toEqual([]);
      expect(sanitizeDeniedPages('dashboard')).toEqual([]);
    });
  });

  describe('isPageDeniedFor', () => {
    const restricted = { esfDeniedPages: ['profitibility-dashboard', 'qmate'] };

    it('blocks a page on the list', () => {
      expect(isPageDeniedFor(restricted, 'profitibility-dashboard')).toBe(true);
    });

    it('allows a page not on the list', () => {
      expect(isPageDeniedFor(restricted, 'dashboard')).toBe(false);
    });

    it('never restricts the owner', () => {
      expect(isPageDeniedFor(restricted, 'qmate', { isOwner: true })).toBe(false);
    });

    it('allows everything when the list is empty — the default is full access', () => {
      expect(isPageDeniedFor({ esfDeniedPages: [] }, 'dashboard')).toBe(false);
      expect(isPageDeniedFor({}, 'dashboard')).toBe(false);
    });

    it('never blocks when there is no page key (shared endpoint)', () => {
      expect(isPageDeniedFor(restricted, null)).toBe(false);
    });
  });
});
