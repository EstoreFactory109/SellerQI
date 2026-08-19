/**
 * Windowing for the two per-day ads collections (keywords + search terms).
 *
 * WHY THIS EXISTS
 * Both collections store ONE document per account per day and have no TTL. `Analyse.js` called
 * both with `{}`, and `{}` meant "every day ever recorded" — the date filter was applied only
 * `if (startStr && endStr)`. Measured in production: 78.8 MB of BSON for a single account
 * (62 docs, largest 1.40 MB), `flatMap`ed into a second copy while the first was still live,
 * inside a ~30-query Promise.all, on heaps of 1536 MB (worker) and 768 MB (api). The cost grew
 * with account age forever.
 *
 * It was also a SELLER-FACING correctness bug: the dashboard's default view is labelled
 * "Last 30 Days" but summed wasted spend over all time, so the figure inflated as an account aged.
 *
 * The subtle part — and the reason for most of these tests — is that the window is anchored to
 * the account's NEWEST metricDate, not to today. Ingestion routinely lags by days; a
 * today-anchored window would return zero rows for a lagging account and silently blank its
 * dashboard, trading a memory bug for a worse correctness bug.
 *
 * These call the schema statics with a mock `this`, so they assert the QUERY that reaches Mongo.
 * That is the actual contract here; a live DB would test mongoose, not this logic.
 */

const AdsKeywords = require('../../models/amazon-ads/adsKeywordsPerformanceModel.js');
const SearchTerms = require('../../models/amazon-ads/SearchTermsModel.js');
const { shiftMetricDateKey } = require('../../utils/metricDateKey.js');

const USER = '6a57b823571ceb9266953c30';

/**
 * Mock model: records every query it is handed and replays canned results.
 * `newestMetricDate` is what the anchor lookup (findOne + sort desc) resolves to.
 */
function makeModel({ newestMetricDate = null, dailyDocs = [], legacyDoc = null } = {}) {
    const calls = { find: [], findOne: [] };
    let findOneCount = 0;

    const model = {
        calls,
        find(query) {
            // Snapshot: the static mutates dailyQuery in place, so a reference would show
            // the FINAL state and silently pass even if the window were applied too late.
            calls.find.push(JSON.parse(JSON.stringify(query)));
            return { sort: () => ({ lean: async () => dailyDocs }) };
        },
        findOne(query) {
            calls.findOne.push(JSON.parse(JSON.stringify(query)));
            const isAnchorLookup = findOneCount === 0 && newestMetricDate !== null;
            findOneCount += 1;
            const result = isAnchorLookup ? { metricDate: newestMetricDate } : legacyDoc;
            const chain = {
                sort: () => chain,
                select: () => chain,
                lean: async () => result,
            };
            return chain;
        },
    };
    return model;
}

const runKeywords = (model, options) =>
    AdsKeywords.schema.statics.findMergedKeywordsData.call(model, USER, 'US', 'NA', options);
const runSearchTerms = (model, options) =>
    SearchTerms.schema.statics.findMergedSearchTermData.call(model, USER, 'US', 'NA', options);

describe('shiftMetricDateKey', () => {
    test('shifts back across a month boundary in UTC', () => {
        expect(shiftMetricDateKey('2026-08-15', -29)).toBe('2026-07-17');
    });

    test('handles a leap day rather than skidding into an invalid date', () => {
        expect(shiftMetricDateKey('2026-03-01', -1)).toBe('2026-02-28');
        expect(shiftMetricDateKey('2024-03-01', -1)).toBe('2024-02-29');
    });

    test('returns null for unusable input so callers can fall back instead of querying garbage', () => {
        expect(shiftMetricDateKey(null, -30)).toBeNull();
        expect(shiftMetricDateKey('not-a-date', -30)).toBeNull();
    });
});

describe.each([
    ['findMergedKeywordsData', runKeywords, 'keywordsData'],
    ['findMergedSearchTermData', runSearchTerms, 'searchTermData'],
])('%s', (_name, run, payloadField) => {
    // THE REGRESSION TEST. Against the pre-fix code this fails: `{}` and `{lookbackDays}` both
    // produced a query with no metricDate range, so every day ever stored was loaded.
    test('lookbackDays bounds the query to a window ending at the newest stored day', async () => {
        const model = makeModel({
            newestMetricDate: '2026-08-15',
            dailyDocs: [{ [payloadField]: [{ keyword: 'a' }] }],
        });

        await run(model, { lookbackDays: 30 });

        const dailyQuery = model.calls.find[0];
        // 30 days INCLUSIVE of the anchor day: 2026-07-17 .. 2026-08-15.
        expect(dailyQuery.metricDate).toEqual({ $gte: '2026-07-17', $lte: '2026-08-15' });
    });

    test('the window is anchored to stored data, NOT to today — a lagging account still returns rows', async () => {
        // Newest data is ~5 months stale. A today-anchored window would return nothing and
        // blank the dashboard; anchoring on the data keeps it correct.
        const model = makeModel({
            newestMetricDate: '2026-03-10',
            dailyDocs: [{ [payloadField]: [{ keyword: 'stale-but-real' }] }],
        });

        const rows = await run(model, { lookbackDays: 30 });

        expect(model.calls.find[0].metricDate).toEqual({ $gte: '2026-02-09', $lte: '2026-03-10' });
        expect(rows).toEqual([{ keyword: 'stale-but-real' }]);
    });

    test('an explicit startDate/endDate still wins over lookbackDays', async () => {
        const model = makeModel({
            newestMetricDate: '2026-08-15',
            dailyDocs: [{ [payloadField]: [] }],
        });

        await run(model, { startDate: '2026-01-01', endDate: '2026-01-31', lookbackDays: 30 });

        expect(model.calls.find[0].metricDate).toEqual({ $gte: '2026-01-01', $lte: '2026-01-31' });
        // No anchor lookup needed when the caller supplied the range outright.
        expect(model.calls.findOne).toHaveLength(0);
    });

    test('no options => unbounded, so existing callers are untouched', async () => {
        const model = makeModel({ dailyDocs: [{ [payloadField]: [] }] });

        await run(model, {});

        // The presence filter remains, but no $gte/$lte range is imposed.
        expect(model.calls.find[0].metricDate).toEqual({
            $exists: true, $type: 'string', $ne: null,
        });
    });

    test('an account with no per-day rows falls through to the legacy document', async () => {
        // newestMetricDate null => anchor lookup finds nothing. The query must stay unbounded
        // so the legacy (metricDate-less) fallback is still reached rather than returning [].
        const model = makeModel({
            newestMetricDate: null,
            dailyDocs: [],
            legacyDoc: { [payloadField]: [{ keyword: 'legacy-row' }] },
        });

        const rows = await run(model, { lookbackDays: 30 });

        expect(model.calls.find[0].metricDate).toEqual({
            $exists: true, $type: 'string', $ne: null,
        });
        expect(rows).toEqual([{ keyword: 'legacy-row' }]);
    });

    test('a nonsensical lookbackDays is ignored rather than producing an inverted range', async () => {
        for (const bad of [0, -5, NaN, 'thirty', null, undefined]) {
            const model = makeModel({
                newestMetricDate: '2026-08-15',
                dailyDocs: [{ [payloadField]: [] }],
            });

            await run(model, { lookbackDays: bad });

            expect(model.calls.find[0].metricDate).toEqual({
                $exists: true, $type: 'string', $ne: null,
            });
        }
    });

    test('lookbackDays of 1 returns just the anchor day, not an empty range', async () => {
        const model = makeModel({
            newestMetricDate: '2026-08-15',
            dailyDocs: [{ [payloadField]: [] }],
        });

        await run(model, { lookbackDays: 1 });

        expect(model.calls.find[0].metricDate).toEqual({ $gte: '2026-08-15', $lte: '2026-08-15' });
    });

    test('the anchor lookup is scoped to the same account, not the whole collection', async () => {
        // A global max would let a busy account drag another account's window off its own data.
        const model = makeModel({
            newestMetricDate: '2026-08-15',
            dailyDocs: [{ [payloadField]: [] }],
        });

        await run(model, { lookbackDays: 30 });

        const anchorQuery = model.calls.findOne[0];
        expect(anchorQuery.country).toBe('US');
        expect(anchorQuery.region).toBe('NA');
        expect(anchorQuery.userId).toBeDefined();
    });
});
