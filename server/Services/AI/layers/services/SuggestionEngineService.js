const logger = require('../../../../utils/Logger.js');
const { buildLLMContext } = require('../helpers/LLMContextBuilder.js');
const { rankIssueDrivers } = require('../helpers/ReasonRanking.js');
const { validateAnswer } = require('../helpers/ResponseValidator.js');
const { generateFollowUps } = require('../helpers/FollowUpGenerator.js');
const { needsClarification, CLARIFY_FALLBACK_MESSAGE } = require('../guards/VagueQueryGuard.js');
const { isGenericResponse, GENERIC_FALLBACK_MESSAGE } = require('../guards/ResponseFilter.js');
const { softenResponse } = require('../helpers/ResponseSoftener.js');
const { isOnboardingQuery, CAPABILITIES_ANSWER, CAPABILITIES_FOLLOW_UPS } = require('../helpers/IntentGuards.js');
const { hasAsin } = require('../helpers/EntityGuards.js');
const { buildFinanceSuggestionContext } = require('./FinanceEngine.js');

/**
 * True when a suggestion/strategy question involves finance, so we should
 * inject accurate FinanceEngine numbers before the LLM reasons about it.
 * Robust to both the full interpretation (raw object) and the layer contract
 * (rewrittenQuestion); also accepts the resolved question text directly.
 */
function isFinanceRelatedSuggestion(interpretation, question) {
    const promptText = String(
        question ||
        interpretation?.rewrittenQuestion ||
        interpretation?.raw?.normalizedPrompt ||
        interpretation?.raw?.prompt ||
        ''
    ).toLowerCase();
    const metrics = (interpretation?.entities?.metrics || []).join(' ').toLowerCase();
    return /profit|margin|expense|fee|cost|sales|revenue|losing|money|improve|optimize|optimise|reduce|cut/.test(
        `${promptText} ${metrics}`
    );
}

/** Currency formatter for the injected finance block. */
function fmtMoneySE(n) {
    const v = Number(n || 0);
    return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/**
 * Render the FinanceEngine context as an authoritative text block for the LLM.
 * These numbers are the source of truth — they override any conflicting figures
 * elsewhere in the prompt.
 */
function buildFinanceBlock(financeContext) {
    const fs = financeContext.financeSummary || {};
    const pa = financeContext.problemAreas || {};
    const cmp = financeContext.comparison || null;
    const lines = [];

    lines.push('ACCURATE FINANCE CONTEXT (source of truth — use these exact numbers):');
    lines.push(`- Total sales: ${fmtMoneySE(fs.totalSales)}`);
    lines.push(`- Total expenses: ${fmtMoneySE(fs.displayTotalExpenses)} (includes Amazon fees, overhead, ad spend; reimbursements netted)`);
    lines.push(`- Ad spend (PPC): ${fmtMoneySE(fs.adSpend)}`);
    lines.push(`- COGS: ${fmtMoneySE(fs.totalCogs)}`);
    lines.push(`- Profit: ${fmtMoneySE(fs.displayProfit)} (${Number(fs.profitMargin || 0).toFixed(1)}% margin)`);
    lines.push(`- Refunds: ${fmtMoneySE(fs.refunds)}`);
    lines.push(`- Account health: ${financeContext.healthIndicator}`);

    if (cmp && cmp.deltas) {
        const d = cmp.deltas;
        lines.push('');
        lines.push(`PERIOD-OVER-PERIOD (${cmp.overallDirection || 'n/a'}):`);
        const delta = (label, x) =>
            x ? `- ${label}: ${fmtMoneySE(x.current)} vs ${fmtMoneySE(x.previous)} (${Number(x.changePct || 0).toFixed(1)}%)` : null;
        [delta('Sales', d.sales), delta('Expenses', d.expenses), delta('Ad spend', d.adSpend), delta('Profit', d.profit)]
            .filter(Boolean)
            .forEach((l) => lines.push(l));
    }

    const fmtProducts = (label, arr) => {
        if (!Array.isArray(arr) || arr.length === 0) return;
        lines.push('');
        lines.push(`${label}:`);
        arr.slice(0, 5).forEach((p) => {
            if (p.grossProfit != null) {
                lines.push(`- ${p.asin}${p.productName ? ` (${p.productName})` : ''}: sales ${fmtMoneySE(p.productSales)}, profit ${fmtMoneySE(p.grossProfit)} (${Number(p.profitMargin || 0).toFixed(1)}%)`);
            } else {
                lines.push(`- ${p.asin}${p.productName ? ` (${p.productName})` : ''}: sales ${fmtMoneySE(p.productSales)}, ${p.units} units`);
            }
        });
    };
    fmtProducts('LOSS-MAKING PRODUCTS', pa.losingProducts);
    fmtProducts('LOW-MARGIN PRODUCTS (<15%)', pa.lowMarginProducts);
    fmtProducts('HIGHEST FEE-RATIO PRODUCTS', pa.highFeeProducts);
    fmtProducts('PRODUCTS MISSING COGS (profit understated)', pa.productsMissingCOGS);

    return lines.join('\n');
}

function formatContext(context) {
    const iss = context.issues;
    return `
DATA SUMMARY:

Sales: ${context.sales != null ? context.sales : 'data not available'}
Profit: ${context.profit != null ? context.profit : 'data not available'}
Ad Spend: ${context.adSpend != null ? context.adSpend : 'data not available'}

Issues:
- Total: ${iss != null ? iss.total : 'data not available'}
- Inventory: ${iss != null ? iss.inventory : 'data not available'}
- PPC: ${iss != null ? iss.ppc : 'data not available'}
- Ranking: ${iss != null ? iss.ranking : 'data not available'}
- Conversion: ${iss != null ? iss.conversion : 'data not available'}
- Profitability: ${iss != null ? iss.profitability : 'data not available'}

Top Products:
${JSON.stringify(context.topProducts ?? [], null, 2)}

Inventory:
${JSON.stringify(context.inventory ?? null, null, 2)}
`;
}

function buildDriverBlock(rankedDrivers) {
    if (!Array.isArray(rankedDrivers) || rankedDrivers.length === 0) {
        return '(no positive issue counts in summary — do not invent issues)';
    }
    return rankedDrivers.map((d) => `${d.type}: ${d.impact}`).join('\n');
}

function isContextEffectivelyEmpty(context) {
    if (!context || typeof context !== 'object') return true;
    if (Object.keys(context).length === 0) return true;
    return Object.values(context).every(
        (v) =>
            v == null ||
            (Array.isArray(v) && v.length === 0) ||
            (typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === 0)
    );
}

function validateResponse(response) {
    if (!response || typeof response !== 'object') return false;
    if (!response.answer || typeof response.answer !== 'string') return false;
    return true;
}

async function handleSuggestionIntent({
    interpretation,
    unifiedData,
    question,
    createCompletionWithFallback,
    client,
    executionPlan,
    resolvedContext,
}) {
    const outputFormat = interpretation?.outputPreference?.format || 'unspecified';
    const asinPresent =
        hasAsin(question) ||
        (Array.isArray(interpretation?.entities?.asins) && interpretation.entities.asins.length > 0);

    if (!asinPresent && isOnboardingQuery(question)) {
        logger.info('[QMate][Suggestion] Onboarding query — returning canned response');
        return {
            status: 200,
            answer_markdown: CAPABILITIES_ANSWER,
            chart_suggestions: [],
            follow_up_questions: [...CAPABILITIES_FOLLOW_UPS],
            needs_clarification: false,
            clarifying_questions: [],
            intent_interpretation: interpretation,
            responseSource: 'canned',
            dataConfidence: 'none',
            dataSources: [],
        };
    }

    // Category G: for finance-related suggestions, run the FinanceEngine FIRST
    // and inject its accurate numbers so the LLM reasons over correct figures
    // (instead of the old conflicting Track A/Track B data). The suggestion
    // engine still keeps its multi-domain context (PPC, issues, inventory).
    let financeContext = null;
    if (isFinanceRelatedSuggestion(interpretation, question)) {
        try {
            const userContext = {
                userId: resolvedContext?.userId,
                country: resolvedContext?.country,
                region: resolvedContext?.region,
            };
            const requestDateRange = {
                startDate: resolvedContext?.startDate,
                endDate: resolvedContext?.endDate,
                calendarMode: resolvedContext?.calendarMode,
            };
            financeContext = await buildFinanceSuggestionContext(interpretation, userContext, requestDateRange);
            logger.info('[QMate][SuggestionEngine] Injected accurate finance context from FinanceEngine');
        } catch (err) {
            logger.warn('[QMate][SuggestionEngine] FinanceEngine context failed, using existing data:', err.message);
        }
    }

    const context = buildLLMContext(unifiedData, interpretation);

    // Override the (possibly conflicting) finance numbers with FinanceEngine's.
    if (financeContext && financeContext.financeSummary) {
        const fs = financeContext.financeSummary;
        context.sales = fs.totalSales;
        context.profit = fs.displayProfit;
        context.adSpend = fs.adSpend;
    }

    if (!context || Object.keys(context).length === 0 || isContextEffectivelyEmpty(context)) {
        logger.info('[QMate][Suggestion] No relevant context — returning data-unavailable response');
        return {
            status: 200,
            answer_markdown: "I couldn't find relevant data for this query.",
            chart_suggestions: [],
            follow_up_questions: [],
            needs_clarification: false,
            clarifying_questions: [],
            intent_interpretation: interpretation,
            responseSource: 'data_unavailable',
            dataConfidence: 'none',
            dataSources: [],
        };
    }

    if (!asinPresent && needsClarification(question)) {
        logger.info('[QMate][Suggestion] Vague query without ASIN — returning clarification fallback');
        return {
            status: 200,
            answer_markdown: CLARIFY_FALLBACK_MESSAGE,
            chart_suggestions: [],
            follow_up_questions: [],
            needs_clarification: false,
            clarifying_questions: [],
            intent_interpretation: interpretation,
            responseSource: 'clarification',
            dataConfidence: 'none',
            dataSources: [],
        };
    }

    const rankedDrivers = rankIssueDrivers(context);
    const driverSummary = buildDriverBlock(rankedDrivers);
    const reinforcedContext = `User Context:
- Amazon seller account query
- Focus on business metrics (sales, ads, inventory, profit)
`;
    const financeBlock = financeContext ? `\n\n${buildFinanceBlock(financeContext)}\n` : '';
    const formattedContext =
        `${reinforcedContext}\n\n${formatContext(context).trim()}${financeBlock}\n\nTOP ISSUE DRIVERS (ranked by impact):\n${driverSummary}\n\n` +
        'Instructions:\n' +
        '- Focus on highest-impact drivers first when explaining causes.\n' +
        '- Consider multiple factors (inventory, ads, ranking, conversion, profitability) when the data supports them.\n' +
        '- Do not ignore other non-zero signals in the summary.\n' +
        (financeContext
            ? '- Finance numbers in the ACCURATE FINANCE CONTEXT block are the source of truth; use those exact figures and do not recompute them.\n'
            : '');

    const messages = [
        {
            role: 'system',
            content: `You are QMate, an AI assistant for Amazon sellers.

STRICT RULES:
- You ONLY answer questions related to Amazon seller analytics and performance
- Use ONLY the provided DATA SUMMARY and TOP ISSUE DRIVERS
- Do NOT behave like a general-purpose assistant
- Do NOT list capabilities or unrelated topics
- Do NOT answer off-topic questions
- If unclear, ask one clarification about Amazon metrics (sales, ads, inventory, profitability, listings)

FORBIDDEN in your answer:
- Phrases like "I can help with many things" or broad capability lists
- Generic assistant disclaimers

STYLE:
- concise, data-driven, business-focused

STYLE RULES:
- Be conversational and natural — write like a human analyst, not a form
- Do NOT present numbered options ("Option 1 / Option 2") unless the user explicitly asks for a choice
- Guide the user instead of forcing choices
- Keep responses short and helpful

Also respect output_format when writing the answer string: if single_number, one concise numeric line with unit/currency; if list, concise bullets; if graph, briefly describe what to chart from the data only.

Return JSON:
{
  "answer": "...",
  "confidence": "high | medium | low"
}

CRITICAL DATA RULES — FOLLOW THESE WITHOUT EXCEPTION:
1. ONLY use numbers, metrics, and data points that appear in the provided context below. If a number is not in the context, say "I don't have that data available" instead of estimating or calculating.
2. NEVER perform arithmetic on the provided numbers to derive new numbers unless the user explicitly asks for a calculation AND all input numbers are present in the context.
3. When citing a metric, specify the exact time period it covers (e.g., "In the last 30 days, your total sales were $X").
4. If the user asks about something not covered by the provided context data, say so honestly. Do not guess.
5. Do NOT reference data from previous conversation turns unless it is re-provided in the current context.
6. Keep your response concise and directly relevant to the user's question. Do not volunteer information about unrelated metrics.`,
        },
        {
            role: 'user',
            content: JSON.stringify({
                question,
                output_format: outputFormat,
                intent_summary: {
                    intent: interpretation?.intent,
                    detailLevel: interpretation?.detailLevel,
                },
                data_summary_text: formattedContext,
                ranked_issue_drivers: rankedDrivers,
                accurate_finance_context: financeContext || undefined,
            }),
        },
    ];

    const completion = await createCompletionWithFallback(client, messages);
    const content = completion?.choices?.[0]?.message?.content || '{}';
    let parsed = {};
    try {
        parsed = JSON.parse(content);
    } catch (e) {
        parsed = {};
    }

    logger.info('[QMate Debug]', {
        query: question,
        intent: interpretation?.intent,
        service: executionPlan?.serviceType,
        context,
        rankedDrivers,
        response: parsed,
    });

    if (!validateResponse(parsed)) {
        logger.warn('[QMate][Suggestion] LLM response failed shape validation');
        return {
            status: 200,
            answer_markdown: "I couldn't verify the answer from available data.",
            chart_suggestions: [],
            follow_up_questions: [],
            needs_clarification: false,
            clarifying_questions: [],
            intent_interpretation: interpretation,
            responseSource: 'data_unavailable',
            dataConfidence: 'none',
            dataSources: Object.keys(context),
        };
    }

    const answerText = softenResponse(String(parsed.answer).trim());
    if (!validateAnswer(answerText, context)) {
        logger.warn('[QMate][Suggestion] Answer failed signal validation against context');
        return {
            status: 200,
            answer_markdown: "I couldn't confidently determine the root cause from available data.",
            chart_suggestions: [],
            follow_up_questions: [],
            needs_clarification: false,
            clarifying_questions: [],
            intent_interpretation: interpretation,
            responseSource: 'data_unavailable',
            dataConfidence: 'none',
            dataSources: Object.keys(context),
        };
    }

    if (isGenericResponse(answerText)) {
        logger.info('[QMate][Suggestion] LLM produced generic response — returning canned fallback');
        return {
            status: 200,
            answer_markdown: GENERIC_FALLBACK_MESSAGE,
            chart_suggestions: [],
            follow_up_questions: [],
            needs_clarification: false,
            clarifying_questions: [],
            intent_interpretation: interpretation,
            responseSource: 'canned',
            dataConfidence: 'none',
            dataSources: [],
        };
    }

    logger.info('[QMate][Suggestion] Returning grounded LLM answer');
    return {
        status: 200,
        answer_markdown: answerText,
        chart_suggestions: [],
        // Phase 4 / Task 4.1: deterministic, intent-templated follow-ups
        // instead of LLM-generated suggestions.
        follow_up_questions: generateFollowUps(
            interpretation?.intent,
            interpretation?.entities,
            unifiedData
        ),
        needs_clarification: false,
        clarifying_questions: [],
        intent_interpretation: interpretation,
        responseSource: 'llm_grounded',
        dataConfidence: 'medium',
        dataSources: Object.keys(context),
    };
}

module.exports = { handleSuggestionIntent };
