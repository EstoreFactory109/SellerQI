/**
 * QMate GeneralStrategyEngine regression suite.
 *
 * NOTE: jest.config.js sets roots: ['<rootDir>/__tests__'], so tests must live
 * under server/__tests__/. (The brief asked for server/tests/, which Jest would
 * NOT discover — placed here to match the real convention, like the finance/ads
 * suites.)
 *
 * Section 1  — isGeneralStrategyQuery detects all PART-3 questions (categories A–I).
 * Section 1b — pure ads/finance queries are NOT caught (deferral correctness).
 * Section 2  — classifyStrategyType returns the right type per category.
 * Section 3  — buildCrossDomainInsights calculations.
 * Section 4  — buildHealthScore grading.
 * Section 5  — rankAllIssues severity ordering.
 *
 * DOCUMENTED DIVERGENCE: doc #54 "Which products are losing money and why?" is
 * intentionally NOT a strategy query — it routes to FinanceEngine's
 * top_bottom_products (a concrete product list beats a generic action plan). It
 * is asserted false in Section 1b.
 */

const GSE = require('../../../Services/AI/layers/services/GeneralStrategyEngine.js');
const DET = require('../../../Services/AI/layers/services/helpers/StrategyQueryDetector.js');

// Build an interpretation with the production-shaped object `raw`.
const mk = (prompt, intent = 'value_lookup') => ({
  raw: { prompt, normalizedPrompt: prompt },
  intent,
  entities: {},
});

// ── PART-3 question set (categories A–I), with expected strategyType ──
const QUESTIONS = {
  why_declining: [
    'Why is my profit dropping?',
    'Why is my profit not increasing?',
    'Why are my sales declining?',
    'Why is my business going down?',
    'Why is my margin shrinking?',
    'Why am I making less money than before?',
    'What changed in my business this month?',
    'Why is my revenue flat despite more ad spend?',
  ],
  how_to_improve: [
    'How can I increase my profit?',
    'How to improve my margins?',
    'How can I grow my sales?',
    'How do I make more money?',
    'How can I improve my business performance?',
    'How to become more profitable?',
    'What can I do to increase my revenue?',
    'How to scale my business profitably?',
    'How to reduce my costs while maintaining sales?',
    // Category I — product strategy → how_to_improve
    'Which products should I focus on?',
    'Which products should I discontinue?',
    'What products are worth keeping?',
    'Should I add more products or optimize existing ones?',
    'Which products have the most potential?',
  ],
  what_mistakes: [
    'What mistakes am I making?',
    "What's wrong with my business?",
    'What problems do I need to fix?',
    "What's hurting my profitability?",
    'What is eating into my profits?',
    'What is costing me the most money unnecessarily?',
    'Where am I going wrong?',
    'What are my biggest issues right now?',
  ],
  what_to_focus: [
    'What should I focus on first?',
    "What's the most important thing to fix?",
    'What should I prioritize?',
    'If I can only fix one thing, what should it be?',
    "What's my biggest opportunity right now?",
    'What would make the most difference to my bottom line?',
    'Where should I spend my time?',
    "What's the quickest win I can get?",
  ],
  complete_summary: [
    'Give me a complete business summary',
    'How is my business doing overall?',
    'Show me a full overview of my account',
    'What does my business health look like?',
    'Rate my business performance',
    'Give me a report card for my Amazon business',
    'How am I doing compared to last month?',
    'Summarize everything about my account',
  ],
  is_it_worth: [
    'Is my advertising worth it?',
    'Am I making money from my ads?',
    'Are my ads profitable?',
    'Should I increase or decrease my ad spend?',
    "What's the return on my advertising investment?",
    'Am I spending too much on ads?',
    'Would I be better off without ads?',
    'How much profit do my ads actually generate?',
  ],
  where_losing: [
    'Where am I losing money?',
    "What's draining my profits?",
    'Where is my money going?',
    'What are my biggest money wasters?',
    'How much money am I wasting?',
    "Show me all the ways I'm losing money",
  ],
  general_health: [
    'Am I running my business efficiently?',
    'Is my business sustainable at this rate?',
    'How does my business compare to a healthy benchmark?',
    'Am I in good shape?',
    "What's my business grade?",
  ],
};

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1 — isGeneralStrategyQuery detects all PART-3 questions
// ════════════════════════════════════════════════════════════════════════════
describe('isGeneralStrategyQuery — PART 3 question coverage (65 questions)', () => {
  for (const [type, questions] of Object.entries(QUESTIONS)) {
    describe(type, () => {
      for (const q of questions) {
        test(`detects "${q}"`, () => {
          expect(GSE.isGeneralStrategyQuery(mk(q))).toBe(true);
        });
      }
    });
  }

  test('total questions covered = 65', () => {
    const total = Object.values(QUESTIONS).reduce((s, arr) => s + arr.length, 0);
    expect(total).toBe(65); // 66 in the doc minus #54 (intentionally finance)
  });

  test('suggestion intent without a strong domain signal → true', () => {
    expect(GSE.isGeneralStrategyQuery(mk('give me some recommendations', 'suggestion'))).toBe(true);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 1b — pure ads/finance queries are NOT caught (deferral correctness)
// ════════════════════════════════════════════════════════════════════════════
describe('isGeneralStrategyQuery — pure domain queries are NOT intercepted', () => {
  const NEGATIVES = [
    'What is my ACOS?',
    'What is my ROAS?',
    'What is my profit?',
    'What are my total sales?',
    'Break down my expenses',
    'Show me wasted keywords',
    'How much did I spend on ads?',
    'Should I increase my budgets?',
    'Give me sales datewise for last 7 days',
    'How much am I spending on ads?',
    // doc #54 — intentionally finance (concrete product list), not strategy:
    'Which products are losing money?',
    // pure-domain suggestion (strong signal) must NOT be intercepted:
  ];
  for (const q of NEGATIVES) {
    test(`does NOT catch "${q}"`, () => {
      expect(GSE.isGeneralStrategyQuery(mk(q))).toBe(false);
    });
  }

  test('suggestion intent WITH ads signal → false (stays ads)', () => {
    expect(GSE.isGeneralStrategyQuery(mk('suggest acos improvements', 'suggestion'))).toBe(false);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 2 — classifyStrategyType returns the correct type per category
// ════════════════════════════════════════════════════════════════════════════
describe('classifyStrategyType — correct type per PART-3 category', () => {
  for (const [expectedType, questions] of Object.entries(QUESTIONS)) {
    describe(`→ ${expectedType}`, () => {
      for (const q of questions) {
        test(`"${q}" → ${expectedType}`, () => {
          expect(GSE.classifyStrategyType(mk(q))).toBe(expectedType);
        });
      }
    });
  }

  test('unknown/ambiguous strategy phrasing → complete_summary (default)', () => {
    // Caught by isGeneralStrategyQuery via suggestion intent, classified as default.
    expect(GSE.classifyStrategyType(mk('tell me about my account', 'suggestion'))).toBe('complete_summary');
  });

  test('detector and engine classifyStrategyType are the same function', () => {
    expect(GSE.classifyStrategyType).toBe(DET.classifyStrategyType);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 3 — buildCrossDomainInsights calculations
// ════════════════════════════════════════════════════════════════════════════
describe('buildCrossDomainInsights', () => {
  const finance = {
    summary: { totalSales: 10000, displayTotalExpenses: 6000, displayProfit: 1000 },
    comparison: { deltas: { profit: { changePct: -12 } } },
  };
  const ads = {
    kpis: { ppcSales: 2000, ppcSpend: 500 },
    totalWastedSpend: 250,
    comparison: { deltas: { acos: { changePct: 8 }, ppcSpend: { changePct: 15 } } },
  };

  test('returns { available: false } when a domain is missing', () => {
    expect(GSE.buildCrossDomainInsights(null, ads)).toEqual({ available: false });
    expect(GSE.buildCrossDomainInsights(finance, null)).toEqual({ available: false });
  });

  test('computes the cross-domain ratios correctly', () => {
    const cd = GSE.buildCrossDomainInsights(finance, ads);
    expect(cd.available).toBe(true);
    expect(cd.adSpendAsPercentOfExpenses).toBeCloseTo((500 / 6000) * 100, 4); // 8.33%
    expect(cd.adSpendAsPercentOfSales).toBeCloseTo(5, 4); // 500/10000
    expect(cd.ppcSalesPercent).toBeCloseTo(20, 4); // 2000/10000
    expect(cd.organicSalesPercent).toBeCloseTo(80, 4);
    expect(cd.adProfit).toBe(1500); // 2000 - 500
    expect(cd.adROI).toBeCloseTo(300, 4); // (2000-500)/500*100
    expect(cd.wastedSpendAsPercentOfProfit).toBeCloseTo(25, 4); // 250/1000
    expect(cd.profitImpactOfFixingWaste).toBe(250);
    expect(cd.profitMarginAfterFixingWaste).toBeCloseTo(((1000 + 250) / 10000) * 100, 4); // 12.5%
    // trend correlation passthrough
    expect(cd.profitTrend).toBe(-12);
    expect(cd.acosTrend).toBe(8);
    expect(cd.adSpendTrend).toBe(15);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 4 — buildHealthScore grading
// ════════════════════════════════════════════════════════════════════════════
describe('buildHealthScore', () => {
  test('perfect inputs → grade A (all dimensions 10/10)', () => {
    const finance = { summary: { profitMargin: 30, totalSales: 10000, displayTotalExpenses: 5000, totalProducts: 5 }, productsMissingCOGS: [] };
    const ads = { kpis: { acos: 10, roas: 8 }, totalWastedSpend: 0 };
    const hs = GSE.buildHealthScore(finance, ads);
    expect(hs.totalScore).toBe(60);
    expect(hs.maxScore).toBe(60);
    expect(hs.percentage).toBe(100);
    expect(hs.grade).toBe('A');
    expect(hs.label).toBe('Excellent');
  });

  test('worst inputs → grade F', () => {
    const finance = { summary: { profitMargin: -5, totalSales: 10000, displayTotalExpenses: 9000, totalProducts: 10 }, productsMissingCOGS: [{}, {}, {}, {}, {}, {}, {}, {}, {}, {}] };
    const ads = { kpis: { acos: 60, roas: 0.5 }, totalWastedSpend: 800 };
    const hs = GSE.buildHealthScore(finance, ads);
    expect(hs.grade).toBe('F');
    expect(hs.label).toBe('Critical');
  });

  test('mixed (8% margin, 45% ACOS) → C or D, dimensions out of 60', () => {
    const finance = { summary: { profitMargin: 8, totalSales: 10000, displayTotalExpenses: 6500, totalProducts: 12 }, productsMissingCOGS: [] };
    const ads = { kpis: { acos: 45, roas: 2.2 }, totalWastedSpend: 250 };
    const hs = GSE.buildHealthScore(finance, ads);
    expect(hs.scores).toHaveLength(6);
    expect(hs.maxScore).toBe(60);
    expect(['C', 'D']).toContain(hs.grade);
  });

  test('only one domain present → maxScore reflects available dimensions', () => {
    const finance = { summary: { profitMargin: 25, totalSales: 1000, displayTotalExpenses: 500, totalProducts: 2 }, productsMissingCOGS: [] };
    const hs = GSE.buildHealthScore(finance, null);
    expect(hs.scores).toHaveLength(3); // finance dimensions only
    expect(hs.maxScore).toBe(30);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// SECTION 5 — rankAllIssues severity ordering
// ════════════════════════════════════════════════════════════════════════════
describe('rankAllIssues', () => {
  test('sorts critical before high before medium, then by |profitImpact|', () => {
    const finance = {
      summary: { profitMargin: 3, displayProfit: 300 }, // < 5 → low_margin (critical)
      lossMakingProducts: [{ grossProfit: -150 }, { grossProfit: -60 }], // high
      productsMissingCOGS: [{}, {}, {}, {}, {}, {}], // > 5 → medium
      comparison: { deltas: {} },
    };
    const ads = {
      kpis: { acos: 45, ppcSpend: 900, ppcSales: 2000 }, // high_acos (high)
      totalWastedSpend: 250, // wasted_spend (high)
      wastedKeywordsCount: 14,
      optimizationOpportunities: { campaignsNeedingNegatives: 2 }, // missing_negatives (medium)
      comparison: { deltas: {} },
    };
    const cd = GSE.buildCrossDomainInsights(finance, ads);
    const issues = GSE.rankAllIssues(finance, ads, cd);

    // severity is non-increasing through the list
    const rank = { critical: 0, high: 1, medium: 2, low: 3 };
    for (let i = 1; i < issues.length; i++) {
      expect(rank[issues[i].severity]).toBeGreaterThanOrEqual(rank[issues[i - 1].severity]);
    }
    // first issue is the critical low_margin
    expect(issues[0].severity).toBe('critical');
    expect(issues[0].type).toBe('low_margin');
    // a medium issue never appears before a high issue
    const firstMedium = issues.findIndex((x) => x.severity === 'medium');
    const lastHigh = issues.map((x) => x.severity).lastIndexOf('high');
    if (firstMedium !== -1 && lastHigh !== -1) expect(firstMedium).toBeGreaterThan(lastHigh);
  });

  test('within the same severity, larger |profitImpact| ranks first', () => {
    const finance = {
      summary: { profitMargin: 20, displayProfit: 5000 }, // no low_margin
      lossMakingProducts: [{ grossProfit: -1000 }], // high, impact -1000
      productsMissingCOGS: [],
      comparison: { deltas: {} },
    };
    const ads = {
      kpis: { acos: 45, ppcSpend: 900, ppcSales: 2000 }, // high_acos, impact -(900-800) = -100
      totalWastedSpend: 60, // wasted_spend high, impact -60
      wastedKeywordsCount: 3,
      optimizationOpportunities: { campaignsNeedingNegatives: 0 },
      comparison: { deltas: {} },
    };
    const issues = GSE.rankAllIssues(finance, ads, GSE.buildCrossDomainInsights(finance, ads));
    const highs = issues.filter((i) => i.severity === 'high');
    // loss_making_products (-1000) must come before high_acos (-100) and wasted_spend (-60)
    expect(highs[0].type).toBe('loss_making_products');
    for (let i = 1; i < highs.length; i++) {
      expect(Math.abs(highs[i].profitImpact)).toBeLessThanOrEqual(Math.abs(highs[i - 1].profitImpact));
    }
  });
});
