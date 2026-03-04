/**
 * QMateProfitabilityService
 * 
 * Specialized service for profitability analysis for QMate AI.
 * Provides detailed profit/loss analysis, COGS integration, margin categorization,
 * and parent-child ASIN aggregation.
 * 
 * Data Sources:
 * - EconomicsMetrics: Sales, profit, fees data
 * - CogsModel: Cost of goods sold per ASIN
 * - ProductWiseFinancial: Detailed product-wise financials
 * - AsinWiseSalesForBigAccounts: Big account data
 * - IssuesDataChunks: Profitability issues
 * 
 * This service is INDEPENDENT and does not affect any existing flows.
 */

const logger = require('../../utils/Logger.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const CogsModel = require('../../models/finance/CogsModel.js');
const ProductWiseFinancial = require('../../models/finance/ProductWiseFinancialModel.js');
const IssuesDataChunks = require('../../models/system/IssuesDataChunksModel.js');
const mongoose = require('mongoose');

/**
 * Get COGS data for all products
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @returns {Promise<Object>} COGS data
 */
async function getCOGSData(userId, country) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const cogsDoc = await CogsModel.findOne({ 
            userId: userObjectId, 
            countryCode: country 
        }).lean();
        
        if (!cogsDoc || !cogsDoc.cogsEntries || cogsDoc.cogsEntries.length === 0) {
            return {
                success: false,
                source: 'none',
                error: 'No COGS data found',
                data: {
                    hasCOGS: false,
                    entries: [],
                    summary: { totalProducts: 0, productsWithCOGS: 0 }
                }
            };
        }
        
        const entries = cogsDoc.cogsEntries.map(e => ({
            asin: e.asin,
            sku: e.sku || null,
            cogs: parseFloat((e.cogs || 0).toFixed(2))
        }));
        
        logger.info('[QMateProfitabilityService] Got COGS data', {
            userId, country,
            duration: Date.now() - startTime,
            entriesCount: entries.length
        });
        
        return {
            success: true,
            source: 'cogs_model',
            data: {
                hasCOGS: true,
                entries,
                summary: {
                    productsWithCOGS: entries.length,
                    averageCOGS: entries.length > 0 
                        ? parseFloat((entries.reduce((s, e) => s + e.cogs, 0) / entries.length).toFixed(2))
                        : 0
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateProfitabilityService] Error getting COGS data', {
            error: error.message, userId, country
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get profit margin categorization
 * Categorizes products by margin level
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Margin categories
 */
async function getProfitMarginCategories(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Get economics metrics and COGS
        const [economicsMetrics, cogsDoc] = await Promise.all([
            EconomicsMetrics.findLatest(userObjectId, region, country),
            CogsModel.findOne({ userId: userObjectId, countryCode: country }).lean()
        ]);
        
        if (!economicsMetrics) {
            return {
                success: false,
                source: 'none',
                error: 'No economics data found',
                data: null
            };
        }
        
        // Build COGS map
        const cogsMap = {};
        if (cogsDoc?.cogsEntries) {
            cogsDoc.cogsEntries.forEach(e => {
                cogsMap[e.asin] = e.cogs || 0;
            });
        }
        
        let profitabilityData = [];
        const isBigAccount = economicsMetrics.isBig === true;
        
        if (isBigAccount || (!economicsMetrics.asinWiseSales?.length && economicsMetrics.totalSales?.amount > 5000)) {
            const profitMap = await AsinWiseSalesForBigAccounts.getProfitabilityMapByMetricsId(economicsMetrics._id);
            profitabilityData = Array.from(profitMap.values());
        } else if (Array.isArray(economicsMetrics.asinWiseSales)) {
            const asinMap = new Map();
            economicsMetrics.asinWiseSales.forEach(item => {
                if (!item.asin) return;
                if (asinMap.has(item.asin)) {
                    const e = asinMap.get(item.asin);
                    e.sales += item.sales?.amount || 0;
                    e.grossProfit += item.grossProfit?.amount || 0;
                    e.ads += item.ppcSpent?.amount || 0;
                    e.unitsSold += item.unitsSold || 0;
                } else {
                    asinMap.set(item.asin, {
                        asin: item.asin,
                        parentAsin: item.parentAsin,
                        sales: item.sales?.amount || 0,
                        grossProfit: item.grossProfit?.amount || 0,
                        ads: item.ppcSpent?.amount || 0,
                        unitsSold: item.unitsSold || 0
                    });
                }
            });
            profitabilityData = Array.from(asinMap.values());
        }
        
        // Calculate margins with COGS
        const categories = {
            highMargin: [], // > 30%
            healthyMargin: [], // 15-30%
            lowMargin: [], // 0-15%
            lossMaking: [] // < 0%
        };
        
        let totalSales = 0;
        let totalProfit = 0;
        let productsWithCOGS = 0;
        
        profitabilityData.forEach(item => {
            const cogsPerUnit = cogsMap[item.asin] || 0;
            const totalCogs = cogsPerUnit * (item.unitsSold || 0);
            const netProfit = (item.grossProfit || 0) - totalCogs - (item.ads || 0);
            const profitMargin = item.sales > 0 ? (netProfit / item.sales) * 100 : 0;
            
            if (cogsPerUnit > 0) productsWithCOGS++;
            totalSales += item.sales || 0;
            totalProfit += netProfit;
            
            const product = {
                asin: item.asin,
                parentAsin: item.parentAsin || item.asin,
                sales: parseFloat((item.sales || 0).toFixed(2)),
                grossProfit: parseFloat((item.grossProfit || 0).toFixed(2)),
                cogs: parseFloat(totalCogs.toFixed(2)),
                adsSpend: parseFloat((item.ads || 0).toFixed(2)),
                netProfit: parseFloat(netProfit.toFixed(2)),
                profitMargin: parseFloat(profitMargin.toFixed(2)),
                unitsSold: item.unitsSold || 0,
                hasCOGS: cogsPerUnit > 0
            };
            
            if (profitMargin < 0) {
                categories.lossMaking.push(product);
            } else if (profitMargin < 15) {
                categories.lowMargin.push(product);
            } else if (profitMargin < 30) {
                categories.healthyMargin.push(product);
            } else {
                categories.highMargin.push(product);
            }
        });
        
        // Sort each category by sales
        Object.keys(categories).forEach(key => {
            categories[key].sort((a, b) => b.sales - a.sales);
            categories[key] = categories[key].slice(0, 15);
        });
        
        const overallMargin = totalSales > 0 ? (totalProfit / totalSales) * 100 : 0;
        
        logger.info('[QMateProfitabilityService] Got margin categories', {
            userId, country, region,
            duration: Date.now() - startTime,
            highMargin: categories.highMargin.length,
            lossMaking: categories.lossMaking.length
        });
        
        return {
            success: true,
            source: 'economics_metrics',
            data: {
                categories,
                summary: {
                    totalProducts: profitabilityData.length,
                    productsWithCOGS,
                    highMarginCount: categories.highMargin.length,
                    healthyMarginCount: categories.healthyMargin.length,
                    lowMarginCount: categories.lowMargin.length,
                    lossMakingCount: categories.lossMaking.length,
                    totalSales: parseFloat(totalSales.toFixed(2)),
                    totalNetProfit: parseFloat(totalProfit.toFixed(2)),
                    overallProfitMargin: parseFloat(overallMargin.toFixed(2))
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateProfitabilityService] Error getting margin categories', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get parent-child ASIN aggregation
 * Groups child ASINs under their parent for analysis
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Parent-child aggregation
 */
async function getParentChildAggregation(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const economicsMetrics = await EconomicsMetrics.findLatest(userObjectId, region, country);
        
        if (!economicsMetrics) {
            return {
                success: false,
                source: 'none',
                error: 'No economics data found',
                data: null
            };
        }
        
        let asinData = [];
        const isBigAccount = economicsMetrics.isBig === true;
        
        if (isBigAccount || (!economicsMetrics.asinWiseSales?.length && economicsMetrics.totalSales?.amount > 5000)) {
            const profitMap = await AsinWiseSalesForBigAccounts.getProfitabilityMapByMetricsId(economicsMetrics._id);
            asinData = Array.from(profitMap.values());
        } else if (Array.isArray(economicsMetrics.asinWiseSales)) {
            asinData = economicsMetrics.asinWiseSales;
        }
        
        // Group by parent ASIN
        const parentMap = new Map();
        
        asinData.forEach(item => {
            const childAsin = item.asin;
            const parentAsin = item.parentAsin || item.asin;
            
            if (!parentMap.has(parentAsin)) {
                parentMap.set(parentAsin, {
                    parentAsin,
                    children: [],
                    totalSales: 0,
                    totalGrossProfit: 0,
                    totalAdsSpend: 0,
                    totalUnitsSold: 0
                });
            }
            
            const parent = parentMap.get(parentAsin);
            const sales = item.sales?.amount || item.sales || 0;
            const grossProfit = item.grossProfit?.amount || item.grossProfit || 0;
            const adsSpend = item.ppcSpent?.amount || item.ads || 0;
            const unitsSold = item.unitsSold || 0;
            
            parent.children.push({
                asin: childAsin,
                sales: parseFloat(sales.toFixed(2)),
                grossProfit: parseFloat(grossProfit.toFixed(2)),
                adsSpend: parseFloat(adsSpend.toFixed(2)),
                unitsSold
            });
            
            parent.totalSales += sales;
            parent.totalGrossProfit += grossProfit;
            parent.totalAdsSpend += adsSpend;
            parent.totalUnitsSold += unitsSold;
        });
        
        // Convert to array and calculate parent metrics
        const parentProducts = Array.from(parentMap.values())
            .map(p => {
                const netProfit = p.totalGrossProfit - p.totalAdsSpend;
                const profitMargin = p.totalSales > 0 ? (netProfit / p.totalSales) * 100 : 0;
                
                return {
                    parentAsin: p.parentAsin,
                    childCount: p.children.length,
                    children: p.children.slice(0, 5),
                    totalSales: parseFloat(p.totalSales.toFixed(2)),
                    totalGrossProfit: parseFloat(p.totalGrossProfit.toFixed(2)),
                    totalAdsSpend: parseFloat(p.totalAdsSpend.toFixed(2)),
                    netProfit: parseFloat(netProfit.toFixed(2)),
                    profitMargin: parseFloat(profitMargin.toFixed(2)),
                    totalUnitsSold: p.totalUnitsSold
                };
            })
            .sort((a, b) => b.totalSales - a.totalSales)
            .slice(0, 30);
        
        const multiVariationProducts = parentProducts.filter(p => p.childCount > 1);
        
        logger.info('[QMateProfitabilityService] Got parent-child aggregation', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalParents: parentProducts.length,
            multiVariation: multiVariationProducts.length
        });
        
        return {
            success: true,
            source: 'economics_metrics',
            data: {
                parentProducts,
                multiVariationProducts,
                summary: {
                    totalParentAsins: parentProducts.length,
                    multiVariationCount: multiVariationProducts.length,
                    singleVariationCount: parentProducts.length - multiVariationProducts.length
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateProfitabilityService] Error getting parent-child aggregation', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get profitability issues from issues data
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Profitability issues
 */
async function getProfitabilityIssues(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const profitabilityErrors = await IssuesDataChunks.getFieldData(
            userObjectId, country, region, 'profitabilityError'
        );
        
        if (!profitabilityErrors || profitabilityErrors.length === 0) {
            return {
                success: false,
                source: 'none',
                error: 'No profitability issues found',
                data: { issues: [], count: 0 }
            };
        }
        
        // Categorize issues
        const categorizedIssues = {
            highFees: [],
            lowMargin: [],
            highAdsCost: [],
            negativeProfits: [],
            other: []
        };
        
        profitabilityErrors.forEach(issue => {
            const type = (issue.type || issue.errorType || '').toLowerCase();
            const formatted = {
                asin: issue.asin,
                productName: issue.name || issue.productName || 'Unknown',
                type: issue.type || issue.errorType,
                message: issue.message || issue.description,
                impact: issue.impact || issue.severity || 'medium',
                suggestion: issue.suggestion || issue.solution
            };
            
            if (type.includes('fee')) {
                categorizedIssues.highFees.push(formatted);
            } else if (type.includes('margin')) {
                categorizedIssues.lowMargin.push(formatted);
            } else if (type.includes('ad') || type.includes('ppc')) {
                categorizedIssues.highAdsCost.push(formatted);
            } else if (type.includes('negative') || type.includes('loss')) {
                categorizedIssues.negativeProfits.push(formatted);
            } else {
                categorizedIssues.other.push(formatted);
            }
        });
        
        // Limit each category
        Object.keys(categorizedIssues).forEach(key => {
            categorizedIssues[key] = categorizedIssues[key].slice(0, 10);
        });
        
        logger.info('[QMateProfitabilityService] Got profitability issues', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalIssues: profitabilityErrors.length
        });
        
        return {
            success: true,
            source: 'issues_data_chunks',
            data: {
                categorizedIssues,
                summary: {
                    totalIssues: profitabilityErrors.length,
                    highFeesCount: categorizedIssues.highFees.length,
                    lowMarginCount: categorizedIssues.lowMargin.length,
                    negativeProfitsCount: categorizedIssues.negativeProfits.length
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateProfitabilityService] Error getting profitability issues', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get product-wise financial breakdown
 * Detailed fees breakdown per product
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {number} limit - Max products to return
 * @returns {Promise<Object>} Product financial breakdown
 */
async function getProductFinancialBreakdown(userId, country, region, limit = 20) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const financialData = await ProductWiseFinancial.findOne({ 
            userid: userObjectId, 
            country, 
            region 
        }).sort({ createdAt: -1 }).lean();
        
        if (!financialData || !financialData.financialData?.length) {
            return {
                success: false,
                source: 'none',
                error: 'No product financial data found',
                data: null
            };
        }
        
        const products = financialData.financialData
            .map(p => ({
                asin: p.asin,
                quantity: p.quantity || 0,
                fbaFees: parseFloat((p.FBAFees || 0).toFixed(2)),
                refunds: parseFloat((p.Refunds || 0).toFixed(2)),
                adsPayments: parseFloat((p.ProductsAdsPayments || 0).toFixed(2)),
                shipment: parseFloat((p.Shipment || 0).toFixed(2)),
                adjustment: parseFloat((p.Adjustment || 0).toFixed(2)),
                amazonFees: parseFloat((p.AmazonFees || 0).toFixed(2)),
                storage: parseFloat((p.Storage || 0).toFixed(2)),
                totalFees: parseFloat((
                    (p.FBAFees || 0) + (p.AmazonFees || 0) + (p.Storage || 0)
                ).toFixed(2))
            }))
            .sort((a, b) => b.totalFees - a.totalFees)
            .slice(0, limit);
        
        const totalFees = products.reduce((sum, p) => sum + p.totalFees, 0);
        const totalRefunds = products.reduce((sum, p) => sum + p.refunds, 0);
        
        logger.info('[QMateProfitabilityService] Got product financial breakdown', {
            userId, country, region,
            duration: Date.now() - startTime,
            productsCount: products.length
        });
        
        return {
            success: true,
            source: 'product_wise_financial',
            data: {
                products,
                summary: {
                    productsAnalyzed: products.length,
                    totalFeesInPeriod: parseFloat(totalFees.toFixed(2)),
                    totalRefundsInPeriod: parseFloat(totalRefunds.toFixed(2))
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateProfitabilityService] Error getting product financial breakdown', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get complete profitability context for QMate AI
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Complete profitability context
 */
async function getQMateProfitabilityContext(userId, country, region) {
    const startTime = Date.now();
    
    try {
        // Fetch all data in parallel
        const [
            cogsResult,
            marginCategoriesResult,
            parentChildResult,
            issuesResult,
            financialBreakdownResult
        ] = await Promise.all([
            getCOGSData(userId, country),
            getProfitMarginCategories(userId, country, region),
            getParentChildAggregation(userId, country, region),
            getProfitabilityIssues(userId, country, region),
            getProductFinancialBreakdown(userId, country, region, 15)
        ]);
        
        const context = {
            cogsData: null,
            marginCategories: null,
            parentChildAnalysis: null,
            issues: null,
            financialBreakdown: null
        };
        
        if (cogsResult?.success) {
            context.cogsData = cogsResult.data;
        }
        
        if (marginCategoriesResult?.success) {
            context.marginCategories = marginCategoriesResult.data;
        }
        
        if (parentChildResult?.success) {
            context.parentChildAnalysis = parentChildResult.data;
        }
        
        if (issuesResult?.success) {
            context.issues = issuesResult.data;
        }
        
        if (financialBreakdownResult?.success) {
            context.financialBreakdown = financialBreakdownResult.data;
        }
        
        // Generate overall profitability summary
        context.overallSummary = {
            hasCOGSData: context.cogsData?.hasCOGS || false,
            totalProducts: context.marginCategories?.summary?.totalProducts || 0,
            overallProfitMargin: context.marginCategories?.summary?.overallProfitMargin || 0,
            lossMakingCount: context.marginCategories?.summary?.lossMakingCount || 0,
            totalIssues: context.issues?.summary?.totalIssues || 0,
            topRecommendation: context.marginCategories?.summary?.lossMakingCount > 0 
                ? 'Review loss-making products and consider price adjustments or cost reduction'
                : (context.marginCategories?.summary?.lowMarginCount > 5 
                    ? 'Optimize low-margin products to improve overall profitability'
                    : 'Profitability is healthy, focus on scaling top performers')
        };
        
        logger.info('[QMateProfitabilityService] Got complete profitability context', {
            userId, country, region,
            duration: Date.now() - startTime
        });
        
        return {
            success: true,
            source: 'combined_profitability_sources',
            data: context
        };
        
    } catch (error) {
        logger.error('[QMateProfitabilityService] Error getting profitability context', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

module.exports = {
    getCOGSData,
    getProfitMarginCategories,
    getParentChildAggregation,
    getProfitabilityIssues,
    getProductFinancialBreakdown,
    getQMateProfitabilityContext
};
