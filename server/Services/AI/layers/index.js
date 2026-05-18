const { createLayerRequest, createInterpretationContract } = require('./contracts.js');
const { resolveRequestContext } = require('./RequestContextResolver.js');
const { buildExecutionPlan } = require('./ServiceRouter.js');
const { fetchUnifiedData } = require('./UnifiedDataAccessService.js');
const { handleInformationIntent } = require('./services/InformationService.js');
const { handleSuggestionIntent } = require('./services/SuggestionEngineService.js');
const { handlePostOperationIntent } = require('./services/PostOperationService.js');
const { handleAsinDeepDive } = require('./services/AsinDeepDiveService.js');
const { shouldAskClarification, buildDiscreteClarificationPrompt, buildDiscreteClarificationOptions } = require('./ClarificationPolicy.js');
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
    });

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
        return {
            status: 200,
            answer_markdown:
                'I could not confidently infer your request after two clarifications. Please ask again using one clear metric and one time range.',
            chart_suggestions: [],
            follow_up_questions: [
                'Example: What is gross profit for last 30 days?',
                'Example: Show wasted ads spend value for last 14 days.',
            ],
            needs_clarification: false,
            intent_interpretation: interpretedContract,
            responseSource: 'canned',
            dataConfidence: 'none',
            dataSources: [],
        };
    }

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
