/**
 * Tests for calculateNegativeKeywordsMetrics — the join between negative keywords and their
 * ads performance rows.
 *
 * WHY THIS EXISTS
 * The original implementation ran three `adsKeywordsPerformanceData.find(...)` calls INSIDE
 * `negativeKeywords.map(...)`, re-lowercasing both sides on every comparison. One production
 * account carries 379,401 negative keywords against 117,108 performance rows: ~44 trillion
 * comparisons per pass, each allocating throwaway strings. That is not slow, it never finishes.
 *
 * It runs synchronously inside `sched_calc_review`, so it blocked the worker's event loop
 * outright — no lock extensions, no heartbeat, BullMQ stall-reclaiming the job every 20 minutes
 * and failing it after three attempts. That account did not complete a pipeline run for over a
 * week while every other account finished the same phase in 17 seconds.
 *
 * THE RISK IN FIXING IT is not speed, it is silently changing which performance row a keyword
 * matches. The precedence has three tiers with `Array#find`'s first-match semantics, `?.` guards
 * that let `undefined` participate in comparisons, and a fuzzy tier that matches substrings in
 * BOTH directions. So the main test here is differential: the ORIGINAL implementation is kept
 * verbatim as an oracle and the two are asserted to agree, rather than asserting outputs I
 * derived by reading the new code.
 */

const {
    calculateNegativeKeywordsMetrics,
} = require('../../../Services/Calculations/SponsoredAdsCalculation.js');

/**
 * The pre-optimisation implementation, copied verbatim from git history. This is the oracle —
 * it defines correct behaviour, including its quirks. Do not "clean it up".
 */
function originalImplementation(negativeKeywords, adsKeywordsPerformanceData) {
    if (!Array.isArray(negativeKeywords) || !Array.isArray(adsKeywordsPerformanceData)) return [];

    return negativeKeywords.map((keyword) => {
        const { keywordText, campaignId } = keyword;

        let performanceData = adsKeywordsPerformanceData.find(perf =>
            perf.keyword?.toLowerCase() === keywordText?.toLowerCase() &&
            perf.campaignId === campaignId
        );

        if (!performanceData) {
            performanceData = adsKeywordsPerformanceData.find(perf =>
                perf.keyword?.toLowerCase() === keywordText?.toLowerCase()
            );
        }

        if (!performanceData) {
            performanceData = adsKeywordsPerformanceData.find(perf =>
                perf.keyword?.toLowerCase().includes(keywordText?.toLowerCase() || '') ||
                keywordText?.toLowerCase().includes(perf.keyword?.toLowerCase() || '')
            );
        }

        if (!performanceData) {
            return { keyword: keywordText || '', campaignName: 'No Campaign Found', sales: 0, spend: 0, acos: 0 };
        }

        const attributedSales30d = parseFloat(String(performanceData.attributedSales30d)) || 0;
        const cost = parseFloat(String(performanceData.cost)) || 0;
        const acos = attributedSales30d > 0 ? (cost / attributedSales30d) * 100 : 0;

        return {
            keyword: keywordText || '',
            campaignName: performanceData.campaignName || 'Unknown Campaign',
            sales: parseFloat(attributedSales30d.toFixed(2)),
            spend: parseFloat(cost.toFixed(2)),
            acos: parseFloat(acos.toFixed(2)),
        };
    });
}

const perf = (keyword, campaignId, extra = {}) => ({
    keyword,
    campaignId,
    campaignName: `camp-${campaignId}`,
    attributedSales30d: 100,
    cost: 25,
    ...extra,
});

describe('the new implementation agrees with the old one', () => {
    /**
     * Every tier and edge case in one fixture, checked against the oracle. Each entry is here
     * because it distinguishes a plausible wrong implementation:
     *   - two rows share a keyword, differing only by campaign  → pins tier-1 vs tier-2
     *   - a keyword present under a DIFFERENT campaign          → must fall to tier 2, not miss
     *   - duplicate (keyword, campaign) pairs                   → pins first-match-wins
     *   - substring matches in both directions                  → pins the fuzzy tier
     *   - undefined keywordText, undefined perf.keyword         → pins the `?.` semantics
     *   - zero sales with non-zero cost                         → pins the ACOS guard
     */
    const performanceRows = [
        perf('running shoes', 'C1'),
        perf('running shoes', 'C2', { attributedSales30d: 200, cost: 50 }),
        perf('running shoes', 'C1', { campaignName: 'DUPLICATE — must never win' }),
        perf('blue widget', 'C3', { attributedSales30d: 0, cost: 10 }),
        perf('WIDGET', 'C4'),
        perf(undefined, 'C5'),
        perf('shoe', 'C6'),
    ];

    const negativeKeywords = [
        { keywordText: 'running shoes', campaignId: 'C1' },   // tier 1
        { keywordText: 'running shoes', campaignId: 'C2' },   // tier 1, different campaign
        { keywordText: 'running shoes', campaignId: 'C99' },  // tier 2 — campaign absent
        { keywordText: 'RUNNING SHOES', campaignId: 'C1' },   // tier 1, case-insensitive
        { keywordText: 'blue widget', campaignId: 'C3' },     // zero sales, non-zero cost
        { keywordText: 'widget', campaignId: 'C4' },          // tier 2 via case folding
        { keywordText: 'running shoes for men', campaignId: 'X' }, // fuzzy: perf ⊂ keyword
        { keywordText: 'shoe', campaignId: 'X' },             // fuzzy: keyword ⊂ perf
        { keywordText: 'zzz totally absent', campaignId: 'X' }, // fuzzy hits '' — see below
        { keywordText: undefined, campaignId: 'C5' },         // undefined text
        { keywordText: '', campaignId: 'X' },                 // empty text
    ];

    test('produces byte-identical output to the original', () => {
        expect(calculateNegativeKeywordsMetrics(negativeKeywords, performanceRows))
            .toEqual(originalImplementation(negativeKeywords, performanceRows));
    });

    test('each tier is actually exercised by the fixture', () => {
        // Guards against the fixture silently degenerating so that "identical" becomes trivial.
        const out = calculateNegativeKeywordsMetrics(negativeKeywords, performanceRows);
        expect(out[0].campaignName).toBe('camp-C1');        // tier 1
        expect(out[1].sales).toBe(200);                     // tier 1, the OTHER campaign
        expect(out[2].campaignName).toBe('camp-C1');        // tier 2 fell back to first match
        expect(out[4].acos).toBe(0);                        // zero sales must not divide
        expect(out.some((r) => r.campaignName === 'DUPLICATE — must never win')).toBe(false);
    });

    // A randomised sweep catches orderings and collisions a hand-written fixture will not.
    test('agrees with the original across 200 randomised cases', () => {
        const words = ['shoe', 'shoes', 'running', 'running shoes', 'widget', 'blue', '', 'x'];
        const campaigns = ['C1', 'C2', 'C3', undefined];
        let seed = 42;
        const rand = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % n; };

        for (let iteration = 0; iteration < 200; iteration++) {
            const rows = Array.from({ length: 1 + rand(6) }, () => perf(
                rand(9) === 0 ? undefined : words[rand(words.length)],
                campaigns[rand(campaigns.length)],
                { attributedSales30d: rand(3) === 0 ? 0 : rand(500), cost: rand(100) }
            ));
            const negatives = Array.from({ length: 1 + rand(8) }, () => ({
                keywordText: rand(10) === 0 ? undefined : words[rand(words.length)],
                campaignId: campaigns[rand(campaigns.length)],
            }));

            expect(calculateNegativeKeywordsMetrics(negatives, rows))
                .toEqual(originalImplementation(negatives, rows));
        }
    });
});

describe('the pathological account shape completes', () => {
    /**
     * THE REGRESSION TEST. Scaled to the real distribution — a large row count over few distinct
     * texts, which is what makes memoising the fuzzy tier effective (379,401 rows / 2,450 distinct
     * in production). The original would need billions of comparisons here and would hang the
     * suite; that is precisely the failure being prevented, so it is deliberately NOT run.
     */
    test('100k negative keywords over 2k performance rows finishes in seconds, not hours', () => {
        const performanceRows = Array.from({ length: 2000 }, (_, i) =>
            perf(`kw-${i}-term`, `C${i % 50}`, { attributedSales30d: i, cost: i / 2 }));

        // 500 distinct texts spread over 100,000 rows, and half match nothing exactly so they
        // reach the fuzzy tier — the expensive path.
        const negativeKeywords = Array.from({ length: 100000 }, (_, i) => ({
            keywordText: i % 2 === 0 ? `kw-${i % 500}-term` : `absent-${i % 500}`,
            campaignId: `C${i % 50}`,
        }));

        const started = Date.now();
        const result = calculateNegativeKeywordsMetrics(negativeKeywords, performanceRows);
        const elapsed = Date.now() - started;

        expect(result).toHaveLength(100000);
        expect(elapsed).toBeLessThan(5000);
    });

    test('repeated keyword texts resolve to the same row (the memo cannot drift)', () => {
        const performanceRows = [perf('alpha', 'C1'), perf('alphabet', 'C2')];
        const negatives = Array.from({ length: 50 }, () => ({ keywordText: 'alph', campaignId: 'X' }));

        const out = calculateNegativeKeywordsMetrics(negatives, performanceRows);

        expect(new Set(out.map((r) => r.campaignName)).size).toBe(1);
        expect(out).toEqual(originalImplementation(negatives, performanceRows));
    });
});

describe('input guards', () => {
    test.each([
        ['negativeKeywords not an array', null, []],
        ['performance data not an array', [], null],
        ['both missing', undefined, undefined],
    ])('%s returns []', (_label, a, b) => {
        expect(calculateNegativeKeywordsMetrics(a, b)).toEqual([]);
    });

    test('no performance rows at all still returns one entry per negative keyword', () => {
        const negatives = [{ keywordText: 'a', campaignId: 'C1' }, { keywordText: 'b', campaignId: 'C2' }];

        const out = calculateNegativeKeywordsMetrics(negatives, []);

        expect(out).toEqual(originalImplementation(negatives, []));
        expect(out.every((r) => r.campaignName === 'No Campaign Found')).toBe(true);
    });
});
