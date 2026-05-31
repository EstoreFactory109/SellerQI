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
const { generateFinanceFollowUps } = require('./helpers/FollowUpGenerator.js');
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

    // --- Finance Engine intercept ---
    // Finance questions are answered deterministically (numbers match the
    // dashboard) and only narrated by the LLM. Placed AFTER clarification and
    // BEFORE the legacy ServiceRouter/intent routing. If the engine errors or
    // returns nothing, we fall through to the existing pipeline (degraded but
    // not broken).
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
