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
  PAGES_WITHOUT_GUARDED_API,
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

  /**
   * A page in the catalogue with no API mapping is a page that LOOKS restricted and
   * is not: pageKeyForApiPath returns null for an unmapped path, and null means
   * "never blocked". The Billing page shipped in exactly that state — a staff member
   * denied the page could still call /api/pagewise/esf/billing and read the client's
   * invoices, card last-four and billing address.
   */
  describe('every client page that has an API is actually guarded', () => {
    const denied = { esfDeniedPages: ESF_CLIENT_PAGES.map((p) => p.key) };

    // Real request paths, one per page with a backend beneath a GUARDED prefix.
    // The guards are mounted on /api/pagewise and /api/qmate only (api/app.js).
    const LIVE_ENDPOINTS = {
      'client-dashboard': '/api/pagewise/esf/client-dashboard',
      status: '/api/pagewise/esf/project-status',
      untapped: '/api/pagewise/esf/untapped',
      reports: '/api/pagewise/esf/reports',
      'report-history': '/api/pagewise/esf/reports/inventory-health/history',
      messages: '/api/pagewise/esf/messages',
      billing: '/api/pagewise/esf/billing',
      dashboard: '/api/pagewise/dashboard',
      qmate: '/api/qmate/ask',
      'your-products': '/api/pagewise/your-products',
      'ppc-dashboard': '/api/pagewise/ppc/summary',
      'keyword-analysis': '/api/pagewise/keyword-analysis',
      tasks: '/api/pagewise/tasks',
      'profitibility-dashboard': '/api/pagewise/profitability/metrics',
      'reimbursement-dashboard': '/api/pagewise/reimbursement',
      issues: '/api/pagewise/issues/summary',
      'account-history': '/api/pagewise/account-history',
    };

    Object.entries(LIVE_ENDPOINTS).forEach(([key, path]) => {
      it(`blocks ${key} at its API, not just in the nav`, () => {
        expect(pageKeyForApiPath(path)).toBe(key);
        expect(isPageDeniedFor(denied, pageKeyForApiPath(path))).toBe(true);
      });
    });

    /**
     * The test that makes this a rule rather than a list someone remembered to
     * update. Billing shipped unguarded, then Messages, then Reports — three
     * instances of one mistake, each found by accident. A new page now cannot be
     * added without either mapping it or saying in writing why it needs no mapping.
     */
    it('accounts for EVERY page in the catalogue — mapped, or excused in writing', () => {
      const unaccounted = ESF_PAGE_KEYS.filter(
        (key) => !(key in LIVE_ENDPOINTS) && !(key in PAGES_WITHOUT_GUARDED_API),
      );
      expect(unaccounted).toEqual([]);
    });

    it('does not let a page be excused and mapped at the same time', () => {
      // Contradictory entries would make the coverage test above pass while the
      // reason recorded beside the page is false.
      const both = Object.keys(PAGES_WITHOUT_GUARDED_API).filter((k) => k in LIVE_ENDPOINTS);
      expect(both).toEqual([]);
    });

    it('gives every excused page a non-empty reason', () => {
      Object.entries(PAGES_WITHOUT_GUARDED_API).forEach(([key, reason]) => {
        expect(ESF_PAGE_KEYS).toContain(key);
        expect(typeof reason).toBe('string');
        expect(reason.length).toBeGreaterThan(20);
      });
    });

    /**
     * Report History is a SEPARATE blockable page from Reports, and its route puts
     * the variable segment in the middle — so no string prefix can tell the two
     * apart. Without the RegExp entry this resolves to 'reports' and a member
     * denied only Report History is still served every archived report.
     */
    it('distinguishes Report History from Reports, despite the shared prefix', () => {
      expect(pageKeyForApiPath('/api/pagewise/esf/reports/inventory-health/history')).toBe('report-history');
      expect(pageKeyForApiPath('/api/pagewise/esf/reports/inventory-health/rows')).toBe('reports');
      expect(pageKeyForApiPath('/api/pagewise/esf/reports')).toBe('reports');
    });

    it('blocks Report History for a member denied only that page', () => {
      const historyOnly = { esfDeniedPages: ['report-history'] };
      const path = '/api/pagewise/esf/reports/inventory-health/history';

      expect(isPageDeniedFor(historyOnly, pageKeyForApiPath(path))).toBe(true);
      // ...and leaves the reports they ARE allowed alone.
      expect(isPageDeniedFor(historyOnly, pageKeyForApiPath('/api/pagewise/esf/reports'))).toBe(false);
    });

    it('guards the invoice PDF through the same entry, by longest-prefix match', () => {
      // A second mapping for the PDF route would be redundant; this asserts the
      // prefix match genuinely covers it rather than leaving a hole beside it.
      expect(pageKeyForApiPath('/api/pagewise/esf/billing/invoices/ESFI3635/pdf')).toBe('billing');
    });

    it('leaves shared infrastructure unrestricted', () => {
      // Blocking these would break the whole app for a member rather than one page.
      ['/api/pagewise/navbar', '/app/profile'].forEach((path) => {
        expect(pageKeyForApiPath(path)).toBeNull();
      });
    });

    /**
     * ── A HOLE THIS FILE CANNOT CLOSE, RECORDED SO IT IS NOT MISTAKEN FOR CLOSED ──
     *
     * Review Requests is a blockable page served from /api/review, and no page guard
     * is mounted on that prefix at all (api/app.js mounts them on /api/pagewise and
     * /api/qmate only). So a member denied the page can still call /api/review/*.
     *
     * Adding an API_PATH_TO_PAGE entry would NOT fix it — pageKeyForApiPath is never
     * consulted for that request. Closing it means mounting the guard on the route,
     * which is a behaviour change on a live endpoint and belongs in its own change.
     * This test pins the current, known-wrong state so that fixing it fails here
     * loudly and this comment gets deleted with it.
     */
    it('KNOWN GAP: /api/review carries no page guard, so a mapping would not help', () => {
      expect(pageKeyForApiPath('/api/review/recent-orders')).toBeNull();
      expect(PAGES_WITHOUT_GUARDED_API['review-request']).toMatch(/no page guard/i);
    });
  });
});
