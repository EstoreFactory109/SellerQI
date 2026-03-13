/**
 * RecommendationService.js
 *
 * Delegates to ScenarioRecommendationService for the 20 scenario-based
 * recommendations. Keeps the buildErrorMaps / enrichProductsWithRecommendations
 * wrapper functions so PageWiseDataController callers don't need to change.
 */

const { evaluateScenarios, buildMetrics } = require('./ScenarioRecommendationService.js');

/**
 * Generate recommendations for a single product using the 20-scenario engine.
 *
 * @param {Object} params
 * @param {Object} params.performance - Performance metrics from ProductPerformanceService
 * @param {Object} params.comparison  - WoW/MoM comparison with changes
 * @returns {Array<Object>} matched recommendations sorted by priority
 */
function generateProductRecommendations({ performance, comparison = null }) {
    if (!performance) return [];

    const metrics = buildMetrics({ performance, profitability: null });
    return evaluateScenarios(metrics, comparison);
}

/**
 * Generate recommendations for all products.
 *
 * @param {Array}  products  - Products with 'performance' and optional 'comparison'
 * @param {Object} errorMaps - (kept for API compat; no longer consumed by scenario engine)
 * @returns {Map<string, Array>} ASIN -> recommendations array
 */
function generateAllRecommendations(products, errorMaps = {}) {
    const recommendationsMap = new Map();

    products.forEach(product => {
        const asin = (product.asin || '').trim();
        if (!asin) return;

        const recommendations = generateProductRecommendations({
            performance: product.performance,
            comparison: product.comparison,
        });

        recommendationsMap.set(asin, recommendations);
    });

    return recommendationsMap;
}

/**
 * Count inventory errors for a product.
 */
function countInventoryErrors(product) {
    let count = 0;
    const invErrors = product.inventoryErrors;
    if (!invErrors) return 0;
    if (invErrors.inventoryPlanningErrorData) count++;
    if (invErrors.strandedInventoryErrorData) count++;
    if (invErrors.inboundNonComplianceErrorData) count++;
    if (invErrors.replenishmentErrorData) count++;
    return count;
}

/**
 * Enrich products with recommendations.
 *
 * @param {Array} products           - Products (should have 'performance' already)
 * @param {Map}   recommendationsMap - Map from generateAllRecommendations
 * @returns {Array} Products with added 'recommendations' + 'primaryRecommendation'
 */
function enrichProductsWithRecommendations(products, recommendationsMap) {
    return products.map(product => {
        const asin = (product.asin || '').trim();
        const recommendations = recommendationsMap.get(asin) || [];
        const primaryRecommendation = recommendations.length > 0 ? recommendations[0] : null;

        return {
            ...product,
            recommendations,
            primaryRecommendation: primaryRecommendation
                ? {
                    id: primaryRecommendation.id,
                    shortLabel: primaryRecommendation.shortLabel,
                    message: primaryRecommendation.message,
                    reason: primaryRecommendation.reason,
                }
                : null,
        };
    });
}

/**
 * Count error types from product-wise error arrays.
 * Kept for backward compatibility with PageWiseDataController.
 */
function buildErrorMaps(conversionProductWiseErrors = [], rankingProductWiseErrors = [], inventoryProductWiseErrors = []) {
    const conversionErrorMap = new Map();
    const rankingErrorMap = new Map();
    const inventoryErrorMap = new Map();

    conversionProductWiseErrors.forEach(item => {
        const asin = (item.asin || '').trim();
        if (asin) {
            let errorCount = 0;
            if (item.imageErrorData?.status === 'Error') errorCount++;
            if (item.videoErrorData?.status === 'Error') errorCount++;
            if (item.aplusErrorData?.status === 'Error') errorCount++;
            if (item.starRatingErrorData?.status === 'Error') errorCount++;
            if (item.buyBoxErrorData?.status === 'Error') errorCount++;
            if (item.brandStoryErrorData?.status === 'Error') errorCount++;
            conversionErrorMap.set(asin, errorCount);
        }
    });

    rankingProductWiseErrors.forEach(item => {
        const asin = (item.asin || '').trim();
        if (asin && item.data) {
            const data = item.data;
            let errorCount = 0;
            if (data.TitleResult) {
                if (data.TitleResult.charLim?.status === 'Error') errorCount++;
                if (data.TitleResult.RestictedWords?.status === 'Error') errorCount++;
                if (data.TitleResult.checkSpecialCharacters?.status === 'Error') errorCount++;
            }
            if (data.BulletPoints) {
                if (data.BulletPoints.charLim?.status === 'Error') errorCount++;
                if (data.BulletPoints.RestictedWords?.status === 'Error') errorCount++;
                if (data.BulletPoints.checkSpecialCharacters?.status === 'Error') errorCount++;
            }
            if (data.Description) {
                if (data.Description.charLim?.status === 'Error') errorCount++;
                if (data.Description.RestictedWords?.status === 'Error') errorCount++;
                if (data.Description.checkSpecialCharacters?.status === 'Error') errorCount++;
            }
            if (data.charLim?.status === 'Error') errorCount++;
            if (data.dublicateWords?.status === 'Error') errorCount++;
            rankingErrorMap.set(asin, errorCount);
        }
    });

    inventoryProductWiseErrors.forEach(item => {
        const asin = (item.asin || '').trim();
        if (asin) {
            let errorCount = 0;
            if (item.inventoryPlanningErrorData) errorCount++;
            if (item.strandedInventoryErrorData) errorCount++;
            if (item.inboundNonComplianceErrorData) errorCount++;
            if (item.replenishmentErrorData) errorCount++;
            inventoryErrorMap.set(asin, errorCount);
        }
    });

    return { conversionErrorMap, rankingErrorMap, inventoryErrorMap };
}

module.exports = {
    generateProductRecommendations,
    generateAllRecommendations,
    enrichProductsWithRecommendations,
    buildErrorMaps,
    countInventoryErrors,
};
