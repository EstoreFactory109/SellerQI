const { createExecutionPlanContract } = require('./contracts.js');

function buildExecutionPlan(interpretation) {
    const intent = interpretation?.intent || 'other';
    const engine = interpretation?.routing?.engine || null;

    if (engine === 'implementation_engine' || intent === 'post_action') {
        return createExecutionPlanContract({
            serviceType: 'post_operation',
            dataRequirements: {
                metrics: true,
                issues: false,
                ppc: true,
                profitability: false,
                inventory: false,
                reimbursement: false,
                products: false,
                account: false,
                keywords: true,
            },
            operations: ['validate_post_action', 'build_action_preview'],
        });
    }

    // ASIN-specific questions use the deep-dive path (same services that power
    // the client Product Details page). Any question with a concrete ASIN belongs here.
    const hasAsin = Array.isArray(interpretation?.entities?.asins) && interpretation.entities.asins.length > 0;
    if (hasAsin) {
        return createExecutionPlanContract({
            serviceType: 'asin_deep_dive',
            dataRequirements: {
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
            operations: ['asin_deep_dive_fetch', 'asin_deep_dive_answer'],
        });
    }

    const isExplanationQuery = interpretation?.entities?.queryShape === 'explanation';
    const pq = interpretation?.entities?.productQuery;
    const hasProductRankLookup = pq?.type === 'top_n_products' || pq?.type === 'best_selling_product';
    const hasMetricsQuery =
        !isExplanationQuery &&
        (interpretation?.intent === 'value_lookup' ||
            hasProductRankLookup ||
            (Array.isArray(interpretation?.entities?.metrics) && interpretation.entities.metrics.length > 0));

    if (hasMetricsQuery) {
        return createExecutionPlanContract({
            serviceType: 'information',
            dataRequirements: {
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
            operations: ['compute_metric_answer', 'build_data_answer'],
        });
    }

    if (engine === 'suggestion_engine' || intent === 'suggestion' || intent === 'detailed_explanation') {
        return createExecutionPlanContract({
            serviceType: 'suggestion_engine',
            dataRequirements: {
                metrics: true,
                issues: true,
                ppc: true,
                profitability: true,
                inventory: true,
                reimbursement: true,
                products: true,
                account: true,
                keywords: true,
            },
            operations: ['build_suggestions', 'generate_why_how_answer'],
        });
    }

    return createExecutionPlanContract({
        serviceType: 'information',
        dataRequirements: {
            metrics: true,
            issues: true,
            ppc: true,
            profitability: true,
            inventory: false,
            reimbursement: true,
            products: false,
            account: true,
            keywords: true,
        },
        operations: ['compute_metric_answer', 'build_data_answer'],
    });
}

module.exports = { buildExecutionPlan };
