/**
 * TopProductsService
 *
 * Narrates the "top products to fix" ranking with the OpenAI API.
 *
 * Sibling of TopOpportunitiesService, and deliberately built the same way:
 * our own code does all the arithmetic (TaskOpportunityGroupsService rolls the
 * seller's tasks up per ASIN and attributes ad waste), and the model only writes
 * the sentence explaining why a product is worth fixing first. Sending 156 tasks
 * would be ~500k tokens; sending the top 8 rolled-up products is ~400.
 *
 * The model never sees or restates a figure it could get wrong: amounts, counts
 * and ordering all come from the rollup, and any product id it invents is dropped.
 * If OpenAI is unavailable or returns something unusable, deterministic template
 * copy is used instead — this feature never hard-fails on the LLM.
 */

const OpenAI = require('openai');
const logger = require('../../utils/Logger.js');
const TopProducts = require('../../models/system/TopProductsModel.js');
const TaskOpportunityGroupsService = require('../Calculations/TaskOpportunityGroupsService.js');
const { getCurrencyCode, formatMoneyForProse } = require('../../utils/marketplaceCurrency.js');

const TOP_PRODUCTS_MODEL = process.env.TOP_PRODUCTS_MODEL || 'gpt-4o-mini';

const MAX_SELECTIONS = 6;
const MAX_OUTPUT_TOKENS = 1200;

// Cost backstop, mirroring TopOpportunitiesService: the integration flow can fire
// several times per account, and each run would otherwise mean another paid call.
const MIN_REGENERATE_INTERVAL_HOURS = Number(process.env.TOP_PRODUCTS_MIN_INTERVAL_HOURS) || 6;
const THROTTLE_EXEMPT_SOURCES = ['manual'];

function getOpenAIClient() {
    const apiKey = process.env.OPENAPI_KEY || process.env.OPENAI_API_KEY;
    if (!apiKey) {
        logger.warn('[TopProducts] No OpenAI key configured; using deterministic copy');
        return null;
    }
    try {
        return new OpenAI({ apiKey });
    } catch (err) {
        logger.error('[TopProducts] Failed to initialize OpenAI client', { message: err.message });
        return null;
    }
}

const SYSTEM_PROMPT = `You are an Amazon seller profit advisor. You are given a PRE-RANKED list of the seller's products, each with the profit obtainable by fixing that product's problems, already computed from their real Amazon data.

For each product, return TWO SEPARATE fields:
- "why": one or two plain sentences a non-technical seller understands, explaining what is wrong with this product and why it is costing them. Do NOT put the next step here.
- "action": the single concrete next step, phrased as an instruction ("Cut the bids on...", "Rewrite the title to..."). Never leave this empty.

STRICT RULES:
1. Use ONLY the productId values provided. Never invent a product.
2. Never invent, recalculate, or restate the money figures differently. The amounts given are final.
3. CURRENCY: amounts are in the currency given as "currencyCode" — NOT necessarily US dollars. Do NOT write any currency symbol or code. Describe impact in words and let the app render the figure.
4. "profitImpact" is the profit obtainable by fixing this product. "adWasteShare" is how much of that is wasted advertising spend we ATTRIBUTED to this product by campaign rather than measured directly — if it is most of profitImpact, say so in plain words ("largely from ad spend we've attributed to it") rather than implying certainty. Never add adWasteShare to profitImpact; it is already inside it.
4a. "capitalTiedUp" is money locked in unsellable stock. It is NOT profit — describe it as capital or cash tied up, never as profit or savings.
5. "issueCategories" tells you what kinds of problems the product has. Lead with the category carrying the most money.
6. If "notInCatalogue" is true, that product is being advertised but is not in the seller's active listings — say that plainly, it is usually the real problem.
7. "action" must be one concrete next step the seller can actually do.

Return ONLY valid JSON in this exact shape:
{"selections":[{"productId":"...","rank":1,"why":"...","action":"..."}]}`;

/**
 * Compact the rollup for the prompt — drop everything the model doesn't need.
 */
function buildPromptPayload(products) {
    return products.map(p => ({
        productId: p.asin,
        name: (p.productName || p.asin).slice(0, 80),
        profitImpact: p.profitImpact,
        adWasteShare: p.adWasteComponent,
        capitalTiedUp: p.capitalTiedUp,
        issueCount: p.taskCount + (p.adsTaskCount || 0),
        issueCategories: p.categories,
        notInCatalogue: !!p.notInCatalogue
    }));
}

/**
 * The next step to take on a product, derived from what it actually suffers from.
 *
 * Also the fallback when the model omits "action" — it tends to fold the next step
 * into "why" and leave the field empty, and an empty call-to-action is worse than
 * a plain one.
 */
function defaultActionForProduct(product) {
    if (product.notInCatalogue) {
        return 'Relist this ASIN or stop advertising it — you are paying for traffic to a product you do not list.';
    }
    const cats = product.categories || [];
    if (cats.includes('profitability')) return 'Review this product\'s price and costs until it clears a healthy margin.';
    if (cats.includes('sponsoredAds')) return 'Pause the wasted keywords and cut bids on this product\'s campaigns.';
    if (cats.includes('inventory')) return 'Clear or relist this product\'s stuck FBA stock.';
    if (cats.includes('conversion')) return 'Improve this listing\'s images and content so more visitors buy.';
    if (cats.includes('ranking')) return 'Fix this listing\'s title and bullet points so it ranks properly.';
    return 'Open this product\'s tasks and work through them highest-value first.';
}

/**
 * Merge a model selection back onto its product, so every number stays ours and
 * only the prose comes from the LLM.
 */
function mergeSelectionWithProduct(selection, product, rank) {
    return {
        asin: product.asin,
        rank,
        productName: product.productName || product.asin,
        profitImpact: product.profitImpact,
        profitGap: product.profitGap,
        adWasteComponent: product.adWasteComponent,
        capitalTiedUp: product.capitalTiedUp,
        amountIsEstimated: !!product.amountIsEstimated,
        taskCount: product.taskCount,
        adsTaskCount: product.adsTaskCount || 0,
        categories: product.categories || [],
        notInCatalogue: !!product.notInCatalogue,
        why: String(selection?.why || '').trim(),
        action: String(selection?.action || '').trim() || defaultActionForProduct(product)
    };
}

/**
 * Deterministic copy, used when the AI step is unavailable or untrustworthy.
 * @param {Array} products
 * @param {number} [limit]
 * @param {string} [country] - so money in the prose uses the marketplace currency
 */
function buildDeterministicSelections(products, limit = MAX_SELECTIONS, country = null) {
    return products.slice(0, limit).map((product, idx) => {
        const issues = product.taskCount + (product.adsTaskCount || 0);
        const money = formatMoneyForProse(product.profitImpact, country);

        let why;
        if (product.notInCatalogue) {
            why = `This ASIN is being advertised but isn't in your active listings, and about ${money} is tied up in it.`;
        } else if (product.profitImpact > 0) {
            const mostlyAds = (product.adWasteComponent || 0) >= (product.profitGap || 0);
            why = `${issues} issue(s) across ${(product.categories || []).join(', ') || 'this product'}, worth about ${money}${mostlyAds ? ' — mostly advertising spend attributed to this product' : ''}.`;
        } else {
            why = `${issues} issue(s) on this product with no direct monetary loss, but worth fixing.`;
        }

        return mergeSelectionWithProduct({ why, action: defaultActionForProduct(product) }, product, idx + 1);
    });
}

/**
 * Validate the model's output against the products we actually sent. Drops
 * invented ids and duplicates, then tops up from the deterministic ranking.
 */
function validateSelections(rawSelections, products, country = null) {
    const byAsin = new Map(products.map(p => [p.asin, p]));
    const seen = new Set();
    const valid = [];

    const ordered = Array.isArray(rawSelections)
        ? [...rawSelections].sort((a, b) => (Number(a?.rank) || 99) - (Number(b?.rank) || 99))
        : [];

    for (const selection of ordered) {
        const product = byAsin.get(selection?.productId);
        if (!product) {
            logger.warn('[TopProducts] Model returned an unknown productId; dropping', {
                productId: selection?.productId
            });
            continue;
        }
        if (seen.has(product.asin)) continue;
        seen.add(product.asin);
        valid.push(mergeSelectionWithProduct(selection, product, valid.length + 1));
        if (valid.length >= MAX_SELECTIONS) break;
    }

    // Top up if the model under-delivered, preserving our own ranking order.
    for (const product of products) {
        if (valid.length >= Math.min(MAX_SELECTIONS, products.length)) break;
        if (seen.has(product.asin)) continue;
        seen.add(product.asin);
        const [filler] = buildDeterministicSelections([product], 1, country);
        valid.push({ ...filler, rank: valid.length + 1 });
    }

    // Our rollup already ordered by money; never let the model reshuffle a
    // money-bearing product below one worth nothing.
    const withMoney = valid.filter(s => (s.profitImpact || 0) > 0);
    const withoutMoney = valid.filter(s => (s.profitImpact || 0) <= 0);
    return [...withMoney, ...withoutMoney].map((s, idx) => ({ ...s, rank: idx + 1 }));
}

/**
 * Ask the model to narrate the ranked products.
 * @returns {Promise<{selections: Array, model: string, tokensUsed: Object}|null>} null on any failure
 */
async function selectWithAI(products, country = null) {
    const client = getOpenAIClient();
    if (!client) return null;

    const payload = {
        currencyCode: getCurrencyCode(country),
        products: buildPromptPayload(products)
    };

    try {
        const completion = await client.chat.completions.create({
            model: TOP_PRODUCTS_MODEL,
            temperature: 0.1,
            max_tokens: MAX_OUTPUT_TOKENS,
            response_format: { type: 'json_object' },
            messages: [
                { role: 'system', content: SYSTEM_PROMPT },
                { role: 'user', content: JSON.stringify(payload) }
            ]
        });

        const content = completion?.choices?.[0]?.message?.content;
        if (!content) {
            logger.warn('[TopProducts] Empty AI response');
            return null;
        }

        let parsed;
        try {
            parsed = JSON.parse(content);
        } catch (err) {
            logger.warn('[TopProducts] AI response was not valid JSON', { message: err.message });
            return null;
        }

        return {
            selections: parsed?.selections,
            model: TOP_PRODUCTS_MODEL,
            tokensUsed: {
                promptTokens: completion?.usage?.prompt_tokens || 0,
                completionTokens: completion?.usage?.completion_tokens || 0,
                totalTokens: completion?.usage?.total_tokens || 0
            }
        };
    } catch (err) {
        logger.error('[TopProducts] OpenAI call failed', { message: err.message, model: TOP_PRODUCTS_MODEL });
        return null;
    }
}

/**
 * Build, narrate and store the top products for an account.
 *
 * @param {string} userId
 * @param {string} country
 * @param {string} region
 * @param {string} source - 'schedule' | 'integration' | 'manual' | 'api_fallback'
 */
async function calculateAndStoreTopProducts(userId, country, region, source = 'schedule', options = {}) {
    const startTime = Date.now();

    try {
        // `options.minIntervalHours` overrides the default window — see the same
        // parameter on calculateAndStoreTopOpportunities for why the scheduler
        // needs both 0 (tasks just rebuilt) and a multi-day value (stale-view net).
        const minIntervalHours = Number.isFinite(options.minIntervalHours)
            ? options.minIntervalHours
            : MIN_REGENERATE_INTERVAL_HOURS;
        if (!THROTTLE_EXEMPT_SOURCES.includes(source) && minIntervalHours > 0) {
            const existing = await TopProducts.getForAccount(userId, country, region);
            if (existing?.generatedAt) {
                const ageHours = (Date.now() - new Date(existing.generatedAt).getTime()) / 3600000;
                if (ageHours < minIntervalHours) {
                    logger.info('[TopProducts] Skipping regeneration — generated recently', {
                        userId, country, region, source,
                        ageHours: Math.round(ageHours * 10) / 10,
                        minIntervalHours
                    });
                    return { success: true, data: existing, skippedByThrottle: true, duration: Date.now() - startTime };
                }
            }
        }

        const ranked = await TaskOpportunityGroupsService.getTopProductsToFix(userId, country, region);
        if (!ranked.success) return { success: false, error: ranked.error };

        const currencyCode = getCurrencyCode(country);
        const products = ranked.products || [];

        if (!products.length) {
            logger.info('[TopProducts] No products to fix for account', { userId, country, region });
            const saved = await TopProducts.upsertForAccount(userId, country, region, {
                currencyCode, products: [], productsConsidered: 0,
                tasksConsidered: ranked.tasksConsidered || 0,
                totalRecoverableAmount: 0, unattributedAmount: 0, source
            });
            return { success: true, data: saved, duration: Date.now() - startTime };
        }

        const aiResult = await selectWithAI(products, country);

        let selections;
        let usedFallback = false;
        let fallbackReason = '';
        let model = '';
        let tokensUsed = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

        if (aiResult) {
            selections = validateSelections(aiResult.selections, products, country);
            model = aiResult.model;
            tokensUsed = aiResult.tokensUsed;
            if (!selections.length) {
                usedFallback = true;
                fallbackReason = 'AI response contained no valid product selections';
            }
        } else {
            usedFallback = true;
            fallbackReason = 'AI unavailable or call failed';
        }

        if (usedFallback) {
            selections = buildDeterministicSelections(products, MAX_SELECTIONS, country);
            logger.warn('[TopProducts] Using deterministic fallback', { userId, country, region, reason: fallbackReason });
        }

        // Sum of what is SHOWN — a subset, and never a headline figure.
        const totalRecoverableAmount = Math.round(
            selections.reduce((sum, s) => sum + (s.profitImpact || 0), 0) * 100
        ) / 100;

        // Account-wide and de-duplicated per ASIN — computed once by the rollup and
        // shared with TopOpportunities so no surface contradicts another.
        const unattributedAmount = Math.round(
            ((ranked.adsAttribution?.unattributedAmount || 0) + (ranked.unattributableAmount || 0)) * 100
        ) / 100;

        const saved = await TopProducts.upsertForAccount(userId, country, region, {
            currencyCode,
            products: selections,
            productsConsidered: ranked.productsConsidered || products.length,
            tasksConsidered: ranked.tasksConsidered || 0,
            totalRecoverableAmount,
            potentialProfitImpact: ranked.potentialProfitImpact || 0,
            capitalTiedUp: ranked.capitalTiedUp || 0,
            unattributedAmount,
            source,
            model,
            tokensUsed,
            usedFallback,
            fallbackReason
        });

        logger.info('[TopProducts] Stored top products', {
            userId, country, region, source,
            products: selections.length,
            potentialProfitImpact: ranked.potentialProfitImpact,
            capitalTiedUp: ranked.capitalTiedUp,
            usedFallback,
            model,
            totalTokens: tokensUsed.totalTokens,
            duration: Date.now() - startTime
        });

        return { success: true, data: saved, duration: Date.now() - startTime };
    } catch (error) {
        logger.error('[TopProducts] Error calculating top products', {
            error: error.message, stack: error.stack, userId, country, region
        });
        return { success: false, error: error.message };
    }
}

async function getTopProducts(userId, country, region) {
    return TopProducts.getForAccount(userId, country, region);
}

module.exports = {
    calculateAndStoreTopProducts,
    getTopProducts,
    selectWithAI,
    validateSelections,
    buildDeterministicSelections,
    buildPromptPayload,
    TOP_PRODUCTS_MODEL,
    MAX_SELECTIONS,
    MIN_REGENERATE_INTERVAL_HOURS,
    THROTTLE_EXEMPT_SOURCES
};
