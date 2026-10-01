/**
 * The "next report" date, and why the server is not allowed to send a day name.
 *
 * The page used to hardcode `{ name: 'Weekly Sales Summary', due: 'Monday' }`. Both halves
 * were false — the weekly job runs Saturday, and no report has that name — so the fix moved
 * the answer server-side. What it must NOT do is move a day name server-side: the weekly run
 * fires at 08:00 in the scheduler's timezone, which with TIMEZONE=UTC is Friday evening in
 * Hawaii. The server sends an instant; this decides what to call it locally.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { formatDueLabel, formatDueTitle } from '../../hooks/useNextReport.js';

describe('formatDueLabel', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => { vi.useRealTimers(); });

    test('calls the day of the run by its weekday within the week', () => {
        // Local wall-clock, so the assertion holds wherever the suite runs. The weekly job
        // really does fire on a Saturday — that is the whole correction this replaced.
        const now = new Date('2026-10-01T12:00:00');          // Thursday
        const saturday = new Date('2026-10-03T08:00:00');

        expect(formatDueLabel(saturday.toISOString(), now)).toBe('Saturday');
    });

    test.each([
        ['later today', '2026-10-01T23:00:00', '2026-10-01T08:00:00', 'Today'],
        ['tomorrow', '2026-10-02T09:00:00', '2026-10-01T08:00:00', 'Tomorrow'],
    ])('%s', (_label, at, now, expected) => {
        // Constructed WITHOUT a Z: these are local wall-clock times, because the function
        // compares local calendar days. Writing them as UTC makes the test pass or fail
        // depending on the machine's timezone, which is the bug in miniature.
        expect(formatDueLabel(new Date(at).toISOString(), new Date(now))).toBe(expected);
    });

    test('compares calendar days, not elapsed hours', () => {
        /*
         * 23:30 tonight is Today, however few hours away it is — and 00:30 tomorrow is
         * Tomorrow, however close. Rounding elapsed milliseconds gets both backwards, which
         * is the one arithmetic mistake this helper exists to avoid.
         */
        const now = new Date('2026-10-01T22:00:00');          // local

        expect(formatDueLabel(new Date('2026-10-01T23:30:00').toISOString(), now)).toBe('Today');
        expect(formatDueLabel(new Date('2026-10-02T00:30:00').toISOString(), now)).toBe('Tomorrow');
    });

    test('falls back to a date beyond a week', () => {
        /*
         * The property is "a date rather than a weekday", not a particular month: a month
         * name here would be asserting the runner's timezone. 1 Nov 08:30 UTC is 31 Oct in
         * Honolulu, and both are correct answers for their reader.
         */
        const label = formatDueLabel(new Date('2026-11-01T08:30:00').toISOString(),
            new Date('2026-10-01T12:00:00'));

        expect(label).not.toMatch(/day$/);        // not Monday, Saturday, ...
        expect(label).toMatch(/\d/);              // carries a day number
        expect(label).toMatch(/[A-Za-z]{3}/);     // and a month
    });

    test('renders nothing when there is no date, rather than inventing one', () => {
        expect(formatDueLabel(null)).toBe('');
        expect(formatDueLabel(undefined)).toBe('');
        expect(formatDueLabel('not a date')).toBe('');
    });

    /**
     * THE CASE THAT FORCES AN INSTANT RATHER THAN A DAY NAME.
     *
     * One instant, two readers. The server cannot be right for both with a single string,
     * which is exactly why it does not try.
     */
    test('one instant reads differently depending on the local day it falls in', () => {
        /*
         * The property that forces the server to send an instant rather than a day name.
         *
         * One fixed moment, two readers whose local calendar days differ — and the label
         * differs with them. A server-rendered "Saturday" could only ever be right for one
         * of these two, which is why it does not try.
         */
        const at = new Date('2026-10-03T08:00:00').toISOString();

        const dayBefore = formatDueLabel(at, new Date('2026-10-02T20:00:00'));
        const sameDay = formatDueLabel(at, new Date('2026-10-03T01:00:00'));

        expect(dayBefore).toBe('Tomorrow');
        expect(sameDay).toBe('Today');
    });
});

describe('formatDueTitle', () => {
    test('names the scheduler timezone, so the exact hour is one hover away', () => {
        const title = formatDueTitle({ at: '2026-10-03T08:00:00.000Z', timezone: 'UTC' });

        expect(title).toMatch(/scheduled UTC/);
    });

    test('is empty when there is nothing scheduled', () => {
        expect(formatDueTitle(null)).toBe('');
        expect(formatDueTitle({ at: null })).toBe('');
    });
});
