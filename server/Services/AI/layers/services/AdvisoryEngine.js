/**
 * AdvisoryEngine — advisory/decision answer engine for QMate.
 *
 * Handles operational-context strategy questions: pricing advice, promotional
 * advice, knowledge-based operational how-to, multi-domain product decisions,
 * and platform-capabilities meta questions.
 *
 * Design: pricing/promo/product-decision use DETERMINISTIC numbers from the same
 * internal engine functions the dashboard uses (FinanceEngine ASIN P&L, AdsEngine
 * ASIN performance) — NOT raw DB queries. Operational advice is KNOWLEDGE-BASED
 * (hardcoded steps), not LLM-generated. Recommendations are produced by template
 * decision trees, not the LLM (the LLM only narrates the structured result).
 *
 * Pipeline position (per the architecture doc): runs AFTER SellerOpsEngine and
 * before the general pipeline. Not yet wired into layers/index.js (dormant).
 */

// ── SECTION 1 — Imports ──
const logger = require('../../../../utils/Logger.js');
const FinanceEngine = require('./FinanceEngine.js');
const AdsEngine = require('./AdsEngine.js');
const QMateProductsService = require('../../QMateProductsService.js');
const QMateInventoryService = require('../../QMateInventoryService.js');

// ── SECTION 2 — Detection + classification ──
// Detection lives in helpers/AdvisoryQueryDetector.js (ZERO engine imports) so
// StrategyQueryDetector can defer to it without a circular dependency. Imported
// here and re-exported for back-compat; the engine adds the handlers below.
const {
  isAdvisoryQuery,
  classifyAdvisoryQueryType,
  parseDiscountPercent,
  extractPromptText,
} = require('./helpers/AdvisoryQueryDetector.js');

// ── Shared helpers ──

/** Resolve a finance date range (anchored, with dayCount) for ASIN handlers. */
async function resolveRange(userContext, requestDateRange) {
  if (requestDateRange && requestDateRange.startDate && requestDateRange.endDate && requestDateRange.dayCount) {
    return requestDateRange;
  }
  return FinanceEngine.resolveFinanceDateRange({}, userContext, requestDateRange);
}

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ── SECTION 3 — getPricingAdvice ──

/** Template decision tree (NOT LLM). */
function generatePricingRecommendation(marginPercent, velocity, acos) {
  if (marginPercent < 5) {
    return { action: 'RAISE_PRICE', reason: 'Margin is critically low. Current price barely covers costs.', urgency: 'high' };
  }
  if (marginPercent < 15 && velocity < 1) {
    return { action: 'CONSIDER_DISCONTINUING', reason: 'Low margin AND low sales velocity. This product may not be worth the effort.', urgency: 'medium' };
  }
  if (marginPercent > 40 && velocity < 2) {
    return { action: 'CONSIDER_LOWERING', reason: 'High margin but low velocity suggests price may be too high for the market.', urgency: 'low' };
  }
  if (marginPercent >= 15 && marginPercent <= 40) {
    return { action: 'MAINTAIN', reason: 'Margin is healthy and sustainable at current price point.', urgency: 'none' };
  }
  return { action: 'REVIEW', reason: 'Analyze competitive pricing and demand signals before making changes.', urgency: 'low' };
}

/**
 * Pricing advice for one ASIN (Category F). Uses FinanceEngine ASIN P&L (with
 * the real COGS map for an accurate cogsPerUnit) + AdsEngine ASIN performance.
 *
 * @param {string} asin
 * @param {{ userId, country, region }} userContext
 * @param {Object} requestDateRange
 * @returns {Promise<Object>} { type:'pricing_advice', ... }
 */
async function getPricingAdvice(asin, userContext, requestDateRange) {
  const normalizedAsin = String(asin || '').trim().toUpperCase();
  if (!normalizedAsin) return { type: 'pricing_advice', asin: null, notFound: true };
  const dateRange = await resolveRange(userContext, requestDateRange);

  // Pass the real COGS map (the doc passed null → cogsPerUnit always 0).
  const cogs = await FinanceEngine.fetchCogsForUser(userContext);
  const [asinFinance, asinAds] = await Promise.all([
    FinanceEngine.buildSingleAsinResponse(normalizedAsin, userContext, dateRange, cogs),
    AdsEngine.getAsinAdsPerformance(normalizedAsin, userContext, dateRange),
  ]);

  const fm = asinFinance?.metrics || {};
  if (asinFinance?.notFound || (fm.unitsSold || 0) === 0) {
    return { type: 'pricing_advice', asin: normalizedAsin, notFound: true, message: 'No sales data for this ASIN in the period, so pricing cannot be evaluated.' };
  }

  const units = fm.unitsSold || 0;
  const adSpend = asinAds?.metrics?.spend || fm.adSpend || 0;
  const velocity = round2(units / (dateRange.dayCount || 30));
  const currentPrice = units > 0 ? round2(fm.productSales / units) : 0;
  const cogsPerUnit = fm.cogsPerUnit || 0;
  // Fees per unit = (all expenses minus ad spend) / units, so ad spend is added
  // separately into the margin (keeps the decision tree's margin definition).
  const feesPerUnit = units > 0 ? round2((fm.totalExpenses - adSpend) / units) : 0;
  const minimumPrice = round2(cogsPerUnit + feesPerUnit);
  const adPerUnit = units > 0 ? adSpend / units : 0;
  const marginPerUnit = round2(currentPrice - minimumPrice - adPerUnit);
  const marginPercent = currentPrice > 0 ? round2((marginPerUnit / currentPrice) * 100) : 0;

  return {
    type: 'pricing_advice',
    asin: normalizedAsin,
    productName: asinFinance.productName || normalizedAsin,
    dateRange,
    currentPrice,
    minimumPrice, // break-even price (COGS + fees, excl. ad spend)
    marginPerUnit,
    marginPercent,
    velocity,
    cogsPerUnit,
    feesPerUnit,
    acos: asinAds?.metrics?.acos || 0,
    roas: asinAds?.metrics?.roas || 0,
    recommendation: generatePricingRecommendation(marginPercent, velocity, asinAds?.metrics?.acos),
  };
}

// ── SECTION 4 — getPromotionalAdvice ──

/**
 * Promotional advice for one ASIN (Category G). Models the margin at a proposed
 * discount and the max discount before loss. Uses FinanceEngine ASIN P&L.
 *
 * @param {string} asin
 * @param {{ userId, country, region }} userContext
 * @param {Object} requestDateRange
 * @param {number} [discountPercent]
 * @returns {Promise<Object>} { type:'promotional_advice', ... }
 */
async function getPromotionalAdvice(asin, userContext, requestDateRange, discountPercent) {
  const normalizedAsin = String(asin || '').trim().toUpperCase();
  if (!normalizedAsin) return { type: 'promotional_advice', asin: null, notFound: true };
  const dateRange = await resolveRange(userContext, requestDateRange);

  const cogs = await FinanceEngine.fetchCogsForUser(userContext);
  const asinFinance = await FinanceEngine.buildSingleAsinResponse(normalizedAsin, userContext, dateRange, cogs);
  const fm = asinFinance?.metrics || {};
  if (asinFinance?.notFound || (fm.unitsSold || 0) === 0) {
    return { type: 'promotional_advice', asin: normalizedAsin, notFound: true, message: 'No sales data for this ASIN in the period, so a promotion cannot be evaluated.' };
  }

  const units = fm.unitsSold || 0;
  const currentPrice = units > 0 ? round2(fm.productSales / units) : 0;
  const currentMargin = fm.profitMargin || 0;
  const currentVelocity = round2(units / (dateRange.dayCount || 30));

  const discount = discountPercent || 20; // default 20% if not specified
  const discountedPrice = round2(currentPrice * (1 - discount / 100));

  const cogsPerUnit = fm.cogsPerUnit || 0;
  const feesPerUnit = units > 0 ? round2(fm.totalExpenses / units) : 0; // all-in expenses/unit
  const newMarginPerUnit = round2(discountedPrice - cogsPerUnit - feesPerUnit);
  const newMarginPercent = discountedPrice > 0 ? round2((newMarginPerUnit / discountedPrice) * 100) : 0;
  const isProfitableAtDiscount = newMarginPerUnit > 0;
  const maxDiscountBeforeLoss = currentPrice > 0 ? round2(((currentPrice - cogsPerUnit - feesPerUnit) / currentPrice) * 100) : 0;

  return {
    type: 'promotional_advice',
    asin: normalizedAsin,
    productName: asinFinance.productName || normalizedAsin,
    dateRange,
    currentPrice,
    currentMargin,
    currentVelocity,
    proposedDiscount: discount,
    discountedPrice,
    newMarginPercent,
    isProfitableAtDiscount,
    maxDiscountBeforeLoss: Math.max(0, maxDiscountBeforeLoss),
    recommendation: isProfitableAtDiscount
      ? { action: 'VIABLE', reason: `A ${discount}% discount would still leave a ${newMarginPercent.toFixed(1)}% margin. Maximum safe discount is ${Math.max(0, maxDiscountBeforeLoss).toFixed(0)}%.` }
      : { action: 'NOT_RECOMMENDED', reason: `A ${discount}% discount would result in a loss. Maximum safe discount is ${Math.max(0, maxDiscountBeforeLoss).toFixed(0)}%.` },
  };
}

// ── SECTION 5 — getOperationalAdvice (knowledge-based) ──

const OPERATIONAL_KNOWLEDGE = {
  fix_suppressed_listing: {
    title: 'How to Fix a Suppressed Listing',
    steps: [
      'Go to Seller Central → Inventory → Manage All Inventory → Suppressed',
      'Identify the suppression reason (missing image, pricing, restricted product, etc.)',
      'For a missing main image: upload one with a white background, ≥1000x1000px, no watermarks',
      "For pricing issues: bring the price within Amazon's fair-pricing guidelines",
      'For restricted products: submit an approval / ungating request',
      'Reactivation typically happens within 24-48 hours; if not, open a Seller Support case with the ASIN',
    ],
    tips: ['Fix the highest-traffic ASINs first', 'Keep a compliant backup main image on file for every ASIN'],
  },
  improve_listing: {
    title: 'How to Improve a Listing',
    steps: [
      'Title: lead with brand + core product + key differentiators; stay under the category limit; no ALL CAPS or special characters',
      'Images: at least 7 — white-background main, lifestyle, infographic, size/scale, and detail shots (≥1000x1000px)',
      'Bullets: 5 benefit-led points, each ≤200 chars, leading with a CAPITALIZED benefit keyword',
      'Description / A+ Content: expand on use cases, materials, dimensions, what\'s in the box',
      'Keywords: place top search terms naturally in title, bullets, and backend search terms — do not keyword-stuff',
    ],
    tips: ['Use A+ Content if brand-registered', 'Match the listing to top converting search terms from your search-term report'],
  },
  reduce_returns: {
    title: 'How to Reduce Your Return Rate',
    steps: [
      'Review return reasons in Seller Central → Reports → Return reports to find the top causes',
      'If "item not as described": tighten title/bullets/images so expectations match reality',
      'If "defective/damaged": audit packaging and supplier QC',
      'Add a sizing chart / clear dimensions for apparel and size-sensitive products',
      'Proactively answer common questions in the listing and A+ content',
    ],
    tips: ['A single misleading image drives a surprising share of returns', 'Track return rate by ASIN — fix the worst offenders first'],
  },
  get_more_reviews: {
    title: 'How to Get More Reviews',
    steps: [
      'Enroll eligible ASINs in the Amazon Vine program (for newer products)',
      'Use the "Request a Review" button (or automated request via SP-API) within 4-30 days of delivery',
      'Ensure a great product + packaging experience — reviews follow satisfaction',
      'Never incentivize or solicit only positive reviews (against Amazon policy)',
    ],
    tips: ['Consistent, compliant review requests on every order compound over time', 'Vine is the fastest legitimate way to seed initial reviews'],
  },
  appeal_suspension: {
    title: 'How to Appeal an Account Suspension',
    steps: [
      'Read the suspension notice carefully to identify the exact policy or metric cited',
      'Write a Plan of Action (POA): (1) root cause, (2) immediate corrective actions, (3) preventive steps',
      'Be specific and factual; avoid blaming Amazon or buyers',
      'Submit via Seller Central → Account Health → Reactivate your account / Appeal',
      'Follow up professionally; escalate only if you have new information',
    ],
    tips: ['A strong POA addresses root cause AND prevention', 'Gather supporting documents (invoices, tracking) before submitting'],
  },
  handle_negative_reviews: {
    title: 'How to Handle Negative Reviews',
    steps: [
      'Identify whether it violates policy (profanity, seller feedback on a product review, etc.) — if so, report it',
      'For product reviews you cannot remove, address the underlying issue in the listing',
      'For seller feedback, you may request removal if it concerns FBA/shipping or violates guidelines',
      'Use negative feedback as a signal to fix product or listing problems',
    ],
    tips: ['You generally cannot contact reviewers directly', 'Patterns in negative reviews are your best product-improvement roadmap'],
  },
  optimize_images: {
    title: 'How to Optimize Listing Images',
    steps: [
      'Main image: pure white background, product fills ~85% of the frame, ≥1000x1000px for zoom',
      'Add lifestyle images showing the product in use / in context',
      'Add an infographic highlighting 3-5 key features/benefits',
      'Add a size/scale image and close-up detail shots',
      'No illustrations, watermarks, or placeholder graphics on the main image',
    ],
    tips: ['Images drive conversion more than copy on mobile', 'Use all available image slots (PT01-PT08)'],
  },
  write_bullet_points: {
    title: 'How to Write Better Bullet Points',
    steps: [
      'Write 5 bullets, each ≤200 characters for mobile readability',
      'Lead each with a CAPITALIZED benefit keyword, then explain the benefit',
      'Focus on benefits and outcomes, not just specs',
      'Weave in relevant search keywords naturally',
      'Order bullets by what matters most to the buyer',
    ],
    tips: ['Benefit-first beats feature-first for conversion', 'Read them aloud — if they sound like a spec sheet, rewrite'],
  },
  launch_new_product: {
    title: 'How to Launch a New Product',
    steps: [
      'Prepare a fully optimized listing BEFORE going live (title, 7+ images, bullets, A+ content, keywords)',
      'Seed initial reviews via Vine and compliant review requests',
      'Start an auto-targeting Sponsored Products campaign to discover converting search terms',
      'Promote converting search terms into exact-match manual campaigns; add negatives for waste',
      'Use a modest launch coupon to drive early velocity (only if it stays profitable)',
      'Monitor inventory closely — running out during launch kills momentum',
    ],
    tips: ['Reviews + ad-driven velocity are the launch flywheel', 'Do not scale ad spend until the listing converts'],
  },
};

/** Map free-text to an operational-knowledge topic key. */
function resolveOperationalTopic(prompt) {
  const p = String(prompt || '').toLowerCase();
  if (/suppress/.test(p)) return 'fix_suppressed_listing';
  if (/appeal|suspension|suspended|reinstate|reactivat/.test(p)) return 'appeal_suspension';
  if (/return/.test(p)) return 'reduce_returns';
  if (/negative review|bad review|handle.*review|respond.*review/.test(p)) return 'handle_negative_reviews';
  if (/review|rating/.test(p)) return 'get_more_reviews';
  if (/image|photo|picture/.test(p)) return 'optimize_images';
  if (/bullet/.test(p)) return 'write_bullet_points';
  if (/launch|new product/.test(p)) return 'launch_new_product';
  if (/listing|title|description|keyword/.test(p)) return 'improve_listing';
  return null;
}

/**
 * Knowledge-based operational advice (Category H). `topic` may be a knowledge
 * key or free text (resolved via resolveOperationalTopic).
 *
 * @param {string} topic
 * @returns {Object} { type:'operational_advice', topic, title, steps, tips, found }
 */
function getOperationalAdvice(topic, userContext) {
  const key = OPERATIONAL_KNOWLEDGE[topic] ? topic : (resolveOperationalTopic(topic) || 'improve_listing');
  const entry = OPERATIONAL_KNOWLEDGE[key];
  return {
    type: 'operational_advice',
    topic: key,
    found: !!entry,
    title: entry.title,
    steps: entry.steps,
    tips: entry.tips || [],
  };
}

// ── SECTION 6 — getProductDecision (multi-domain) ──

// Score helpers — each returns 0-10 or null (N/A when the domain has no data).
function scoreProfitability(margin) {
  if (margin == null) return null;
  if (margin > 25) return 10;
  if (margin > 15) return 8;
  if (margin > 5) return 5;
  if (margin > 0) return 3;
  return 0;
}
function scoreAdEfficiency(acos, hasAds) {
  if (!hasAds) return null;
  if (acos === 0) return 6; // no attributed sales but tracked — neutral-low
  if (acos < 15) return 10;
  if (acos < 25) return 8;
  if (acos < 40) return 5;
  if (acos < 60) return 2;
  return 0;
}
function scoreListingQuality(totalErrors) {
  if (totalErrors == null) return null;
  if (totalErrors === 0) return 10;
  if (totalErrors <= 2) return 7;
  if (totalErrors <= 5) return 4;
  return 1;
}
function scoreInventoryHealth(status) {
  if (status == null) return null;
  if (status === 'out_of_stock') return 1;
  if (status === 'low_stock') return 4;
  return 9; // in stock / healthy
}
function scoreVelocity(unitsPerDay) {
  if (unitsPerDay == null) return null;
  if (unitsPerDay >= 5) return 10;
  if (unitsPerDay >= 2) return 8;
  if (unitsPerDay >= 1) return 6;
  if (unitsPerDay >= 0.3) return 4;
  if (unitsPerDay > 0) return 2;
  return 0;
}

/**
 * Multi-domain product decision (Category J). Scores 5 dimensions (each 0-10 or
 * 'N/A' when that domain has no data) and produces keep / optimize / discontinue.
 * Uses FinanceEngine (margin/velocity), AdsEngine (ACOS), QMateProductsService
 * (listing quality), QMateInventoryService (inventory health).
 *
 * @param {string} asin
 * @param {{ userId, country, region }} userContext
 * @param {Object} requestDateRange
 * @returns {Promise<Object>} { type:'product_decision', asin, scores, recommendation, reasoning, limitations }
 */
async function getProductDecision(asin, userContext, requestDateRange) {
  const normalizedAsin = String(asin || '').trim().toUpperCase();
  if (!normalizedAsin) return { type: 'product_decision', asin: null, notFound: true };
  const dateRange = await resolveRange(userContext, requestDateRange);
  const limitations = [];

  const cogs = await FinanceEngine.fetchCogsForUser(userContext);
  const [finRes, adsRes, issuesRes, invRes] = await Promise.allSettled([
    FinanceEngine.buildSingleAsinResponse(normalizedAsin, userContext, dateRange, cogs),
    AdsEngine.getAsinAdsPerformance(normalizedAsin, userContext, dateRange),
    QMateProductsService.getAsinIssues(userContext.userId, userContext.country, userContext.region, normalizedAsin),
    QMateInventoryService.getReplenishmentRecommendations(userContext.userId, userContext.country, userContext.region),
  ]);

  // Finance
  const fin = finRes.status === 'fulfilled' ? finRes.value : null;
  const fm = fin?.metrics || {};
  const hasFinance = fin && !fin.notFound && (fm.unitsSold || 0) > 0;
  const margin = hasFinance ? fm.profitMargin : null;
  const velocity = hasFinance ? round2((fm.unitsSold || 0) / (dateRange.dayCount || 30)) : null;
  if (!hasFinance) limitations.push('No finance data for this ASIN in the period.');

  // Ads
  const ads = adsRes.status === 'fulfilled' ? adsRes.value : null;
  const hasAds = ads && !ads.notFound && ads.metrics;
  const acos = hasAds ? ads.metrics.acos : null;
  if (!hasAds) limitations.push('No ads data for this ASIN.');

  // Listing quality
  const issues = issuesRes.status === 'fulfilled' ? issuesRes.value : null;
  const hasIssues = issues && issues.success && issues.data;
  const totalErrors = hasIssues ? (issues.data.totalErrors || (issues.data.issues || []).length) : null;
  if (!hasIssues) limitations.push('Listing-quality data unavailable for this ASIN.');

  // Inventory
  let invStatus = null;
  if (invRes.status === 'fulfilled' && invRes.value?.success && invRes.value.data) {
    const p = (invRes.value.data.products || []).find((x) => String(x.asin).toUpperCase() === normalizedAsin);
    invStatus = p ? p.status : 'in_stock'; // not in restock list → treat as healthy
  } else {
    limitations.push('Inventory data unavailable.');
  }

  const scores = {
    profitability: scoreProfitability(margin),
    adEfficiency: scoreAdEfficiency(acos, hasAds),
    listingQuality: scoreListingQuality(totalErrors),
    inventoryHealth: scoreInventoryHealth(invStatus),
    salesVelocity: scoreVelocity(velocity),
  };

  // Average over the dimensions that HAVE data (N/A excluded).
  const present = Object.values(scores).filter((s) => s != null);
  const avg = present.length ? present.reduce((a, b) => a + b, 0) / present.length : null;

  // Recommendation from the available signal. Loss-making + low velocity is the
  // clearest discontinue case; strong margin/velocity → keep; else optimize.
  let recommendation;
  const reasoning = [];
  if (avg == null) {
    recommendation = 'INSUFFICIENT_DATA';
    reasoning.push('Not enough data across domains to make a confident recommendation.');
  } else {
    const lossMaking = margin != null && margin <= 0;
    const lowVelocity = velocity != null && velocity < 0.3;
    if (lossMaking && lowVelocity) {
      recommendation = 'DISCONTINUE';
      reasoning.push(`Losing money (${margin.toFixed(1)}% margin) with very low velocity (${velocity}/day).`);
    } else if (avg >= 7 && !lossMaking) {
      recommendation = 'KEEP';
      reasoning.push(`Strong overall health (avg score ${avg.toFixed(1)}/10).`);
      if (margin != null) reasoning.push(`Margin ${margin.toFixed(1)}%.`);
    } else {
      recommendation = 'OPTIMIZE';
      if (acos != null && acos > 40) reasoning.push(`ACOS is high (${acos.toFixed(1)}%) — tighten ad targeting.`);
      if (totalErrors != null && totalErrors > 2) reasoning.push(`${totalErrors} listing issues to fix.`);
      if (margin != null && margin < 15) reasoning.push(`Margin is thin (${margin.toFixed(1)}%) — review pricing/costs.`);
      if (invStatus === 'low_stock' || invStatus === 'out_of_stock') reasoning.push(`Inventory is ${invStatus}.`);
      if (reasoning.length === 0) reasoning.push(`Mixed signals (avg score ${avg.toFixed(1)}/10) — targeted improvements recommended.`);
    }
  }

  return {
    type: 'product_decision',
    asin: normalizedAsin,
    productName: fin?.productName || normalizedAsin,
    dateRange,
    scores, // each 0-10 or null (=N/A)
    overallScore: avg != null ? round2(avg) : null,
    metrics: { margin, velocity, acos, totalErrors, inventoryStatus: invStatus },
    recommendation,
    reasoning,
    limitations,
  };
}

// ── SECTION 7 — Capabilities ──

const CAPABILITIES_RESPONSE = {
  type: 'capabilities',
  features: [
    { name: 'Financial Analysis', description: 'Profit, expenses, margins, COGS, per-product profitability', examples: ['What is my profit?', 'Break down my expenses'] },
    { name: 'PPC/Ads Management', description: 'ACOS, ROAS, wasted spend, campaign analysis, keyword optimization', examples: ['What is my ACOS?', 'Show wasted keywords'] },
    { name: 'Listing Issues', description: 'Identify and fix listing problems, suppressed listings, quality issues', examples: ['What issues do my listings have?', 'How do I fix a suppressed listing?'] },
    { name: 'Inventory Tracking', description: 'Stock levels, low stock alerts, restock recommendations', examples: ['Am I running low on stock?', 'What should I restock?'] },
    { name: 'Account Health', description: 'ODR, late shipment rate, policy compliance', examples: ['What is my account health?', 'My ODR is high — what should I do?'] },
    { name: 'Reimbursements', description: 'FBA reimbursement opportunities, lost/damaged inventory', examples: ['How much am I owed in reimbursements?'] },
    { name: 'Business Strategy', description: 'Cross-domain insights, health scores, action plans', examples: ['How can I improve my profit?', 'What mistakes am I making?'] },
    { name: 'PPC Actions', description: 'Pause keywords, add negatives, optimize campaigns', examples: ['Pause my worst keywords', 'Add negative keywords'] },
  ],
};

function getCapabilities() {
  return CAPABILITIES_RESPONSE;
}

// ── SECTION 8 — handleAdvisoryQuery ──

/**
 * Main entry point. Classifies and routes to the matching handler.
 *
 * @param {Object} interpretation
 * @param {{ userId, country, region }} userContext
 * @param {Object} [requestDateRange]
 * @returns {Promise<Object>} structured result, or { type:'error', message }
 */
async function handleAdvisoryQuery(interpretation, userContext, requestDateRange) {
  try {
    const queryType = classifyAdvisoryQueryType(interpretation);
    const prompt = extractPromptText(interpretation);
    const asin = (interpretation?.entities?.asins || [])[0] || null;
    logger.info(`[AdvisoryEngine] handleAdvisoryQuery — queryType=${queryType}`);

    switch (queryType) {
      case 'pricing_advice':
        return await getPricingAdvice(asin, userContext, requestDateRange);
      case 'promotional_advice':
        return await getPromotionalAdvice(asin, userContext, requestDateRange, parseDiscountPercent(prompt));
      case 'operational_advice':
        return getOperationalAdvice(prompt, userContext);
      case 'product_decision':
        // Requires a specific ASIN; cross-product "which products…" decisions are
        // a strategy ranking and are left to the GeneralStrategyEngine upstream.
        if (!asin) return { type: 'product_decision', notFound: true, message: 'Specify a product (ASIN) for a keep/optimize/discontinue decision.' };
        return await getProductDecision(asin, userContext, requestDateRange);
      case 'capabilities':
        return getCapabilities();
      default:
        return { type: 'not_advisory' };
    }
  } catch (err) {
    logger.error('[AdvisoryEngine] Error in handleAdvisoryQuery:', err.message);
    return { type: 'error', message: err.message };
  }
}

// ── Narrator (LLM formats the deterministic result; fallback is template) ──

const ADVISORY_NARRATOR_MODEL = process.env.QMATE_NARRATOR_MODEL || 'gpt-4o-mini';
const ADVISORY_NARRATOR_SYSTEM_PROMPT = `You are QMate, a strategic advisor for an Amazon seller. You receive pre-computed pricing analysis, promotional viability, operational guidance, or product decisions.

RULES:
1. Every number from the result data only.
2. For pricing: always state the minimum viable price and current margin.
3. For promotions: always state the maximum safe discount percentage.
4. For operational advice: present steps as a numbered list.
5. For product decisions: state the recommendation clearly (keep/optimize/discontinue) with the top 2 reasons.
6. For capabilities: be friendly and list features with examples.
7. Keep responses under 300 words.`;

function aFmtMoney(n) { return `$${Number(n || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }

/** Deterministic per-type fallback narration. */
function buildAdvisoryFallback(r) {
  if (!r || typeof r !== 'object') return 'I was unable to format the result.';
  if (r.notFound) return r.message || 'That data is not available for this product.';
  switch (r.type) {
    case 'pricing_advice':
      return `${r.productName || r.asin} is priced at ${aFmtMoney(r.currentPrice)} with a ${Number(r.marginPercent || 0).toFixed(1)}% margin (break-even ${aFmtMoney(r.minimumPrice)}, ${r.velocity}/day). Recommendation: ${r.recommendation?.action} — ${r.recommendation?.reason}`;
    case 'promotional_advice':
      return `At a ${r.proposedDiscount}% discount, ${r.productName || r.asin} would sell at ${aFmtMoney(r.discountedPrice)} with a ${Number(r.newMarginPercent || 0).toFixed(1)}% margin. ${r.recommendation?.action}: ${r.recommendation?.reason}`;
    case 'operational_advice':
      return `${r.title}:\n${(r.steps || []).map((s, i) => `${i + 1}. ${s}`).join('\n')}${(r.tips || []).length ? `\nTips: ${r.tips.join('; ')}` : ''}`;
    case 'product_decision': {
      const sc = r.scores || {};
      const fmt = (v) => (v == null ? 'N/A' : `${v}/10`);
      return `Recommendation for ${r.productName || r.asin}: ${r.recommendation}${r.overallScore != null ? ` (overall ${r.overallScore}/10)` : ''}. Scores — profitability ${fmt(sc.profitability)}, ad efficiency ${fmt(sc.adEfficiency)}, listing ${fmt(sc.listingQuality)}, inventory ${fmt(sc.inventoryHealth)}, velocity ${fmt(sc.salesVelocity)}. ${(r.reasoning || []).join(' ')}`;
    }
    case 'capabilities':
      return `QMate can help with: ${(r.features || []).map((f) => f.name).join(', ')}.`;
    default:
      return 'Here is your advice.';
  }
}

/**
 * Narrate an advisory result via the LLM, with deterministic fallback.
 * @param {Object} result
 * @param {string} userQuestion
 * @param {Object} [modelTools] - { client }
 * @returns {Promise<string>}
 */
async function narrateAdvisoryResult(result, userQuestion, modelTools) {
  const client = modelTools && modelTools.client;
  if (client && client.chat && client.chat.completions && typeof client.chat.completions.create === 'function') {
    try {
      const completion = await client.chat.completions.create({
        model: ADVISORY_NARRATOR_MODEL,
        messages: [
          { role: 'system', content: ADVISORY_NARRATOR_SYSTEM_PROMPT },
          { role: 'user', content: `User asked: '${userQuestion}'\n\nPre-computed result:\n${JSON.stringify(result, null, 2)}\n\nPresent this as a clear answer.` },
        ],
        temperature: 0.15,
        max_tokens: 800,
      });
      const content = completion?.choices?.[0]?.message?.content;
      if (content && content.trim()) return content.trim();
    } catch (err) {
      logger.warn('[AdvisoryEngine] Narrator LLM failed; using fallback', { message: err.message });
    }
  }
  return buildAdvisoryFallback(result);
}

module.exports = {
  isAdvisoryQuery,
  handleAdvisoryQuery,
  classifyAdvisoryQueryType,
  narrateAdvisoryResult,
  // handlers
  getPricingAdvice,
  getPromotionalAdvice,
  getOperationalAdvice,
  getProductDecision,
  getCapabilities,
  // exported for later phases / testing
  OPERATIONAL_KNOWLEDGE,
  CAPABILITIES_RESPONSE,
  parseDiscountPercent,
  extractPromptText,
};
