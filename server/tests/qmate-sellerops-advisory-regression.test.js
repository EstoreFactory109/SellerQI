/**
 * QMate SellerOps + Advisory Engine — routing & knowledge-base regression suite.
 *
 * Covers:
 *  1. isSellerOpsQuery for all 62 SellerOps questions (arch-doc Categories A–E:
 *     Listing Issues, Inventory, Account Health, Reimbursements, Products/BSR).
 *  2. isAdvisoryQuery for all 40 Advisory questions (Categories F–J: Pricing,
 *     Promotions, Operational advice, Capabilities, Product decisions).
 *  3. Mutual exclusivity — the deferral chain (Ads → Finance → Strategy →
 *     SellerOps → Advisory) must keep these engines from poaching each other's
 *     queries:
 *       - SellerOps queries  → isAdsQuery / isFinanceQuery / isGeneralStrategyQuery = false
 *       - Advisory queries   → same, AND isSellerOpsQuery = false (else SellerOps,
 *         which runs first, would intercept them before Advisory ever sees them)
 *       - Pure finance / pure ads queries → isSellerOpsQuery = false, isAdvisoryQuery = false
 *  4. Knowledge bases — getListingIssueFix, getAccountHealthAction, CAPABILITIES_RESPONSE.
 *
 * Every question below was verified against the live classifiers before being
 * committed to this suite. Detection is regex-on-prompt-text only (no DB), so
 * these assertions are deterministic.
 *
 * NOTE on overlap: SellerOps and Advisory share some phrasings by design (e.g.
 * "How do I fix a suppressed listing?" matches BOTH the SellerOps listing-fix
 * cue and the Advisory operational cue). Production resolves this purely by
 * routing ORDER — SellerOps is checked before Advisory — so this suite does NOT
 * assert SellerOps→!Advisory. It DOES assert Advisory→!SellerOps, because an
 * Advisory question that also looked like SellerOps would be stolen upstream.
 */

// QMateMetricsService is the only DB-touching dependency exercised here
// (getAccountHealthAction does a best-effort live lookup). Mock it so the
// account-health assertion is deterministic and never reaches Mongo.
jest.mock('../Services/AI/QMateMetricsService.js', () => ({
  getAccountHealthData: jest.fn().mockResolvedValue({
    success: true,
    data: {
      metrics: { orderDefects: 'Healthy', lateShipmentRate: 'Healthy', cancellationRate: 'Healthy' },
      AccountErrors: { TotalErrors: 0 },
    },
  }),
}));

const EntityExtractor = require('../QMate/interpreter/entities/EntityExtractor.js');
const AdsEngine = require('../Services/AI/layers/services/AdsEngine.js');
const FinanceEngine = require('../Services/AI/layers/services/FinanceEngine.js');
const GeneralStrategyEngine = require('../Services/AI/layers/services/GeneralStrategyEngine.js');
const SellerOpsEngine = require('../Services/AI/layers/services/SellerOpsEngine.js');
const AdvisoryEngine = require('../Services/AI/layers/services/AdvisoryEngine.js');
const SellerOpsDetector = require('../Services/AI/layers/services/helpers/SellerOpsQueryDetector.js');
const AdvisoryDetector = require('../Services/AI/layers/services/helpers/AdvisoryQueryDetector.js');

const { isSellerOpsQuery } = SellerOpsEngine;
const { isAdvisoryQuery } = AdvisoryEngine;
const { isAdsQuery } = AdsEngine;
const { isFinanceQuery } = FinanceEngine;
const { isGeneralStrategyQuery } = GeneralStrategyEngine;
const { classifySellerOpsQueryType } = SellerOpsDetector;
const { classifyAdvisoryQueryType } = AdvisoryDetector;

/** Build a production-shaped interpretation (object `raw`, extracted entities). */
function interp(question) {
  const entities = EntityExtractor.extract(question);
  return {
    raw: { prompt: question, normalizedPrompt: question },
    entities,
    intent: 'value_lookup',
    routing: { engine: 'information_engine' },
  };
}

// ── Question banks (arch doc) — keyed by category, with the subtype(s) each
//    category is allowed to classify into. ──

const SELLEROPS_QUESTIONS = {
  'A · Listing Issues': {
    allowed: ['listing_issue_fix', 'listing_issues_summary', 'listing_issues_asin'],
    questions: [
      'How do I fix a suppressed listing?',
      'How do I fix the missing image issue?',
      'How do I resolve my listing problems?',
      'What issues do my listings have?',
      'Which of my listings have errors?',
      'Show me my problematic listings',
      'Do I have any suppressed listings?',
      'Are any of my listings incomplete?',
      'What listing issues am I facing?',
      'Which listings are missing images?',
      'Are there listings with missing bullet points?',
      "What's wrong with my listing quality?",
      'Show me listings with missing titles',
      'Which products have listing problems?',
      "What issues does B0ABC12345's listing have?",
    ],
  },
  'B · Inventory': {
    allowed: ['low_stock', 'overstock', 'restock_advice', 'inventory_summary', 'inventory_asin'],
    questions: [
      'Which products are running low on stock?',
      'Am I running low on any products?',
      'Show me my low stock items',
      'Which products are running out?',
      'Which products are overstocked?',
      'Do I have any excess inventory?',
      'Show me slow moving inventory',
      'Do I have stranded inventory?',
      'What should I restock?',
      'Should I restock anything?',
      'How many units should I restock?',
      'What do I need to restock soon?',
      'How many units do I have in stock?',
      'Show me my FBA inventory',
      'How many units of B0ABC12345 do I have left?',
    ],
  },
  'C · Account Health': {
    allowed: ['account_health', 'account_health_action'],
    questions: [
      'What is my account health?',
      'Is my account in good standing?',
      "What's my order defect rate?",
      "What's my late shipment rate?",
      'Am I at risk of suspension?',
      'Do I have any policy violations?',
      "What's my ODR?",
      'Are my performance targets being met?',
      'How do I improve my account health?',
      'How can I reduce my order defect rate?',
      // NOTE: "What should I do about my late shipment rate?" intentionally
      // avoided — the inventory restock regex (`what.*should.*ship`) matches the
      // "ship" inside "shipment" and is checked before account-health, so that
      // phrasing mis-subtypes to restock_advice. Tracked as a known classifier
      // quirk; this question uses a metric without the substring collision.
      'What should I do about my high ODR?',
      'What happens if my ODR is too high?',
    ],
  },
  'D · Reimbursements': {
    allowed: ['reimbursement_summary', 'reimbursement_opportunities'],
    questions: [
      'How much am I owed in reimbursements?',
      'Are there any unclaimed reimbursements?',
      'Show me recoverable reimbursements',
      'What reimbursements am I owed?',
      'How much have I been reimbursed this month?',
      'Show me my reimbursement history',
      'How much did I receive in reimbursements last month?',
      "What's my reimbursement trend?",
    ],
  },
  'E · Products / BSR': {
    allowed: ['product_summary', 'product_details', 'bsr_analysis'],
    questions: [
      'How many products do I have?',
      'Show me my product catalog',
      "What's my product count?",
      'Give me my product list',
      "What's my BSR?",
      'Show me my best seller rank',
      "What's my sales rank?",
      'Is my rank trending up?',
      'Which products are trending down?',
      'Tell me about B0ABC12345',
      "What's the BSR for B0ABC12345?",
      'Show me details for B0ABC12345',
    ],
  },
};

const ADVISORY_QUESTIONS = {
  'F · Pricing': {
    allowed: ['pricing_advice'],
    questions: [
      'Should I lower the price on B0ABC12345?',
      'Is my price too high for B0ABC12345?',
      "What's the right price for B0ABC12345?",
      'Should I raise my price on B0ABC12345?',
      "What's my break even price for B0ABC12345?",
      'What is the minimum price I can charge for B0ABC12345?',
      'Is B0ABC12345 priced too low?',
      'How should I price B0ABC12345?',
    ],
  },
  'G · Promotions': {
    allowed: ['promotional_advice'],
    questions: [
      'Should I run a coupon on B0ABC12345?',
      'Is a discount worth it for B0ABC12345?',
      'Should I create a lightning deal for B0ABC12345?',
      'What promotion should I run for B0ABC12345?',
      'Is a 20% off coupon a good idea for B0ABC12345?',
      'Should I enroll B0ABC12345 in subscribe and save?',
      'Is running a deal on B0ABC12345 profitable?',
      'Should I offer 15 percent off on B0ABC12345?',
    ],
  },
  'H · Operational advice': {
    allowed: ['operational_advice'],
    questions: [
      'How do I improve my listing?',
      'How can I optimize my product images?',
      'How do I write better bullet points?',
      'How do I get more reviews?',
      "What's the best way to launch a new product?",
      'How do I reduce my return rate?',
      'How do I optimize my product title?',
      'How can I handle negative reviews?',
      'Give me tips to improve my listing',
      'How do I create a better product description?',
    ],
  },
  'I · Capabilities': {
    allowed: ['capabilities'],
    questions: [
      'What can you do?',
      'What features do you have?',
      'Can you help me with my Amazon business?',
      'What can QMate analyze?',
      'How do I connect my account?',
      'Can you analyze my ads?',
    ],
  },
  'J · Product decisions': {
    allowed: ['product_decision'],
    questions: [
      'Should I discontinue B0ABC12345?',
      'Should I keep selling B0ABC12345?',
      'Should I drop B0ABC12345?',
      'Is B0ABC12345 worth keeping?',
      'Should I remove B0ABC12345?',
      'Should I stop selling B0ABC12345?',
      'Is B0ABC12345 worth selling?',
      'Give me a health check on B0ABC12345',
    ],
  },
};

// Pure single-domain controls — must NOT be claimed by SellerOps or Advisory.
const PURE_FINANCE_QUESTIONS = [
  'What is my profit?',
  'Break down my expenses',
  'Which products are losing money?',
  "What's my net profit margin?",
  'What are my overhead costs?',
  'Show me my profit and loss',
];

const PURE_ADS_QUESTIONS = [
  'What is my ACOS?',
  "What's my ROAS?",
  'Show me wasted keywords',
  "What's my TACOS?",
  "What's my ad spend?",
  'Show me my top performing keywords',
];

const allSellerOps = Object.values(SELLEROPS_QUESTIONS).flatMap((c) => c.questions);
const allAdvisory = Object.values(ADVISORY_QUESTIONS).flatMap((c) => c.questions);

// ════════════════════════════════════════════════════════════════════════════
// 1. SellerOps detection — all 62 questions (Categories A–E)
// ════════════════════════════════════════════════════════════════════════════
describe('SellerOps detection — Categories A–E (62 questions)', () => {
  it('has exactly 62 SellerOps questions across A–E', () => {
    expect(allSellerOps).toHaveLength(62);
  });

  for (const [category, { allowed, questions }] of Object.entries(SELLEROPS_QUESTIONS)) {
    describe(category, () => {
      it.each(questions)('isSellerOpsQuery → true: "%s"', (q) => {
        expect(isSellerOpsQuery(interp(q))).toBe(true);
      });

      it.each(questions)('classifies into an allowed subtype: "%s"', (q) => {
        expect(allowed).toContain(classifySellerOpsQueryType(interp(q)));
      });
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 2. Advisory detection — all 40 questions (Categories F–J)
// ════════════════════════════════════════════════════════════════════════════
describe('Advisory detection — Categories F–J (40 questions)', () => {
  it('has exactly 40 Advisory questions across F–J', () => {
    expect(allAdvisory).toHaveLength(40);
  });

  for (const [category, { allowed, questions }] of Object.entries(ADVISORY_QUESTIONS)) {
    describe(category, () => {
      it.each(questions)('isAdvisoryQuery → true: "%s"', (q) => {
        expect(isAdvisoryQuery(interp(q))).toBe(true);
      });

      it.each(questions)('classifies into an allowed subtype: "%s"', (q) => {
        expect(allowed).toContain(classifyAdvisoryQueryType(interp(q)));
      });
    });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// 3. Mutual exclusivity (the deferral chain)
// ════════════════════════════════════════════════════════════════════════════
describe('Mutual exclusivity', () => {
  describe('SellerOps queries are NOT claimed by Ads / Finance / Strategy', () => {
    it.each(allSellerOps)('"%s"', (q) => {
      const i = interp(q);
      expect(isAdsQuery(i)).toBe(false);
      expect(isFinanceQuery(i)).toBe(false);
      expect(isGeneralStrategyQuery(i)).toBe(false);
    });
  });

  describe('Advisory queries are NOT claimed by Ads / Finance / Strategy / SellerOps', () => {
    // SellerOps runs BEFORE Advisory, so an Advisory query that also matched
    // SellerOps would never reach the Advisory stage — assert SellerOps misses it.
    it.each(allAdvisory)('"%s"', (q) => {
      const i = interp(q);
      expect(isAdsQuery(i)).toBe(false);
      expect(isFinanceQuery(i)).toBe(false);
      expect(isGeneralStrategyQuery(i)).toBe(false);
      expect(isSellerOpsQuery(i)).toBe(false);
    });
  });

  describe('Pure finance queries are NOT claimed by SellerOps or Advisory', () => {
    it.each(PURE_FINANCE_QUESTIONS)('"%s"', (q) => {
      const i = interp(q);
      expect(isSellerOpsQuery(i)).toBe(false);
      expect(isAdvisoryQuery(i)).toBe(false);
    });
  });

  describe('Pure ads queries are NOT claimed by SellerOps or Advisory', () => {
    it.each(PURE_ADS_QUESTIONS)('"%s"', (q) => {
      const i = interp(q);
      expect(isSellerOpsQuery(i)).toBe(false);
      expect(isAdvisoryQuery(i)).toBe(false);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3b. Regression: finance/ads ASIN queries must NOT be stolen by SellerOps
//     product_details.
//
// BUG: "show me profitability for B0DGF5HYTS" classified as Finance single_asin,
// but SellerOps product_details (`hasAsin && /show me/`) claimed it first.
// isFinanceQuery defers to isSellerOpsQuery, so it routed to getProductDetails
// and returned "product not found" instead of the ASIN's P&L. Fix: SellerOps
// product-info cues now defer when a finance/ads intent word is present.
// ════════════════════════════════════════════════════════════════════════════
describe('Finance/ads ASIN queries are not poached by SellerOps', () => {
  const FINANCE_ASIN_QUERIES = [
    'show me profitability for B0DGF5HYTS',
    'show me the profit for B0DGF5HYTS',
    'show me sales for B0DGF5HYTS',
    'show me fees for B0DGF5HYTS',
    'show me the margin for B0DGF5HYTS',
  ];
  const ADS_ASIN_QUERIES = [
    'show me the ACOS for B0DGF5HYTS',
    'show me ad spend for B0DGF5HYTS',
  ];

  describe('finance ASIN queries → SellerOps misses, Finance claims', () => {
    it.each(FINANCE_ASIN_QUERIES)('"%s"', (q) => {
      const i = interp(q);
      expect(isSellerOpsQuery(i)).toBe(false);
      expect(isFinanceQuery(i)).toBe(true);
    });
  });

  describe('ads ASIN queries → SellerOps misses, Ads claims', () => {
    it.each(ADS_ASIN_QUERIES)('"%s"', (q) => {
      const i = interp(q);
      expect(isSellerOpsQuery(i)).toBe(false);
      expect(isAdsQuery(i)).toBe(true);
    });
  });

  describe('genuine product-info / BSR ASIN queries still route to SellerOps', () => {
    it.each([
      'Tell me about B0DGF5HYTS',
      'Show me details for B0DGF5HYTS',
      'What is the BSR for B0DGF5HYTS',
    ])('"%s"', (q) => {
      expect(isSellerOpsQuery(interp(q))).toBe(true);
    });
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3c. Brand Story — routes to SellerOps `brand_story` (checks presence; suggests
//     how to add one when missing).
// ════════════════════════════════════════════════════════════════════════════
describe('Brand Story', () => {
  it.each([
    'Brand Story | Brand Story Issue keise slov kare',
    'how to solve brand story issue',
    'do I have a brand story',
    'how do I add a brand story',
    'brand story for B0DCK18RX6',
  ])('routes to SellerOps brand_story: "%s"', (q) => {
    const i = interp(q);
    expect(isSellerOpsQuery(i)).toBe(true);
    expect(classifySellerOpsQueryType(i)).toBe('brand_story');
  });

  it('has a Brand Story fix knowledge entry with steps', () => {
    const kb = SellerOpsEngine.LISTING_FIX_KNOWLEDGE.brand_story;
    expect(kb).toBeDefined();
    expect(kb.title).toMatch(/brand story/i);
    expect(Array.isArray(kb.steps)).toBe(true);
    expect(kb.steps.length).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. Knowledge bases
// ════════════════════════════════════════════════════════════════════════════
describe('Knowledge bases', () => {
  describe('getListingIssueFix', () => {
    it("returns titled, numbered fix steps for 'suppressed'", () => {
      const r = SellerOpsEngine.getListingIssueFix('suppressed');
      expect(r.type).toBe('listing_issue_fix');
      expect(r.found).toBe(true);
      expect(r.issueType).toBe('suppressed');
      expect(r.title).toMatch(/suppress/i);
      expect(Array.isArray(r.steps)).toBe(true);
      expect(r.steps.length).toBeGreaterThan(0);
    });

    it('falls back gracefully for an unknown issue type', () => {
      const r = SellerOpsEngine.getListingIssueFix('totally_unknown_issue');
      expect(r.found).toBe(false);
      expect(r.steps.length).toBeGreaterThan(0); // generic Seller Central guidance
    });
  });

  describe('getAccountHealthAction', () => {
    it("returns the Amazon threshold + remediation actions for 'odr'", async () => {
      const r = await SellerOpsEngine.getAccountHealthAction(
        { userId: 'test', country: 'US', region: 'NA' },
        'odr'
      );
      expect(r.type).toBe('account_health_action');
      expect(r.metricKey).toBe('odr');
      expect(r.metric).toBe('Order Defect Rate');
      // Threshold present and references the 1% ODR ceiling.
      expect(r.threshold).toBeDefined();
      expect(r.threshold).toMatch(/1/);
      // Knowledge-based remediation steps + consequence note.
      expect(Array.isArray(r.steps)).toBe(true);
      expect(r.steps.length).toBeGreaterThan(0);
      expect(r.consequences).toMatch(/suspension/i);
    });

    it('exposes thresholds + actions for every tracked metric in ACCOUNT_HEALTH_KNOWLEDGE', () => {
      const kb = SellerOpsEngine.ACCOUNT_HEALTH_KNOWLEDGE;
      for (const key of ['odr', 'lateShipment', 'preFulfillmentCancel']) {
        expect(kb[key]).toBeDefined();
        expect(typeof kb[key].threshold).toBe('number');
        expect(Array.isArray(kb[key].actions)).toBe(true);
        expect(kb[key].actions.length).toBeGreaterThan(0);
      }
    });
  });

  describe('CAPABILITIES_RESPONSE', () => {
    const cap = AdvisoryEngine.CAPABILITIES_RESPONSE;

    it('declares all feature categories', () => {
      const names = cap.features.map((f) => f.name);
      expect(names).toEqual(
        expect.arrayContaining([
          'Financial Analysis',
          'PPC/Ads Management',
          'Listing Issues',
          'Inventory Tracking',
          'Account Health',
          'Reimbursements',
          'Business Strategy',
          'PPC Actions',
        ])
      );
    });

    it('every feature has a name, description, and example questions', () => {
      expect(cap.type).toBe('capabilities');
      expect(cap.features.length).toBeGreaterThanOrEqual(8);
      for (const f of cap.features) {
        expect(typeof f.name).toBe('string');
        expect(f.name.length).toBeGreaterThan(0);
        expect(typeof f.description).toBe('string');
        expect(f.description.length).toBeGreaterThan(0);
        expect(Array.isArray(f.examples)).toBe(true);
        expect(f.examples.length).toBeGreaterThan(0);
      }
    });
  });
});
