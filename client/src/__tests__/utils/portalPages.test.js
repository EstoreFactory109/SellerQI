/**
 * Typing another portal's URL must leave the visitor on the page they were on,
 * so the last page of each portal is remembered — and must never be a login page,
 * or the redirect would land right back on a guard.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { portalOf, rememberPortalPage, returnPathFor } from '../../utils/portalPages.js';

// setup.js stubs localStorage with vi.fn(); back it with a real map here.
let store;
beforeEach(() => {
  store = {};
  localStorage.getItem.mockImplementation((key) => (key in store ? store[key] : null));
  localStorage.setItem.mockImplementation((key, value) => { store[key] = String(value); });
});

describe('portalOf', () => {
  it('maps each portal', () => {
    expect(portalOf('/manage-accounts/logs/email')).toBe('admin');
    expect(portalOf('/esf/users')).toBe('esf');
    expect(portalOf('/esf')).toBe('esf');
    expect(portalOf('/manage-agency-users/settings')).toBe('agency');
    expect(portalOf('/seller-central-checker/dashboard')).toBe('user');
  });

  it('gives login, invite and demo pages no portal', () => {
    ['/', '/esf-login', '/esf-login/verify/abc', '/esf-invite/abc', '/admin-login', '/member-login',
      '/seller-central-checker-demo/dashboard'].forEach((path) => expect(portalOf(path)).toBeNull());
  });
});

describe('returnPathFor', () => {
  const admin = { kind: 'admin', home: '/manage-accounts', inAccount: false };

  it("returns the portal's home when nothing was remembered", () => {
    expect(returnPathFor(admin)).toBe('/manage-accounts');
  });

  it('returns the exact page last visited in that portal, query string included', () => {
    rememberPortalPage('/manage-accounts/logs/email', '?page=2');
    expect(returnPathFor(admin)).toBe('/manage-accounts/logs/email?page=2');
  });

  it("never returns another portal's page", () => {
    rememberPortalPage('/esf/users');
    expect(returnPathFor(admin)).toBe('/manage-accounts');
  });

  it('never remembers a login page', () => {
    rememberPortalPage('/esf-login');
    expect(Object.keys(store)).toHaveLength(0);
  });

  it("returns the client's page when staff were last inside a client account", async () => {
    rememberPortalPage('/esf/clients');
    await new Promise((r) => setTimeout(r, 2));
    rememberPortalPage('/seller-central-checker/tasks');
    expect(returnPathFor({ kind: 'esf', home: '/esf/clients', inAccount: true })).toBe('/seller-central-checker/tasks');
  });

  it('ignores that client page once the client account has been closed', () => {
    rememberPortalPage('/seller-central-checker/tasks');
    expect(returnPathFor({ kind: 'esf', home: '/esf/clients', inAccount: false })).toBe('/esf/clients');
  });
});
