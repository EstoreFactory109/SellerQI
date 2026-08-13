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
 * Build a short, real (not fabricated) category-level label list for one product's
 * precomputed error data (as stored per-entry in productWiseError / IssuesDataChunks).
 * Mirrors the field checks IssuesByProduct.jsx uses to render full issue text, but
 * returns short "Category: Field" labels instead of full sentences - cheap enough to
 * run inline on a paginated table response instead of the full dashboard computation.
 *
 * NOTE: field names verified against IssuesByProduct.jsx (the actual consumer) -
 * they differ from the stale names in buildErrorMaps() below (e.g. imageResultErrorData,
 * not imageErrorData).
 */
function getShortIssueLabels(productWiseErrorEntry) {
    const labels = [];
    if (!productWiseErrorEntry) return labels;

    const ranking = productWiseErrorEntry.rankingErrors?.data;
    if (ranking) {
        const t = ranking.TitleResult;
        if (t?.charLim?.status === 'Error' || t?.RestictedWords?.status === 'Error' || t?.checkSpecialCharacters?.status === 'Error' || t?.wordRepetition?.status === 'Error' || t?.capitalization?.status === 'Error') {
            labels.push('Ranking: Title');
        }
        const b = ranking.BulletPoints;
        if (b?.charLim?.status === 'Error' || b?.RestictedWords?.status === 'Error' || b?.checkSpecialCharacters?.status === 'Error') {
            labels.push('Ranking: Bullet Points');
        }
        const d = ranking.Description;
        if (d?.charLim?.status === 'Error' || d?.RestictedWords?.status === 'Error' || d?.checkSpecialCharacters?.status === 'Error') {
            labels.push('Ranking: Description');
        }
        if (ranking.charLim?.status === 'Error' || ranking.dublicateWords === 'Error') {
            labels.push('Ranking: Backend Search Terms');
        }
    }

    const conversion = productWiseErrorEntry.conversionErrors;
    if (conversion) {
        if (conversion.imageResultErrorData?.status === 'Error') labels.push('Conversion: Image');
        if (conversion.videoResultErrorData?.status === 'Error') labels.push('Conversion: Video');
        if (conversion.productStarRatingResultErrorData?.status === 'Error') labels.push('Conversion: Star Rating');
        if (conversion.productsWithOutBuyboxErrorData?.status === 'Error') labels.push('Conversion: Buy Box');
        if (conversion.aplusErrorData?.status === 'Error') labels.push('Conversion: A+ Content');
        if (conversion.brandStoryErrorData?.status === 'Error') labels.push('Conversion: Brand Story');
    }

    const inventory = productWiseErrorEntry.inventoryErrors;
    if (inventory) {
        if (inventory.inventoryPlanningErrorData) labels.push('Inventory: Planning');
        if (inventory.strandedInventoryErrorData) labels.push('Inventory: Stranded Inventory');
        if (inventory.inboundNonComplianceErrorData) labels.push('Inventory: Inbound Non-Compliance');
        if (inventory.replenishmentErrorData) labels.push('Inventory: Replenishment');
    }

    return labels;
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
                if (data.TitleResult.wordRepetition?.status === 'Error') errorCount++;
                if (data.TitleResult.capitalization?.status === 'Error') errorCount++;
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
    getShortIssueLabels,
};
