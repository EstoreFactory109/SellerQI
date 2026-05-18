/**
 * Single-ASIN deep-dive for QMate. Uses the same services that power the
 * client Product Details page (ProductBasicInfoService, ProductPerformanceService,
 * ProductPPCIssuesService, QMateProductsService.getFullAsinIssues) so answers
 * match what the seller sees in the UI.
 *
 * Two modes:
 *  - Deterministic summary (no LLM) for simple facts ("B0X sales / acos / profit").
 *  - LLM reasoning over the same structured facts for "why" / "explain" questions.
 */

const logger = require('../../../../utils/Logger.js');
const ProductBasicInfoService = require('../../../Calculations/ProductBasicInfoService.js');
const ProductPerformanceService = require('../../../Calculations/ProductPerformanceService.js');
const ProductPPCIssuesService = require('../../../Calculations/ProductPPCIssuesService.js');
const QMateProductsService = require('../../QMateProductsService.js');
const { softenResponse } = require('../helpers/ResponseSoftener.js');
const { isGenericResponse, GENERIC_FALLBACK_MESSAGE } = require('../guards/ResponseFilter.js');
const { generateFollowUps } = require('../helpers/FollowUpGenerator.js');

const LOSS_PATTERN = /\b(loss|losing|profitable|profitabilit|margin|make money|makes? a loss|net profit|gross profit)\b/i;
const PERF_PATTERN = /\b(sessions?|conversion\s*rate|buy\s*box|buybox|traffic|units?\s*sold|page\s*views?|perform(ing|ance)?|ctr|click[- ]?through)\b/i;
const PPC_PATTERN = /\b(ads?|ppc|sponsored|acos|spend|spent|campaign|keyword|click|impression|wasted|cpc|roas|ad\s*group)\b/i;
const ISSUES_PATTERN = /\b(issue|problem|error|fix|why|how (?:can|do|to)|improve|loss|losing|recommend|suppressed|title|bullet|image|description|listing|a\s*plus|aplus|buy\s*box|stranded|inventory)\b/i;
const ALL_PATTERN = /\b(deep\s*dive|everything|overview|summary|analyze|analysis|complete|full details|tell me (about|everything))\b/i;

function selectRelevantDomains(question = '') {
    const q = String(question).toLowerCase();
    const all = ALL_PATTERN.test(q);
    const loss = LOSS_PATTERN.test(q);
    const perf = PERF_PATTERN.test(q);
    const ppc = PPC_PATTERN.test(q);
    const issues = ISSUES_PATTERN.test(q);

    if (all || loss) {
        return { basicInfo: true, performance: true, ppcIssues: true, issues: true };
    }

    const domains = { basicInfo: true, performance: false, ppcIssues: false, issues: false };
    if (perf) domains.performance = true;
    if (ppc) domains.ppcIssues = true;
    if (issues) domains.issues = true;

    if (!domains.performance && !domains.ppcIssues && !domains.issues) {
        domains.issues = true;
    }
    return domains;
}

function safeWrap(promiseFactory, label) {
    return promiseFactory().catch((error) => {
        logger.warn(`[AsinDeepDive] ${label} failed`, { message: error?.message });
        return { success: false, error: error?.message || 'Unknown error' };
    });
}

async function fetchAsinDeepDive({ userId, country, region, asin, question }) {
    if (!asin) throw new Error('ASIN is required for deep dive');
    const domains = selectRelevantDomains(question);

    const tasks = {};
    if (domains.basicInfo) {
        tasks.basicInfo = safeWrap(
            () => ProductBasicInfoService.getProductBasicInfo({ userId, region, country, asin }),
            'basicInfo'
        );
    }
    if (domains.performance) {
        tasks.performance = safeWrap(
            () => ProductPerformanceService.getProductPerformanceByAsin({ userId, region, country, asin, comparison: 'none' }),
            'performance'
        );
    }
    if (domains.ppcIssues) {
        tasks.ppcIssues = safeWrap(
            () => ProductPPCIssuesService.getProductPPCIssues({ userId, region, country, asin }),
            'ppcIssues'
        );
    }
    if (domains.issues) {
        tasks.issues = safeWrap(
            () => QMateProductsService.getFullAsinIssues(userId, country, region, asin),
            'issues'
        );
    }

    const keys = Object.keys(tasks);
    const results = await Promise.all(keys.map((k) => tasks[k]));
    const bundle = keys.reduce((acc, k, i) => {
        acc[k] = results[i];
        return acc;
    }, {});

    logger.info('[AsinDeepDive] fetched', {
        asin,
        domainsFetched: keys,
        basicInfoOk: Boolean(bundle.basicInfo?.success),
        performanceOk: Boolean(bundle.performance?.success),
        ppcOk: Boolean(bundle.ppcIssues?.success),
        issuesOk: Boolean(bundle.issues?.success),
    });

    return { asin, domains, bundle };
}

function money(currency, value) {
    const n = Number(value || 0);
    return `${currency} ${n.toFixed(2)}`;
}

function pct(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 'n/a';
    return `${n.toFixed(2)}%`;
}

function summarizeBasicInfo(basic) {
    if (!basic?.success || !basic.data) return null;
    const d = basic.data;
    return {
        name: d.name || null,
        sku: d.sku || null,
        price: Number(d.price || 0),
        sales: Number(d.sales || 0),
        unitsSold: Number(d.unitsSold || 0),
        grossProfit: Number(d.grossProfit || 0),
        amazonFees: Number(d.amzFee || 0),
        fbaFees: Number(d.fbaFees || 0),
        storageFees: Number(d.storageFees || 0),
        totalFees: Number(d.totalFees || 0),
        refunds: Number(d.refunds || 0),
        adsSpend: Number(d.adsSpend || 0),
        starRating: Number(d.starRating || 0),
        numRatings: Number(d.numRatings || 0),
        hasAPlus: Boolean(d.hasAPlus),
        hasBrandStory: Boolean(d.hasBrandStory),
    };
}

function summarizePerformance(perf) {
    if (!perf?.success || !perf.data) return null;
    const d = perf.data;
    return {
        sessions: Number(d.sessions || 0),
        pageViews: Number(d.pageViews || 0),
        conversionRate: Number(d.conversionRate || 0),
        buyBoxPercentage: Number(d.buyBoxPercentage || 0),
        ppcSpend: Number(d.ppcSpend || 0),
        ppcSales: Number(d.ppcSales || 0),
        impressions: Number(d.impressions || 0),
        clicks: Number(d.clicks || 0),
        acos: d.acos == null ? null : Number(d.acos),
        ctr: Number(d.ctr || 0),
    };
}

function summarizePpc(ppc) {
    if (!ppc?.success || !ppc.data) return null;
    const d = ppc.data;
    const metrics = d.ppcMetrics || null;
    const issues = Array.isArray(d.issues) ? d.issues : [];
    return {
        hasAds: Boolean(d.hasAds),
        spend: Number(metrics?.spend || 0),
        sales: Number(metrics?.sales || 0),
        acos: metrics?.acos == null ? null : Number(metrics.acos),
        cpc: Number(metrics?.cpc || 0),
        roas: metrics?.roas == null ? null : Number(metrics.roas),
        conversionRate: Number(metrics?.conversionRate || 0),
        clicks: Number(metrics?.clicks || 0),
        impressions: Number(metrics?.impressions || 0),
        totalIssues: issues.length,
        criticalIssues: Number(d.summary?.criticalIssues || 0),
        topIssues: issues.slice(0, 5).map((i) => ({
            type: i.type,
            severity: i.severity,
            title: i.title,
            recommendation: i.recommendation,
        })),
    };
}

function summarizeIssues(issues) {
    if (!issues?.success || !issues.data) return null;
    const d = issues.data;
    const counts = d.errorCounts || { ranking: 0, conversion: 0, inventory: 0 };
    const rankingTotal = Number(counts.ranking || 0);
    const conversionTotal = Number(counts.conversion || 0);
    const inventoryTotal = Number(counts.inventory || 0);
    return {
        totalErrors: Number(d.totalErrors || rankingTotal + conversionTotal + inventoryTotal),
        ranking: rankingTotal,
        conversion: conversionTotal,
        inventory: inventoryTotal,
        name: d.name || null,
        sku: d.sku || null,
        rankingErrors: d.rankingErrors || null,
        conversionErrors: d.conversionErrors || null,
        inventoryErrors: d.inventoryErrors || null,
    };
}

function buildAsinFacts({ asin, bundle }, currency = 'USD') {
    const basic = summarizeBasicInfo(bundle.basicInfo);
    const performance = summarizePerformance(bundle.performance);
    const ppc = summarizePpc(bundle.ppcIssues);
    const issues = summarizeIssues(bundle.issues);

    // Reconcile the most trustworthy per-ASIN sales/profit figures for context.
    let sales = basic?.sales;
    if (sales == null && performance) sales = performance.sales;
    let grossProfit = basic?.grossProfit;
    if (grossProfit == null && performance) grossProfit = performance.grossProfit;
    let adsSpend = basic?.adsSpend;
    if (!adsSpend && ppc) adsSpend = ppc.spend;
    if (!adsSpend && performance) adsSpend = performance.ppcSpend;

    return {
        asin,
        currency,
        basic,
        performance,
        ppc,
        issues,
        reconciled: {
            sales: Number(sales || 0),
            grossProfit: Number(grossProfit || 0),
            adsSpend: Number(adsSpend || 0),
        },
    };
}

function buildAsinContextText(facts) {
    const { asin, currency, basic, performance, ppc, issues, reconciled } = facts;
    const lines = [`ASIN: ${asin}`];
    if (basic?.name) lines.push(`Product: ${basic.name}${basic.sku ? ` (SKU ${basic.sku})` : ''}`);
    lines.push('');
    lines.push('FINANCIALS (selected period):');
    lines.push(`- Sales: ${money(currency, reconciled.sales)}`);
    lines.push(`- Units sold: ${basic?.unitsSold ?? 'n/a'}`);
    lines.push(`- Gross profit: ${money(currency, reconciled.grossProfit)}`);
    if (basic) {
        lines.push(`- Amazon fees: ${money(currency, basic.amazonFees)}`);
        lines.push(`- FBA fees: ${money(currency, basic.fbaFees)}`);
        lines.push(`- Storage fees: ${money(currency, basic.storageFees)}`);
        lines.push(`- Refunds: ${money(currency, basic.refunds)}`);
    }
    lines.push(`- Ad spend: ${money(currency, reconciled.adsSpend)}`);
    if (ppc) {
        lines.push('');
        lines.push('PPC:');
        lines.push(`- Has active ads: ${ppc.hasAds ? 'yes' : 'no'}`);
        lines.push(`- PPC spend: ${money(currency, ppc.spend)}`);
        lines.push(`- PPC sales (attributed): ${money(currency, ppc.sales)}`);
        lines.push(`- ACOS: ${pct(ppc.acos)}`);
        lines.push(`- Clicks / Impressions: ${ppc.clicks} / ${ppc.impressions}`);
        if (ppc.topIssues?.length) {
            lines.push('- PPC issues (top):');
            for (const issue of ppc.topIssues) {
                lines.push(`  • [${issue.severity}] ${issue.title} — ${issue.recommendation || ''}`);
            }
        }
    }
    if (performance) {
        lines.push('');
        lines.push('LISTING PERFORMANCE:');
        lines.push(`- Sessions: ${performance.sessions}`);
        lines.push(`- Page views: ${performance.pageViews}`);
        lines.push(`- Conversion rate: ${pct(performance.conversionRate)}`);
        lines.push(`- Buy Box %: ${pct(performance.buyBoxPercentage)}`);
    }
    if (basic) {
        lines.push('');
        lines.push('CATALOG:');
        lines.push(`- Star rating: ${basic.starRating} (${basic.numRatings} ratings)`);
        lines.push(`- Has A+ content: ${basic.hasAPlus ? 'yes' : 'no'}`);
        lines.push(`- Has Brand Story: ${basic.hasBrandStory ? 'yes' : 'no'}`);
    }
    if (issues) {
        lines.push('');
        lines.push('ISSUE COUNTS:');
        lines.push(`- Total errors: ${issues.totalErrors}`);
        lines.push(`- Ranking errors: ${issues.ranking}`);
        lines.push(`- Conversion errors: ${issues.conversion}`);
        lines.push(`- Inventory errors: ${issues.inventory}`);
    }
    return lines.join('\n');
}

function buildDeterministicSummary(facts) {
    const { asin, currency, reconciled, basic, ppc, issues } = facts;
    const lines = [`ASIN ${asin}${basic?.name ? ` — ${basic.name}` : ''} (selected period):`];
    lines.push(`- Sales: ${money(currency, reconciled.sales)}`);
    if (basic?.unitsSold != null) lines.push(`- Units sold: ${basic.unitsSold}`);
    if (basic?.totalFees != null) lines.push(`- Total fees: ${money(currency, basic.totalFees)}`);
    lines.push(`- Ad spend: ${money(currency, reconciled.adsSpend)}`);
    if (ppc?.acos != null) lines.push(`- ACOS: ${pct(ppc.acos)}`);
    lines.push(`- Gross profit: ${money(currency, reconciled.grossProfit)}`);
    if (issues?.totalErrors != null) lines.push(`- Open issues: ${issues.totalErrors}`);
    return lines.join('\n');
}

const SYSTEM_PROMPT = `You are QMate, an AI assistant for Amazon sellers.

You are answering a question about ONE specific ASIN. The FACTS block contains the
only data you are allowed to use — it comes from the same services that power the
client Product Details page.

STRICT RULES:
- Use ONLY the provided FACTS. Do NOT invent numbers, reviews, campaigns, or issues.
- If a needed fact is missing, say "data not available" — never guess.
- Explain causes by referencing the actual numbers and issues in the FACTS.
- Keep the answer concise, conversational, and actionable.
- When the question is about losses or profit, always discuss sales, ad spend, fees,
  and profitability issues (with recommendations) if they are present in FACTS.
- Do NOT list capabilities or generic assistant phrases.

Return JSON:
{ "answer": "...", "confidence": "high | medium | low" }

CRITICAL DATA RULES — FOLLOW THESE WITHOUT EXCEPTION:
1. ONLY use numbers, metrics, and data points that appear in the provided context below. If a number is not in the context, say "I don't have that data available" instead of estimating or calculating.
2. NEVER perform arithmetic on the provided numbers to derive new numbers unless the user explicitly asks for a calculation AND all input numbers are present in the context.
3. When citing a metric, specify the exact time period it covers (e.g., "In the last 30 days, your total sales were $X").
4. If the user asks about something not covered by the provided context data, say so honestly. Do not guess.
5. Do NOT reference data from previous conversation turns unless it is re-provided in the current context.
6. Keep your response concise and directly relevant to the user's question. Do not volunteer information about unrelated metrics.`;

async function callLlmForExplanation({ facts, question, outputFormat, modelTools }) {
    const messages = [
        { role: 'system', content: SYSTEM_PROMPT },
        {
            role: 'user',
            content: JSON.stringify({
                question,
                output_format: outputFormat,
                asin: facts.asin,
                facts_text: buildAsinContextText(facts),
                reconciled_numbers: facts.reconciled,
            }),
        },
    ];
    const completion = await modelTools.createCompletionWithFallback(modelTools.client, messages);
    const content = completion?.choices?.[0]?.message?.content || '{}';
    try {
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed.answer === 'string' && parsed.answer.trim()) {
            return softenResponse(parsed.answer.trim());
        }
    } catch (e) {
        logger.warn('[AsinDeepDive] LLM returned non-JSON', { message: e.message });
    }
    return null;
}

function isReasoningQuestion(question, interpretation) {
    const q = String(question || '').toLowerCase();
    if (interpretation?.entities?.queryShape === 'explanation') return true;
    if (interpretation?.intent === 'suggestion' || interpretation?.intent === 'detailed_explanation') return true;
    return /\b(why|how (?:can|do|to)|what('s| is) (?:wrong|driving)|explain|reason|root\s*cause|losing\s*money|making\s*loss)\b/.test(q);
}

async function handleAsinDeepDive({ interpretation, unifiedData, question, resolvedContext, modelTools }) {
    const asinFromEntities = Array.isArray(interpretation?.entities?.asins) && interpretation.entities.asins.length
        ? interpretation.entities.asins[0]
        : null;
    const asinFromQuestion = String(question || '').match(/\b(B0[A-Z0-9]{8,9})\b/i);
    const asin = (asinFromEntities || asinFromQuestion?.[1] || '').toUpperCase();
    if (!asin) {
        return null;
    }

    const { userId, country, region } = resolvedContext;
    const outputFormat = interpretation?.outputPreference?.format || 'unspecified';
    const currency = unifiedData?.bySource?.metrics?.data?.summary?.currency || 'USD';

    const deepDive = await fetchAsinDeepDive({ userId, country, region, asin, question });
    const facts = buildAsinFacts(deepDive, currency);

    const deepDiveSources = Object.keys(deepDive.domains || {}).filter((k) => deepDive.domains[k]);

    if (isReasoningQuestion(question, interpretation)) {
        const llmAnswer = await callLlmForExplanation({ facts, question, outputFormat, modelTools });
        let answer_markdown = llmAnswer || null;
        let llmGrounded = true;
        if (!answer_markdown) {
            // Safe fallback: show the facts so the user sees something useful.
            answer_markdown =
                `Here is what I have for ${asin}. I could not build a confident explanation from this data alone:\n\n` +
                buildAsinContextText(facts);
            llmGrounded = false;
            logger.info('[AsinDeepDive] LLM explanation unavailable — returning facts fallback');
        } else if (isGenericResponse(answer_markdown)) {
            answer_markdown = GENERIC_FALLBACK_MESSAGE;
            llmGrounded = false;
            logger.info('[AsinDeepDive] LLM produced generic response — using canned fallback');
        } else {
            logger.info('[AsinDeepDive] Returning grounded LLM explanation', { asin });
        }
        return {
            status: 200,
            answer_markdown,
            chart_suggestions: [],
            // Phase 4 / Task 4.1: deterministic intent-templated follow-ups.
            // The generator resolves {asin} / {timeRange} from the interpreter
            // entities so the chips are always answerable.
            follow_up_questions: generateFollowUps(
                interpretation?.intent,
                interpretation?.entities,
                unifiedData
            ),
            needs_clarification: false,
            clarifying_questions: [],
            intent_interpretation: interpretation,
            responseSource: llmGrounded ? 'llm_grounded' : 'canned',
            dataConfidence: llmGrounded ? 'medium' : 'none',
            dataSources: deepDiveSources,
        };
    }

    logger.info('[AsinDeepDive] Returning deterministic ASIN summary', { asin });
    return {
        status: 200,
        answer_markdown: buildDeterministicSummary(facts),
        chart_suggestions: [],
        // Phase 4 / Task 4.1: single-number answers stay quiet; everything
        // else gets templated follow-ups from FollowUpGenerator.
        follow_up_questions: outputFormat === 'single_number'
            ? []
            : generateFollowUps(
                interpretation?.intent,
                interpretation?.entities,
                unifiedData
            ),
        needs_clarification: false,
        clarifying_questions: [],
        intent_interpretation: interpretation,
        responseSource: 'deterministic',
        dataConfidence: 'high',
        dataSources: deepDiveSources,
    };
}

module.exports = {
    selectRelevantDomains,
    fetchAsinDeepDive,
    buildAsinFacts,
    buildAsinContextText,
    buildDeterministicSummary,
    handleAsinDeepDive,
};
