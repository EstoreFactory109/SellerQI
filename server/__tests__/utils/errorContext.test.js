/**
 * Tests for errorContext — the hop tagging that makes a finance transport failure attributable.
 *
 * The two properties that actually matter are not the formatting; they are the invariants that stop
 * this helper from breaking something else:
 *
 *   1. FIRST TAG WINS. The error bubbles outward through wrapper after wrapper. If the outermost
 *      tag won, every finance failure would report `financeWalk` — accurate, and exactly as useless
 *      as the bare `socket hang up` this exists to replace.
 *   2. NO HOP NAME MAY COLLIDE WITH A classifySyncFailure KEYWORD. That function does lowercase
 *      substring matching over the whole message, and ScheduledIntegration rebuilds an Error from
 *      the stored note and re-runs it. A hop called e.g. `downloadTimeout` would force every failure
 *      tagged with it into the 'timeout' bucket regardless of the real cause.
 */

const { tagHop, describeError, HOP_NAMES } = require('../../utils/errorContext.js');
const { classifySyncFailure } = require('../../Services/Sp_API/FinanceService.js');

const netErr = (msg, code) => Object.assign(new Error(msg), code ? { code } : {});

describe('tagHop', () => {
    test('tags an untagged error', () => {
        const err = tagHop(new Error('boom'), HOP_NAMES.LWA_TOKEN);
        expect(err.hop).toBe('lwaToken');
    });

    test('FIRST tag wins — the innermost hop is preserved', () => {
        const err = new Error('socket hang up');
        tagHop(err, HOP_NAMES.LWA_TOKEN);        // innermost: the real failure
        tagHop(err, HOP_NAMES.FINANCE_TXN_PAGE); // an outer wrapper
        tagHop(err, HOP_NAMES.FINANCE_WALK);     // the outermost
        expect(err.hop).toBe('lwaToken');
    });

    test('returns the same error object, so `throw tagHop(err, …)` works', () => {
        const err = new Error('boom');
        expect(tagHop(err, HOP_NAMES.LWA_TOKEN)).toBe(err);
    });

    test('attaches extras without overwriting ones already present', () => {
        const err = new Error('boom');
        tagHop(err, HOP_NAMES.FINANCE_TXN_PAGE, { pagesCompleted: 5 });
        tagHop(err, HOP_NAMES.FINANCE_WALK, { pagesCompleted: 999 });
        expect(err.pagesCompleted).toBe(5);
    });

    test('never throws on a non-object, and passes it through', () => {
        // This runs on an error path; replacing the real failure with a TypeError would be worse
        // than not annotating at all.
        expect(() => tagHop(null, HOP_NAMES.LWA_TOKEN)).not.toThrow();
        expect(() => tagHop('a string', HOP_NAMES.LWA_TOKEN)).not.toThrow();
        expect(tagHop(undefined, HOP_NAMES.LWA_TOKEN)).toBeUndefined();
    });

    test('never throws on a frozen error', () => {
        const err = Object.freeze(new Error('boom'));
        expect(() => tagHop(err, HOP_NAMES.LWA_TOKEN)).not.toThrow();
    });
});

describe('describeError', () => {
    test('renders hop, code, message and extras', () => {
        const err = tagHop(netErr('socket hang up', 'ECONNRESET'), HOP_NAMES.FINANCE_TXN_PAGE, { pagesCompleted: 847 });
        expect(describeError(err)).toBe('[financeTxnPage] ECONNRESET: socket hang up (pagesCompleted=847)');
    });

    test('omits the hop when untagged', () => {
        expect(describeError(new Error('plain'))).toBe('plain');
    });

    test('the hop comes FIRST so it survives the shortest downstream truncation', () => {
        // diagnoseDailySchedule prints notes clipped to a fixed width; a trailing tag would be the
        // first thing lost, which defeats the point of tagging.
        const err = tagHop(netErr('socket hang up', 'ECONNRESET'), HOP_NAMES.LWA_TOKEN);
        expect(describeError(err).slice(0, 11)).toBe('[lwaToken] ');
    });

    test('bounds the total length', () => {
        const err = tagHop(new Error('x'.repeat(10000)), HOP_NAMES.LWA_TOKEN);
        expect(describeError(err).length).toBeLessThanOrEqual(300);
    });

    test('trims the message from the RIGHT, keeping its head', () => {
        // classifySyncFailure matches on keywords that appear at the START of these messages, so the
        // head is the part that must survive.
        const err = tagHop(new Error(`socket hang up ${'y'.repeat(5000)}`), HOP_NAMES.LWA_TOKEN);
        expect(describeError(err)).toContain('socket hang up');
    });

    test('handles a non-Error input', () => {
        expect(describeError('just a string')).toBe('just a string');
        // Nullish renders as a readable placeholder rather than the literal "null"/"undefined",
        // which would read as a real error message in a stored note.
        expect(describeError(null)).toBe('unknown error');
        expect(describeError(undefined)).toBe('unknown error');
    });
});

/**
 * The collision guard. This is the test that stops a future hop name from silently re-bucketing
 * every failure it touches.
 */
describe('hop names never change the errorKind bucket', () => {
    const FORBIDDEN = [
        'timeout', 'forbidden', 'access_denied', 'denied', 'out of memory',
        'econnreset', 'econnaborted', 'eai_again', 'epipe', 'timed out',
        'did not complete within', 'download exceeded', 'download stalled', 'no response within',
        'heap already at',
    ];

    test.each(Object.values(HOP_NAMES))('`%s` contains no classifySyncFailure keyword', (hop) => {
        const lower = hop.toLowerCase();
        for (const kw of FORBIDDEN) expect(lower).not.toContain(kw);
    });

    test.each(Object.values(HOP_NAMES))('`%s` leaves a benign error bucketed as `other`', (hop) => {
        // The proof that matters: tagging must not move the bucket. A structural error stays 'other'.
        const err = tagHop(new Error('something structural went wrong'), hop);
        expect(classifySyncFailure(new Error(describeError(err)))).toBe('other');
    });

    test.each(Object.values(HOP_NAMES))('`%s` preserves a socket error as `timeout`', (hop) => {
        const err = tagHop(netErr('socket hang up', 'ECONNRESET'), hop);
        expect(classifySyncFailure(new Error(describeError(err)))).toBe('timeout');
    });

    test('an auth denial stays `auth_denied` after tagging', () => {
        const err = tagHop(new Error('Access to requested resource is denied'), HOP_NAMES.LWA_TOKEN);
        expect(classifySyncFailure(new Error(describeError(err)))).toBe('auth_denied');
    });
});
