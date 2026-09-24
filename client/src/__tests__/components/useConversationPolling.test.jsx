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
    it('calls the refresh on each interval', () => {
        const refresh = vi.fn();
        renderHook(() => useConversationPolling(refresh, { intervalMs: 1000 }));

        act(() => { vi.advanceTimersByTime(3000); });

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
