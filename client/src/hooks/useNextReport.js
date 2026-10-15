import { useEffect, useState } from 'react';
import axiosInstance from '../config/axios.config.js';

/**
 * When the client's next batch of reports arrives.
 *
 * Fetched once and cached at module scope, the same way useEsfPageAccess does, because two
 * surfaces render it — the Reports page header and the Overview stat card — and they must not
 * cost two requests or, worse, show two different answers. Reading the same object out of the
 * same heap means they cannot disagree even in principle, which the Overview page's own
 * comment demands: "a summary that contradicts the page it links to is worse than no summary."
 *
 * ── WHAT THIS REPLACED ──
 * A module-level constant, `NEXT_REPORT = { name: 'Weekly Sales Summary', due: 'Monday' }`,
 * imported across pages. It was wrong twice: the weekly job runs on Saturday, and no report
 * has ever been called "Weekly Sales Summary". Every client saw the same false claim.
 *
 * Fails QUIET, to null. A card that says nothing is strictly better than one that invents a
 * date, and this is decoration on a page whose real content comes from elsewhere.
 */

let cache = null;
let inflight = null;
const subscribers = new Set();

const load = () => {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;

  inflight = axiosInstance
    .get('/api/pagewise/esf/reports/next')
    .then((res) => {
      cache = res.data?.data || null;
      return cache;
    })
    .catch(() => {
      cache = null;
      return cache;
    })
    .finally(() => {
      inflight = null;
      subscribers.forEach((fn) => fn(cache));
    });

  return inflight;
};

/** Drop the cached answer — call after switching client or signing out. */
export const clearNextReport = () => {
  cache = null;
  inflight = null;
};

/**
 * Turn the server's instant into something a person reads.
 *
 * ── WHY THE SERVER DOES NOT SEND A DAY NAME ──
 * Because there isn't one. The weekly job fires at 08:00 in the scheduler's timezone, which
 * with TIMEZONE=UTC is Friday 22:00 in Pacific/Honolulu — so "Saturday" would be as wrong for
 * that reader as "Monday" was for everybody. The server sends the instant and this decides
 * what to call it in the browser's own timezone, which is the only arrangement that is right
 * for every reader.
 *
 * Compares local CALENDAR days rather than elapsed hours: 23:30 tonight is "Today", not
 * "Tomorrow", and a naive `Math.round(ms / 86400000)` gets that backwards.
 *
 * @returns {string} '' when there is no date — callers render their own placeholder.
 */
export const formatDueLabel = (iso, now = new Date()) => {
  if (!iso) return '';
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return '';

  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(at) - startOfDay(now)) / 86400000);

  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 7) return at.toLocaleDateString(undefined, { weekday: 'long' });
  return at.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
};

/** The full instant, for a title attribute — so the exact hour is one hover away. */
export const formatDueTitle = (next) => {
  if (!next?.at) return '';
  const at = new Date(next.at);
  if (Number.isNaN(at.getTime())) return '';
  return `${at.toLocaleString()}${next.timezone ? ` (scheduled ${next.timezone})` : ''}`;
};

const useNextReport = () => {
  const [next, setNext] = useState(cache);

  useEffect(() => {
    let alive = true;
    const onChange = (value) => { if (alive) setNext(value); };
    subscribers.add(onChange);
    load().then(onChange);

    return () => {
      alive = false;
      subscribers.delete(onChange);
    };
  }, []);

  return next;
};

export default useNextReport;
