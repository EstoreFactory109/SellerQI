/**
 * Tests for Amazon Ads SP v3 ID-filter chunking.
 *
 * Context: the v2 -> v3 migration assumed the POST body removed the need to chunk ID filters.
 * That is true of the URL-length limit only — v3 still caps `include[]` members, so sending every
 * campaign ID at once returned `400 INVALID_ARGUMENT` and an account with 5,102 campaigns fetched
 * NO ad groups and NO negative keywords at all (the latter silently, because the caller logs the
 * failure as a warning).
 */

const { chunkIds, ADS_ID_FILTER_MAX, ADS_CHUNK_DELAY_MS, sleep } = require('../../utils/adsIdFilter.js');

const idsOfLength = (n) => Array.from({ length: n }, (_, i) => String(i + 1));

describe('ADS_ID_FILTER_MAX', () => {
    test('defaults to 100 — Amazon SP v3 include[] cap', () => {
        expect(ADS_ID_FILTER_MAX).toBe(100);
    });
});

describe('ADS_CHUNK_DELAY_MS / sleep', () => {
    // These reload the module under an explicit env so the assertions are real rather than
    // dependent on whatever another suite happened to leave in process.env.
    const loadWith = (value) => {
        const original = process.env.ADS_ID_FILTER_CHUNK_DELAY_MS;
        if (value === undefined) delete process.env.ADS_ID_FILTER_CHUNK_DELAY_MS;
        else process.env.ADS_ID_FILTER_CHUNK_DELAY_MS = value;
        jest.resetModules();
        try {
            return require('../../utils/adsIdFilter.js');
        } finally {
            if (original === undefined) delete process.env.ADS_ID_FILTER_CHUNK_DELAY_MS;
            else process.env.ADS_ID_FILTER_CHUNK_DELAY_MS = original;
        }
    };

    test('a delay of 0 is honoured, not silently replaced by the default', () => {
        // Regression guard: the validator originally rejected anything <= 0 and fell back to 250ms,
        // so pacing could not be switched off — which blew the per-test timeout on large fixtures.
        expect(loadWith('0').ADS_CHUNK_DELAY_MS).toBe(0);
    });

    test('defaults to 250ms when unset', () => {
        expect(loadWith(undefined).ADS_CHUNK_DELAY_MS).toBe(250);
    });

    test('a negative delay is rejected and falls back to the default', () => {
        expect(loadWith('-5').ADS_CHUNK_DELAY_MS).toBe(250);
    });

    test('chunk SIZE still rejects 0 — a zero-sized chunk is meaningless', () => {
        const original = process.env.ADS_ID_FILTER_CHUNK_SIZE;
        process.env.ADS_ID_FILTER_CHUNK_SIZE = '0';
        jest.resetModules();
        try {
            expect(require('../../utils/adsIdFilter.js').ADS_ID_FILTER_MAX).toBe(100);
        } finally {
            if (original === undefined) delete process.env.ADS_ID_FILTER_CHUNK_SIZE;
            else process.env.ADS_ID_FILTER_CHUNK_SIZE = original;
        }
    });

    test('sleep(0) resolves without scheduling a timer', async () => {
        const start = Date.now();
        await sleep(0);
        expect(Date.now() - start).toBeLessThan(50);
    });

    test('sleep of a positive value actually waits', async () => {
        const start = Date.now();
        await sleep(30);
        expect(Date.now() - start).toBeGreaterThanOrEqual(20);
    });
});

describe('chunkIds', () => {
    test('empty input yields NO chunks, not one empty chunk', () => {
        // An empty `include` means "match nothing" to Amazon, not "match all" — so callers must
        // never be handed an empty chunk to send.
        expect(chunkIds([])).toEqual([]);
    });

    test('non-array input is treated as empty rather than throwing', () => {
        expect(chunkIds(null)).toEqual([]);
        expect(chunkIds(undefined)).toEqual([]);
    });

    test('single id yields one chunk of one', () => {
        expect(chunkIds(['a'])).toEqual([['a']]);
    });

    test('exactly at the cap stays a single chunk (no off-by-one split)', () => {
        const chunks = chunkIds(idsOfLength(100));
        expect(chunks).toHaveLength(1);
        expect(chunks[0]).toHaveLength(100);
    });

    test('one over the cap splits into 100 + 1', () => {
        const chunks = chunkIds(idsOfLength(101));
        expect(chunks).toHaveLength(2);
        expect(chunks[0]).toHaveLength(100);
        expect(chunks[1]).toEqual(['101']);
    });

    test('the real failing account size (5,102 campaigns) splits into 52 chunks', () => {
        const chunks = chunkIds(idsOfLength(5102));
        expect(chunks).toHaveLength(52);
        expect(chunks[51]).toHaveLength(2); // 51 * 100 + 2
    });

    test('every chunk respects the cap and nothing is lost or duplicated', () => {
        const input = idsOfLength(5102);
        const chunks = chunkIds(input);
        for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(ADS_ID_FILTER_MAX);
            expect(chunk.length).toBeGreaterThan(0);
        }
        expect(chunks.flat()).toEqual(input);
    });

    test('honours an explicit size override', () => {
        expect(chunkIds(idsOfLength(5), 2)).toEqual([['1', '2'], ['3', '4'], ['5']]);
    });

    test('falls back to the default for a nonsensical size', () => {
        expect(chunkIds(idsOfLength(150), 0)).toHaveLength(2);
        expect(chunkIds(idsOfLength(150), -10)).toHaveLength(2);
    });
});
