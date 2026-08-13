/**
 * OpportunityRankingService + TopOpportunitiesService tests
 *
 * Covers the grouping/ranking math, the token-size claim that justifies the
 * whole design, and the AI validation/fallback behaviour.
 */

const OpportunityRankingService = require('../../../Services/Calculations/OpportunityRankingService.js');
const TopOpportunitiesService = require('../../../Services/AI/TopOpportunitiesService.js');

const { buildCandidatesFromIssuesData, CONFIDENCE } = OpportunityRankingService;
const { validateSelections, buildDeterministicSelections, buildPromptPayload, MIN_SELECTIONS, MAX_SELECTIONS } = TopOpportunitiesService;

describe('OpportunityRankingService', () => {
  describe('grouping', () => {
    it('collapses many issue rows into one candidate per issue type', () => {
      const issuesData = {
        sponsoredAdsErrorDetails: [
          { errorType: 'wasted_spend_keyword', keyword: 'kw1', amount: 10 },
          { errorType: 'wasted_spend_keyword', keyword: 'kw2', amount: 20 },
          { errorType: 'wasted_spend_keyword', keyword: 'kw3', amount: 30 },
        ],
      };

      const { candidates } = buildCandidatesFromIssuesData(issuesData);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].id).toBe('ads_wasted_spend_keyword');
      expect(candidates[0].count).toBe(3);
      expect(candidates[0].totalAmount).toBe(60);
    });

    it('caps examples per group and orders them biggest-dollar first', () => {
      const issuesData = {
        sponsoredAdsErrorDetails: Array.from({ length: 20 }, (_, i) => ({
          errorType: 'wasted_spend_keyword', keyword: `kw${i}`, amount: i + 1,
        })),
      };

      const { candidates } = buildCandidatesFromIssuesData(issuesData);

      expect(candidates[0].count).toBe(20);
      expect(candidates[0].topExamples).toHaveLength(OpportunityRankingService.MAX_EXAMPLES_PER_GROUP);
      expect(candidates[0].topExamples[0].amount).toBe(20); // largest first
      expect(candidates[0].totalAmount).toBe(210); // 1..20 summed — full total, not just examples
    });

    it('reads the NESTED inventory amount paths', () => {
      const issuesData = {
        inventoryProductWiseErrors: [
          {
            asin: 'A1', Title: 'Widget',
            inventoryPlanningErrorData: {
              unfulfillable: { status: 'Error', amount: 40 },
              longTermStorageFees: { status: 'Error', amount: 25 },
            },
          },
          {
            asin: 'A2', Title: 'Gadget',
            strandedInventoryErrorData: { status: 'Error', amount: 75, amountIsEstimated: true },
          },
        ],
      };

      const { candidates } = buildCandidatesFromIssuesData(issuesData);
      const byId = Object.fromEntries(candidates.map(c => [c.id, c]));

      expect(byId['inventory_unfulfillable'].totalAmount).toBe(40);
      expect(byId['inventory_long_term_storage_fees'].totalAmount).toBe(25);
      expect(byId['inventory_stranded'].totalAmount).toBe(75);
      // Stranded uses an inferred quantity, so it must be tagged estimated.
      expect(byId['inventory_stranded'].confidence).toBe(CONFIDENCE.ESTIMATED);
      expect(byId['inventory_unfulfillable'].confidence).toBe(CONFIDENCE.MEASURED);
    });

    it('reads the NESTED buy-box amount path', () => {
      const issuesData = {
        conversionProductWiseErrors: [
          { asin: 'A1', Title: 'Widget', productsWithOutBuyboxErrorData: { status: 'Error', amount: 300 } },
          // A conversion error with no buybox data must NOT produce a candidate
          { asin: 'A2', Title: 'Gadget', imageResultErrorData: { status: 'Error' } },
        ],
      };

      const { candidates } = buildCandidatesFromIssuesData(issuesData);

      expect(candidates).toHaveLength(1);
      expect(candidates[0].id).toBe('conversion_buybox_loss');
      expect(candidates[0].count).toBe(1);
      expect(candidates[0].totalAmount).toBe(300);
      expect(candidates[0].confidence).toBe(CONFIDENCE.ESTIMATED);
    });

    it('separates profitability by errorType', () => {
      const issuesData = {
        profitabilityErrorDetails: [
          { errorType: 'negative_profit', asin: 'A1', amount: 100 },
          { errorType: 'low_margin', asin: 'A2', amount: 10 },
          { errorType: 'low_margin', asin: 'A3', amount: 15 },
        ],
      };

      const { candidates } = buildCandidatesFromIssuesData(issuesData);
      const byId = Object.fromEntries(candidates.map(c => [c.id, c]));

      expect(byId['profitability_negative_profit'].count).toBe(1);
      expect(byId['profitability_low_margin'].count).toBe(2);
      expect(byId['profitability_low_margin'].totalAmount).toBe(25);
    });

    it('returns nothing when there are no issues', () => {
      const { candidates, totalRecoverableAmount } = buildCandidatesFromIssuesData({});
      expect(candidates).toEqual([]);
      expect(totalRecoverableAmount).toBe(0);
    });

    it('does not throw on malformed records', () => {
      const issuesData = {
        sponsoredAdsErrorDetails: [null, undefined, {}, { errorType: 'wasted_spend_keyword' }],
        inventoryProductWiseErrors: [null, {}],
      };
      expect(() => buildCandidatesFromIssuesData(issuesData)).not.toThrow();
      const { candidates } = buildCandidatesFromIssuesData(issuesData);
      // The one row with a matching errorType but no amount counts as $0
      expect(candidates.find(c => c.id === 'ads_wasted_spend_keyword').totalAmount).toBe(0);
    });
  });

  describe('ranking', () => {
    it('sorts by recoverable dollars, biggest first', () => {
      const issuesData = {
        profitabilityErrorDetails: [{ errorType: 'negative_profit', asin: 'A1', amount: 50 }],
        sponsoredAdsErrorDetails: [{ errorType: 'wasted_spend_keyword', keyword: 'k', amount: 500 }],
        conversionProductWiseErrors: [{ asin: 'A2', productsWithOutBuyboxErrorData: { amount: 200 } }],
      };

      const { candidates } = buildCandidatesFromIssuesData(issuesData);

      expect(candidates.map(c => c.totalAmount)).toEqual([500, 200, 50]);
    });

    it('never lets a $0 growth opportunity outrank real money', () => {
      const issuesData = {
        sponsoredAdsErrorDetails: [
          // $0 by design, and 500 of them — must still rank below a $1 real loss
          ...Array.from({ length: 500 }, (_, i) => ({
            errorType: 'auto_campaign_migration_needed', searchTerm: `st${i}`, amount: 0,
          })),
          { errorType: 'wasted_spend_keyword', keyword: 'k', amount: 1 },
        ],
      };

      const { candidates } = buildCandidatesFromIssuesData(issuesData);

      expect(candidates[0].id).toBe('ads_wasted_spend_keyword');
      expect(candidates[1].id).toBe('ads_auto_campaign_migration');
      expect(candidates[1].isGrowthOpportunity).toBe(true);
    });

    it('prefers measured over estimated when dollars tie', () => {
      const issuesData = {
        // Both total $100 — measured (unfulfillable) should come first
        inventoryProductWiseErrors: [
          { asin: 'A1', inventoryPlanningErrorData: { unfulfillable: { status: 'Error', amount: 100 } } },
          { asin: 'A2', strandedInventoryErrorData: { amount: 100 } },
        ],
      };

      const { candidates } = buildCandidatesFromIssuesData(issuesData);

      expect(candidates[0].confidence).toBe(CONFIDENCE.MEASURED);
      expect(candidates[1].confidence).toBe(CONFIDENCE.ESTIMATED);
    });
  });

  describe('token size — the claim this whole design rests on', () => {
    it('keeps the LLM payload tiny even at real production scale', () => {
      // Modelled on a real logged account: 7,432 issues.
      const issuesData = {
        sponsoredAdsErrorDetails: [
          ...Array.from({ length: 1210 }, (_, i) => ({
            errorType: 'wasted_spend_keyword', keyword: `some longer keyword phrase ${i}`,
            keywordId: `kw-${i}`, campaignName: `Campaign Name ${i}`, campaignId: `c-${i}`,
            adGroupName: `Ad Group ${i}`, spend: 5 + i, sales: 0, amount: 5 + i, source: 'keyword',
          })),
        ],
        profitabilityErrorDetails: Array.from({ length: 85 }, (_, i) => ({
          errorType: i % 2 ? 'negative_profit' : 'low_margin', asin: `B00ASIN${i}`,
          productName: `A fairly long product title for ASIN ${i}`,
          sales: 1000, netProfit: -50, profitMargin: -5, amount: 50,
        })),
        conversionProductWiseErrors: Array.from({ length: 2920 }, (_, i) => ({
          asin: `B00CONV${i}`, Title: `Conversion product title ${i}`,
          productsWithOutBuyboxErrorData: i % 10 === 0
            ? { status: 'Error', asin: `B00CONV${i}`, sessions: 30, amount: 120 }
            : undefined,
          imageResultErrorData: { status: 'Error' },
        })),
        inventoryProductWiseErrors: Array.from({ length: 5 }, (_, i) => ({
          asin: `B00INV${i}`, Title: `Inventory product ${i}`,
          inventoryPlanningErrorData: { unfulfillable: { status: 'Error', amount: 30 } },
        })),
      };

      const rawIssueCount = 1210 + 85 + 2920 + 5;
      const naiveChars = JSON.stringify([
        ...issuesData.sponsoredAdsErrorDetails,
        ...issuesData.profitabilityErrorDetails,
        ...issuesData.conversionProductWiseErrors,
        ...issuesData.inventoryProductWiseErrors,
      ]).length;

      const { candidates, issuesConsidered } = buildCandidatesFromIssuesData(issuesData);
      const promptChars = JSON.stringify(buildPromptPayload(candidates)).length;

      // ~4 chars/token is the standard rough estimate.
      const naiveTokens = Math.round(naiveChars / 4);
      const promptTokens = Math.round(promptChars / 4);

      // eslint-disable-next-line no-console
      console.log(
        `\n  [token proof] ${rawIssueCount} raw issues -> ${candidates.length} candidates\n` +
        `  naive  : ~${naiveTokens.toLocaleString()} tokens (${naiveChars.toLocaleString()} chars)\n` +
        `  grouped: ~${promptTokens.toLocaleString()} tokens (${promptChars.toLocaleString()} chars)\n` +
        `  reduction: ~${Math.round(naiveTokens / promptTokens)}x\n`
      );

      expect(issuesConsidered).toBe(rawIssueCount);
      // The whole point: a handful of candidates, not thousands of rows.
      expect(candidates.length).toBeLessThanOrEqual(OpportunityRankingService.MAX_CANDIDATES);
      // Must comfortably fit any model's context.
      expect(promptTokens).toBeLessThan(3000);
      // And must be a dramatic reduction, not a marginal one.
      expect(naiveTokens / promptTokens).toBeGreaterThan(50);
    });
  });
});

describe('TopOpportunitiesService', () => {
  const candidates = [
    { id: 'a', category: 'sponsoredAds', issueType: 'wasted_spend_keyword', title: 'A', action: 'do a', confidence: 'measured', isGrowthOpportunity: false, count: 10, totalAmount: 500, topExamples: [{ label: 'k1', amount: 50 }] },
    { id: 'b', category: 'profitability', issueType: 'negative_profit', title: 'B', action: 'do b', confidence: 'measured', isGrowthOpportunity: false, count: 5, totalAmount: 300, topExamples: [] },
    { id: 'c', category: 'inventory', issueType: 'unfulfillable', title: 'C', action: 'do c', confidence: 'measured', isGrowthOpportunity: false, count: 3, totalAmount: 200, topExamples: [] },
    { id: 'd', category: 'inventory', issueType: 'stranded', title: 'D', action: 'do d', confidence: 'estimated', isGrowthOpportunity: false, count: 2, totalAmount: 100, topExamples: [] },
    { id: 'e', category: 'conversion', issueType: 'buybox_loss', title: 'E', action: 'do e', confidence: 'estimated', isGrowthOpportunity: false, count: 1, totalAmount: 50, topExamples: [] },
    { id: 'f', category: 'sponsoredAds', issueType: 'high_acos_campaign', title: 'F', action: 'do f', confidence: 'measured', isGrowthOpportunity: false, count: 1, totalAmount: 25, topExamples: [] },
  ];

  describe('validateSelections', () => {
    it('drops hallucinated candidateIds', () => {
      const result = validateSelections([
        { candidateId: 'a', rank: 1, why: 'w', action: 'x' },
        { candidateId: 'DOES_NOT_EXIST', rank: 2, why: 'w', action: 'x' },
        { candidateId: 'b', rank: 3, why: 'w', action: 'x' },
      ], candidates);

      const ids = result.map(r => r.candidateId);
      expect(ids).not.toContain('DOES_NOT_EXIST');
      expect(ids).toContain('a');
      expect(ids).toContain('b');
    });

    it('tops the list back up to the minimum when the model under-delivers', () => {
      const result = validateSelections([{ candidateId: 'a', rank: 1, why: 'w', action: 'x' }], candidates);
      expect(result.length).toBeGreaterThanOrEqual(MIN_SELECTIONS);
      expect(result[0].candidateId).toBe('a'); // model's pick kept in front
    });

    it('never exceeds the max, and never repeats a candidate', () => {
      const result = validateSelections(
        candidates.map((c, i) => ({ candidateId: c.id, rank: i + 1, why: 'w', action: 'x' }))
          .concat([{ candidateId: 'a', rank: 99, why: 'dupe', action: 'x' }]),
        candidates
      );
      expect(result.length).toBeLessThanOrEqual(MAX_SELECTIONS);
      expect(new Set(result.map(r => r.candidateId)).size).toBe(result.length);
    });

    it('takes dollars from OUR candidate, not from the model', () => {
      const result = validateSelections([
        // Model tries to claim a different amount — must be ignored
        { candidateId: 'a', rank: 1, why: 'w', action: 'x', amount: 999999, count: 12345 },
      ], candidates);

      expect(result[0].amount).toBe(500);
      expect(result[0].count).toBe(10);
    });

    it('handles a null/garbage response without throwing', () => {
      expect(() => validateSelections(null, candidates)).not.toThrow();
      expect(() => validateSelections('nonsense', candidates)).not.toThrow();
      // Falls through to the deterministic top-up
      expect(validateSelections(null, candidates).length).toBeGreaterThanOrEqual(MIN_SELECTIONS);
    });

    it('renumbers ranks sequentially from 1', () => {
      const result = validateSelections([
        { candidateId: 'c', rank: 7, why: 'w', action: 'x' },
        { candidateId: 'a', rank: 2, why: 'w', action: 'x' },
      ], candidates);
      expect(result.map(r => r.rank)).toEqual(result.map((_, i) => i + 1));
      expect(result[0].candidateId).toBe('a'); // rank 2 sorts before rank 7
    });
  });

  describe('buildDeterministicSelections (the no-AI fallback)', () => {
    it('returns the top candidates by dollars with usable copy', () => {
      const result = buildDeterministicSelections(candidates);
      expect(result).toHaveLength(MAX_SELECTIONS);
      expect(result[0].candidateId).toBe('a');
      expect(result[0].amount).toBe(500);
      expect(result[0].why).toContain('500');
      expect(result[0].action).toBe('do a');
      expect(result.map(r => r.rank)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    it('handles an empty candidate list', () => {
      expect(buildDeterministicSelections([])).toEqual([]);
    });
  });

  // Amazon reports money in the marketplace's own currency. The fallback copy is
  // stored in the DB and rendered verbatim, so it must not hardcode dollars.
  describe('currency handling in generated prose', () => {
    it.each([
      ['US', 'USD'],
      ['UK', 'GBP'],
      ['GB', 'GBP'],
      ['DE', 'EUR'],
      ['JP', 'JPY'],
      ['AU', 'AUD'],
      ['IN', 'INR'],
      ['CA', 'CAD'],
    ])('uses the right currency code for %s', (country, expectedCode) => {
      const [result] = buildDeterministicSelections([candidates[0]], 1, country);
      expect(result.why).toContain(expectedCode);
      expect(result.why).toContain('500.00');
    });

    it('never emits a bare "$" for a non-USD marketplace', () => {
      const nonUsd = ['UK', 'DE', 'JP', 'AU', 'IN', 'SE', 'PL', 'TR', 'BR'];
      nonUsd.forEach((country) => {
        buildDeterministicSelections(candidates, MAX_SELECTIONS, country).forEach((r) => {
          expect(r.why).not.toMatch(/\$/);
        });
      });
    });

    it('falls back to USD for an unknown/missing marketplace rather than throwing', () => {
      expect(() => buildDeterministicSelections([candidates[0]], 1, 'ZZ')).not.toThrow();
      expect(buildDeterministicSelections([candidates[0]], 1, 'ZZ')[0].why).toContain('USD');
      expect(buildDeterministicSelections([candidates[0]], 1, null)[0].why).toContain('USD');
      expect(buildDeterministicSelections([candidates[0]], 1, undefined)[0].why).toContain('USD');
    });

    it('is case-insensitive on the country code', () => {
      expect(buildDeterministicSelections([candidates[0]], 1, 'uk')[0].why).toContain('GBP');
    });

    it('threads currency through validateSelections top-up too', () => {
      // Model returns only 1 pick -> the rest are filled deterministically and
      // those filler rows must also use the marketplace currency.
      const result = validateSelections([{ candidateId: 'a', rank: 1, why: 'model text', action: 'x' }], candidates, 'DE');
      const fillers = result.slice(1);
      expect(fillers.length).toBeGreaterThan(0);
      fillers.filter(f => f.amount > 0).forEach((f) => {
        expect(f.why).toContain('EUR');
        expect(f.why).not.toMatch(/\$/);
      });
    });

    it('zero-amount rows avoid currency wording entirely', () => {
      const zeroCandidate = { ...candidates[0], id: 'z', totalAmount: 0 };
      const [result] = buildDeterministicSelections([zeroCandidate], 1, 'UK');
      expect(result.why).not.toMatch(/\$|GBP/);
      expect(result.why).toContain('No direct monetary loss');
    });
  });

  describe('buildPromptPayload', () => {
    it('sends only what the model needs', () => {
      const [row] = buildPromptPayload([candidates[0]]);
      expect(row).toEqual({
        candidateId: 'a',
        category: 'sponsoredAds',
        problem: 'A',
        affectedItems: 10,
        recoverableAmount: 500,
        confidence: 'measured',
        isGrowthOpportunity: false,
        examples: ['k1'],
      });
      // No internal bookkeeping leaks into the prompt
      expect(row).not.toHaveProperty('topExamples');
      expect(row).not.toHaveProperty('issueType');
    });
  });

  describe('selectWithAI', () => {
    const ORIGINAL_KEY = process.env.OPENAPI_KEY;
    afterEach(() => {
      if (ORIGINAL_KEY === undefined) delete process.env.OPENAPI_KEY;
      else process.env.OPENAPI_KEY = ORIGINAL_KEY;
    });

    it('returns null (so callers fall back) when the API key is missing', async () => {
      delete process.env.OPENAPI_KEY;
      jest.resetModules();
      const Fresh = require('../../../Services/AI/TopOpportunitiesService.js');
      await expect(Fresh.selectWithAI(candidates)).resolves.toBeNull();
    });
  });

  // Cost backstop: the integration flow can fire several times per account
  // (successful retries, monolithic + phased flows, multi-marketplace re-syncs),
  // and each run would otherwise mean another paid OpenAI call.
  describe('regeneration throttle', () => {
    const TopOpportunities = require('../../../models/system/TopOpportunitiesModel.js');
    const RankingService = require('../../../Services/Calculations/OpportunityRankingService.js');
    const { MIN_REGENERATE_INTERVAL_HOURS } = TopOpportunitiesService;

    const hoursAgo = (h) => new Date(Date.now() - h * 3600000);
    let getForAccountSpy;
    let rankingSpy;

    beforeEach(() => {
      getForAccountSpy = jest.spyOn(TopOpportunities, 'getForAccount');
      // If the throttle works, ranking must never be reached.
      rankingSpy = jest.spyOn(RankingService, 'getRankedOpportunities')
        .mockResolvedValue({ success: false, error: 'should not be called' });
    });

    afterEach(() => {
      getForAccountSpy.mockRestore();
      rankingSpy.mockRestore();
    });

    it('skips regeneration when a record was generated inside the interval', async () => {
      const existing = { opportunities: [{ rank: 1 }], generatedAt: hoursAgo(1), source: 'integration' };
      getForAccountSpy.mockResolvedValue(existing);

      const result = await TopOpportunitiesService.calculateAndStoreTopOpportunities('u1', 'AU', 'FE', 'integration');

      expect(result.success).toBe(true);
      expect(result.skippedByThrottle).toBe(true);
      expect(result.data).toBe(existing);
      // The important assertion: no ranking work, therefore no OpenAI call.
      expect(rankingSpy).not.toHaveBeenCalled();
    });

    it('proceeds when the existing record is older than the interval', async () => {
      getForAccountSpy.mockResolvedValue({ generatedAt: hoursAgo(MIN_REGENERATE_INTERVAL_HOURS + 1) });

      const result = await TopOpportunitiesService.calculateAndStoreTopOpportunities('u1', 'AU', 'FE', 'schedule');

      // Ranking was attempted (our mock then fails it) — proving the throttle let it through.
      expect(rankingSpy).toHaveBeenCalled();
      expect(result.skippedByThrottle).toBeUndefined();
    });

    it('proceeds when no record exists yet (first fetch must never be throttled)', async () => {
      getForAccountSpy.mockResolvedValue(null);

      await TopOpportunitiesService.calculateAndStoreTopOpportunities('u1', 'AU', 'FE', 'integration');

      expect(rankingSpy).toHaveBeenCalled();
    });

    it("bypasses the throttle for source 'manual' even with a fresh record", async () => {
      getForAccountSpy.mockResolvedValue({ generatedAt: hoursAgo(0.1) });

      await TopOpportunitiesService.calculateAndStoreTopOpportunities('u1', 'AU', 'FE', 'manual');

      expect(rankingSpy).toHaveBeenCalled();
      // 'manual' shouldn't even consult the stored record for throttling purposes.
      expect(getForAccountSpy).not.toHaveBeenCalled();
    });

    it('does not throttle a record with no generatedAt', async () => {
      getForAccountSpy.mockResolvedValue({ opportunities: [] }); // legacy/partial doc

      await TopOpportunitiesService.calculateAndStoreTopOpportunities('u1', 'AU', 'FE', 'schedule');

      expect(rankingSpy).toHaveBeenCalled();
    });
  });
});
