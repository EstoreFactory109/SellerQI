/**
 * Keeping the reader looking at the right part of a conversation.
 *
 * ── THE TRAP THIS FILE IS BUILT AROUND ──
 * jsdom has no layout. scrollHeight, clientHeight and scrollTop all read 0, and
 * Element.scrollTo does not exist. Every "was the reader near the bottom" assertion
 * therefore passes vacuously unless the geometry is defined by hand, which is the same
 * class of silently-green test as a constructor mock that never took effect.
 *
 * So the harness below defines all three properties and drives position by dispatching
 * real scroll events. A test that does not go through `setGeometry` is not testing
 * anything.
 */
import { render, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useState, useEffect } from 'react';

import useConversationScroll from '../../Components/ESF/useConversationScroll.js';

/** A real node, because the hook attaches via a callback ref. */
const Harness = ({ threadId, messages, isOwn, onReachBottom, expose }) => {
    const api = useConversationScroll({ threadId, messages, isOwn, onReachBottom });
    useEffect(() => { expose(api); });
    return <div data-testid="pane" ref={api.containerRef} />;
};

const setGeometry = (node, { scrollHeight = 1000, clientHeight = 300, scrollTop = 700 } = {}) => {
    Object.defineProperty(node, 'scrollHeight', { value: scrollHeight, configurable: true });
    Object.defineProperty(node, 'clientHeight', { value: clientHeight, configurable: true });
    let top = scrollTop;
    Object.defineProperty(node, 'scrollTop', {
        get: () => top,
        set: (v) => { top = v; },
        configurable: true,
    });
    return {
        /** Move the viewport and fire the listener, as a real scroll would. */
        to(next) {
            top = next;
            act(() => { node.dispatchEvent(new Event('scroll')); });
        },
    };
};

const msgs = (n, startAt = 1) => Array.from({ length: n }, (_, i) => ({ id: `m${startAt + i}`, direction: 'inbound' }));

const mount = (props = {}) => {
    let api;
    const expose = (a) => { api = a; };
    const utils = render(
        <Harness threadId="t1" messages={msgs(3)} isOwn={() => false} expose={expose} {...props} />,
    );
    const node = utils.getByTestId('pane');
    return { ...utils, node, api: () => api };
};

beforeEach(() => {
    // jsdom implements neither; the hook feature-detects both.
    if (!window.matchMedia) {
        window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {} });
    }
});

describe('opening a conversation', () => {
    it('lands at the bottom, instantly - never animated', () => {
        const { node, rerender } = mount();
        // Geometry has to exist BEFORE the open effect runs, so switch threads with it
        // in place rather than asserting on the very first mount.
        setGeometry(node, { scrollTop: 0 });
        const smooth = vi.fn();
        node.scrollTo = smooth;

        act(() => {
            rerender(<Harness threadId="t2" messages={msgs(5)} isOwn={() => false} expose={() => {}} />);
        });

        // A thread opens showing its newest message, not its oldest - which is what it
        // did before this hook existed, on every thread longer than a screen.
        expect(node.scrollTop).toBe(node.scrollHeight);
        // Instantly. Animating a thread open means watching it race past the history.
        expect(smooth).not.toHaveBeenCalled();
    });

    it('jumps again when the same thread is reopened', () => {
        // Unmounting resets the seen-marker; without that the count/lastId guard
        // early-returns and the thread reopens wherever it was last left.
        const { node, rerender, unmount } = mount();
        setGeometry(node, { scrollTop: 0 });
        act(() => { rerender(<Harness threadId="t2" messages={msgs(5)} isOwn={() => false} expose={() => {}} />); });
        unmount();

        const again = mount({ threadId: 't2', messages: msgs(5) });
        setGeometry(again.node, { scrollTop: 0 });
        act(() => {
            again.rerender(<Harness threadId="t9" messages={msgs(5)} isOwn={() => false} expose={() => {}} />);
        });

        expect(again.node.scrollTop).toBe(again.node.scrollHeight);
    });
});

describe('a new message arrives', () => {
    it('scrolls down when the reader is already at the bottom', () => {
        const { node, rerender } = mount();
        const view = setGeometry(node, { scrollTop: 700 });
        view.to(700); // 1000 - 700 - 300 = 0 from the bottom

        act(() => {
            rerender(<Harness threadId="t1" messages={msgs(4)} isOwn={() => false} expose={() => {}} />);
        });

        expect(node.scrollTop).toBe(node.scrollHeight);
    });

    it('does NOT move the viewport when the reader is scrolled up reading history', () => {
        let api;
        const { node, rerender } = mount({ expose: (a) => { api = a; } });
        const view = setGeometry(node, { scrollTop: 0 });
        view.to(0); // 1000 - 0 - 300 = 700 from the bottom: far away

        act(() => {
            rerender(<Harness threadId="t1" messages={msgs(4)} isOwn={() => false} expose={(a) => { api = a; }} />);
        });

        // Yanking someone out of the history they are deliberately reading is a worse
        // bug than the one this hook fixes.
        expect(node.scrollTop).toBe(0);
        expect(api.newCount).toBe(1);
    });

    it('counts each arrival while away, not just the first', () => {
        let api;
        const { node, rerender } = mount({ expose: (a) => { api = a; } });
        setGeometry(node, { scrollTop: 0 }).to(0);

        act(() => { rerender(<Harness threadId="t1" messages={msgs(4)} isOwn={() => false} expose={(a) => { api = a; }} />); });
        act(() => { rerender(<Harness threadId="t1" messages={msgs(6)} isOwn={() => false} expose={(a) => { api = a; }} />); });

        expect(api.newCount).toBe(3);
    });

    it("follows the reader's OWN message even when they were scrolled up", () => {
        const { node, rerender } = mount();
        setGeometry(node, { scrollTop: 0 }).to(0);

        act(() => {
            rerender(<Harness threadId="t1" messages={msgs(4)} isOwn={() => true} expose={() => {}} />);
        });

        // You just pressed send; you expect to see it.
        expect(node.scrollTop).toBe(node.scrollHeight);
    });
});

describe('the 15-second poll', () => {
    it('does nothing when the array is unchanged', () => {
        let api;
        const { node, rerender } = mount({ expose: (a) => { api = a; } });
        setGeometry(node, { scrollTop: 0 }).to(0);

        // A fresh array object with identical contents, which is what every tick hands back.
        act(() => { rerender(<Harness threadId="t1" messages={msgs(3)} isOwn={() => false} expose={(a) => { api = a; }} />); });

        expect(node.scrollTop).toBe(0);
        expect(api.newCount).toBe(0);
    });

    it('does not re-scroll a reader who is already at the bottom', () => {
        // The case the unchanged-array guard actually protects. A reader parked at the
        // bottom is the common one, and without the guard every tick calls scrollToBottom
        // again - a smooth-scroll animation restarting every 15 seconds, forever.
        const { node, rerender } = mount();
        const view = setGeometry(node, { scrollTop: 700 });
        view.to(700);

        const smooth = vi.fn();
        node.scrollTo = smooth;

        act(() => { rerender(<Harness threadId="t1" messages={msgs(3)} isOwn={() => false} expose={() => {}} />); });
        act(() => { rerender(<Harness threadId="t1" messages={msgs(3)} isOwn={() => false} expose={() => {}} />); });

        expect(smooth).not.toHaveBeenCalled();
    });
});

describe('returning to the bottom', () => {
    it('clears the count and reports it once, not on every scroll event', () => {
        const onReachBottom = vi.fn();
        let api;
        const { node, rerender } = mount({ onReachBottom, expose: (a) => { api = a; } });
        const view = setGeometry(node, { scrollTop: 0 });
        view.to(0);

        act(() => { rerender(<Harness threadId="t1" messages={msgs(4)} isOwn={() => false} onReachBottom={onReachBottom} expose={(a) => { api = a; }} />); });
        expect(api.newCount).toBe(1);

        view.to(700);
        expect(api.newCount).toBe(0);
        expect(onReachBottom).toHaveBeenCalledTimes(1);

        // Still at the bottom; this must not fire again.
        view.to(700);
        expect(onReachBottom).toHaveBeenCalledTimes(1);
    });

    it('scrollToBottom clears the count too', () => {
        let api;
        const { node, rerender } = mount({ expose: (a) => { api = a; } });
        setGeometry(node, { scrollTop: 0 }).to(0);
        act(() => { rerender(<Harness threadId="t1" messages={msgs(4)} isOwn={() => false} expose={(a) => { api = a; }} />); });
        expect(api.newCount).toBe(1);

        act(() => { api.scrollToBottom(); });

        expect(api.newCount).toBe(0);
        expect(node.scrollTop).toBe(node.scrollHeight);
    });
});

describe('isAtBottom', () => {
    it('reports position from a ref, so a poll callback never reads a stale value', () => {
        let api;
        const { node } = mount({ expose: (a) => { api = a; } });
        const view = setGeometry(node, { scrollTop: 700 });

        view.to(700);
        expect(api.isAtBottom()).toBe(true);
        view.to(0);
        expect(api.isAtBottom()).toBe(false);
    });
});
