/**
 * Reports how the seller app is used, for the admin / ESF "User activity" pages.
 *
 *   page_view  - each time a different page is opened (settings tabs count as pages)
 *   heartbeat  - every 30s while the page is really in use: tab visible AND some
 *                input in the last 2 minutes, so a tab left open overnight adds nothing
 *
 * Only seller-app pages are reported. The server decides whose use it is (from the
 * session, not from anything sent here) and ignores admins/staff acting for a user,
 * caps the time it credits, and ignores duplicate heartbeats from a second tab.
 *
 * Sent with fetch + keepalive rather than axiosInstance: a failed report must
 * never trigger the session-expired redirect, and the last one should still go out
 * as the tab closes.
 */
import { portalOf } from './portalPages.js';

const HEARTBEAT_MS = 30 * 1000;
const IDLE_MS = 2 * 60 * 1000;
const ASIN = /^[A-Z0-9]{10}$/;

let currentKey = null;
let lastInputAt = Date.now();
let started = false;

/**
 * "/seller-central-checker/settings?tab=members" -> "settings:members",
 * "/seller-central-checker/B0ABC12345" -> "product-details". Matches the keys the
 * server labels (Services/Activity/activityReport.js).
 */
export const pageKeyFor = (pathname, search = '') => {
  const segments = pathname.split('/').filter(Boolean);
  let key;
  if (segments[0] === 'seller-central-checker') {
    key = segments[1] || 'dashboard';
    if (key === 'estore-factory') key = segments[2] || key;
    else if (ASIN.test(key)) key = 'product-details';
    else if (key === 'notification-details') key = 'notification-details';
    if (key === 'settings') key = `settings:${new URLSearchParams(search).get('tab') || 'profile'}`;
  } else {
    key = segments[0] || '';
  }
  key = key.toLowerCase().replace(/[^a-z0-9:-]/g, '').slice(0, 60);
  return key || null;
};

const send = (body) => {
  try {
    fetch(`${import.meta.env.VITE_BASE_URI}/app/activity`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  } catch {
    /* reporting must never break the page */
  }
};

const start = () => {
  if (started || typeof window === 'undefined') return;
  started = true;

  const noteInput = () => { lastInputAt = Date.now(); };
  ['mousemove', 'keydown', 'click', 'scroll', 'touchstart', 'wheel'].forEach((event) =>
    window.addEventListener(event, noteInput, { passive: true, capture: true })
  );
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') noteInput();
  });

  setInterval(() => {
    if (!currentKey) return;
    if (document.visibilityState !== 'visible') return;
    if (Date.now() - lastInputAt > IDLE_MS) return;
    send({ type: 'heartbeat', pageKey: currentKey, seconds: HEARTBEAT_MS / 1000 });
  }, HEARTBEAT_MS);
};

/** Call on every navigation (App.jsx). Non-seller pages stop the clock. */
export const trackPage = (pathname, search) => {
  const isSellerPage = portalOf(pathname) === 'user';
  const key = isSellerPage ? pageKeyFor(pathname, search) : null;
  if (!key) {
    currentKey = null;
    return;
  }
  start();
  if (key === currentKey) return;
  currentKey = key;
  lastInputAt = Date.now();
  send({ type: 'page_view', pageKey: key });
};
