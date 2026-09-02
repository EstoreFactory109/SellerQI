/**
 * TaskOpportunityGroupsService
 *
 * The single ranking authority shared by the Dashboard's "Top things to fix" and
 * the Tasks page's High impact / Quick wins buckets.
 *
 * Why this exists: the two surfaces were built independently and disagreed in
 * four ways — different data sources (IssuesDataChunks vs TaskItem), different
 * ranking bases (aggregate-per-type vs per-item), different coverage (10 issue
 * types vs 39), and different vintages (stored AI snapshot vs live). A seller
 * would see "Keywords spending money with zero sales — $187.41" on the dashboard
 * and a $13.98 keyword row on Tasks, with the two pages ordering the same
 * problems differently and each showing problems the other never mentioned.
 *
 * The fix is one source of truth: TaskItem. The Dashboard now shows GROUPS of
 * tasks (collapsed by category + errorType) and the Tasks page shows the
 * individual tasks inside those groups, so a group's total is by construction
 * exactly the sum of the rows beneath it, and neither surface can be blind to a
 * category the other highlights.
 *
 * LLM-free and network-free; TopOpportunitiesService layers the AI prose step
 * on top of the groups produced here.
 */

const logger = require('../../utils/Logger.js');
const TaskItem = require('../../models/MCP/TaskItemModel.js');
const {
    normalizeErrorType,
    getTaskPriorityMeta,
    IMPACT_WEIGHT
} = require('./TaskPrioritizationService.js');
const {
    loadCampaignAsinIndex,
    attributeAdsTasksToAsins
} = require('./AdsProductAttributionService.js');
const { capProfitOpportunity } = require('./RecoverableAmountUtils.js');

// Bounds the payload handed to the LLM.
const MAX_EXAMPLES_PER_GROUP = 5;
const MAX_GROUPS = 12;

const CONFIDENCE = {
    MEASURED: 'measured',
    ESTIMATED: 'estimated'
};

/**
 * Seller-facing copy per issue type, keyed `<category>:<normalizedErrorType>`.
 *
 * The ten entries marked "(existing dashboard copy)" are carried over VERBATIM
 * from OpportunityRankingService.GROUP_DEFINITIONS so the wording sellers
 * already see on the dashboard does not change. Note the two modules name the
 * same issue differently (`inventory/unfulfillable` there vs
 * `inventory/unfulfillable_inventory` here, `conversion/buybox_loss` vs
 * `conversion/no_buybox`, `sponsoredAds/high_acos_campaign` vs
 * `sponsoredAds/high_acos`) — these keys use the stored TaskItem errorType.
 */
const GROUP_COPY = {
    // ── Profitability ──
    'profitability:negative_profit': {
        title: 'Products losing money on every sale',                       // (existing dashboard copy)
        action: 'Reprice, cut ad spend, or stop selling these ASINs'
    },
    'profitability:low_margin': {
        title: 'Products earning below a healthy 10% margin',                // (existing dashboard copy)
        action: 'Review pricing and fees to lift these toward a 10% margin'
    },
    'profitability:profitability_issue': {
        title: 'Products with unresolved profitability problems',
        action: 'Review pricing, fees and ad spend on these ASINs'
    },

    // ── Sponsored Ads ──
    'sponsoredAds:wasted_spend_keyword': {
        title: 'Keywords spending money with zero sales',                    // (existing dashboard copy)
        action: 'Pause these keywords — the spend is pure waste'
    },
    'sponsoredAds:search_term_zero_sales': {
        title: 'Search terms getting clicks but no sales',                   // (existing dashboard copy)
        action: 'Add these as negative keywords to stop the bleed'
    },
    'sponsoredAds:high_acos': {
        title: 'Campaigns spending too much per sale (ACOS above 40%)',      // (existing dashboard copy)
        action: 'Lower bids or tighten targeting on these campaigns'
    },
    'sponsoredAds:auto_campaign_migration_needed': {
        title: 'Winning auto-campaign search terms not yet in a manual campaign', // (existing dashboard copy)
        action: 'Move these proven search terms into manual campaigns to scale them',
        isGrowthOpportunity: true
    },
    // Retired alias of wasted_spend_keyword; still present on stored tasks.
    'sponsoredAds:keyword_no_sales': {
        title: 'Keywords spending money with zero sales',
        action: 'Pause these keywords — the spend is pure waste'
    },
    'sponsoredAds:extreme_high_acos': {
        title: 'Targets losing money on every advertised sale',
        action: 'Pause these targets or cut their bids sharply'
    },
    'sponsoredAds:no_sales_high_spend': {
        title: 'Ad targets spending with nothing to show for it',
        action: 'Pause these targets and review keyword relevance'
    },
    'sponsoredAds:marginal_profit': {
        title: 'Ad targets running at thin advertising efficiency',
        action: 'Trim bids gradually and watch the effect on sales'
    },
    'sponsoredAds:low_ctr': {
        title: 'Ads shoppers see but rarely click',
        action: 'Improve the main image, title and price to earn the click'
    },
    'sponsoredAds:ppc_optimization': {
        title: 'Ad targets needing a closer look',
        action: 'Review these targets against their performance data'
    },

    // ── Inventory ──
    'inventory:unfulfillable_inventory': {
        title: 'Unsellable stock sitting in FBA',                            // (existing dashboard copy)
        action: 'File removals or dispose — this is dead capital'
    },
    'inventory:long_term_storage_fees': {
        title: 'Long-term storage fees accruing on aged stock',              // (existing dashboard copy)
        action: 'Liquidate or remove aged inventory — this fee recurs monthly'
    },
    'inventory:stranded_inventory': {
        title: 'Stranded stock in FBA that cannot be sold',                  // (existing dashboard copy)
        action: 'Fix the listing problem to make this inventory sellable again'
    },
    'inventory:inbound_non_compliance': {
        title: 'Inbound shipments held up by compliance problems',
        action: 'Resolve the labelling or quantity issue so the stock can be received'
    },
    'inventory:replenishment_needed': {
        title: 'Products about to run out of stock',
        action: 'Create an FBA shipment before these go unavailable'
    },

    // ── Conversion ──
    'conversion:no_buybox': {
        title: 'Products not winning the Buy Box',                           // (existing dashboard copy)
        action: 'Fix price/stock/seller-health so these win the Buy Box back'
    },
    'conversion:insufficient_images': {
        title: 'Listings with too few images to convince a buyer',
        action: 'Add images until each listing has at least seven'
    },
    'conversion:missing_video': {
        title: 'Listings with no product video',
        action: 'Add a short demonstration video to these listings'
    },
    'conversion:missing_aplus_content': {
        title: 'Listings without A+ content',
        action: 'Build A+ content for these listings'
    },
    'conversion:missing_brand_story': {
        title: 'Listings without a Brand Story',
        action: 'Add the Brand Story module to these listings'
    },
    'conversion:low_star_rating': {
        title: 'Products whose rating is driving buyers away',
        action: 'Address the complaints behind the low rating'
    },
    'conversion:insufficient_reviews': {
        title: 'Products with too few reviews to build trust',
        action: 'Enrol these in review programmes to build social proof'
    },

    // ── Account health ──
    'account:accountStatus': {
        title: 'Your selling account is at risk',
        action: 'Resolve this with Amazon immediately — it can stop all sales'
    },
    'account:PolicyViolations': {
        title: 'Policy violations on your account',
        action: 'Fix or appeal each violation before it escalates'
    },
    'account:a_z_claims': {
        title: 'A-to-Z claims counting against you',
        action: 'Respond to open claims and fix the cause'
    },
    'account:orderWithDefectsStatus': {
        title: 'Order defect rate above Amazon\'s limit',
        action: 'Work the defect causes down below the threshold'
    },
    'account:lateShipmentRateStatus': {
        title: 'Late shipment rate above Amazon\'s limit',
        action: 'Tighten handling times to bring this back in range'
    },
    'account:CancellationRate': {
        title: 'Cancellation rate above Amazon\'s limit',
        action: 'Keep stock accurate so orders are not cancelled'
    },
    'account:NCX': {
        title: 'Products flagged for negative customer experience',
        action: 'Fix the product or listing problems driving complaints'
    },
    'account:negativeFeedbacks': {
        title: 'Negative seller feedback needing a response',
        action: 'Respond to each, and request removal where the rules allow'
    },
    'account:validTrackingRateStatus': {
        title: 'Valid tracking rate below Amazon\'s requirement',
        action: 'Add valid tracking to every shipment'
    },
    'account:responseUnder24HoursCount': {
        title: 'Buyer messages answered too slowly',
        action: 'Reply to buyer messages within 24 hours'
    }
};

// Ranking copy for listing/search issues. These share one template per section
// because the fix is the same shape regardless of which check failed.
const RANKING_SECTION_COPY = {
    titleresult: { label: 'title', action: 'Rewrite these titles to meet Amazon\'s rules' },
    bulletpoints: { label: 'bullet points', action: 'Rewrite these bullet points to meet Amazon\'s rules' },
    description: { label: 'description', action: 'Rewrite these descriptions to meet Amazon\'s rules' }
};

const RANKING_CHECK_LABEL = {
    char_limit: 'over or under the character limit',
    restricted_words: 'containing restricted words',
    special_characters: 'containing special characters',
    word_repetition: 'repeating the same word too often',
    capitalization: 'with incorrect capitalisation'
};

/**
 * Copy for one issue type, falling back to generated text for ranking checks and
 * finally to a safe generic label — so a new errorType can never produce a blank
 * dashboard row.
 */
function getGroupCopy(category, normalizedType) {
    const explicit = GROUP_COPY[`${category}:${normalizedType}`];
    if (explicit) return explicit;

    if (category === 'ranking') {
        if (normalizedType === 'backend_keywords_char_limit') {
            return { title: 'Backend keywords over Amazon\'s byte limit', action: 'Trim backend search terms to fit the limit' };
        }
        if (normalizedType === 'duplicate_words') {
            return { title: 'Titles repeating the same word', action: 'Remove duplicate words from these titles' };
        }
        const [section, ...rest] = normalizedType.split('_');
        const sectionCopy = RANKING_SECTION_COPY[section];
        const checkLabel = RANKING_CHECK_LABEL[rest.join('_')];
        if (sectionCopy && checkLabel) {
            return {
                title: `Listings with a ${sectionCopy.label} ${checkLabel}`,
                action: sectionCopy.action
            };
        }
    }

    return {
        title: `${category} issues needing attention`,
        action: 'Review these items and resolve the underlying problem'
    };
}

const toCents = (n) => Math.round((Number(n) || 0) * 100) / 100;

/**
 * The shared ordering rule. Real recoverable money always outranks a weight,
 * because money is measured while a weight is only a judgement about how much a
 * class of problem usually costs.
 *
 * The client mirrors this precedence for individual tasks in
 * client/src/utils/taskBuckets.js (compareByImpact). Keep the two in step — that
 * shared precedence is what makes the Dashboard and the Tasks page agree.
 */
function compareByImpact(a, b) {
    const aMoney = a.totalAmount > 0;
    const bMoney = b.totalAmount > 0;
    if (aMoney !== bMoney) return aMoney ? -1 : 1;
    if (aMoney && bMoney && b.totalAmount !== a.totalAmount) return b.totalAmount - a.totalAmount;

    if (b.impactWeight !== a.impactWeight) return b.impactWeight - a.impactWeight;

    // Equal standing — prefer measured dollars, then the broader problem.
    const aMeasured = a.confidence === CONFIDENCE.MEASURED;
    const bMeasured = b.confidence === CONFIDENCE.MEASURED;
    if (aMeasured !== bMeasured) return aMeasured ? -1 : 1;
    if (b.count !== a.count) return b.count - a.count;

    return String(a.id).localeCompare(String(b.id));
}

/**
 * A useful label for one task inside a group example.
 */
function getExampleLabel(task) {
    if (task.errorCategory === 'sponsoredAds') {
        // productName already encodes "Keyword: x" / "Search Term: x" / "Campaign: x".
        return task.productName || task.asin;
    }
    return task.productName || task.asin;
}

/**
 * Collapse tasks into ranked opportunity groups.
 *
 * Pure function — the unit-testable core. Give it annotated or raw tasks; the
 * priority metadata is (re)derived here so callers can't pass a stale weight.
 *
 * @param {Array} tasks - TaskItem-shaped objects
 * @param {Object} [options]
 * @param {number} [options.maxGroups]
 * @returns {{groups: Array, totalRecoverableAmount: number, tasksConsidered: number}}
 */
function buildGroupsFromTasks(tasks, options = {}) {
    const maxGroups = options.maxGroups || MAX_GROUPS;

    if (!Array.isArray(tasks) || tasks.length === 0) {
        return { groups: [], totalRecoverableAmount: 0, tasksConsidered: 0 };
    }

    const byKey = new Map();

    for (const task of tasks) {
        if (!task || !task.errorCategory || !task.errorType) continue;

        const normalizedType = normalizeErrorType(task.errorType);
        const key = `${task.errorCategory}:${normalizedType}`;

        if (!byKey.has(key)) {
            const copy = getGroupCopy(task.errorCategory, normalizedType);
            byKey.set(key, {
                id: key,
                category: task.errorCategory,
                issueType: normalizedType,
                title: copy.title,
                action: copy.action,
                isGrowthOpportunity: !!copy.isGrowthOpportunity,
                impactWeight: IMPACT_WEIGHT[key] ?? getTaskPriorityMeta(task).impactWeight,
                count: 0,
                totalAmount: 0,
                anyEstimated: false,
                members: []
            });
        }

        const group = byKey.get(key);
        const amount = Number(task.amount) || 0;
        group.count += 1;
        group.totalAmount += amount;
        if (task.amountIsEstimated && amount > 0) group.anyEstimated = true;
        group.members.push({ label: getExampleLabel(task), amount: toCents(amount) });
    }

    const groups = [...byKey.values()].map(g => {
        g.members.sort((a, b) => b.amount - a.amount);
        return {
            id: g.id,
            category: g.category,
            issueType: g.issueType,
            title: g.title,
            action: g.action,
            isGrowthOpportunity: g.isGrowthOpportunity,
            impactWeight: g.impactWeight,
            count: g.count,
            totalAmount: toCents(g.totalAmount),
            // A group is only as trustworthy as its softest dollar.
            confidence: g.anyEstimated ? CONFIDENCE.ESTIMATED : CONFIDENCE.MEASURED,
            topExamples: g.members.slice(0, MAX_EXAMPLES_PER_GROUP)
        };
    });

    groups.sort(compareByImpact);

    // Total across ALL groups, not just the ranked slice, so it equals the sum of
    // every task's amount — which is exactly what the Tasks page displays.
    const totalRecoverableAmount = toCents(groups.reduce((sum, g) => sum + g.totalAmount, 0));

    return {
        groups: groups.slice(0, maxGroups),
        totalRecoverableAmount,
        tasksConsidered: tasks.length
    };
}

/**
 * Load an account's tasks and build ranked groups from them.
 *
 * Tasks are stored per user, not per marketplace (TaskItem has no country/region),
 * so country/region are accepted only for logging symmetry with the caller.
 *
 * @param {string} userId
 * @param {string} [country]
 * @param {string} [region]
 */
async function getTaskOpportunityGroups(userId, country = null, region = null) {
    const startTime = Date.now();

    try {
        const tasks = await TaskItem.find({ userId })
            .select('taskId productName asin errorCategory errorType amount amountIsEstimated status')
            .lean();

        const result = buildGroupsFromTasks(tasks);
        const duration = Date.now() - startTime;

        logger.info('[TaskOpportunityGroups] Built groups from tasks', {
            userId,
            country,
            region,
            tasksConsidered: result.tasksConsidered,
            groups: result.groups.length,
            totalRecoverableAmount: result.totalRecoverableAmount,
            duration
        });

        return { success: true, ...result, duration };
    } catch (error) {
        logger.error('[TaskOpportunityGroups] Error building groups', {
            error: error.message,
            stack: error.stack,
            userId
        });
        return { success: false, error: error.message };
    }
}

// ── Product-level rollup ─────────────────────────────────────────────────────
// The same tasks, grouped by ASIN instead of by issue type, answering "which
// product should I fix and what do I gain" rather than "which problem is
// biggest". Shares compareByImpact with the issue-level view so the two orderings
// cannot drift.

const MAX_PRODUCTS = 8;
const MAX_TASKS_PER_PRODUCT = 6;

// Sponsored-ads tasks store an ads entity id (keywordId/searchTerm) in `asin`,
// never a real ASIN, so they can only reach a product through attribution.
//
// This is decided by CATEGORY, not by the shape of the string: a real account has
// a search term that is itself an ASIN ("b07fmhwfwt"), which a shape test happily
// mistakes for a product — attributing ad waste to a product twice and inventing
// money that isn't there.
const carriesRealAsin = (task) =>
    task.errorCategory !== 'sponsoredAds' &&
    typeof task.asin === 'string' &&
    task.asin !== 'N/A' &&
    task.asin !== 'ACCOUNT';

/**
 * Roll tasks up per product, ranked by potential profit impact.
 *
 * Two rules make this figure honest, both learned the hard way:
 *
 * 1. A product's profit gap and its wasted ad spend DO NOT ADD UP. `netProfit` is
 *    already `sales - adsSpend - totalFees`, so the loss has the waste baked in;
 *    removing the waste is part of closing the gap. Summing them reported $146.57
 *    for a product whose breakeven was $122.29 — an impossible number. They are
 *    combined with capProfitOpportunity (take the larger) instead.
 * 2. Capital locked in unsellable stock is not profit and is tracked separately,
 *    because a single ASIN's $7,902 of dead stock would otherwise outrank every
 *    real profit issue by 62x.
 *
 * Ranking uses the capped profit figure alone. A product's current margin is
 * deliberately not an input: `negative_profit`'s amount already IS that loss.
 *
 * @param {Array} tasks - TaskItem-shaped objects (annotated or not)
 * @param {Object} [options]
 * @param {Map<string, {amount: number, taskCount: number}>} [options.adsByAsin] -
 *   from AdsProductAttributionService.attributeAdsTasksToAsins
 * @param {number} [options.maxProducts]
 * @returns {{products, potentialProfitImpact, capitalTiedUp, unattributableAmount, productsConsidered}}
 */
function buildProductRollupFromTasks(tasks, options = {}) {
    const maxProducts = options.maxProducts || MAX_PRODUCTS;
    const adsByAsin = options.adsByAsin instanceof Map ? options.adsByAsin : new Map();

    if (!Array.isArray(tasks) || tasks.length === 0) {
        return {
            products: [],
            potentialProfitImpact: 0,
            capitalTiedUp: 0,
            unattributableAmount: 0,
            productsConsidered: 0
        };
    }

    const byAsin = new Map();
    const ensure = (asin) => {
        if (!byAsin.has(asin)) {
            byAsin.set(asin, {
                asin,
                productName: null,
                // The profit gap from this product's OWN tasks, split by how much we
                // trust each figure. Ad waste is held apart so it can be capped
                // against this rather than added to it.
                measuredGap: 0,
                estimatedGap: 0,
                adWaste: 0,
                capitalAmount: 0,
                taskCount: 0,
                // Kept separate because an ad issue split across several products
                // counts once per product — a soft number that shouldn't be mixed
                // into the exact count of issues sitting directly on this ASIN.
                adsTaskCount: 0,
                categories: new Set(),
                impactWeight: 0,
                topTasks: []
            });
        }
        return byAsin.get(asin);
    };

    let unattributableAmount = 0;

    for (const task of tasks) {
        if (!task || !task.errorCategory || !task.errorType) continue;

        // Ads tasks are folded in via attribution below, not by their own `asin`.
        if (!carriesRealAsin(task)) {
            if (task.errorCategory !== 'sponsoredAds') unattributableAmount += Number(task.amount) || 0;
            continue;
        }

        const p = ensure(task.asin);
        const amount = Number(task.amount) || 0;
        if (!p.productName && task.productName) p.productName = task.productName;
        if (task.amountIsEstimated && amount > 0) p.estimatedGap += amount;
        else p.measuredGap += amount;
        p.capitalAmount += Number(task.capitalAmount) || 0;
        p.taskCount += 1;
        p.categories.add(task.errorCategory);

        const weight = IMPACT_WEIGHT[`${task.errorCategory}:${normalizeErrorType(task.errorType)}`]
            ?? getTaskPriorityMeta(task).impactWeight;
        if (weight > p.impactWeight) p.impactWeight = weight;

        p.topTasks.push({
            taskId: task.taskId,
            errorCategory: task.errorCategory,
            errorType: normalizeErrorType(task.errorType),
            amount: toCents(amount),
            capitalAmount: toCents(Number(task.capitalAmount) || 0),
            effortMinutes: task.effortMinutes ?? getTaskPriorityMeta(task).effortMinutes
        });
    }

    // Attributed ad waste is held in its own bucket, NOT added to the gap.
    for (const [asin, ads] of adsByAsin) {
        const p = ensure(asin);
        p.adWaste += Number(ads.amount) || 0;
        p.adsTaskCount += Number(ads.taskCount) || 0;
        p.categories.add('sponsoredAds');
        const adsWeight = IMPACT_WEIGHT['sponsoredAds:wasted_spend_keyword'] || 0;
        if (adsWeight > p.impactWeight) p.impactWeight = adsWeight;
    }

    const products = [...byAsin.values()].map(p => {
        p.topTasks.sort((a, b) => b.amount - a.amount);

        const profitGap = toCents(p.measuredGap + p.estimatedGap);
        const adWaste = toCents(p.adWaste);
        const profitImpact = toCents(capProfitOpportunity({ profitGap, adWaste }));

        return {
            asin: p.asin,
            productName: p.productName || p.asin,
            // The headline per product: capped, so it can never exceed what is
            // actually obtainable for this ASIN.
            profitImpact,
            // Kept for display: "of which ~$X is wasted ad spend" reads as a
            // component of profitImpact rather than an addition to it.
            profitGap,
            adWasteComponent: adWaste,
            capitalTiedUp: toCents(p.capitalAmount),
            // Inferred whenever any part of the figure is inferred — ad attribution
            // is always inference, and some gaps are estimates too.
            amountIsEstimated: p.estimatedGap > 0 || adWaste > 0,
            taskCount: p.taskCount,
            adsTaskCount: p.adsTaskCount,
            categories: [...p.categories],
            impactWeight: p.impactWeight,
            topTasks: p.topTasks.slice(0, MAX_TASKS_PER_PRODUCT)
        };
    });

    // Reuse the issue-level comparator by mapping onto the fields it reads, so
    // both views order money-first by exactly the same rule.
    products.sort((a, b) => compareByImpact(
        { id: a.asin, totalAmount: a.profitImpact, impactWeight: a.impactWeight, confidence: a.amountIsEstimated ? CONFIDENCE.ESTIMATED : CONFIDENCE.MEASURED, count: a.taskCount },
        { id: b.asin, totalAmount: b.profitImpact, impactWeight: b.impactWeight, confidence: b.amountIsEstimated ? CONFIDENCE.ESTIMATED : CONFIDENCE.MEASURED, count: b.taskCount }
    ));

    return {
        products: products.slice(0, maxProducts),
        // Account-wide and de-duplicated: the sum of each product's CAPPED figure,
        // across every product including those below the display cut. This is why
        // the headline can no longer be a sum of issue-type groups — the overlap it
        // removes is per-ASIN and crosses issue types.
        potentialProfitImpact: toCents(
            products.reduce((s, p) => s + p.profitImpact, 0) + unattributableAmount
        ),
        capitalTiedUp: toCents(products.reduce((s, p) => s + p.capitalTiedUp, 0)),
        unattributableAmount: toCents(unattributableAmount),
        productsConsidered: products.length
    };
}

/**
 * ASIN → product title from the seller's catalogue.
 *
 * Needed because a product can reach the ranking purely through attributed ad
 * waste, in which case no task supplied a name. Returns an empty map on any
 * failure — a missing title degrades to showing the ASIN, never an error.
 */
async function loadProductNameMap(userId, country) {
    try {
        const User = require('../../models/user-auth/userModel.js');
        const Seller = require('../../models/user-auth/sellerCentralModel.js');

        const user = await User.findById(userId).select('sellerCentral').lean();
        if (!user?.sellerCentral) return new Map();

        const seller = await Seller.findById(user.sellerCentral).select('sellerAccount').lean();
        const accounts = seller?.sellerAccount || [];
        const account = accounts.find(a => a.country === country) || accounts[0];

        const map = new Map();
        for (const p of account?.products || []) {
            if (p?.asin && p.itemName) map.set(p.asin, p.itemName);
        }
        return map;
    } catch (err) {
        logger.warn('[TopProductsToFix] product name lookup unavailable', { message: err.message });
        return new Map();
    }
}

/**
 * Load an account's tasks, attribute its ad waste, and rank its products.
 *
 * country/region are required here (unlike the issue-level groups) because the
 * campaign→ASIN index is marketplace-scoped even though TaskItem is not.
 */
async function getTopProductsToFix(userId, country, region, options = {}) {
    const startTime = Date.now();

    try {
        // Project only the two renderData fields ad attribution needs. Pulling the
        // whole blob would drag every keyword/search-term string and metric along
        // with it — needless weight on an account with tens of thousands of tasks.
        const tasks = await TaskItem.find({ userId })
            .select('taskId productName asin errorCategory errorType amount amountIsEstimated capitalAmount renderData.campaignId renderData.campaignName status')
            .lean();

        if (tasks.length === 0) {
            return { success: true, products: [], potentialProfitImpact: 0, capitalTiedUp: 0, unattributableAmount: 0, productsConsidered: 0, tasksConsidered: 0 };
        }

        // Non-fatal: without the index, ads waste simply stays unattributed rather
        // than the whole product view failing.
        let adsByAsin = new Map();
        let adsStats = null;
        try {
            const index = await loadCampaignAsinIndex(userId, country, region);
            const adsTasks = tasks.filter(t => t.errorCategory === 'sponsoredAds');
            adsStats = attributeAdsTasksToAsins(adsTasks, index);
            adsByAsin = adsStats.byAsin;
        } catch (err) {
            logger.warn('[TopProductsToFix] ad attribution unavailable; continuing without it', { message: err.message });
        }

        const result = buildProductRollupFromTasks(tasks, { adsByAsin, maxProducts: options.maxProducts });

        // Fill in titles for products that only surfaced through ad attribution.
        const nameMap = await loadProductNameMap(userId, country);
        let unnamed = 0;
        for (const p of result.products) {
            if (p.productName === p.asin) {
                const name = nameMap.get(p.asin);
                if (name) p.productName = name;
                else {
                    unnamed++;
                    // Advertised but absent from the catalogue — worth saying plainly,
                    // since spending on an ASIN you no longer list is its own problem.
                    p.notInCatalogue = true;
                }
            }
        }

        logger.info('[TopProductsToFix] Built product rollup', {
            userId,
            country,
            region,
            tasksConsidered: tasks.length,
            productsConsidered: result.productsConsidered,
            potentialProfitImpact: result.potentialProfitImpact,
            capitalTiedUp: result.capitalTiedUp,
            adsAttributed: adsStats?.attributedAmount ?? 0,
            adsUnattributed: adsStats?.unattributedAmount ?? 0,
            adsSplitAcrossProducts: adsStats?.splitTasks ?? 0,
            productsNotInCatalogue: unnamed,
            duration: Date.now() - startTime
        });

        return {
            success: true,
            ...result,
            tasksConsidered: tasks.length,
            adsAttribution: adsStats
                ? {
                    attributedAmount: adsStats.attributedAmount,
                    unattributedAmount: adsStats.unattributedAmount,
                    splitTasks: adsStats.splitTasks
                }
                : null
        };
    } catch (error) {
        logger.error('[TopProductsToFix] Error building product rollup', {
            error: error.message,
            stack: error.stack,
            userId
        });
        return { success: false, error: error.message };
    }
}

module.exports = {
    getTaskOpportunityGroups,
    buildGroupsFromTasks,
    getTopProductsToFix,
    buildProductRollupFromTasks,
    compareByImpact,
    getGroupCopy,
    GROUP_COPY,
    CONFIDENCE,
    MAX_EXAMPLES_PER_GROUP,
    MAX_GROUPS,
    MAX_PRODUCTS,
    MAX_TASKS_PER_PRODUCT
};
