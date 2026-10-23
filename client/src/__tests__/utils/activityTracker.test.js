/**
 * Seller activity tracker: what counts as "using SellerQI".
 *
 * Pinned: a page open is sent for seller pages only; heartbeats every 30 s only while the tab
 * is visible AND there was input in the last 5 minutes; an idle or hidden tab goes quiet.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startActivityTracking, trackPage, resetActivityTracking, HEARTBEAT_MS, IDLE_MS } from '../../utils/activityTracker.js';

const setVisibility = (state) => Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
const bodies = () => global.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

beforeEach(() => {
  vi.useFakeTimers();
  global.fetch = vi.fn(() => Promise.resolve({ ok: true }));
  setVisibility('visible');
  resetActivityTracking();
  startActivityTracking();
});
afterEach(() => {
  resetActivityTracking();
  vi.useRealTimers();
});

describe('activity tracker', () => {
  it('sends a page open for seller pages, with credentials', () => {
    trackPage('/seller-central-checker/dashboard');
    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = global.fetch.mock.calls[0];
    expect(url).toMatch(/\/app\/activity\/ping$/);
    expect(init.credentials).toBe('include');
    expect(bodies()[0]).toMatchObject({ type: 'view', path: '/seller-central-checker/dashboard' });
  });

  it('ignores admin, ESF and marketing pages', () => {
    for (const p of ['/manage-accounts', '/esf/clients', '/pricing', '/']) trackPage(p);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a new page is a new visit; the same page is not re-sent', () => {
    trackPage('/seller-central-checker/dashboard');
    trackPage('/seller-central-checker/dashboard');
    trackPage('/seller-central-checker/tasks');
    const [a, b] = bodies();
    expect(bodies()).toHaveLength(2);
    expect(a.visitId).not.toBe(b.visitId);
  });

  it('heartbeats every 30 s while someone is there', () => {
    trackPage('/seller-central-checker/tasks');
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(bodies().filter((b) => b.type === 'beat')).toHaveLength(3);
    expect(new Set(bodies().map((b) => b.visitId)).size).toBe(1);
  });

  it('goes quiet after 5 minutes without input, and resumes on input', () => {
    trackPage('/seller-central-checker/tasks');
    vi.advanceTimersByTime(IDLE_MS + HEARTBEAT_MS * 4);
    const beatsWhileIdle = bodies().filter((b) => b.type === 'beat').length;
    expect(beatsWhileIdle).toBeLessThanOrEqual(IDLE_MS / HEARTBEAT_MS);
    global.fetch.mockClear();
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(global.fetch).not.toHaveBeenCalled();
    window.dispatchEvent(new Event('mousemove'));
    vi.advanceTimersByTime(HEARTBEAT_MS);
    expect(bodies()).toEqual([expect.objectContaining({ type: 'beat' })]);
  });

  it('a hidden tab sends nothing', () => {
    trackPage('/seller-central-checker/tasks');
    global.fetch.mockClear();
    setVisibility('hidden');
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('leaving the seller app ends the visit', () => {
    trackPage('/seller-central-checker/tasks');
    trackPage('/manage-accounts');
    global.fetch.mockClear();
    vi.advanceTimersByTime(HEARTBEAT_MS * 2);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a network error never escapes', () => {
    global.fetch = vi.fn(() => Promise.reject(new Error('offline')));
    expect(() => trackPage('/seller-central-checker/tasks')).not.toThrow();
  });
});
