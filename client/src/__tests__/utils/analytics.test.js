import { describe, it, expect, vi, afterEach } from 'vitest';
import { trackEvent } from '../../utils/analytics.js';

describe('trackEvent', () => {
  afterEach(() => { delete window.gtag; });

  it('sends a GA4 event when gtag is loaded', () => {
    window.gtag = vi.fn();
    trackEvent('fixit_open', { source: 'hero' });
    expect(window.gtag).toHaveBeenCalledWith('event', 'fixit_open', { source: 'hero' });
  });

  it('does nothing without gtag', () => {
    expect(() => trackEvent('fixit_open')).not.toThrow();
  });

  // Tracking must never break the UI it measures.
  it('swallows errors from gtag', () => {
    window.gtag = () => { throw new Error('blocked'); };
    expect(() => trackEvent('fixit_open')).not.toThrow();
  });
});
