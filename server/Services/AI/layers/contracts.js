function createLayerRequest(payload = {}) {
    return {
        rawQuestion: payload.rawQuestion || '',
        cleanedQuestion: payload.cleanedQuestion || '',
        chatHistory: Array.isArray(payload.chatHistory) ? payload.chatHistory : [],
        userContext: payload.userContext || {},
        runtimeContext: payload.runtimeContext || {},
    };
}

function createInterpretationContract(interpreted = {}) {
    return {
        intent: interpreted.intent || 'other',
        confidence: Number(interpreted.confidence || 0),
        detailLevel: interpreted.detailLevel || 'normal',
        entities: interpreted.entities || {},
        postAction: interpreted.postAction || null,
        presentation: interpreted.presentation || {},
        routing: interpreted.routing || { engine: 'information_engine', reason: 'fallback' },
        outputPreference: interpreted.outputPreference || { format: 'unspecified', confidence: 0 },
        rewrittenQuestion: interpreted.rewrittenQuestion || '',
        clarification: interpreted.clarification || { needed: false, questions: [], options: [] },
        warnings: Array.isArray(interpreted.warnings) ? interpreted.warnings : [],
    };
}

function createResolvedContextContract(payload = {}) {
    return {
        userId: payload.userId || null,
        country: payload.country || null,
        region: payload.region || null,
        calendarMode: payload.calendarMode || 'default',
        startDate: payload.startDate || null,
        endDate: payload.endDate || null,
        clarificationState: payload.clarificationState || { attempts: 0, maxAttempts: 1 },
        derived: payload.derived || {},
        validationErrors: Array.isArray(payload.validationErrors) ? payload.validationErrors : [],
    };
}

function createExecutionPlanContract(payload = {}) {
    return {
        serviceType: payload.serviceType || 'information',
        dataRequirements: payload.dataRequirements || {
            metrics: true,
            issues: false,
            ppc: false,
            profitability: false,
            inventory: false,
            reimbursement: false,
            products: false,
            account: false,
            keywords: false,
        },
        operations: Array.isArray(payload.operations) ? payload.operations : [],
    };
}

module.exports = {
    createLayerRequest,
    createInterpretationContract,
    createResolvedContextContract,
    createExecutionPlanContract,
};
