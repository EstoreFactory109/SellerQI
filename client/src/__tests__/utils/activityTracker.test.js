/**
 * Every page count on the User activity pages depends on turning a URL into the
 * right page key, so pin the mapping.
 */
import { describe, it, expect } from 'vitest';
import { pageKeyFor } from '../../utils/activityTracker.js';

describe('pageKeyFor', () => {
  it('uses the seller-app page name', () => {
    expect(pageKeyFor('/seller-central-checker/dashboard')).toBe('dashboard');
    expect(pageKeyFor('/seller-central-checker/ppc-dashboard')).toBe('ppc-dashboard');
  });

  it('counts each settings tab as its own page', () => {
    expect(pageKeyFor('/seller-central-checker/settings', '?tab=members')).toBe('settings:members');
    expect(pageKeyFor('/seller-central-checker/settings', '')).toBe('settings:profile');
  });

  it('groups every product page together instead of one key per ASIN', () => {
    expect(pageKeyFor('/seller-central-checker/B0ABC12345')).toBe('product-details');
  });

  it('names Estore Factory pages by their own page', () => {
    expect(pageKeyFor('/seller-central-checker/estore-factory/reports')).toBe('reports');
  });

  it('drops ids from detail pages', () => {
    expect(pageKeyFor('/seller-central-checker/notification-details/64f0c0ffee')).toBe('notification-details');
  });

  it('handles onboarding pages', () => {
    expect(pageKeyFor('/connect-to-amazon')).toBe('connect-to-amazon');
  });
});
