import { useEffect, useRef } from 'react';

/**
 * Grow a composer textarea with its content, the way a chat app does.
 *
 * A fixed single row meant a long message scrolled inside two lines of box, so you could
 * not see the sentence you were finishing. Growing without a ceiling is the opposite
 * problem — a pasted paragraph would swallow the conversation above it.
 *
 * Height is recomputed from scrollHeight rather than counting lines, because a line is
 * not a fixed thing once text wraps. Resetting to 'auto' first is what makes it shrink
 * again on delete: scrollHeight never reports less than the element's current height.
 *
 * @param {string} value  the controlled value, so it also collapses when a send clears it
 * @param {number} maxPx  ceiling before it scrolls internally
 */
const useAutoGrow = (value, maxPx = 128) => {
    const ref = useRef(null);

    useEffect(() => {
        const el = ref.current;
        if (!el) return;
        el.style.height = 'auto';
        el.style.height = `${Math.min(el.scrollHeight, maxPx)}px`;
        // Only let it scroll once it has stopped growing, so the scrollbar does not
        // flicker in and out on every keystroke.
        el.style.overflowY = el.scrollHeight > maxPx ? 'auto' : 'hidden';
    }, [value, maxPx]);

    return ref;
};

export default useAutoGrow;
