/**
 * ScenarioRecommendationService.js
 *
 * Unified scenario-based recommendation engine.
 * Implements 20 diagnostic scenarios derived from KPI range thresholds
 * and WoW/MoM trend data to surface actionable product-level insights.
 *
 * Consumed by:
 *  - OptimizationService (backend, Optimization tab)
 *  - ProductDetails.jsx  (client-side mirror — same constants + logic)
 *  - RecommendationService (backend, Issues-by-Product flow)
 */

// Sessions & units normalised to daily (BuyBoxData stores one day per doc).
// Monthly spec: Sessions Low < 300, High > 1500  →  Daily: Low < 10, High > 50
const KPI_RANGES = {
    sessions: { low: 10, high: 50 },
    cvr:      { low: 10,  high: 20 },
    buyBox:   { low: 80,  high: 95 },
    acos:     { low: 15,  high: 30 },
    tacos:    { low: 8,   high: 15 },
    ppcSpendPctRev: { low: 10, high: 25 },
    unitsSold: { low: 2, high: 4 }, // daily: "low units" < 2/day, "high units" > 4/day
};

const TREND_THRESHOLDS = {
    rising:   15,   // percentChange >  +15%
    flat:     10,   // percentChange between -10% and +10%
    dropping: -15,  // percentChange < -15%
};

// ---------------------------------------------------------------------------
// Trend helpers
// ---------------------------------------------------------------------------
const isRising   = (pct) => typeof pct === 'number' && pct > TREND_THRESHOLDS.rising;
const isFlat     = (pct) => typeof pct === 'number' && pct >= -TREND_THRESHOLDS.flat && pct <= TREND_THRESHOLDS.flat;
const isDropping = (pct) => typeof pct === 'number' && pct < TREND_THRESHOLDS.dropping;

// ACOS comparison stores percentChange as null (it's already a %);
// use delta (absolute pp change) with a 5-pp threshold instead.
const ACOS_DELTA_THRESHOLD = 5;
const isAcosRising = (change) => typeof change?.delta === 'number' && change.delta > ACOS_DELTA_THRESHOLD;

// ---------------------------------------------------------------------------
// Scenario definitions
// priority: 1 = most urgent … 4 = informational
// ---------------------------------------------------------------------------
const SCENARIOS = [
    // --- Static scenarios (no trend data required) -------------------------

    {
        id: 'high_sessions_low_cvr',
        priority: 2,
        shortLabel: 'Fix Listing',
        message: 'Your product is getting strong traffic but visitors are not buying. This is a classic listing quality problem. Focus on improving your main image, ensuring competitive pricing, adding high-quality A+ content, and addressing negative reviews. Your listing needs to convince shoppers who are already finding you.',
        evaluate: (m) => m.sessions > KPI_RANGES.sessions.high && m.cvr < KPI_RANGES.cvr.low,
        buildReason: (m) =>
            `Sessions are high (${m.sessions.toLocaleString()}/day) but conversion rate is only ${m.cvr.toFixed(1)}% (below ${KPI_RANGES.cvr.low}% threshold). Traffic is not the problem — your listing is failing to convert.`,
    },
    {
        id: 'low_sessions_high_cvr',
        priority: 3,
        shortLabel: 'Scale Traffic',
        message: 'Your listing converts well when people find it, but not enough shoppers are seeing it. This is a visibility problem. Consider increasing PPC budget, launching Sponsored Brand campaigns, improving backend keywords for organic discovery, or running promotions and deals to boost ranking.',
        evaluate: (m) => m.sessions < KPI_RANGES.sessions.low && m.cvr > KPI_RANGES.cvr.high,
        buildReason: (m) =>
            `Conversion rate is strong at ${m.cvr.toFixed(1)}% (above ${KPI_RANGES.cvr.high}%) but sessions are only ${m.sessions.toLocaleString()}/day. The product converts — it just needs more eyeballs.`,
    },
    {
        id: 'high_acos_low_buybox',
        priority: 1,
        shortLabel: 'Fix Buy Box First',
        message: 'You are spending heavily on ads but don\'t own the Buy Box, meaning most of that ad spend is driving sales for a competitor or another seller on your listing. Pause or reduce PPC immediately and focus on winning back the Buy Box by reviewing your pricing, checking fulfillment method (FBA vs FBM), and ensuring your seller metrics are healthy.',
        evaluate: (m) => m.acos > KPI_RANGES.acos.high && m.buyBoxPercentage < KPI_RANGES.buyBox.low,
        buildReason: (m) =>
            `ACoS is ${m.acos.toFixed(1)}% (above ${KPI_RANGES.acos.high}%) while Buy Box ownership is only ${m.buyBoxPercentage.toFixed(0)}% (below ${KPI_RANGES.buyBox.low}%). Ad dollars are being wasted — fix Buy Box before spending on ads.`,
    },
    {
        id: 'low_sessions_low_cvr',
        priority: 1,
        shortLabel: 'Fix Listing First',
        message: 'Both traffic and conversion are critically low. Do not increase ad spend in this state — you\'d be paying to send people to a listing that doesn\'t convert. Start by fixing the listing fundamentals: main image, title with relevant keywords, bullet points that address buyer objections, competitive pricing, and reviews. Only scale ads once conversion rate improves.',
        evaluate: (m) => m.sessions < KPI_RANGES.sessions.low && m.cvr < KPI_RANGES.cvr.low,
        buildReason: (m) =>
            `Sessions (${m.sessions.toLocaleString()}/day) and conversion rate (${m.cvr.toFixed(1)}%) are both below healthy levels. Both traffic acquisition and listing quality need attention — prioritise the listing first.`,
    },
    {
        id: 'high_ppc_spend_low_units',
        priority: 2,
        shortLabel: 'Keyword-Listing Mismatch',
        message: 'Your ads are consuming a large share of revenue but generating very few sales. This typically indicates a keyword-to-listing mismatch — shoppers clicking your ads aren\'t finding what they expected. Review your search term reports to identify irrelevant clicks, add negative keywords aggressively, and ensure your ad copy and product listing align with the keywords you\'re bidding on.',
        evaluate: (m) => m.ppcSpendPctRev > KPI_RANGES.ppcSpendPctRev.high && m.unitsSold < KPI_RANGES.unitsSold.low,
        buildReason: (m) =>
            `PPC spend accounts for ${m.ppcSpendPctRev.toFixed(1)}% of revenue (above ${KPI_RANGES.ppcSpendPctRev.high}%) but only ${m.unitsSold} units were sold. Ads are attracting clicks that don\'t convert to purchases.`,
    },
    {
        id: 'high_pageviews_low_sessions',
        priority: 3,
        shortLabel: 'Listing Creating Doubt',
        message: 'Shoppers are viewing your product page multiple times within their browsing sessions but not committing to a purchase. This revisiting behaviour signals hesitation or doubt — often caused by unclear product information, unanswered questions in the listing, inconsistent images, or pricing that feels uncertain. Review your listing from a buyer\'s perspective and address potential objections.',
        evaluate: (m) => m.sessions > 0 && (m.pageViews / m.sessions) > 2.0 && m.sessions < KPI_RANGES.sessions.low,
        buildReason: (m) =>
            `Page views per session ratio is ${(m.pageViews / m.sessions).toFixed(1)}x (visitors are coming back to the page multiple times) with only ${m.sessions.toLocaleString()} sessions. Shoppers are interested but something is stopping them from buying.`,
    },
    {
        id: 'high_cvr_high_acos',
        priority: 2,
        shortLabel: 'Reduce Bids',
        message: 'Your product converts well — the listing is doing its job. The problem is ad efficiency: your bids are too aggressive, driving up cost per click beyond what\'s profitable. Lower your bids gradually (10-15% at a time), pause high-ACoS keywords that aren\'t converting, and focus budget on your best-performing exact match keywords. Do not pause campaigns entirely — just trim the bids.',
        evaluate: (m) => m.cvr > KPI_RANGES.cvr.high && m.acos > KPI_RANGES.acos.high,
        buildReason: (m) =>
            `Conversion rate is excellent at ${m.cvr.toFixed(1)}% but ACoS is ${m.acos.toFixed(1)}% (above ${KPI_RANGES.acos.high}%). The product sells well — you\'re just overpaying for the traffic.`,
    },
    {
        id: 'low_acos_low_sessions',
        priority: 3,
        shortLabel: 'Increase Bids',
        message: 'Your ad campaigns are very efficient but barely generating any traffic. You\'re being too conservative with bids — your ads likely aren\'t winning enough auctions to get meaningful impressions. Gradually increase bids by 15-25%, expand to broader match types, and consider adding new keyword targets. You have room to spend more while staying profitable.',
        evaluate: (m) => m.acos > 0 && m.acos < KPI_RANGES.acos.low && m.sessions < KPI_RANGES.sessions.low,
        buildReason: (m) =>
            `ACoS is only ${m.acos.toFixed(1)}% (well below ${KPI_RANGES.acos.low}%) with just ${m.sessions.toLocaleString()} sessions/day. There\'s significant headroom to increase ad spend while maintaining profitability.`,
    },
    {
        id: 'buybox_full_low_cvr',
        priority: 2,
        shortLabel: 'Listing Bottleneck',
        message: 'You own the Buy Box — that\'s not the issue. The problem is purely your listing\'s ability to convert visitors into buyers. Audit your listing content: are your images high quality and showing the product in use? Do your bullet points address the top buyer concerns? Is the price competitive? Check your reviews for recurring complaints and address them in your listing copy or product improvements.',
        evaluate: (m) => m.buyBoxPercentage >= KPI_RANGES.buyBox.high && m.cvr < KPI_RANGES.cvr.low,
        buildReason: (m) =>
            `Buy Box is solid at ${m.buyBoxPercentage.toFixed(0)}% but conversion rate is only ${m.cvr.toFixed(1)}%. The Buy Box isn\'t the bottleneck — your listing quality is preventing sales.`,
    },
    {
        id: 'low_tacos_low_units',
        priority: 4,
        shortLabel: 'Push More Ads',
        message: 'Your advertising efficiency is excellent relative to total sales, but overall sales volume is low. This is a good position to scale from — your organic-to-paid ratio is healthy, meaning you can safely increase PPC spend without it eating into margins. Consider launching new campaigns, adding more keyword targets, or increasing daily budgets to drive incremental volume.',
        evaluate: (m) => m.tacos < KPI_RANGES.tacos.low && m.unitsSold < KPI_RANGES.unitsSold.low,
        buildReason: (m) =>
            `TACoS is only ${m.tacos.toFixed(1)}% (below ${KPI_RANGES.tacos.low}%) with ${m.unitsSold} units sold. Ad efficiency is strong but total volume is small — safe to invest more in advertising.`,
    },
    {
        id: 'high_sessions_low_pv_ratio',
        priority: 3,
        shortLabel: 'Single Visit Behavior',
        message: 'Shoppers are visiting your listing and making a decision quickly — they don\'t come back for a second look. This can be positive (instant purchase) or negative (instant bounce). Check whether your conversion rate matches this behaviour: if CVR is high, your listing is compelling at first glance. If CVR is low, shoppers are deciding against you immediately — likely due to the main image, price, or star rating visible on the search results page.',
        evaluate: (m) => m.sessions > KPI_RANGES.sessions.high && m.sessions > 0 && (m.pageViews / m.sessions) < 1.3,
        buildReason: (m) =>
            `High traffic (${m.sessions.toLocaleString()} sessions/day) but page-views-per-session is only ${(m.pageViews / m.sessions).toFixed(2)}x — visitors are making instant decisions without revisiting.`,
    },
    {
        id: 'high_units_low_buybox',
        priority: 1,
        shortLabel: 'Investigate Hijackers',
        message: 'Your product is selling well but you don\'t control the Buy Box for a significant portion of sales. This strongly suggests another seller is on your listing — potentially a hijacker, an unauthorized reseller, or Amazon itself. Check your listing\'s "Other Sellers" section, file a complaint if unauthorized sellers are present, and consider enrolling in Amazon Brand Registry or Transparency to protect your listing.',
        evaluate: (m) => m.unitsSold > KPI_RANGES.unitsSold.high && m.buyBoxPercentage < KPI_RANGES.buyBox.low,
        buildReason: (m) =>
            `${m.unitsSold} units are being sold but your Buy Box share is only ${m.buyBoxPercentage.toFixed(0)}% (below ${KPI_RANGES.buyBox.low}%). Someone else is capturing sales on your listing.`,
    },
    {
        id: 'high_sessions_high_cvr_high_acos',
        priority: 2,
        shortLabel: 'Restructure Campaigns',
        message: 'This is a healthy product — strong traffic, strong conversion — but your ad campaigns are inefficient. The product doesn\'t need more visibility or listing improvements. Focus entirely on campaign structure: consolidate ad groups, move top-converting search terms into exact match campaigns with controlled bids, add negative keywords to broad/auto campaigns, and consider reducing bids on high-ACoS keywords rather than pausing them entirely.',
        evaluate: (m) =>
            m.sessions > KPI_RANGES.sessions.high &&
            m.cvr > KPI_RANGES.cvr.high &&
            m.acos > KPI_RANGES.acos.high,
        buildReason: (m) =>
            `Sessions (${m.sessions.toLocaleString()}/day) and CVR (${m.cvr.toFixed(1)}%) are both strong, but ACoS is ${m.acos.toFixed(1)}%. The product is performing well — campaigns just need optimization.`,
    },
    {
        id: 'low_ppc_spend_low_sessions',
        priority: 3,
        shortLabel: 'Underspending',
        message: 'Your product has minimal ad investment and minimal traffic — it\'s effectively invisible on Amazon. In competitive categories, organic ranking alone is rarely enough. Consider allocating a meaningful PPC budget, starting with auto campaigns to discover relevant keywords, then building out manual exact-match campaigns for your best performers.',
        evaluate: (m) => m.ppcSpendPctRev < KPI_RANGES.ppcSpendPctRev.low && m.sessions < KPI_RANGES.sessions.low,
        buildReason: (m) =>
            `PPC spend is only ${m.ppcSpendPctRev.toFixed(1)}% of revenue with just ${m.sessions.toLocaleString()} sessions/day. The product is getting almost no visibility — both organic and paid.`,
    },

    // --- Trend scenarios (require WoW/MoM comparison data) -----------------

    {
        id: 'high_tacos_flat_units',
        priority: 2,
        shortLabel: 'Weak Organic',
        message: 'Your total advertising cost relative to sales is high, and unit sales are not growing despite the spend. This means ads are sustaining your current sales level rather than driving organic growth. Healthy products should see TACoS decrease over time as organic ranking improves. Review whether your ads are driving enough organic keyword ranking improvements, and check if competitors have gained ground.',
        evaluate: (m, c) =>
            m.tacos > KPI_RANGES.tacos.high &&
            c?.hasComparison &&
            isFlat(c.changes?.unitsSold?.percentChange),
        buildReason: (m, c) =>
            `TACoS is ${m.tacos.toFixed(1)}% (above ${KPI_RANGES.tacos.high}%) while unit sales are flat (${c.changes.unitsSold.percentChange?.toFixed(1) ?? 0}% change). Advertising is propping up sales without building organic momentum.`,
    },
    {
        id: 'rising_sessions_flat_units',
        priority: 2,
        shortLabel: 'Competitors Improving',
        message: 'Traffic to your listing is increasing but sales are not keeping pace. This often means competitors are improving their listings or pricing — shoppers are comparison-shopping more and choosing alternatives. Audit competitor listings for recent changes (new images, lower prices, better reviews) and ensure your listing remains competitive. Also check if your conversion rate has dropped.',
        evaluate: (m, c) =>
            c?.hasComparison &&
            isRising(c.changes?.sessions?.percentChange) &&
            isFlat(c.changes?.unitsSold?.percentChange),
        buildReason: (m, c) =>
            `Sessions are up ${c.changes.sessions.percentChange?.toFixed(1)}% but unit sales remain flat (${c.changes.unitsSold.percentChange?.toFixed(1)}% change). More people are seeing your listing but not buying — competitive pressure is likely increasing.`,
    },
    {
        id: 'high_units_rising_acos',
        priority: 2,
        shortLabel: 'Organic Slipping',
        message: 'You\'re still selling well, but your advertising costs are climbing. This is a warning sign that organic ranking is declining — ads are picking up the slack to maintain sales volume. If left unchecked, profitability will erode. Investigate keyword ranking changes, check if competitors are bidding more aggressively, and review whether recent listing or inventory changes may have affected organic performance.',
        evaluate: (m, c) =>
            m.unitsSold > KPI_RANGES.unitsSold.high &&
            c?.hasComparison &&
            isAcosRising(c.changes?.acos),
        buildReason: (m, c) =>
            `${m.unitsSold} units sold but ACoS has increased by ${c.changes.acos.delta?.toFixed(1)} percentage points. Sales are holding but you\'re paying more in ads to maintain them — organic visibility is likely declining.`,
    },
    {
        id: 'flat_sessions_dropping_units',
        priority: 1,
        shortLabel: 'CVR Falling',
        message: 'Traffic is stable but fewer visitors are converting to buyers — your conversion rate is actively declining. Something has changed: check for recent negative reviews, competitor price drops, listing suppression warnings, or changes to your images/content. Also verify that your product is still in stock and that the Buy Box hasn\'t shifted to another seller.',
        evaluate: (m, c) =>
            c?.hasComparison &&
            isFlat(c.changes?.sessions?.percentChange) &&
            isDropping(c.changes?.unitsSold?.percentChange),
        buildReason: (m, c) =>
            `Sessions are stable (${c.changes.sessions.percentChange?.toFixed(1)}% change) but units sold dropped ${Math.abs(c.changes.unitsSold.percentChange).toFixed(1)}%. Same traffic, fewer sales — conversion rate is declining.`,
    },
    {
        id: 'rising_ppc_flat_revenue',
        priority: 1,
        shortLabel: 'Audit Search Terms',
        message: 'You\'re spending more on advertising but revenue isn\'t growing — your ad efficiency is deteriorating. This typically happens when broad or auto campaigns accumulate wasteful search terms over time. Download your search term report, identify terms with high spend and zero or low sales, and add them as negative keywords. Also check if your bids have drifted up due to bid automation or competitive pressure.',
        evaluate: (m, c) =>
            c?.hasComparison &&
            isRising(c.changes?.ppcSpend?.percentChange) &&
            isFlat(c.changes?.sales?.percentChange),
        buildReason: (m, c) =>
            `PPC spend increased ${c.changes.ppcSpend.percentChange?.toFixed(1)}% but revenue is flat (${c.changes.sales.percentChange?.toFixed(1)}% change). Increasing ad budget is not translating to more sales — search term waste is the likely culprit.`,
    },
    {
        id: 'dropping_sessions_rising_acos',
        priority: 1,
        shortLabel: 'Losing Organic Rank',
        message: 'Traffic is declining while ad costs are rising — this is the signature pattern of losing organic ranking. Your product is becoming less visible in organic search results, forcing you to spend more on ads to compensate. Conduct a full keyword ranking audit, check for indexing issues, review any recent listing changes that may have affected relevance, and ensure your inventory levels haven\'t caused ranking penalties.',
        evaluate: (m, c) =>
            c?.hasComparison &&
            isDropping(c.changes?.sessions?.percentChange) &&
            isAcosRising(c.changes?.acos),
        buildReason: (m, c) =>
            `Sessions dropped ${Math.abs(c.changes.sessions.percentChange).toFixed(1)}% while ACoS rose by ${c.changes.acos.delta?.toFixed(1)} percentage points. Organic visibility is eroding and paid ads are becoming more expensive to compensate.`,
    },
];

// ---------------------------------------------------------------------------
// Main evaluation function
// ---------------------------------------------------------------------------

/**
 * Evaluate all scenarios against a product's metrics and comparison data.
 *
 * @param {Object} metrics
 *   { sessions, pageViews, cvr, buyBoxPercentage, unitsSold, sales,
 *     ppcSpend, ppcSales, acos, tacos, ppcSpendPctRev }
 * @param {Object|null} comparison
 *   { hasComparison, changes: { sessions, pageViews, unitsSold, sales,
 *     ppcSpend, acos } } where each change has { delta, percentChange }
 * @returns {Array<{ id, shortLabel, message, reason, priority }>}
 */
function evaluateScenarios(metrics, comparison) {
    if (!metrics) return [];

    const matched = [];

    for (const scenario of SCENARIOS) {
        try {
            if (scenario.evaluate(metrics, comparison)) {
                matched.push({
                    id: scenario.id,
                    shortLabel: scenario.shortLabel,
                    message: scenario.message,
                    reason: scenario.buildReason(metrics, comparison),
                    priority: scenario.priority,
                });
            }
        } catch (_) {
            // Guard against missing fields — skip scenario silently
        }
    }

    matched.sort((a, b) => a.priority - b.priority);
    return matched;
}

/**
 * Build the normalised metrics object that evaluateScenarios expects.
 *
 * Accepts the heterogeneous shapes produced by:
 *  - OptimizationService  (performance + profitability maps)
 *  - ProductDetails.jsx   (performance + profitabilityProduct)
 *
 * @param {Object} opts
 * @param {Object} opts.performance  - { sessions, pageViews, conversionRate, buyBoxPercentage, unitsSold, sales, ppcSpend, ppcSales, acos }
 * @param {Object} [opts.profitability] - { sales, ads (ppcSpend), unitsSold }  (from EconomicsMetrics / profitabilityProduct)
 * @returns {Object} normalised metrics
 */
function buildMetrics({ performance = {}, profitability = null }) {
    const sessions        = performance.sessions        ?? 0;
    const pageViews       = performance.pageViews       ?? 0;
    const cvr             = performance.conversionRate   ?? 0;
    const buyBoxPercentage = performance.buyBoxPercentage ?? 100;
    const unitsSold       = profitability?.unitsSold ?? performance.unitsSold ?? 0;
    const sales           = profitability?.sales     ?? performance.sales     ?? 0;
    const ppcSpend        = profitability?.ads       ?? performance.ppcSpend  ?? 0;
    const ppcSales        = performance.ppcSales     ?? 0;
    const acos            = performance.acos         ?? (ppcSales > 0 ? (ppcSpend / ppcSales) * 100 : 0);
    const tacos           = sales > 0 ? (ppcSpend / sales) * 100 : 0;
    const ppcSpendPctRev  = tacos; // same formula, different threshold range

    return {
        sessions, pageViews, cvr, buyBoxPercentage, unitsSold,
        sales, ppcSpend, ppcSales, acos, tacos, ppcSpendPctRev,
    };
}

module.exports = {
    KPI_RANGES,
    TREND_THRESHOLDS,
    SCENARIOS,
    evaluateScenarios,
    buildMetrics,
    isRising,
    isFlat,
    isDropping,
    isAcosRising,
};
