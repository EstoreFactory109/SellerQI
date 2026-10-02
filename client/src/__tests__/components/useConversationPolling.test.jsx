/**
 * Keeping an open conversation current without a manual refresh.
 *
 * Two things here fail silently rather than loudly, which is why they are pinned:
 *
 *  - a callback held directly in the effect's deps tears the timer down and rebuilds it
 *    on every render, and with an inline arrow that means polling never actually fires
 *  - without the visibility check, a tab left open overnight makes thousands of requests
 *    nobody will ever read
 */
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import useConversationPolling from '../../Components/ESF/useConversationPolling.js';

const setVisibility = (state) => {
    Object.defineProperty(document, 'visibilityState', { value: state, configurable: true });
};

beforeEach(() => {
    vi.useFakeTimers();
    setVisibility('visible');
});

afterEach(() => {
    vi.useRealTimers();
});

describe('polling', () => {
    it('calls the refresh on each interval', async () => {
        /*
         * advanceTimersByTimeAsync, not the synchronous form, because the hook's tick
         * is now async (it awaits refresh so it can count a rejection). Advancing
         * synchronously fires all three interval callbacks before any of their
         * microtasks resolve, so the in-flight guard added for the failure counter
         * would see the first tick still "running" and skip the second and third —
         * three calls becoming one. The async form flushes microtasks between ticks,
         * which is what a real 15-second gap does anyway.
         */
        const refresh = vi.fn();
        renderHook(() => useConversationPolling(refresh, { intervalMs: 1000 }));

        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

        expect(refresh).toHaveBeenCalledTimes(3);
    });

    it('keeps firing when the callback identity changes every render', () => {
        // The failure this guards: an inline arrow is a new function each render, and
        // holding it in the effect deps would reset the timer before it ever elapsed.
        const spy = vi.fn();
        const { rerender } = renderHook(() => useConversationPolling(() => spy(), { intervalMs: 1000 }));

        act(() => { vi.advanceTimersByTime(900); });
        rerender();
        act(() => { vi.advanceTimersByTime(200); });

        expect(spy).toHaveBeenCalled();
    });

    it('uses the LATEST callback, not the one from mount', () => {
        const first = vi.fn();
        const second = vi.fn();
        const { rerender } = renderHook(({ cb }) => useConversationPolling(cb, { intervalMs: 1000 }), {
            initialProps: { cb: first },
        });

        rerender({ cb: second });
        act(() => { vi.advanceTimersByTime(1000); });

        expect(second).toHaveBeenCalled();
        expect(first).not.toHaveBeenCalled();
    });
});

describe('a hidden tab', () => {
    it('does not poll', () => {
        // Otherwise a page left open overnight makes thousands of pointless requests.
        const refresh = vi.fn();
        setVisibility('hidden');
        renderHook(() => useConversationPolling(refresh, { intervalMs: 1000 }));

        act(() => { vi.advanceTimersByTime(5000); });

        expect(refresh).not.toHaveBeenCalled();
    });

    it('refreshes the moment it is focused again', () => {
        // When someone returns is exactly when staleness is most visible, so it does not
        // wait out the rest of the interval.
        const refresh = vi.fn();
        setVisibility('hidden');
        renderHook(() => useConversationPolling(refresh, { intervalMs: 60000 }));

        setVisibility('visible');
        act(() => { document.dispatchEvent(new Event('visibilitychange')); });

        expect(refresh).toHaveBeenCalledTimes(1);
    });
});

describe('teardown', () => {
    it('stops polling once unmounted', () => {
        const refresh = vi.fn();
        const { unmount } = renderHook(() => useConversationPolling(refresh, { intervalMs: 1000 }));

        unmount();
        act(() => { vi.advanceTimersByTime(5000); });

        expect(refresh).not.toHaveBeenCalled();
    });

    it('does nothing at all when disabled', () => {
        const refresh = vi.fn();
        renderHook(() => useConversationPolling(refresh, { intervalMs: 1000, enabled: false }));

        act(() => { vi.advanceTimersByTime(5000); });

        expect(refresh).not.toHaveBeenCalled();
    });
});

/**
 * Both pages used to swallow every poll failure with an empty catch, reasoning that
 * "the next poll is 15s away." True for one blip; silent forever for an expired session
 * or a revoked Messages permission, where the page keeps polling, keeps failing, and
 * shows nothing to say so. These pin the replacement: the hook itself tracks failures,
 * because a page-local catch cannot be checked for consistency between the two pages
 * that each used to write their own.
 */
describe('failure tracking', () => {
    it('reports a rejected refresh as a failure, not silently', async () => {
        const refresh = vi.fn().mockRejectedValue(new Error('network blip'));
        const { result } = renderHook(() => useConversationPolling(refresh, { intervalMs: 1000 }));

        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

        expect(result.current.failures).toBe(1);
        expect(result.current.lastError).toBeInstanceOf(Error);
    });

    it('is not stale after a single failure', async () => {
        // One transient blip must stay invisible — only a run of them is worth showing.
        const refresh = vi.fn().mockRejectedValue(new Error('blip'));
        const { result } = renderHook(() => useConversationPolling(refresh, { intervalMs: 1000 }));

        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

        expect(result.current.stale).toBe(false);
    });

    it('becomes stale after two CONSECUTIVE failures', async () => {
        const refresh = vi.fn().mockRejectedValue(new Error('down'));
        const { result } = renderHook(() => useConversationPolling(refresh, { intervalMs: 1000 }));

        await act(async () => { await vi.advanceTimersByTimeAsync(2000); });

        expect(result.current.failures).toBe(2);
        expect(result.current.stale).toBe(true);
    });

    it('a single success resets the count back to zero', async () => {
        // The run must be CONSECUTIVE: two old failures from an hour ago must not
        // combine with a brand new one to read as "still failing."
        const refresh = vi.fn()
            .mockRejectedValueOnce(new Error('one'))
            .mockResolvedValueOnce(undefined)
            .mockRejectedValueOnce(new Error('two'));
        const { result } = renderHook(() => useConversationPolling(refresh, { intervalMs: 1000 }));

        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });

        expect(result.current.failures).toBe(1);
        expect(result.current.stale).toBe(false);
    });

    it('the stale threshold is configurable', async () => {
        const refresh = vi.fn().mockRejectedValue(new Error('down'));
        const { result } = renderHook(() => useConversationPolling(refresh, {
            intervalMs: 1000, staleAfterFailures: 1,
        }));

        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

        expect(result.current.stale).toBe(true);
    });

    it('a request still in flight is not restarted by the next tick', async () => {
        // Without the in-flight guard, a slow request stacks a fresh call every
        // interval, and the failure count stops meaning anything.
        let resolveFirst;
        const refresh = vi.fn()
            .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
            .mockResolvedValue(undefined);

        renderHook(() => useConversationPolling(refresh, { intervalMs: 1000 }));

        await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
        expect(refresh).toHaveBeenCalledTimes(1);

        resolveFirst();
        await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
        expect(refresh).toHaveBeenCalledTimes(2);
    });
});
