import { useEffect, useState } from 'react';
import axiosInstance from '../config/axios.config.js';

/**
 * Page access for the staff member driving the current client session.
 *
 * Fetched once and cached at module scope: the sidebar, the tablet sidebar and
 * the route guard all need the same answer, and it must not cost three requests
 * on every render.
 *
 * Fails OPEN. If the lookup errors the user keeps the sidebar they already had —
 * a network blip should not blank the navigation. The server refuses the data
 * independently, so nothing is actually exposed by that choice.
 */

const EMPTY = { isEsfSession: false, esfRole: null, isOwner: false, deniedPages: [] };

let cache = null;
let inflight = null;
const subscribers = new Set();

const load = () => {
  if (cache) return Promise.resolve(cache);
  if (inflight) return inflight;

  inflight = axiosInstance
    .get('/app/esf/session-permissions')
    .then((res) => {
      cache = res.data?.data || EMPTY;
      return cache;
    })
    .catch(() => {
      cache = EMPTY; // fail open
      return cache;
    })
    .finally(() => {
      inflight = null;
      subscribers.forEach((fn) => fn(cache));
    });

  return inflight;
};

/**
 * Warm the cache during an existing loading screen, so the route guard does not
 * add a second spinner of its own on first paint.
 */
export const prefetchEsfPageAccess = () => load();

/** Drop the cached answer — call after switching client or signing out. */
export const clearEsfPageAccessCache = () => {
  cache = null;
  inflight = null;
};

export const useEsfPageAccess = () => {
  const [state, setState] = useState(cache || EMPTY);
  const [ready, setReady] = useState(Boolean(cache));

  useEffect(() => {
    let alive = true;
    const onUpdate = (value) => {
      if (alive) {
        setState(value);
        setReady(true);
      }
    };
    subscribers.add(onUpdate);

    load().then(onUpdate);

    return () => {
      alive = false;
      subscribers.delete(onUpdate);
    };
  }, []);

  const denied = state.deniedPages || [];

  return {
    ...state,
    ready,
    /** Owner is never restricted; a non-ESF session is never restricted. */
    isPageAllowed: (pageKey) => {
      if (!state.isEsfSession || state.isOwner) return true;
      return !denied.includes(pageKey);
    },
  };
};

export default useEsfPageAccess;
