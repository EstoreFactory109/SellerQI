import { useEffect, useState } from 'react';

/** Re-render every `ms` so "12s ago" keeps counting between data refreshes. */
export const useNow = (ms = 10000) => {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
};

/** Run `fn` now and every `ms` while the browser tab is visible. */
export const usePolling = (fn, ms, enabled = true) => {
  useEffect(() => {
    if (!enabled) return undefined;
    fn();
    const id = setInterval(() => {
      if (document.visibilityState === 'visible') fn();
    }, ms);
    return () => clearInterval(id);
  }, [fn, ms, enabled]);
};
