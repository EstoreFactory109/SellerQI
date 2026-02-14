/**
 * RecommendationService.js
 * 
 * Rule-based recommendation engine for product performance optimization.
 * 
 * Generates actionable recommendations per product based on:
 * - Traffic (sessions) + PPC status
 * - Conversion rate + listing quality (conversion errors)
 * - PPC efficiency (ACOS)
 * - Listing optimization (ranking errors)
 * - Sales trends (WoW/MoM comparisons)
 * - Profitability (gross profit, margins)
 * - Buy Box percentage
 * - Inventory issues
 * 
 * Recommendation types:
 * - add_ppc: Product has low/no PPC but could benefit from advertising
 * - reduce_ppc: High ACOS, should optimize or reduce spend
 * - fix_listing: Low conversion, listing needs optimization
 * - optimize_keywords: PPC active but high spend with low returns
 * - sales_declining: Sales trend is negative
 * - traffic_declining: Sessions/page views declining
 * - fix_buybox: Low buy box percentage
 * - review_profitability: Negative or low profit margin
 * - fix_inventory: Inventory issues detected
 */

const logger = require('../../utils/Logger.js');

// Thresholds for recommendations (can be made configurable later)
const THRESHOLDS = {
    // Sessions threshold: below this, consider "low traffic"
    LOW_SESSIONS: 50,
    
    // Conversion rate threshold: below this, consider "low conversion"
    LOW_CONVERSION_RATE: 10, // percent
    
    // ACOS threshold: above this, consider "high ACOS"
    HIGH_ACOS: 40, // percent
    
    // Minimum sales to consider for "reduce PPC" (avoid recommending for products with no sales)
    MIN_SALES_FOR_PPC_REVIEW: 10, // dollars
    
    // Minimum PPC spend to consider for efficiency review
    MIN_PPC_SPEND_FOR_REVIEW: 5, // dollars
    
    // Sessions threshold for "has enough traffic to judge conversion"
    ENOUGH_TRAFFIC_FOR_CONVERSION: 100,
    
    // Sales decline threshold: below this % change, flag as declining
    SALES_DECLINE_THRESHOLD: -15, // percent (e.g., -15% or worse)
    
    // Traffic decline threshold
    TRAFFIC_DECLINE_THRESHOLD: -20, // percent
    
    // Buy Box threshold: below this, flag as low buy box
    LOW_BUYBOX_PERCENTAGE: 50, // percent
    
    // Minimum sales to consider for profitability review
    MIN_SALES_FOR_PROFITABILITY: 50, // dollars
    
    // Profit margin threshold: below this, consider "low margin"
    LOW_PROFIT_MARGIN: 10 // percent (gross profit / sales * 100)
};

/**
 * Recommendation type definitions
 */
const RECOMMENDATION_TYPES = {
    ADD_PPC: {
        type: 'add_ppc',
        priority: 3,
        message: 'Consider starting PPC campaigns to increase visibility and sales',
        shortLabel: 'Add PPC'
    },
    REDUCE_PPC: {
        type: 'reduce_ppc',
        priority: 2,
        message: 'High ACOS detected. Consider reducing PPC spend or optimizing keywords',
        shortLabel: 'Reduce PPC'
    },
    FIX_LISTING: {
        type: 'fix_listing',
        priority: 2,
        message: 'Low conversion rate detected. Optimize listing (images, A+, reviews, pricing)',
        shortLabel: 'Fix Listing'
    },
    OPTIMIZE_KEYWORDS: {
        type: 'optimize_keywords',
        priority: 3,
        message: 'PPC spend is high relative to returns. Review and optimize keyword targeting',
        shortLabel: 'Optimize Keywords'
    },
    REVIEW_PRICING: {
        type: 'review_pricing',
        priority: 4,
        message: 'Consider reviewing pricing strategy to improve conversion',
        shortLabel: 'Review Pricing'
    },
    SALES_DECLINING: {
        type: 'sales_declining',
        priority: 1, // High priority - declining sales is urgent
        message: 'Sales are declining compared to previous period. Review pricing, inventory, and competition',
        shortLabel: 'Sales Declining'
    },
    TRAFFIC_DECLINING: {
        type: 'traffic_declining',
        priority: 1,
        message: 'Traffic (sessions) is declining. Consider increasing PPC or improving SEO/keywords',
        shortLabel: 'Traffic Declining'
    },
    FIX_BUYBOX: {
        type: 'fix_buybox',
        priority: 1,
        message: 'Low Buy Box percentage. Review pricing, inventory levels, and seller performance',
        shortLabel: 'Fix Buy Box'
    },
    REVIEW_PROFITABILITY: {
        type: 'review_profitability',
        priority: 1,
        message: 'Product has low or negative profit margin. Review costs, pricing, and fees',
        shortLabel: 'Review Profitability'
    },
    FIX_INVENTORY: {
        type: 'fix_inventory',
        priority: 2,
        message: 'Inventory issues detected. Review stranded inventory, inbound shipments, or replenishment',
        shortLabel: 'Fix Inventory'
    }
};

/**
 * Generate recommendations for a single product
 * @param {Object} params - Product data and context
 * @param {Object} params.performance - Performance metrics from ProductPerformanceService
 * @param {Object} params.comparison - Comparison data (WoW/MoM) with changes
 * @param {number} params.conversionErrorCount - Number of conversion errors (images, A+, etc.)
 * @param {number} params.rankingErrorCount - Number of ranking errors (title, bullets, etc.)
 * @param {number} params.inventoryErrorCount - Number of inventory errors
 * @param {number} params.totalErrors - Total error count for the product
 * @returns {Array<Object>} Array of recommendation objects
 */
function generateProductRecommendations({ 
    performance, 
    comparison = null,
    conversionErrorCount = 0, 
    rankingErrorCount = 0, 
    inventoryErrorCount = 0,
    totalErrors = 0 
}) {
    const recommendations = [];
    
    if (!performance) {
        return recommendations;
    }
    
    const {
        sessions = 0,
        conversionRate = 0,
        sales = 0,
        ppcSpend = 0,
        ppcSales = 0,
        acos = 0,
        hasPPC = false,
        hasTraffic = false,
        buyBoxPercentage = 100,
        grossProfit = 0
    } = performance;
    
    // === HIGH PRIORITY RULES (Trends & Profitability) ===
    
    // Rule: Sales declining significantly
    // Condition: Has comparison data AND sales change is below threshold
    if (comparison?.hasComparison && comparison.changes?.sales?.percentChange !== null) {
        const salesChange = comparison.changes.sales.percentChange;
        if (salesChange <= THRESHOLDS.SALES_DECLINE_THRESHOLD) {
            recommendations.push({
                ...RECOMMENDATION_TYPES.SALES_DECLINING,
                reason: `Sales declined by ${Math.abs(salesChange).toFixed(1)}% compared to previous period`
            });
        }
    }
    
    // Rule: Traffic (sessions) declining significantly
    // Condition: Has comparison data AND sessions change is below threshold
    if (comparison?.hasComparison && comparison.changes?.sessions?.percentChange !== null) {
        const sessionsChange = comparison.changes.sessions.percentChange;
        if (sessionsChange <= THRESHOLDS.TRAFFIC_DECLINE_THRESHOLD) {
            recommendations.push({
                ...RECOMMENDATION_TYPES.TRAFFIC_DECLINING,
                reason: `Sessions declined by ${Math.abs(sessionsChange).toFixed(1)}% compared to previous period`
            });
        }
    }
    
    // Rule: Low Buy Box percentage
    // Condition: buyBoxPercentage < LOW_BUYBOX_PERCENTAGE AND has some traffic
    if (buyBoxPercentage < THRESHOLDS.LOW_BUYBOX_PERCENTAGE && sessions > 0) {
        recommendations.push({
            ...RECOMMENDATION_TYPES.FIX_BUYBOX,
            reason: `Buy Box percentage is only ${buyBoxPercentage.toFixed(0)}% (below ${THRESHOLDS.LOW_BUYBOX_PERCENTAGE}% threshold)`
        });
    }
    
    // Rule: Low or negative profitability
    // Condition: Has sales but gross profit is low or negative
    if (sales >= THRESHOLDS.MIN_SALES_FOR_PROFITABILITY) {
        const profitMargin = sales > 0 ? (grossProfit / sales) * 100 : 0;
        if (grossProfit < 0) {
            recommendations.push({
                ...RECOMMENDATION_TYPES.REVIEW_PROFITABILITY,
                reason: `Product is losing money with a gross profit of $${grossProfit.toFixed(2)} on $${sales.toFixed(2)} in sales`
            });
        } else if (profitMargin < THRESHOLDS.LOW_PROFIT_MARGIN && profitMargin >= 0) {
            recommendations.push({
                ...RECOMMENDATION_TYPES.REVIEW_PROFITABILITY,
                reason: `Profit margin is only ${profitMargin.toFixed(1)}% (below ${THRESHOLDS.LOW_PROFIT_MARGIN}% threshold)`
            });
        }
    }
    
    // Rule: Inventory issues detected
    // Condition: Has inventory errors
    if (inventoryErrorCount > 0) {
        recommendations.push({
            ...RECOMMENDATION_TYPES.FIX_INVENTORY,
            reason: `${inventoryErrorCount} inventory issue${inventoryErrorCount > 1 ? 's' : ''} detected (stranded, inbound, or replenishment)`
        });
    }
    
    // === MEDIUM PRIORITY RULES (PPC & Listing) ===
    
    // Rule: High ACOS + decent PPC sales → "Reduce PPC / optimize keywords"
    // Condition: ACOS > HIGH_ACOS AND ppcSales > MIN_SALES_FOR_PPC_REVIEW
    if (acos > THRESHOLDS.HIGH_ACOS && ppcSales > THRESHOLDS.MIN_SALES_FOR_PPC_REVIEW) {
        recommendations.push({
            ...RECOMMENDATION_TYPES.REDUCE_PPC,
            reason: `ACOS is ${acos.toFixed(1)}% (above ${THRESHOLDS.HIGH_ACOS}% threshold)`
        });
    }
    
    // Rule: High traffic + low conversion → "Listing optimization needed"
    // Condition: sessions >= ENOUGH_TRAFFIC AND conversionRate < LOW_CONVERSION_RATE
    if (sessions >= THRESHOLDS.ENOUGH_TRAFFIC_FOR_CONVERSION && conversionRate < THRESHOLDS.LOW_CONVERSION_RATE) {
        // Check if there are actual listing issues to fix
        const hasListingIssues = conversionErrorCount > 0 || rankingErrorCount > 0;
        
        recommendations.push({
            ...RECOMMENDATION_TYPES.FIX_LISTING,
            reason: `Conversion rate is ${conversionRate.toFixed(1)}% with ${sessions} sessions${hasListingIssues ? ` and ${conversionErrorCount + rankingErrorCount} listing issues` : ''}`,
            hasListingIssues
        });
    }
    
    // === LOWER PRIORITY RULES ===
    
    // Rule: Low/no traffic + no/low PPC → "Consider starting PPC"
    // Condition: sessions < LOW_SESSIONS AND (no PPC or very low PPC spend)
    if (sessions < THRESHOLDS.LOW_SESSIONS && !hasPPC) {
        recommendations.push({
            ...RECOMMENDATION_TYPES.ADD_PPC,
            reason: `Only ${sessions} sessions with no active PPC campaigns`
        });
    }
    
    // Rule: PPC active with high spend but low/no sales → "Optimize keywords"
    // Condition: ppcSpend > MIN_PPC_SPEND AND ppcSales < ppcSpend (losing money on PPC)
    if (ppcSpend > THRESHOLDS.MIN_PPC_SPEND_FOR_REVIEW && ppcSales < ppcSpend) {
        // Only add if we haven't already added REDUCE_PPC
        const hasReducePPC = recommendations.some(r => r.type === 'reduce_ppc');
        if (!hasReducePPC) {
            recommendations.push({
                ...RECOMMENDATION_TYPES.OPTIMIZE_KEYWORDS,
                reason: `PPC spend ($${ppcSpend.toFixed(2)}) exceeds PPC sales ($${ppcSales.toFixed(2)})`
            });
        }
    }
    
    // Rule: Low conversion + no clear listing issues → "Review pricing"
    // Condition: decent traffic, low conversion, but no conversion/ranking errors
    if (sessions >= THRESHOLDS.ENOUGH_TRAFFIC_FOR_CONVERSION && 
        conversionRate < THRESHOLDS.LOW_CONVERSION_RATE && 
        conversionErrorCount === 0 && 
        rankingErrorCount === 0) {
        // Only add if we haven't already flagged declining sales or profitability
        const hasHigherPriorityIssue = recommendations.some(r => 
            r.type === 'sales_declining' || r.type === 'review_profitability'
        );
        if (!hasHigherPriorityIssue) {
            recommendations.push({
                ...RECOMMENDATION_TYPES.REVIEW_PRICING,
                reason: `Low conversion (${conversionRate.toFixed(1)}%) with no obvious listing issues - pricing may be a factor`
            });
        }
    }
    
    // Sort by priority (lower = more urgent)
    recommendations.sort((a, b) => a.priority - b.priority);
    
    return recommendations;
}

/**
 * Generate recommendations for all products
 * @param {Array} products - Array of products with 'performance', 'comparison', and error counts
 * @param {Object} errorMaps - Maps of ASIN -> error counts
 * @param {Map} errorMaps.conversionErrorMap - ASIN -> conversion error count
 * @param {Map} errorMaps.rankingErrorMap - ASIN -> ranking error count
 * @param {Map} errorMaps.inventoryErrorMap - ASIN -> inventory error count
 * @returns {Map<string, Array>} Map of ASIN -> recommendations array
 */
function generateAllRecommendations(products, errorMaps = {}) {
    const recommendationsMap = new Map();
    const { 
        conversionErrorMap = new Map(), 
        rankingErrorMap = new Map(),
        inventoryErrorMap = new Map()
    } = errorMaps;
    
    products.forEach(product => {
        const asin = (product.asin || '').trim();
        if (!asin) return;
        
        const conversionErrorCount = conversionErrorMap.get(asin) || (product.conversionErrors?.errors || 0);
        const rankingErrorCount = rankingErrorMap.get(asin) || (product.rankingErrors?.data?.TotalErrors || 0);
        const inventoryErrorCount = inventoryErrorMap.get(asin) || countInventoryErrors(product);
        const totalErrors = product.errors || 0;
        
        const recommendations = generateProductRecommendations({
            performance: product.performance,
            comparison: product.comparison,
            conversionErrorCount,
            rankingErrorCount,
            inventoryErrorCount,
            totalErrors
        });
        
        recommendationsMap.set(asin, recommendations);
    });
    
    return recommendationsMap;
}

/**
 * Count inventory errors for a product
 * @param {Object} product - Product object
 * @returns {number} Count of inventory errors
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
 * Enrich products with recommendations
 * @param {Array} products - Array of products (should have 'performance' already added)
 * @param {Map} recommendationsMap - Map from generateAllRecommendations
 * @returns {Array} Products with added 'recommendations' property
 */
function enrichProductsWithRecommendations(products, recommendationsMap) {
    return products.map(product => {
        const asin = (product.asin || '').trim();
        const recommendations = recommendationsMap.get(asin) || [];
        
        // Get the primary recommendation (highest priority / first)
        const primaryRecommendation = recommendations.length > 0 ? recommendations[0] : null;
        
        return {
            ...product,
            recommendations,
            primaryRecommendation: primaryRecommendation ? {
                type: primaryRecommendation.type,
                shortLabel: primaryRecommendation.shortLabel,
                message: primaryRecommendation.message,
                reason: primaryRecommendation.reason
            } : null
        };
    });
}

/**
 * Count error types from product wise error arrays
 * @param {Array} conversionProductWiseErrors - Array of conversion errors per product
 * @param {Array} rankingProductWiseErrors - Array of ranking errors per product
 * @param {Array} inventoryProductWiseErrors - Array of inventory errors per product (optional)
 * @returns {Object} Maps for error counts
 */
function buildErrorMaps(conversionProductWiseErrors = [], rankingProductWiseErrors = [], inventoryProductWiseErrors = []) {
    const conversionErrorMap = new Map();
    const rankingErrorMap = new Map();
    const inventoryErrorMap = new Map();
    
    // Count conversion errors per ASIN
    conversionProductWiseErrors.forEach(item => {
        const asin = (item.asin || '').trim();
        if (asin) {
            // Count actual errors from the error object
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
    
    // Count ranking errors per ASIN
    rankingProductWiseErrors.forEach(item => {
        const asin = (item.asin || '').trim();
        if (asin && item.data) {
            const data = item.data;
            let errorCount = 0;
            
            // Title errors
            if (data.TitleResult) {
                if (data.TitleResult.charLim?.status === 'Error') errorCount++;
                if (data.TitleResult.RestictedWords?.status === 'Error') errorCount++;
                if (data.TitleResult.checkSpecialCharacters?.status === 'Error') errorCount++;
            }
            
            // Bullet point errors
            if (data.BulletPoints) {
                if (data.BulletPoints.charLim?.status === 'Error') errorCount++;
                if (data.BulletPoints.RestictedWords?.status === 'Error') errorCount++;
                if (data.BulletPoints.checkSpecialCharacters?.status === 'Error') errorCount++;
            }
            
            // Description errors
            if (data.Description) {
                if (data.Description.charLim?.status === 'Error') errorCount++;
                if (data.Description.RestictedWords?.status === 'Error') errorCount++;
                if (data.Description.checkSpecialCharacters?.status === 'Error') errorCount++;
            }
            
            // Backend keywords
            if (data.charLim?.status === 'Error') errorCount++;
            if (data.dublicateWords?.status === 'Error') errorCount++;
            
            rankingErrorMap.set(asin, errorCount);
        }
    });
    
    // Count inventory errors per ASIN
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
    THRESHOLDS,
    RECOMMENDATION_TYPES
};
