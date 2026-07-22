const { createLayerRequest, createInterpretationContract } = require('./contracts.js');
const { resolveRequestContext } = require('./RequestContextResolver.js');
const { buildExecutionPlan } = require('./ServiceRouter.js');
const { fetchUnifiedData } = require('./UnifiedDataAccessService.js');
const { handleInformationIntent } = require('./services/InformationService.js');
const { handleSuggestionIntent } = require('./services/SuggestionEngineService.js');
const { handlePostOperationIntent } = require('./services/PostOperationService.js');
const { handleAsinDeepDive } = require('./services/AsinDeepDiveService.js');
const { shouldAskClarification, buildDiscreteClarificationPrompt, buildDiscreteClarificationOptions } = require('./ClarificationPolicy.js');
const { isFinanceQuery, handleFinanceQuery, narrateFinanceResult } = require('./services/FinanceEngine.js');
const { isAdsQuery, handleAdsQuery, narrateAdsResult } = require('./services/AdsEngine.js');
const { isGeneralStrategyQuery, handleStrategyQuery, narrateStrategyResult } = require('./services/GeneralStrategyEngine.js');
const { isSellerOpsQuery, handleSellerOpsQuery, narrateSellerOpsResult } = require('./services/SellerOpsEngine.js');
const { isAdvisoryQuery, handleAdvisoryQuery, narrateAdvisoryResult } = require('./services/AdvisoryEngine.js');
const { generateFinanceFollowUps, generateAdsFollowUps, generateStrategyFollowUps, generateSellerOpsFollowUps, generateAdvisoryFollowUps } = require('./helpers/FollowUpGenerator.js');
const logger = require('../../../utils/Logger.js');

async function runLayeredQMatePipeline({
    interpretation,
    rawQuestion,
    cleanedQuestion,
    chatHistory,
    userContext,
    runtimeContext,
    skipClarification,
    clarificationThreshold,
    modelTools,
    conversationContext = {},
}) {
    const layerRequest = createLayerRequest({
        rawQuestion,
        cleanedQuestion,
        chatHistory,
        userContext,
        runtimeContext,
    });

    const interpretedContract = createInterpretationContract(interpretation);
    const resolvedContext = resolveRequestContext({
        interpreted: interpretation,
        request: { ...layerRequest, ...userContext },
        runtimeContext,
    });

    if (resolvedContext.validationErrors.length > 0) {
        return {
            status: 400,
            error: resolvedContext.validationErrors.join(', '),
        };
    }

    const clarificationDecision = shouldAskClarification({
        interpretation: interpretedContract,
        resolvedContext,
        threshold: clarificationThreshold,
        skipForSimple: skipClarification,
        question: cleanedQuestion,
        // Phase 6 / Task 6.1: established-context bypass.
        conversationContext,
    });
    logger.info(`[QMate][DEBUG-TRACE] Pipeline — clarification result: ${JSON.stringify(clarificationDecision)}`);

    if (clarificationDecision.ask) {
        const layer1Questions = Array.isArray(interpretedContract?.clarification?.questions)
            ? interpretedContract.clarification.questions.filter(Boolean)
            : [];
        const layer1Options = Array.isArray(interpretedContract?.clarification?.options)
            ? interpretedContract.clarification.options.filter(Boolean)
            : [];
        const layer1Reasons = Array.isArray(interpretedContract?.clarification?.reasons)
            ? interpretedContract.clarification.reasons
            : [];
        const clarificationLead =
            clarificationDecision?.reason === 'layer1_explicit'
                ? 'I need a small clarification before proceeding.'
                : 'I want to make sure I answer this correctly.';
        // Phase 3 / Task 3.1: emit BOTH the legacy `clarifying_questions`
        // (string array) and the new `clarification_options` (structured
        // array). Old clients keep working; new clients render buttons.
        const clarifyingQuestions = layer1Questions.length
            ? layer1Questions.slice(0, 4)
            : [buildDiscreteClarificationPrompt()];
        const clarificationOptions = layer1Options.length
            ? layer1Options.slice(0, 4)
            : buildDiscreteClarificationOptions(cleanedQuestion);
        logger.info('[QMate] Layered pipeline returning clarification', {
            reason: clarificationDecision?.reason || null,
            optionsCount: clarificationOptions.length,
        });
        return {
            status: 200,
            answer_markdown: clarificationLead,
            chart_suggestions: [],
            follow_up_questions: [],
            needs_clarification: true,
            clarifying_questions: clarifyingQuestions,
            clarification_options: clarificationOptions,
            clarification_reasons: layer1Reasons,
            intent_interpretation: interpretedContract,
            responseSource: 'clarification',
            dataConfidence: 'none',
            dataSources: [],
        };
    }

    if (clarificationDecision.exhausted) {
        logger.info('[QMate] Layered pipeline returning exhausted-clarification canned response');
        // Include the user's ASIN in the example when one was detected, so the
        // suggestion is concrete and actionable.
        const exhaustedAsin =
            (Array.isArray(interpretedContract?.entities?.asins) && interpretedContract.entities.asins[0]) ||
            (String(cleanedQuestion || '').match(/\bB0[A-Z0-9]{8}\b/i) || [])[0] ||
            'B0XXXXXXXXX';
        return {
            status: 200,
            answer_markdown:
                "I'm having trouble understanding that question. Could you try asking about a specific metric? " +
                `For example: "What are the sales for ${exhaustedAsin} in the last 30 days?" or ` +
                `"Show me the profitability breakdown for ${exhaustedAsin}"`,
            chart_suggestions: [],
            follow_up_questions: [
                `What are the sales for ${exhaustedAsin} in the last 30 days?`,
                `Show me the profitability breakdown for ${exhaustedAsin}`,
            ],
            needs_clarification: false,
            intent_interpretation: interpretedContract,
            responseSource: 'canned',
            dataConfidence: 'none',
            dataSources: [],
        };
    }

    // --- Ads Engine intercept — FIRST ---
    // Ads (PPC) questions are answered deterministically (numbers match the
    // Campaign Audit Dashboard) and only narrated by the LLM. Placed BEFORE the
    // FinanceEngine intercept: ANY ads context (ppc/acos/roas/campaign/keyword/
    // ad spend/sponsored/…) is owned by the AdsEngine, so an ads query is never
    // captured by the FinanceEngine just because it also contains "sales" or
    // "spend". classifyAdsQueryType returns 'not_ads_engine' for non-ads queries
    // (and for post-action pause/negative intents), so those naturally fall
    // through to the FinanceEngine below. On error/empty, fall through too.
    if (isAdsQuery(interpretation)) {
        try {
            const adsResult = await handleAdsQuery(
                interpretation,
                { userId: userContext.userId, country: userContext.country, region: userContext.region },
                {
                    startDate: runtimeContext.startDate,
                    endDate: runtimeContext.endDate,
                    calendarMode: runtimeContext.calendarMode,
                }
            );

            if (adsResult && adsResult.type !== 'error') {
                const narratedContent = await narrateAdsResult(adsResult, rawQuestion, modelTools);

                logger.info(`[QMate][AdsEngine] Answered with type=${adsResult.type}, responseSource=ads_engine_deterministic`);

                // Map to this codebase's response contract: the controller reads
                // `answer_markdown` (→ content) and `chart_suggestions` (→ charts).
                return {
                    status: 200,
                    answer_markdown: narratedContent,
                    content: narratedContent,
                    chart_suggestions: adsResult.charts || [],
                    charts: adsResult.charts || [],
                    follow_up_questions: generateAdsFollowUps(adsResult.type, interpretation.entities),
                    needs_clarification: false,
                    clarifying_questions: [],
                    intent_interpretation: interpretedContract,
                    responseSource: 'ads_engine_deterministic',
                    dataConfidence: 'high',
                    dataSources: ['PPCCampaignAnalysisService', 'PPCMetrics'],
                    // Ads-specific extras for the frontend interactive table.
                    wasted_keywords: adsResult.wasted_keywords || [],
                    wasted_keywords_total: adsResult.wasted_keywords_total || 0,
                    load_more_available: adsResult.load_more_available || false,
                    adsResult, // raw data for frontend if needed
                };
            }
            // adsResult is error or null → fall through to existing pipeline.
            logger.warn('[QMate][AdsEngine] Ads query returned error/null, falling through to existing pipeline');
        } catch (err) {
            logger.error('[QMate][AdsEngine] Error in ads engine, falling through:', err.message);
            // Fall through to existing pipeline as a safety net.
        }
    }
    // --- End Ads Engine intercept ---

    // --- Finance Engine intercept — SECOND ---
    // Pure finance questions (no ads context) are answered deterministically
    // (numbers match the dashboard) and only narrated by the LLM. Runs AFTER the
    // AdsEngine intercept above and BEFORE the legacy ServiceRouter/intent
    // routing. If the engine errors or returns nothing, we fall through to the
    // existing pipeline (degraded but not broken).
    if (isFinanceQuery(interpretation)) {
        try {
            const financeResult = await handleFinanceQuery(
                interpretation,
                { userId: userContext.userId, country: userContext.country, region: userContext.region },
                {
                    startDate: runtimeContext.startDate,
                    endDate: runtimeContext.endDate,
                    calendarMode: runtimeContext.calendarMode,
                }
            );

            if (financeResult && financeResult.type !== 'error') {
                const narratedContent = await narrateFinanceResult(financeResult, rawQuestion, modelTools);

                logger.info(`[QMate][FinanceEngine] Answered with type=${financeResult.type}, responseSource=finance_engine_deterministic`);

                // Map to this codebase's response contract: the controller reads
                // `answer_markdown` (→ content) and `chart_suggestions` (→ charts).
                // `content`/`charts`/`financeResult` are included as harmless
                // extras for spec fidelity and frontend raw access.
                return {
                    status: 200,
                    answer_markdown: narratedContent,
                    content: narratedContent,
                    chart_suggestions: financeResult.charts || [],
                    charts: financeResult.charts || [],
                    follow_up_questions: generateFinanceFollowUps(financeResult.type, interpretation.entities),
                    needs_clarification: false,
                    clarifying_questions: [],
                    intent_interpretation: interpretedContract,
                    responseSource: 'finance_engine_deterministic',
                    dataConfidence: 'high',
                    dataSources: ['FinanceDashboardReadService', 'DailySkuFinance'],
                    financeResult, // raw data for frontend if needed
                };
            }
            // financeResult is error or null → fall through to existing pipeline.
            logger.warn('[QMate][FinanceEngine] Finance query returned error/null, falling through to existing pipeline');
        } catch (err) {
            logger.error('[QMate][FinanceEngine] Error in finance engine, falling through:', err.message);
            // Fall through to existing pipeline as a safety net.
        }
    }
    // --- End Finance Engine intercept ---

    // --- General Strategy Engine intercept — THIRD ---
    // Cross-domain questions ("why is my profit dropping?", "what should I fix
    // first?", "complete summary") combine finance + ads. They contain finance/
    // ads words, so AdsEngine.isAdsQuery and FinanceEngine.isFinanceQuery DEFER
    // them (both return false when isGeneralStrategyQuery is true) — which is why
    // execution reaches here. Runs AFTER both domain engines, BEFORE the general
    // pipeline. On error/empty, falls through to the existing pipeline.
    if (isGeneralStrategyQuery(interpretation)) {
        try {
            const strategyResult = await handleStrategyQuery(
                interpretation,
                { userId: userContext.userId, country: userContext.country, region: userContext.region },
                { startDate: runtimeContext.startDate, endDate: runtimeContext.endDate }
            );

            if (strategyResult && strategyResult.type !== 'error') {
                const narratedContent = await narrateStrategyResult(strategyResult, rawQuestion, modelTools);

                logger.info(`[QMate][StrategyEngine] Answered with strategyType=${strategyResult.strategyType}, responseSource=general_strategy_engine`);

                return {
                    status: 200,
                    answer_markdown: narratedContent,
                    content: narratedContent,
                    chart_suggestions: strategyResult.charts || [],
                    charts: strategyResult.charts || [],
                    follow_up_questions: generateStrategyFollowUps(strategyResult.strategyType),
                    needs_clarification: false,
                    clarifying_questions: [],
                    intent_interpretation: interpretedContract,
                    responseSource: 'general_strategy_engine',
                    dataConfidence: 'high',
                    dataSources: ['FinanceDashboardReadService', 'PPCCampaignAnalysisService'],
                    strategyResult, // raw cross-domain data for the frontend
                };
            }
            // handleStrategyQuery returned an error marker (it caught something
            // internally). Log the detail for diagnosis.
            logger.error('[QMate][StrategyEngine] handleStrategyQuery returned error/null', {
                detail: (strategyResult && strategyResult.message) || 'null result',
                prompt: String(rawQuestion || '').slice(0, 120),
            });
        } catch (err) {
            // FULL error + stack so the real cause is visible (missing import,
            // undefined function, data-access error, narrator failure, …).
            logger.error('[QMate][StrategyEngine] Strategy engine threw', {
                message: err && err.message,
                stack: err && err.stack,
                prompt: String(rawQuestion || '').slice(0, 120),
            });
        }

        // This IS a strategy question — the strategy engine is its correct handler.
        // Rather than cascading to the general pipeline (which cannot answer
        // cross-domain questions and may itself error → an opaque "trouble reaching
        // the AI service" to the user), return a graceful, deterministic 200 that
        // points the seller at the per-domain answers QMate can always give.
        logger.warn('[QMate][StrategyEngine] Returning graceful strategy fallback (no cascade to general pipeline)');
        return {
            status: 200,
            answer_markdown:
                "I couldn't pull your full cross-domain business analysis just now. " +
                'You can still ask me about a specific area and I\'ll answer directly:',
            content:
                "I couldn't pull your full cross-domain business analysis just now. " +
                'You can still ask me about a specific area and I\'ll answer directly:',
            chart_suggestions: [],
            charts: [],
            follow_up_questions: [
                'What is my profit?',
                'What is my ACOS?',
                'Where am I wasting money on ads?',
                'Which products are losing money?',
            ],
            needs_clarification: false,
            clarifying_questions: [],
            intent_interpretation: interpretedContract,
            responseSource: 'general_strategy_engine',
            dataConfidence: 'low',
            dataSources: [],
        };
    }
    // --- End General Strategy Engine intercept ---

    // --- SellerOps Engine intercept — FOURTH ---
    // Operational data-lookup domains: listing issues, inventory, account health,
    // reimbursements, products. Runs after the three analytics engines (which
    // defer to it) and before Advisory. On error/empty, falls through.
    if (isSellerOpsQuery(interpretation)) {
        try {
            const opsResult = await handleSellerOpsQuery(
                interpretation,
                { userId: userContext.userId, country: userContext.country, region: userContext.region },
                { startDate: runtimeContext.startDate, endDate: runtimeContext.endDate }
            );

            if (opsResult && opsResult.type !== 'error' && opsResult.type !== 'not_implemented') {
                const narratedContent = await narrateSellerOpsResult(opsResult, rawQuestion, modelTools);

                logger.info(`[QMate][SellerOpsEngine] Answered with type=${opsResult.type}, responseSource=seller_ops_engine`);

                return {
                    status: 200,
                    answer_markdown: narratedContent,
                    content: narratedContent,
                    chart_suggestions: [],
                    charts: [],
                    follow_up_questions: generateSellerOpsFollowUps(opsResult.type, interpretation.entities, opsResult.available === false),
                    needs_clarification: false,
                    clarifying_questions: [],
                    intent_interpretation: interpretedContract,
                    responseSource: 'seller_ops_engine',
                    dataConfidence: opsResult.available === false ? 'low' : 'high',
                    dataSources: ['SellerOpsEngine'],
                    sellerOpsResult: opsResult,
                };
            }
            logger.warn('[QMate][SellerOpsEngine] Returned error/null/not_implemented, falling through to existing pipeline');
        } catch (err) {
            logger.error('[QMate][SellerOpsEngine] Error in seller-ops engine, falling through:', err.message);
        }
    }
    // --- End SellerOps Engine intercept ---

    // --- Advisory Engine intercept — FIFTH ---
    // Pricing, promotions, operational how-to, product decisions, and platform
    // capabilities. Runs after SellerOps and before the general pipeline.
    if (isAdvisoryQuery(interpretation)) {
        try {
            const advResult = await handleAdvisoryQuery(
                interpretation,
                { userId: userContext.userId, country: userContext.country, region: userContext.region },
                { startDate: runtimeContext.startDate, endDate: runtimeContext.endDate }
            );

            if (advResult && advResult.type !== 'error' && advResult.type !== 'not_advisory') {
                const narratedContent = await narrateAdvisoryResult(advResult, rawQuestion, modelTools);

                logger.info(`[QMate][AdvisoryEngine] Answered with type=${advResult.type}, responseSource=advisory_engine`);

                return {
                    status: 200,
                    answer_markdown: narratedContent,
                    content: narratedContent,
                    chart_suggestions: [],
                    charts: [],
                    follow_up_questions: generateAdvisoryFollowUps(advResult.type, interpretation.entities),
                    needs_clarification: false,
                    clarifying_questions: [],
                    intent_interpretation: interpretedContract,
                    responseSource: 'advisory_engine',
                    dataConfidence: advResult.type === 'operational_advice' || advResult.type === 'capabilities' ? 'high' : 'medium',
                    dataSources: ['AdvisoryEngine', 'FinanceEngine', 'AdsEngine'],
                    advisoryResult: advResult,
                };
            }
            logger.warn('[QMate][AdvisoryEngine] Returned error/null/not_advisory, falling through to existing pipeline');
        } catch (err) {
            logger.error('[QMate][AdvisoryEngine] Error in advisory engine, falling through:', err.message);
        }
    }
    // --- End Advisory Engine intercept ---

    const executionPlan = buildExecutionPlan(interpretedContract);
    const unifiedData = await fetchUnifiedData({
        resolvedContext,
        executionPlan,
        question: cleanedQuestion,
    });

    if (
        executionPlan.serviceType !== 'asin_deep_dive' &&
        !unifiedData?.fetchStatus?.metrics &&
        !unifiedData?.fetchStatus?.issues
    ) {
        return null;
    }

    if (executionPlan.serviceType === 'post_operation') {
        return handlePostOperationIntent({
            interpretation: interpretedContract,
            unifiedData,
            question: cleanedQuestion,
            resolvedContext,
        });
    }

    if (executionPlan.serviceType === 'asin_deep_dive') {
        const deepDiveResponse = await handleAsinDeepDive({
            interpretation: interpretedContract,
            unifiedData,
            question: cleanedQuestion,
            resolvedContext,
            modelTools,
        });
        if (deepDiveResponse) return deepDiveResponse;
    }

    if (executionPlan.serviceType === 'suggestion_engine') {
        return handleSuggestionIntent({
            interpretation: interpretedContract,
            unifiedData,
            question: interpretedContract?.rewrittenQuestion || cleanedQuestion,
            resolvedContext,
            executionPlan,
            createCompletionWithFallback: modelTools.createCompletionWithFallback,
            client: modelTools.client,
        });
    }

    return handleInformationIntent({
        interpretation: interpretedContract,
        unifiedData,
        question: cleanedQuestion,
        resolvedContext,
    });
}

module.exports = {
    runLayeredQMatePipeline,
};
