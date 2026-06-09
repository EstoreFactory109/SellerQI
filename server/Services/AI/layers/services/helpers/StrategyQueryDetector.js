/**
 * StrategyQueryDetector — cross-domain (general strategy) question detection +
 * sub-type classification.
 *
 * Deliberately has ZERO imports from FinanceEngine, AdsEngine, or
 * GeneralStrategyEngine — pure regex on the prompt text. Both
 * FinanceEngine.isFinanceQuery and AdsEngine.isAdsQuery DEFER strategy questions
 * (return false) by calling isGeneralStrategyQuery here; GeneralStrategyEngine
 * imports both isGeneralStrategyQuery and classifyStrategyType. Keeping detection
 * here (and out of any engine) breaks what would otherwise be a circular import.
 *
 * The 8 strategy sub-types and their question phrasings come from
 * QMate-General-Strategy-Architecture.md PART 3 (categories A–I; category I,
 * product strategy, maps to how_to_improve). A single ordered matcher list backs
 * BOTH isGeneralStrategyQuery (any match) and classifyStrategyType (first match),
 * so detection and classification can never drift apart.
 *
 * It also DEFERS to the SellerOps and Advisory detectors: a query those domains
 * own (listing issues, inventory, pricing, capabilities, …) must NOT be claimed
 * by the strategy engine even if it loosely matches a strategy pattern. Those
 * detectors are likewise ZERO-engine-import pure helpers, so importing them here
 * keeps the no-circular-dependency guarantee intact.
 */

const { isSellerOpsQuery } = require('./SellerOpsQueryDetector.js');
const { isAdvisoryQuery } = require('./AdvisoryQueryDetector.js');

/**
 * Extract the user's prompt text, lower-cased — robust to `interpretation.raw`
 * being a string OR the interpreter's object `{ prompt, normalizedPrompt }`.
 */
function extractPromptText(interpretation) {
  const rawField = interpretation && interpretation.raw;
  const fromRaw =
    typeof rawField === 'string'
      ? rawField
      : (rawField && (rawField.normalizedPrompt || rawField.prompt)) || '';
  const text = fromRaw || (interpretation && interpretation.rewrittenQuestion) || (interpretation && interpretation.rawQuestion) || '';
  return String(text).toLowerCase();
}

/**
 * True when the query clearly belongs to ONLY ads or ONLY finance — used by the
 * suggestion-intent fallback so a domain-specific suggestion isn't intercepted.
 */
function hasStrongDomainSignal(prompt) {
  const pureAds = /\b(acos|roas|tacos|ctr|cpc|campaign|keyword|sponsored|impression|ppc|negative keyword|search term)\b/i;
  const pureFinance = /\b(cogs|fba fee|referral fee|storage fee|overhead|reimbursement|closing fee|disposal fee)\b/i;
  return pureAds.test(prompt) || pureFinance.test(prompt);
}

// A business metric and a "declining" cue — used by the why_declining matcher.
const BIZ_METRIC = /(profit|margin|sales|revenue|business|money|income|earning|bottom line)/;
const DECLINE = /(drop|declin|decreas|shrink|fall|fell|going down|\bdown\b|\blow\b|\bbad\b|poor|worse|flat|stagnant|slow|slump|stall|\bless\b|not\s*(increas|improv|grow|up))/;

/**
 * Ordered strategy-type matchers (PART 3 categories). FIRST MATCH WINS for
 * classifyStrategyType. Order rationale: is_it_worth before how_to_improve
 * (both mention ads/spend); where_losing before complete_summary; general_health
 * last so "business grade" isn't swallowed by the summary matcher.
 *
 * NOTE on what is intentionally NOT matched (stays with the domain engines):
 *  - "which products are losing money" → FinanceEngine top_bottom_products
 *    (concrete product list, better than a generic strategy action plan).
 *  - bare ads metrics ("what is my acos", "how much am I spending on ads") and
 *    bare finance lookups ("what is my profit") have no strategy cue → false.
 */
const STRATEGY_MATCHERS = [
  {
    type: 'why_declining', // Category A
    test: (p) =>
      (/\bwhy\b/.test(p) && DECLINE.test(p) && BIZ_METRIC.test(p)) ||
      (/what\s*(changed|happened)/.test(p) && /(business|profit|sales|revenue|month|account)/.test(p)) ||
      /(making less|less money than before|making.*less money)/.test(p),
  },
  {
    type: 'is_it_worth', // Category F (before how_to_improve)
    test: (p) =>
      /(worth it|worth the)/.test(p) ||
      /\b(ad|ads|advertising|ppc)\b.*(worth|profitable|making money|generat|too much|better off without|return)/.test(p) ||
      /(worth|profitable|return on|roi|too much|better off without)\b.*\b(ad|ads|advertising|ppc)\b/.test(p) ||
      /making money (from|with|on).*\bads?\b/.test(p) ||
      /how much profit.*\bads?\b/.test(p) ||
      /should i (increase|decrease|raise|lower).*\bad/.test(p),
  },
  {
    type: 'how_to_improve', // Categories B + I (product strategy)
    test: (p) =>
      ((/\bhow\b/.test(p) || /what can i do/.test(p)) &&
        /(improv|increas|grow|boost|raise|maximiz|optimi[sz]|make more money|more money|more profitab|become.*profitab|scal|reduce.*cost|lower.*cost|cut.*cost|make more)/.test(p)) ||
      /products?.*(should i (focus|discontinu|keep|drop|cut|add)|worth keeping|most potential|focus on)/.test(p) ||
      /(discontinu|worth keeping|most potential).*products?/.test(p) ||
      /(add more products|should i add.*products?|products?.*or optimi|optimi.*existing)/.test(p),
  },
  {
    type: 'what_mistakes', // Category C
    test: (p) => /(what|where).*(mistake|wrong|problem|issue|hurting|killing|eating|costing|going wrong)/.test(p),
  },
  {
    type: 'what_to_focus', // Category D
    test: (p) =>
      /(focus on|prioriti|do first|fix first|work on|start with|most important|only fix|fix one thing|one thing.*fix|biggest opportunit|most difference|bottom line|spend my time|quickest win|quick win)/.test(p),
  },
  {
    type: 'where_losing', // Category G
    test: (p) =>
      /(where|what|how much).*(losing|wasting|drain|bleed|leak|money waster|hemorrhag|money going)/.test(p) ||
      /ways.*losing/.test(p),
  },
  {
    type: 'complete_summary', // Category E
    test: (p) =>
      /(complete|full|overall|entire|comprehensive).{0,24}(summary|overview|report|health|status|analysis|review|breakdown)/.test(p) ||
      /(business summary|report card|overview of my account|summari[sz]e (everything|my|the)|rate my business|business health|how (is|am) (my|i).*(doing|overall|business))/.test(p),
  },
  {
    type: 'general_health', // Category H
    test: (p) => /(efficien|sustainab|good shape|bad shape|\bhealthy\b|unhealthy|business grade|benchmark|in good shape)/.test(p),
  },
];

/**
 * Classify a cross-domain question into its strategy sub-type. First matcher
 * wins; defaults to 'complete_summary'. (Only meaningful when
 * isGeneralStrategyQuery is true.)
 *
 * @param {Object} interpretation
 * @returns {string} strategyType
 */
function classifyStrategyType(interpretation) {
  const p = extractPromptText(interpretation);
  for (const m of STRATEGY_MATCHERS) {
    if (m.test(p)) return m.type;
  }
  return 'complete_summary';
}

/**
 * Detect a cross-domain / general-strategy question. True if any strategy-type
 * matcher fires, or (Pattern 8) the query is a generic suggestion with no strong
 * single-domain signal. Robust to object-shaped `raw`.
 *
 * @param {Object} interpretation
 * @returns {boolean}
 */
function isGeneralStrategyQuery(interpretation) {
  // Defer to the SellerOps and Advisory engines: if a query belongs to one of
  // those domains, it is NOT a general-strategy question (they run after Strategy
  // in the pipeline, so without this a loosely-matching strategy pattern would
  // grab them first). Pure detectors → no circular dependency.
  if (isSellerOpsQuery(interpretation) || isAdvisoryQuery(interpretation)) return false;

  const prompt = extractPromptText(interpretation);
  if (STRATEGY_MATCHERS.some((m) => m.test(prompt))) return true;

  const intent = interpretation && interpretation.intent;
  if (intent === 'suggestion' && !hasStrongDomainSignal(prompt)) return true;

  return false;
}

module.exports = {
  isGeneralStrategyQuery,
  classifyStrategyType,
  hasStrongDomainSignal,
  extractPromptText,
  STRATEGY_MATCHERS,
};
