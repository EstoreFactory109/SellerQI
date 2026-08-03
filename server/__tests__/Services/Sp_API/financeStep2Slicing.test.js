/**
 * Tests for finance Step 2 slice selection (`resolveStep2Slice`).
 *
 * WHY THIS FILE EXISTS
 * `backfillPendingExpenses` had zero test coverage, and the thing being changed is boundary
 * arithmetic over a date window — which is exactly where a previous attempt at bounding this work
 * went wrong. FinanceService.js documents that attempt: it capped the span at N days from the oldest
 * pending purchase date, which was "wrong and actively harmful" because the window start is a derived
 * minimum over the SURVIVING pending rows *with no cursor*, so one permanently-stuck order pinned the
 * window at its own date for up to 45 days and every newer pending row sat outside it forever, never
 * searched, expiring with its estimate never replaced by the actual.
 *
 * The distinction this file has to prove is therefore narrow and specific: slicing-with-a-cursor
 * still reaches EVERY part of the window, just across several runs. If that property breaks, the old
 * silent-money-loss bug is back. `covers the entire window with no gap` and `the stuck-order trap`
 * below are the load-bearing tests.
 */

const { resolveStep2Slice } = require('../../../Services/Sp_API/FinanceService.js');

const W = { windowStart: '2026-06-10', windowEnd: '2026-08-03', sliceDays: 7 };
const cursorAt = (coveredUntil, overrides = {}) => ({
    windowStart: W.windowStart, windowEnd: W.windowEnd, coveredUntil, ...overrides,
});

/** Walk a whole pass, returning every slice in order. */
function walkPass(args = W, maxSlices = 50) {
    const slices = [];
    let cursor = null;
    for (let i = 0; i < maxSlices; i++) {
        const r = resolveStep2Slice({ cursor, ...args });
        slices.push(r);
        if (r.passComplete) break;
        cursor = { windowStart: args.windowStart, windowEnd: args.windowEnd, coveredUntil: r.sliceStart };
    }
    return slices;
}

describe('resolveStep2Slice — newest-first', () => {
    test('the first slice of a pass ends at the window end, not the start', () => {
        // Almost every real resolution is in the most recent days, because Amazon posts fees within
        // 1-3 days of purchase. Searching oldest-first would make a brand-new order wait a whole pass.
        const first = resolveStep2Slice({ cursor: null, ...W });
        expect(first.sliceEnd).toBe('2026-08-03');
        expect(first.sliceStart).toBe('2026-07-27');
        expect(first.startingNewPass).toBe(true);
    });

    test('slices move backwards through the window', () => {
        const slices = walkPass();
        const ends = slices.map((s) => s.sliceEnd);
        expect(ends).toEqual([...ends].sort().reverse());
    });
});

describe('resolveStep2Slice — the cursor covers the whole window', () => {
    test('consecutive slices meet exactly: no gap, no overlap', () => {
        // A gap here is the silent-money-loss bug: a date range never searched means a pending order
        // whose fee landed there is never resolved and eventually expires on its estimate.
        const slices = walkPass();
        for (let i = 1; i < slices.length; i++) {
            expect(slices[i].sliceEnd).toBe(slices[i - 1].sliceStart);
        }
    });

    test('the pass reaches windowStart and stops there, never before or beyond', () => {
        const slices = walkPass();
        const last = slices[slices.length - 1];
        expect(last.sliceStart).toBe(W.windowStart);
        expect(last.passComplete).toBe(true);
        expect(slices.filter((s) => s.passComplete)).toHaveLength(1);
    });

    test('a 55-day window at 7-day slices terminates in a sane number of runs', () => {
        // The whole point: hours in one run becomes ~8 bounded runs.
        expect(walkPass().length).toBe(8);
    });

    test('the union of all slices covers every single day of the window', () => {
        const covered = new Set();
        for (const s of walkPass()) {
            for (let d = new Date(`${s.sliceStart}T00:00:00Z`); d <= new Date(`${s.sliceEnd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
                covered.add(d.toISOString().slice(0, 10));
            }
        }
        for (let d = new Date(`${W.windowStart}T00:00:00Z`); d <= new Date(`${W.windowEnd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) {
            expect(covered.has(d.toISOString().slice(0, 10))).toBe(true);
        }
    });
});

describe('resolveStep2Slice — the stuck-order trap must not come back', () => {
    test('a 55-day-old stuck order does not stop newer days being searched', () => {
        // The exact scenario the rejected design broke on: one order so old it pins windowStart for
        // up to 45 days. Under the old cap, everything newer sat permanently outside the window.
        // Here the recent days must still be covered — in the FIRST slice, in fact.
        const slices = walkPass();
        const recentDays = ['2026-08-03', '2026-08-01', '2026-07-28'];
        for (const day of recentDays) {
            const hit = slices.find((s) => s.sliceStart <= day && day <= s.sliceEnd);
            expect(hit).toBeDefined();
        }
        expect(slices[0].sliceStart <= '2026-07-28').toBe(true);
    });

    test('a pinned windowStart still yields a terminating pass, not an endless one', () => {
        // 45 days is the documented worst case for how long one stuck order can hold the boundary.
        const slices = walkPass({ windowStart: '2026-06-19', windowEnd: '2026-08-03', sliceDays: 7 });
        expect(slices[slices.length - 1].passComplete).toBe(true);
        expect(slices.length).toBeLessThan(20);
    });
});

describe('resolveStep2Slice — pass restart', () => {
    test('a completed pass starts a new one from the window end', () => {
        const done = resolveStep2Slice({ cursor: cursorAt(W.windowStart), ...W });
        expect(done.startingNewPass).toBe(true);
        expect(done.sliceEnd).toBe(W.windowEnd);
    });

    test('a cursor that somehow went past windowStart also restarts', () => {
        const r = resolveStep2Slice({ cursor: cursorAt('2026-05-01'), ...W });
        expect(r.startingNewPass).toBe(true);
    });

    test('a stale windowStart restarts rather than continuing against a moved boundary', () => {
        // Orders resolved, so min(purchasePacificDate) moved forward and windowStart changed.
        // Continuing from the old cursor could leave the newly-exposed range unsearched.
        const r = resolveStep2Slice({
            cursor: cursorAt('2026-07-20', { windowStart: '2026-05-01' }),
            ...W,
        });
        expect(r.startingNewPass).toBe(true);
        expect(r.sliceEnd).toBe(W.windowEnd);
    });

    test('mid-pass, it continues from coveredUntil rather than restarting', () => {
        const r = resolveStep2Slice({ cursor: cursorAt('2026-07-20'), ...W });
        expect(r.startingNewPass).toBe(false);
        expect(r.sliceEnd).toBe('2026-07-20');
        expect(r.sliceStart).toBe('2026-07-13');
    });
});

describe('resolveStep2Slice — passComplete drives whether expiry is allowed', () => {
    // A run that searched 1/8 of the window has no business concluding a fee does not exist. If
    // expiry fired mid-pass it would delete a pending order whose fee was findable in a slice not yet
    // reached — permanently keeping the estimate. That is the original bug via a different route.
    test('false on a mid-pass slice', () => {
        expect(resolveStep2Slice({ cursor: null, ...W }).passComplete).toBe(false);
        expect(resolveStep2Slice({ cursor: cursorAt('2026-07-20'), ...W }).passComplete).toBe(false);
    });

    test('true only on the slice that reaches windowStart', () => {
        expect(resolveStep2Slice({ cursor: cursorAt('2026-06-15'), ...W }).passComplete).toBe(true);
    });
});

describe('resolveStep2Slice — steady state and edges', () => {
    test('a window narrower than one slice is covered in a single pass-completing run', () => {
        // This is the post-backlog steady state: pending orders are all recent, so the window is
        // under one slice and behaviour is identical to the unsliced path.
        const r = resolveStep2Slice({ cursor: null, windowStart: '2026-08-01', windowEnd: '2026-08-03', sliceDays: 7 });
        expect(r.sliceStart).toBe('2026-08-01');
        expect(r.sliceEnd).toBe('2026-08-03');
        expect(r.passComplete).toBe(true);
    });

    test('a single-day window works', () => {
        const r = resolveStep2Slice({ cursor: null, windowStart: '2026-08-03', windowEnd: '2026-08-03', sliceDays: 7 });
        expect(r.sliceStart).toBe('2026-08-03');
        expect(r.passComplete).toBe(true);
    });

    test('sliceDays is floored at 1 so a bad env value cannot produce a zero-width slice', () => {
        // A zero-width slice would never advance the cursor — an infinite pass.
        for (const bad of [0, -5]) {
            const r = resolveStep2Slice({ cursor: null, ...W, sliceDays: bad });
            expect(r.sliceStart < r.sliceEnd).toBe(true);
        }
    });

    test('never emits a slice wider than 180 days, which Amazon returns empty for', () => {
        const slices = walkPass({ windowStart: '2025-01-01', windowEnd: '2026-08-03', sliceDays: 7 }, 200);
        for (const s of slices) {
            const days = (new Date(`${s.sliceEnd}T00:00:00Z`) - new Date(`${s.sliceStart}T00:00:00Z`)) / 86400000;
            expect(days).toBeLessThanOrEqual(180);
        }
    });
});
