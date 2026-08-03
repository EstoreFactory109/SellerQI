/**
 * Tests for the finance async gate.
 *
 * The point of this gate is blast radius: `ADS_ASYNC_ENABLED` switches six phases for every
 * account at once, so finance needed a switch that can be turned on for ONE account. The states
 * below are the ones that decide whether a production account runs proven inline code or new async
 * code, so each is pinned explicitly — particularly "flag on, empty list", which is the difference
 * between a widened rollout and accidentally sending everyone back to inline.
 */

const { financeAsyncEnabledFor, parseUserIdList } = require('../../utils/asyncFinanceGate.js');

const A = '507f1f77bcf86cd799439011';
const B = '6a57b823571ceb9266953c30';

describe('financeAsyncEnabledFor', () => {
    test('flag unset -> inline for everyone (the default, and the rollback)', () => {
        expect(financeAsyncEnabledFor(A, {})).toBe(false);
    });

    test('flag not exactly \'true\' -> inline (no truthy-string surprises)', () => {
        for (const v of ['1', 'yes', 'TRUE', 'True', '', 'false']) {
            expect(financeAsyncEnabledFor(A, { FINANCE_ASYNC_ENABLED: v })).toBe(false);
        }
    });

    test('flag on with no allowlist -> async for everyone (the widened state)', () => {
        expect(financeAsyncEnabledFor(A, { FINANCE_ASYNC_ENABLED: 'true' })).toBe(true);
    });

    test('flag on with a BLANK allowlist -> async for everyone, not nobody', () => {
        // Blanking the variable must widen, not silently disable — otherwise rollout and rollback
        // would look identical in the env file.
        expect(financeAsyncEnabledFor(A, { FINANCE_ASYNC_ENABLED: 'true', FINANCE_ASYNC_USER_IDS: '' })).toBe(true);
        expect(financeAsyncEnabledFor(A, { FINANCE_ASYNC_ENABLED: 'true', FINANCE_ASYNC_USER_IDS: '  ' })).toBe(true);
    });

    test('allowlist hit -> async; miss -> inline', () => {
        const env = { FINANCE_ASYNC_ENABLED: 'true', FINANCE_ASYNC_USER_IDS: B };
        expect(financeAsyncEnabledFor(B, env)).toBe(true);
        expect(financeAsyncEnabledFor(A, env)).toBe(false);
    });

    test('allowlist works with several ids and tolerates whitespace', () => {
        const env = { FINANCE_ASYNC_ENABLED: 'true', FINANCE_ASYNC_USER_IDS: ` ${A} , ${B} ` };
        expect(financeAsyncEnabledFor(A, env)).toBe(true);
        expect(financeAsyncEnabledFor(B, env)).toBe(true);
        expect(financeAsyncEnabledFor('507f1f77bcf86cd799439099', env)).toBe(false);
    });

    test('an ObjectId instance is accepted, not just a string', () => {
        const mongoose = require('mongoose');
        const oid = new mongoose.Types.ObjectId(B);
        expect(financeAsyncEnabledFor(oid, { FINANCE_ASYNC_ENABLED: 'true', FINANCE_ASYNC_USER_IDS: B })).toBe(true);
    });

    test('the allowlist is off when the flag is off, even if ids are listed', () => {
        expect(financeAsyncEnabledFor(B, { FINANCE_ASYNC_USER_IDS: B })).toBe(false);
    });

    test('a malformed id fails CLOSED — that account stays on the inline path', () => {
        // A typo must not crash the worker at phase dispatch, and must not accidentally opt an
        // account into new code.
        const env = { FINANCE_ASYNC_ENABLED: 'true', FINANCE_ASYNC_USER_IDS: 'not-an-objectid' };
        expect(financeAsyncEnabledFor(A, env)).toBe(false);
        expect(financeAsyncEnabledFor('not-an-objectid', env)).toBe(false);
    });

    test('a valid id still works when listed alongside a malformed one', () => {
        const env = { FINANCE_ASYNC_ENABLED: 'true', FINANCE_ASYNC_USER_IDS: `oops,${B}` };
        expect(financeAsyncEnabledFor(B, env)).toBe(true);
        expect(financeAsyncEnabledFor(A, env)).toBe(false);
    });
});

describe('parseUserIdList', () => {
    test('drops invalid ids rather than throwing', () => {
        expect([...parseUserIdList(`${A},nope,,${B}`)]).toEqual([A, B]);
    });

    test('empty / undefined input yields an empty set', () => {
        expect(parseUserIdList(undefined).size).toBe(0);
        expect(parseUserIdList('').size).toBe(0);
    });

    test('de-duplicates', () => {
        expect([...parseUserIdList(`${A},${A}`)]).toEqual([A]);
    });
});

describe('financeStep2SlicingEnabledFor', () => {
    const { financeStep2SlicingEnabledFor } = require('../../utils/asyncFinanceGate.js');

    test('is INDEPENDENT of the async-report flag', () => {
        // The two solve different problems (report queueing vs worker occupancy during the
        // pending-fee search) and must be soakable separately. If they were coupled, enabling one
        // would silently enable the other.
        expect(financeStep2SlicingEnabledFor(A, { FINANCE_ASYNC_ENABLED: 'true' })).toBe(false);
        expect(financeAsyncEnabledFor(A, { FINANCE_STEP2_SLICING_ENABLED: 'true' })).toBe(false);
    });

    test('flag unset -> unsliced for everyone (the default and the rollback)', () => {
        expect(financeStep2SlicingEnabledFor(A, {})).toBe(false);
    });

    test('flag on with no allowlist -> sliced for everyone', () => {
        expect(financeStep2SlicingEnabledFor(A, { FINANCE_STEP2_SLICING_ENABLED: 'true' })).toBe(true);
    });

    test('allowlist hit -> sliced; miss -> unsliced', () => {
        const env = { FINANCE_STEP2_SLICING_ENABLED: 'true', FINANCE_STEP2_USER_IDS: B };
        expect(financeStep2SlicingEnabledFor(B, env)).toBe(true);
        expect(financeStep2SlicingEnabledFor(A, env)).toBe(false);
    });

    test('a malformed allowlist fails CLOSED, same as the async gate', () => {
        const env = { FINANCE_STEP2_SLICING_ENABLED: 'true', FINANCE_STEP2_USER_IDS: 'typo' };
        expect(financeStep2SlicingEnabledFor(A, env)).toBe(false);
        expect(financeStep2SlicingEnabledFor(B, env)).toBe(false);
    });

    test('only exactly \'true\' enables it', () => {
        for (const v of ['1', 'yes', 'TRUE', '', 'false']) {
            expect(financeStep2SlicingEnabledFor(A, { FINANCE_STEP2_SLICING_ENABLED: v })).toBe(false);
        }
    });
});
