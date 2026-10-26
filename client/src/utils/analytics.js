/**
 * Thin wrapper over the GA4 tag that client/index.html loads globally.
 *
 * Never throws and does nothing without gtag (ad blockers, tests, local dev), so a
 * tracking call can never break the UI it measures.
 */
export function trackEvent(name, params = {}) {
  try {
    if (typeof window !== 'undefined' && typeof window.gtag === 'function') {
      window.gtag('event', name, params);
    }
  } catch {
    // Tracking is best-effort.
  }
}
