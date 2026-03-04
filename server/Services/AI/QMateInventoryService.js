/**
 * QMateInventoryService
 * 
 * Specialized service for inventory data for QMate AI.
 * Provides stranded inventory, non-compliance, planning, and replenishment data.
 * 
 * Data Sources:
 * - StrandedInventoryUIData: Stranded inventory with reasons
 * - GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA: Non-compliance issues
 * - GET_FBA_INVENTORY_PLANNING_DATA: Aging inventory data
 * - RestockInventoryRecommendations: Restock recommendations
 * - ProductWiseFBAData: FBA product data
 * - IssuesDataChunks: Inventory issues
 * 
 * This service is INDEPENDENT and does not affect any existing flows.
 */

const logger = require('../../utils/Logger.js');
const StrandedInventory = require('../../models/inventory/GET_STRANDED_INVENTORY_UI_DATA_MODEL.js');
const NonComplianceData = require('../../models/inventory/GET_FBA_FULFILLMENT_INBOUND_NONCOMPLAIANCE_DATA.js');
const InventoryPlanning = require('../../models/inventory/GET_FBA_INVENTORY_PLANNING_DATA_Model.js');
const RestockRecommendations = require('../../models/inventory/GET_RESTOCK_INVENTORY_RECOMMENDATIONS_REPORT_Model.js');
const ProductWiseFBAData = require('../../models/inventory/ProductWiseFBADataModel.js');
const IssuesDataChunks = require('../../models/system/IssuesDataChunksModel.js');
const mongoose = require('mongoose');

/**
 * Get stranded inventory data
 * Products that are stuck and not available for sale
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Stranded inventory data
 */
async function getStrandedInventory(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const strandedData = await StrandedInventory.findOne({ User: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!strandedData || !strandedData.strandedUIData?.length) {
            return {
                success: true,
                source: 'stranded_inventory',
                data: {
                    hasStranded: false,
                    strandedProducts: [],
                    summary: { totalStranded: 0, byReason: {} }
                }
            };
        }
        
        // Flatten the nested array
        const allStranded = strandedData.strandedUIData.flat().filter(item => item && item.asin);
        
        // Group by reason
        const byReason = {};
        allStranded.forEach(item => {
            const reason = item.stranded_reason || 'Unknown';
            if (!byReason[reason]) {
                byReason[reason] = [];
            }
            byReason[reason].push({
                asin: item.asin,
                status: item.status_primary || 'stranded',
                reason
            });
        });
        
        // Get top stranded products
        const strandedProducts = allStranded.slice(0, 25).map(item => ({
            asin: item.asin,
            status: item.status_primary || 'stranded',
            reason: item.stranded_reason || 'Unknown'
        }));
        
        // Create reason summary
        const reasonSummary = {};
        Object.keys(byReason).forEach(reason => {
            reasonSummary[reason] = byReason[reason].length;
        });
        
        logger.info('[QMateInventoryService] Got stranded inventory', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalStranded: allStranded.length
        });
        
        return {
            success: true,
            source: 'stranded_inventory',
            data: {
                hasStranded: allStranded.length > 0,
                strandedProducts,
                summary: {
                    totalStranded: allStranded.length,
                    byReason: reasonSummary
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateInventoryService] Error getting stranded inventory', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get non-compliance issues
 * FBA fulfillment inbound non-compliance data
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Non-compliance data
 */
async function getNonComplianceData(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const ncData = await NonComplianceData.findOne({ userId: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!ncData || !ncData.ErrorData?.length) {
            return {
                success: true,
                source: 'non_compliance',
                data: {
                    hasIssues: false,
                    issues: [],
                    summary: { totalIssues: 0, byProblemType: {} }
                }
            };
        }
        
        // Group by problem type
        const byProblemType = {};
        ncData.ErrorData.forEach(item => {
            const problemType = item.problemType || 'Unknown';
            if (!byProblemType[problemType]) {
                byProblemType[problemType] = [];
            }
            byProblemType[problemType].push({
                asin: item.asin,
                problemType,
                issueReportedDate: item.issueReportedDate,
                shipmentCreationDate: item.shipmentCreationDate
            });
        });
        
        // Get all issues formatted
        const issues = ncData.ErrorData.slice(0, 30).map(item => ({
            asin: item.asin,
            problemType: item.problemType || 'Unknown',
            issueReportedDate: item.issueReportedDate,
            shipmentCreationDate: item.shipmentCreationDate
        }));
        
        // Create problem type summary
        const problemTypeSummary = {};
        Object.keys(byProblemType).forEach(type => {
            problemTypeSummary[type] = byProblemType[type].length;
        });
        
        logger.info('[QMateInventoryService] Got non-compliance data', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalIssues: ncData.ErrorData.length
        });
        
        return {
            success: true,
            source: 'non_compliance',
            data: {
                hasIssues: ncData.ErrorData.length > 0,
                issues,
                summary: {
                    totalIssues: ncData.ErrorData.length,
                    byProblemType: problemTypeSummary
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateInventoryService] Error getting non-compliance data', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get aging inventory data
 * Products approaching long-term storage fees
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Aging inventory data
 */
async function getAgingInventory(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const planningData = await InventoryPlanning.findOne({ User: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!planningData || !planningData.data?.length) {
            return {
                success: true,
                source: 'inventory_planning',
                data: {
                    hasAgingInventory: false,
                    agingProducts: [],
                    summary: { totalProducts: 0, totalUnfulfillable: 0, agingCategories: {} }
                }
            };
        }
        
        let totalUnfulfillable = 0;
        const agingCategories = {
            '181_210_days': 0,
            '211_240_days': 0,
            '241_270_days': 0,
            '271_300_days': 0,
            '301_330_days': 0,
            '331_365_days': 0,
            '365_plus_days': 0
        };
        
        const agingProducts = planningData.data
            .filter(item => {
                // Check if any aging quantity
                const hasAging = 
                    parseInt(item.quantity_to_be_charged_ais_181_210_days) > 0 ||
                    parseInt(item.quantity_to_be_charged_ais_211_240_days) > 0 ||
                    parseInt(item.quantity_to_be_charged_ais_241_270_days) > 0 ||
                    parseInt(item.quantity_to_be_charged_ais_271_300_days) > 0 ||
                    parseInt(item.quantity_to_be_charged_ais_301_330_days) > 0 ||
                    parseInt(item.quantity_to_be_charged_ais_331_365_days) > 0 ||
                    parseInt(item.quantity_to_be_charged_ais_365_plus_days) > 0;
                return hasAging;
            })
            .map(item => {
                const qty181_210 = parseInt(item.quantity_to_be_charged_ais_181_210_days) || 0;
                const qty211_240 = parseInt(item.quantity_to_be_charged_ais_211_240_days) || 0;
                const qty241_270 = parseInt(item.quantity_to_be_charged_ais_241_270_days) || 0;
                const qty271_300 = parseInt(item.quantity_to_be_charged_ais_271_300_days) || 0;
                const qty301_330 = parseInt(item.quantity_to_be_charged_ais_301_330_days) || 0;
                const qty331_365 = parseInt(item.quantity_to_be_charged_ais_331_365_days) || 0;
                const qty365_plus = parseInt(item.quantity_to_be_charged_ais_365_plus_days) || 0;
                const unfulfillable = parseInt(item.unfulfillable_quantity) || 0;
                
                agingCategories['181_210_days'] += qty181_210;
                agingCategories['211_240_days'] += qty211_240;
                agingCategories['241_270_days'] += qty241_270;
                agingCategories['271_300_days'] += qty271_300;
                agingCategories['301_330_days'] += qty301_330;
                agingCategories['331_365_days'] += qty331_365;
                agingCategories['365_plus_days'] += qty365_plus;
                totalUnfulfillable += unfulfillable;
                
                const totalAging = qty181_210 + qty211_240 + qty241_270 + qty271_300 + qty301_330 + qty331_365 + qty365_plus;
                
                return {
                    asin: item.asin,
                    totalAgingUnits: totalAging,
                    unfulfillable,
                    agingBreakdown: {
                        '181_210_days': qty181_210,
                        '211_240_days': qty211_240,
                        '241_270_days': qty241_270,
                        '271_300_days': qty271_300,
                        '301_330_days': qty301_330,
                        '331_365_days': qty331_365,
                        '365_plus_days': qty365_plus
                    },
                    urgency: qty365_plus > 0 ? 'critical' : (qty331_365 > 0 ? 'high' : 'medium')
                };
            })
            .sort((a, b) => b.totalAgingUnits - a.totalAgingUnits)
            .slice(0, 20);
        
        const totalAgingUnits = Object.values(agingCategories).reduce((a, b) => a + b, 0);
        
        logger.info('[QMateInventoryService] Got aging inventory', {
            userId, country, region,
            duration: Date.now() - startTime,
            agingProductsCount: agingProducts.length,
            totalAgingUnits
        });
        
        return {
            success: true,
            source: 'inventory_planning',
            data: {
                hasAgingInventory: agingProducts.length > 0,
                agingProducts,
                summary: {
                    totalProducts: agingProducts.length,
                    totalUnfulfillable,
                    totalAgingUnits,
                    agingCategories
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateInventoryService] Error getting aging inventory', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get replenishment recommendations
 * Products that need restocking
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Replenishment data
 */
async function getReplenishmentRecommendations(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const restockData = await RestockRecommendations.findOne({ User: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!restockData || !restockData.Products?.length) {
            return {
                success: true,
                source: 'restock_recommendations',
                data: {
                    hasRecommendations: false,
                    products: [],
                    summary: { totalProducts: 0, needsRestock: 0, lowStock: 0, outOfStock: 0 }
                }
            };
        }
        
        let needsRestock = 0;
        let lowStock = 0;
        let outOfStock = 0;
        
        const products = restockData.Products
            .filter(p => {
                const recQty = parseInt(p.recommendedReplenishmentQty) || 0;
                const available = parseInt(p.available) || 0;
                const alert = (p.alert || '').toLowerCase();
                
                return recQty > 0 || alert.includes('low') || alert.includes('out') || available === 0;
            })
            .map(p => {
                const recQty = parseInt(p.recommendedReplenishmentQty) || 0;
                const available = parseInt(p.available) || 0;
                const daysOfSupply = parseInt(p.daysOfSupplyAtAmazon) || parseInt(p.totalDaysOfSupply) || 0;
                const unitsSold = parseInt(p.unitsSoldLast30Days) || 0;
                const alert = (p.alert || '').toLowerCase();
                
                let status = 'normal';
                if (available === 0) {
                    status = 'out_of_stock';
                    outOfStock++;
                } else if (daysOfSupply < 14 || alert.includes('low')) {
                    status = 'low_stock';
                    lowStock++;
                }
                
                if (recQty > 0) needsRestock++;
                
                return {
                    asin: p.asin,
                    productName: p.productName || '',
                    available,
                    inbound: parseInt(p.inbound) || 0,
                    daysOfSupply,
                    unitsSoldLast30Days: unitsSold,
                    recommendedQty: recQty,
                    recommendedShipDate: p.recommendedShipDate || null,
                    alert: p.alert || '',
                    status,
                    urgency: status === 'out_of_stock' ? 'critical' : (status === 'low_stock' ? 'high' : 'medium')
                };
            })
            .sort((a, b) => {
                // Sort by urgency
                const urgencyOrder = { critical: 0, high: 1, medium: 2 };
                return (urgencyOrder[a.urgency] || 2) - (urgencyOrder[b.urgency] || 2);
            })
            .slice(0, 25);
        
        logger.info('[QMateInventoryService] Got replenishment recommendations', {
            userId, country, region,
            duration: Date.now() - startTime,
            productsCount: products.length
        });
        
        return {
            success: true,
            source: 'restock_recommendations',
            data: {
                hasRecommendations: products.length > 0,
                products,
                summary: {
                    totalProducts: restockData.Products.length,
                    needsRestock,
                    lowStock,
                    outOfStock
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateInventoryService] Error getting replenishment recommendations', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get inventory issues from issues data
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Inventory issues
 */
async function getInventoryIssues(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const inventoryErrors = await IssuesDataChunks.getFieldData(
            userObjectId, country, region, 'inventoryError'
        );
        
        if (!inventoryErrors || inventoryErrors.length === 0) {
            return {
                success: true,
                source: 'issues_data_chunks',
                data: { issues: [], count: 0 }
            };
        }
        
        const issues = inventoryErrors.slice(0, 30).map(issue => ({
            asin: issue.asin,
            productName: issue.name || issue.productName || 'Unknown',
            type: issue.type || issue.errorType,
            message: issue.message || issue.description,
            suggestion: issue.suggestion || issue.solution
        }));
        
        logger.info('[QMateInventoryService] Got inventory issues', {
            userId, country, region,
            duration: Date.now() - startTime,
            issuesCount: issues.length
        });
        
        return {
            success: true,
            source: 'issues_data_chunks',
            data: {
                issues,
                count: inventoryErrors.length
            }
        };
        
    } catch (error) {
        logger.error('[QMateInventoryService] Error getting inventory issues', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get complete inventory context for QMate AI
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Complete inventory context
 */
async function getQMateInventoryContext(userId, country, region) {
    const startTime = Date.now();
    
    try {
        // Fetch all inventory data in parallel
        const [
            strandedResult,
            nonComplianceResult,
            agingResult,
            replenishmentResult,
            issuesResult
        ] = await Promise.all([
            getStrandedInventory(userId, country, region),
            getNonComplianceData(userId, country, region),
            getAgingInventory(userId, country, region),
            getReplenishmentRecommendations(userId, country, region),
            getInventoryIssues(userId, country, region)
        ]);
        
        const context = {
            stranded: null,
            nonCompliance: null,
            aging: null,
            replenishment: null,
            issues: null
        };
        
        if (strandedResult?.success) {
            context.stranded = strandedResult.data;
        }
        
        if (nonComplianceResult?.success) {
            context.nonCompliance = nonComplianceResult.data;
        }
        
        if (agingResult?.success) {
            context.aging = agingResult.data;
        }
        
        if (replenishmentResult?.success) {
            context.replenishment = replenishmentResult.data;
        }
        
        if (issuesResult?.success) {
            context.issues = issuesResult.data;
        }
        
        // Generate overall inventory health summary
        const strandedCount = context.stranded?.summary?.totalStranded || 0;
        const nonComplianceCount = context.nonCompliance?.summary?.totalIssues || 0;
        const agingCount = context.aging?.summary?.totalAgingUnits || 0;
        const outOfStockCount = context.replenishment?.summary?.outOfStock || 0;
        const lowStockCount = context.replenishment?.summary?.lowStock || 0;
        
        let healthScore = 100;
        let healthStatus = 'healthy';
        const concerns = [];
        
        if (outOfStockCount > 0) {
            healthScore -= outOfStockCount * 5;
            concerns.push(`${outOfStockCount} products out of stock`);
        }
        if (lowStockCount > 5) {
            healthScore -= 10;
            concerns.push(`${lowStockCount} products with low stock`);
        }
        if (strandedCount > 0) {
            healthScore -= Math.min(strandedCount * 2, 15);
            concerns.push(`${strandedCount} stranded products`);
        }
        if (nonComplianceCount > 0) {
            healthScore -= Math.min(nonComplianceCount * 3, 15);
            concerns.push(`${nonComplianceCount} non-compliance issues`);
        }
        if (agingCount > 100) {
            healthScore -= 10;
            concerns.push('Significant aging inventory');
        }
        
        healthScore = Math.max(0, healthScore);
        if (healthScore < 50) healthStatus = 'critical';
        else if (healthScore < 80) healthStatus = 'needs_attention';
        
        context.overallSummary = {
            healthScore,
            healthStatus,
            concerns,
            criticalActions: [
                ...(outOfStockCount > 0 ? ['Restock out-of-stock products immediately'] : []),
                ...(strandedCount > 0 ? ['Resolve stranded inventory issues'] : []),
                ...(nonComplianceCount > 0 ? ['Address non-compliance problems'] : []),
                ...(agingCount > 100 ? ['Consider promotional pricing for aging inventory'] : [])
            ].slice(0, 3)
        };
        
        logger.info('[QMateInventoryService] Got complete inventory context', {
            userId, country, region,
            duration: Date.now() - startTime,
            healthScore
        });
        
        return {
            success: true,
            source: 'combined_inventory_sources',
            data: context
        };
        
    } catch (error) {
        logger.error('[QMateInventoryService] Error getting inventory context', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

module.exports = {
    getStrandedInventory,
    getNonComplianceData,
    getAgingInventory,
    getReplenishmentRecommendations,
    getInventoryIssues,
    getQMateInventoryContext
};
