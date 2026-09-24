import { useEffect, useRef } from 'react';

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
 */
const useConversationPolling = (refresh, { intervalMs = 15000, enabled = true } = {}) => {
    // Held in a ref so a changing callback identity does not tear down the timer on
    // every render and effectively stop the polling.
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;

    useEffect(() => {
        if (!enabled) return undefined;

        const tick = () => {
            if (document.visibilityState === 'visible') refreshRef.current();
        };

        const timer = setInterval(tick, intervalMs);
        // Coming back to the tab is the moment freshness matters most.
        document.addEventListener('visibilitychange', tick);

        return () => {
            clearInterval(timer);
            document.removeEventListener('visibilitychange', tick);
        };
    }, [intervalMs, enabled]);
};

export default useConversationPolling;
