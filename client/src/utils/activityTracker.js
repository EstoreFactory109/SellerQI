/**
 * Seller activity tracker (activity monitoring for the super admin and ESF admins).
 *
 * On seller pages only, it tells the server:
 *   - a page was opened (a new `visitId` per page),
 *   - every 30 s, that the seller is still there — but only while the tab is visible AND they
 *     have moved, typed, scrolled or touched in the last 5 minutes, and
 *   - once more when they leave the page (navigate, hide the tab, close it), so a page left
 *     before its first heartbeat still gets its real time instead of 0s. Skipped when they were
 *     already idle, so an abandoned tab never gains time it wasn't used.
 * So an open-but-ignored tab, or the app's own background polling, never counts as "active".
 *
 * Visits made within 30 minutes of each other share an `activityId` (per tab), which the admin
 * view shows as one sitting. Fire-and-forget `fetch`, not the axios instance: a failure must
 * never surface, and a 401 here must not trigger the app's refresh/redirect handling.
 */
import { portalOf } from './portalPages.js';

export const HEARTBEAT_MS = 30 * 1000;
export const IDLE_MS = 5 * 60 * 1000;
const SITTING_GAP_MS = 30 * 60 * 1000;
const SITTING_KEY = 'sqi_activity_sitting';
const INPUT_EVENTS = ['mousemove', 'mousedown', 'keydown', 'scroll', 'touchstart', 'wheel'];

const state = { started: false, visitId: null, path: null, lastInputAt: 0, timer: null };

const newId = () => (globalThis.crypto?.randomUUID
  ? globalThis.crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

const isVisible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
const recentlyActive = () => Date.now() - state.lastInputAt < IDLE_MS;

/** The current sitting's id; a new one after 30 minutes without a ping. */
const sittingId = () => {
  const now = Date.now();
  let sitting = null;
  try { sitting = JSON.parse(sessionStorage.getItem(SITTING_KEY) || 'null'); } catch { /* new sitting */ }
  if (!sitting?.id || now - (sitting.at || 0) > SITTING_GAP_MS) sitting = { id: newId() };
  sitting.at = now;
  try { sessionStorage.setItem(SITTING_KEY, JSON.stringify(sitting)); } catch { /* per-call id is fine */ }
  return sitting.id;
};

const send = (type) => {
  if (!state.visitId) return;
  try {
    fetch(`${import.meta.env.VITE_BASE_URI}/app/activity/ping`, {
      method: 'POST',
      credentials: 'include',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, visitId: state.visitId, activityId: sittingId(), path: state.path }),
    }).catch(() => {});
  } catch { /* never disturb the app */ }
};

const onInput = () => { state.lastInputAt = Date.now(); };

/** Close out the current visit with its real end time (navigation, hidden tab, page close). */
const closeVisit = () => {
  if (state.visitId && recentlyActive()) send('beat');
};

const onVisibility = () => {
  if (!isVisible()) {
    closeVisit();
    return;
  }
  // Coming back to the tab is itself a sign someone is there.
  onInput();
  send('beat');
};

/** Start once per page load. */
export const startActivityTracking = () => {
  if (state.started || typeof window === 'undefined') return;
  state.started = true;
  state.lastInputAt = Date.now();
  INPUT_EVENTS.forEach((event) => window.addEventListener(event, onInput, { passive: true }));
  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', closeVisit);
  state.timer = setInterval(() => {
    if (state.visitId && isVisible() && recentlyActive()) send('beat');
  }, HEARTBEAT_MS);
};

/** Call on every route change. Pages outside the seller app end the current visit. */
export const trackPage = (pathname) => {
  const isSellerPage = portalOf(pathname) === 'user';
  if (pathname === state.path && state.visitId) return;
  closeVisit(); // the page being left gets its time up to now
  if (!isSellerPage) {
    state.visitId = null;
    state.path = null;
    return;
  }
  state.visitId = newId();
  state.path = pathname;
  onInput(); // navigating is interaction
  send('view');
};

/** Test helper: back to a fresh page load. */
export const resetActivityTracking = () => {
  if (typeof window !== 'undefined') {
    INPUT_EVENTS.forEach((event) => window.removeEventListener(event, onInput));
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('pagehide', closeVisit);
  }
  clearInterval(state.timer);
  Object.assign(state, { started: false, visitId: null, path: null, lastInputAt: 0, timer: null });
};
