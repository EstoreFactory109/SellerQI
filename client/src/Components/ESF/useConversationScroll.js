import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Keep the reader's VIEW of a conversation correct, the way useConversationPolling keeps
 * the data correct. One fetches; this one decides what the reader should be looking at.
 *
 * ── THE BUG THIS EXISTS FOR ──
 * Neither Messages page scrolled. Not on open, not on a new message. The pane was a plain
 * overflow-y-auto div with no ref, so opening a thread left the reader at the TOP - the
 * oldest message - and a reply arriving appended below the fold with nothing to say so.
 * The poll was working the whole time. "It doesn't auto-update" was the page never moving.
 *
 * ── WHAT IT WILL NOT DO ──
 * Scroll someone away from what they are reading. Jumping to the bottom whenever a message
 * lands is its own bug, and a worse one, because it happens while a person is mid-sentence
 * in the history. So: scroll only when they are already at the bottom, or when the new
 * message is their own. Otherwise count it and let them choose.
 *
 * @param {object}   args
 * @param {string}   args.threadId      changing it means a different conversation: jump, never animate
 * @param {Array}    args.messages      the rendered list; watched by length and last id, not identity
 * @param {Function} args.isOwn         (message) => did the reader send this? INVERTED between the two pages
 * @param {Function} [args.onReachBottom] fires once on the away -> bottom transition
 * @param {number}   [args.nearBottomPx]
 */
const useConversationScroll = ({
    threadId,
    messages,
    isOwn = () => false,
    onReachBottom,
    nearBottomPx = 120,
}) => {
    const nodeRef = useRef(null);
    /**
     * Whether the reader was at the bottom BEFORE this render.
     *
     * Maintained by a scroll listener rather than measured when `messages` changes, and
     * that ordering is the whole trick. By the time any effect can read the container -
     * useLayoutEffect included - React has already committed the new bubble and
     * scrollHeight has grown, so measuring then answers the question about a layout that
     * never existed on screen.
     */
    const nearBottomRef = useRef(true);
    const lastSeenRef = useRef({ threadId: null, count: 0, lastId: null });
    const onReachBottomRef = useRef(onReachBottom);
    onReachBottomRef.current = onReachBottom;

    const [newCount, setNewCount] = useState(0);

    const measure = useCallback((node) => {
        if (!node) return true;
        return node.scrollHeight - node.scrollTop - node.clientHeight <= nearBottomPx;
    }, [nearBottomPx]);

    const scrollToBottom = useCallback((behavior = 'smooth') => {
        const node = nodeRef.current;
        if (!node) return;
        /*
         * The container's own scrollTop, never scrollIntoView on a sentinel.
         * scrollIntoView walks every ancestor scroll container including the page, which
         * on mobile - where these panes stack - yanks the whole layout.
         */
        const reduceMotion = typeof window !== 'undefined'
            && typeof window.matchMedia === 'function'
            && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        const top = node.scrollHeight;

        if (behavior === 'smooth' && !reduceMotion && typeof node.scrollTo === 'function') {
            node.scrollTo({ top, behavior: 'smooth' });
        } else {
            node.scrollTop = top;
        }
        nearBottomRef.current = true;
        setNewCount(0);
    }, []);

    /**
     * A CALLBACK ref, not useRef.
     *
     * The pane renders inside `{open && (...)}`, so the node does not exist when openId is
     * first set, and an effect keyed on threadId can run before it is in the DOM. That is
     * exactly the shape of "works on the second thread you open, but not the first".
     */
    const containerRef = useCallback((node) => {
        if (nodeRef.current) {
            nodeRef.current.removeEventListener('scroll', nodeRef.current.__convScrollHandler);
            delete nodeRef.current.__convScrollHandler;
        }
        nodeRef.current = node;

        if (!node) {
            // Remounting the same thread must still jump; without this the count/lastId
            // guard below early-returns and it reopens wherever it was left.
            lastSeenRef.current = { threadId: null, count: 0, lastId: null };
            return;
        }

        const handler = () => {
            const atBottom = measure(node);
            const wasAway = !nearBottomRef.current;
            nearBottomRef.current = atBottom;
            if (atBottom && wasAway) {
                setNewCount(0);
                onReachBottomRef.current?.();
            }
        };
        node.__convScrollHandler = handler;
        node.addEventListener('scroll', handler, { passive: true });
    }, [measure]);

    useEffect(() => {
        const node = nodeRef.current;
        if (!node) return;

        const list = messages || [];
        const count = list.length;
        const lastId = count ? (list[count - 1]?.id ?? null) : null;
        const seen = lastSeenRef.current;

        if (threadId !== seen.threadId) {
            lastSeenRef.current = { threadId, count, lastId };
            setNewCount(0);
            scrollToBottom('auto');
            return;
        }

        /*
         * The poll hands back a fresh array object every 15 seconds. Without this guard
         * the pane would scroll - or count a phantom new message - on every single tick.
         */
        if (count === seen.count && lastId === seen.lastId) return;

        const added = count - seen.count;
        lastSeenRef.current = { threadId, count, lastId };

        const lastIsOwn = count > 0 && isOwn(list[count - 1]);
        if (lastIsOwn || nearBottomRef.current) {
            scrollToBottom('smooth');
            return;
        }
        if (added > 0) setNewCount((n) => n + added);
    }, [threadId, messages, isOwn, scrollToBottom]);

    /** Read from a ref, so a poll callback is never holding a stale closure over it. */
    const isAtBottom = useCallback(() => nearBottomRef.current, []);

    return { containerRef, newCount, scrollToBottom, isAtBottom };
};

export default useConversationScroll;
