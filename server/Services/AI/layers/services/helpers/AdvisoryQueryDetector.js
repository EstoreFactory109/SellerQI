/**
 * AdvisoryQueryDetector — advisory (pricing / promotions / operational advice /
 * product decisions / capabilities) question detection + classification.
 *
 * ZERO imports from any engine. Pure regex on the prompt text. Lives apart from
 * AdvisoryEngine (which imports FinanceEngine/AdsEngine) so StrategyQueryDetector
 * can defer to advisory detection without a circular dependency. AdvisoryEngine
 * re-exports these for back-compat.
 */

/** Extract the prompt text, lower-cased — robust to object-shaped `raw`. */
function extractPromptText(interpretation) {
  const rawField = interpretation && interpretation.raw;
  const fromRaw =
    typeof rawField === 'string'
      ? rawField
      : (rawField && (rawField.normalizedPrompt || rawField.prompt)) || '';
  const text = fromRaw || (interpretation && interpretation.rewrittenQuestion) || (interpretation && interpretation.rawQuestion) || '';
  return String(text).toLowerCase();
}

/** Parse a discount percent from the prompt ("20% off", "20 percent coupon"). */
function parseDiscountPercent(prompt) {
  const m = String(prompt || '').match(/(\d{1,2})\s*(%|percent)/i);
  if (m) {
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n) && n > 0 && n < 100) return n;
  }
  return null;
}

/**
 * Classify an advisory query (PART 4 classifier). First match wins; returns
 * 'not_advisory' when nothing matches.
 *
 * @param {Object} interpretation
 * @returns {string} an advisory queryType, or 'not_advisory'
 */
function classifyAdvisoryQueryType(interpretation) {
  const prompt = extractPromptText(interpretation);
  const hasAsin = (interpretation?.entities?.asins || []).length > 0;

  // Pricing
  if (/\bpric(e|ing)\b|lower.*price|raise.*price|too\s*(high|low|expensive|cheap)|break\s*even\s*price|minimum.*price|should.*price/i.test(prompt)) {
    return 'pricing_advice';
  }

  // Promotions
  if (/coupon|discount|lightning\s*deal|promotion|\bdeal\b|subscribe.*save|percent\s*off|% ?off/i.test(prompt)) {
    return 'promotional_advice';
  }

  // Operational how-to (knowledge-based topics).
  if (/how\s*(do|can|to).*(fix|improve|optimi[sz]e|write|create|appeal|handle|reduce|get more|launch).*(listing|image|bullet|title|description|keyword|review|rating|return|suspension|appeal|product)/i.test(prompt) ||
      /how.*(launch|appeal|handle negative|get more review|reduce.*return)/i.test(prompt) ||
      /(best way|tips?|guide|steps?).*(launch|improve|optimi[sz]e|reduce.*return|get more review|handle.*review|write.*bullet|listing|image)/i.test(prompt) ||
      /launch.*(new\s*)?product|new product launch/i.test(prompt)) {
    return 'operational_advice';
  }

  // Product decisions — PER-ASIN only. The handler needs a specific ASIN to
  // score keep/optimize/discontinue. Cross-product "which products …" rankings
  // (need attention / most potential / focus on) are strategy/prioritization
  // questions owned by the GeneralStrategyEngine, so they are intentionally NOT
  // claimed here (avoids a "specify an ASIN" dead-end and lets Strategy win).
  if (/(should|keep|discontinue|drop|remove|stop\s*selling|worth\s*selling|worth\s*keeping|health\s*check)/i.test(prompt) && hasAsin) {
    return 'product_decision';
  }

  // Capabilities / meta
  if (/what\s*can\s*(you|qmate|sellerqi)|features?|help\s*me\s*with|can\s*you\s*(do|help|analyze|generate|connect|pause)/i.test(prompt)) {
    return 'capabilities';
  }
  if (/how\s*(do|can|to)\s*(i\s*)?(set\s*up|configure|connect|enable|use)/i.test(prompt)) {
    return 'capabilities';
  }

  return 'not_advisory';
}

/**
 * True when the query maps to any advisory queryType.
 * @param {Object} interpretation
 * @returns {boolean}
 */
function isAdvisoryQuery(interpretation) {
  return classifyAdvisoryQueryType(interpretation) !== 'not_advisory';
}

module.exports = {
  isAdvisoryQuery,
  classifyAdvisoryQueryType,
  parseDiscountPercent,
  extractPromptText,
};
