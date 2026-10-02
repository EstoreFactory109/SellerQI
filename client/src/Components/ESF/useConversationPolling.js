import { useEffect, useRef, useState } from 'react';

/**
 * Keep an open conversation current without the reader refreshing.
 *
 * A client's reply arrives by email, is ingested by a background sync, and lands in the
 * database with nothing telling the page. Until this existed the only way to see it was
 * a manual reload — so a conversation could sit there looking finished while an answer
 * was already waiting.
 *
 * ── POLLING, DELIBERATELY ──
 * There is no socket or SSE layer in this app, and adding one for a page two people use
 * at a time would be a lot of moving parts for the same result. The mail it is chasing
 * arrives by a sync that runs on its own schedule anyway, so sub-second delivery is not
 * available no matter what this does.
 *
 * ── ONLY WHILE THE TAB IS VISIBLE ──
 * A background tab left open overnight would otherwise make thousands of requests
 * nobody reads. It also refreshes the moment a tab is focused, which is when someone is
 * actually about to look — so returning to the page shows current data immediately
 * rather than at the next interval.
 *
 * ── FAILURE TRACKING ──
 * `refresh` is expected to REJECT on failure. Both callers used to swallow their own
 * errors with an empty catch, on the reasoning that "the next poll is 15s away" — true
 * for one blip, and silent forever for a session whose cookie expired or whose Messages
 * permission was just revoked. The page kept polling, kept failing, and showed nothing
 * to say so. Counting failures here, in the one place both pages share, means that
 * reasoning only has to be reconsidered once.
 *
 * @returns {{ failures: number, lastError: unknown, stale: boolean }}
 *   `stale` flips true after `staleAfterFailures` consecutive failures — two, by
 *   default, so one transient blip never shows anything.
 */
const useConversationPolling = (refresh, {
    intervalMs = 15000, enabled = true, staleAfterFailures = 2,
} = {}) => {
    // Held in a ref so a changing callback identity does not tear down the timer on
    // every render and effectively stop the polling.
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;

    const [failures, setFailures] = useState(0);
    const [lastError, setLastError] = useState(null);

    useEffect(() => {
        if (!enabled) return undefined;

        let cancelled = false;
        /**
         * Without this, a request that hangs past the interval stacks a new one every
         * tick — each one racing to update the same state, and the failure count
         * becoming meaningless because several requests are in flight for one logical
         * "did this poll succeed" question.
         */
        let inFlight = false;

        const tick = async () => {
            if (document.visibilityState !== 'visible') return;
            if (inFlight) return;
            inFlight = true;
            try {
                await refreshRef.current();
                if (cancelled) return;
                setFailures(0);
                setLastError(null);
            } catch (error) {
                if (cancelled) return;
                setFailures((n) => n + 1);
                setLastError(error);
            } finally {
                inFlight = false;
            }
        };

        const timer = setInterval(tick, intervalMs);
        // Coming back to the tab is the moment freshness matters most.
        document.addEventListener('visibilitychange', tick);

        return () => {
            cancelled = true;
            clearInterval(timer);
            document.removeEventListener('visibilitychange', tick);
        };
    }, [intervalMs, enabled]);

    return { failures, lastError, stale: failures >= staleAfterFailures };
};

export default useConversationPolling;
