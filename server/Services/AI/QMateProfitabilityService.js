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
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
const { getAdsSpendByAsin } = require('../amazon-ads/ProductWiseSponsoredAdsService.js');
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
 * Get datewise profitability data (gross profit and sales per day)
 * Matches the Profitability Dashboard chart exactly
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Datewise profitability data
 */
async function getDatewiseProfitability(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        const userIdStr = userId?.toString() || userId;
        
        const [economicsMetrics, ppcMetrics] = await Promise.all([
            EconomicsMetrics.findLatest(userObjectId, region, country),
            PPCMetrics.findLatestForUser(userIdStr, country, region)
        ]);
        
        if (!economicsMetrics) {
            return {
                success: false,
                source: 'none',
                error: 'No economics data found',
                data: null
            };
        }
        
        const currencyCode = economicsMetrics.totalSales?.currencyCode || 'USD';
        const datewiseSales = economicsMetrics.datewiseSales || [];
        const datewiseFeesAndRefunds = economicsMetrics.datewiseFeesAndRefunds || [];
        const datewiseAmazonFees = economicsMetrics.datewiseAmazonFees || [];
        const dateWisePPCMetrics = ppcMetrics?.dateWiseMetrics || [];
        
        const feesMap = new Map();
        datewiseFeesAndRefunds.forEach(item => {
            if (item.date) {
                const dateKey = new Date(item.date).toISOString().split('T')[0];
                feesMap.set(dateKey, {
                    fbaFees: item.fbaFulfillmentFee?.amount || 0,
                    storageFees: item.storageFee?.amount || 0,
                    refunds: item.refunds?.amount || 0
                });
            }
        });
        
        const amazonFeesMap = new Map();
        datewiseAmazonFees.forEach(item => {
            if (item.date) {
                const dateKey = new Date(item.date).toISOString().split('T')[0];
                amazonFeesMap.set(dateKey, item.totalAmount?.amount || 0);
            }
        });
        
        const ppcMap = new Map();
        dateWisePPCMetrics.forEach(item => {
            if (item.date) {
                const dateKey = new Date(item.date).toISOString().split('T')[0];
                ppcMap.set(dateKey, {
                    spend: item.cost || item.spend || 0,
                    sales: item.sales14d || item.sales7d || item.sales || 0
                });
            }
        });
        
        const datewiseData = datewiseSales.map(item => {
            if (!item.date) return null;
            
            const dateKey = new Date(item.date).toISOString().split('T')[0];
            const sales = item.sales?.amount || 0;
            const backendGrossProfit = item.grossProfit?.amount || 0;
            const fees = feesMap.get(dateKey) || { fbaFees: 0, storageFees: 0, refunds: 0 };
            const amazonFees = amazonFeesMap.get(dateKey) || 0;
            const ppc = ppcMap.get(dateKey) || { spend: 0, sales: 0 };
            
            const displayedGrossProfit = backendGrossProfit - ppc.spend;
            
            return {
                date: dateKey,
                totalSales: parseFloat(sales.toFixed(2)),
                grossProfit: parseFloat(displayedGrossProfit.toFixed(2)),
                backendGrossProfit: parseFloat(backendGrossProfit.toFixed(2)),
                ppcSpend: parseFloat(ppc.spend.toFixed(2)),
                ppcSales: parseFloat(ppc.sales.toFixed(2)),
                amazonFees: parseFloat(amazonFees.toFixed(2)),
                fbaFees: parseFloat(fees.fbaFees.toFixed(2)),
                refunds: parseFloat(fees.refunds.toFixed(2)),
                unitsSold: item.unitsSold || 0
            };
        }).filter(item => item !== null)
          .sort((a, b) => new Date(a.date) - new Date(b.date));
        
        let totalSales = 0;
        let totalGrossProfit = 0;
        let totalPpcSpend = 0;
        let totalPpcSales = 0;
        let totalAmazonFees = 0;
        let totalUnitsSold = 0;
        
        datewiseData.forEach(item => {
            totalSales += item.totalSales;
            totalGrossProfit += item.grossProfit;
            totalPpcSpend += item.ppcSpend;
            totalPpcSales += item.ppcSales;
            totalAmazonFees += item.amazonFees;
            totalUnitsSold += item.unitsSold;
        });
        
        logger.info('[QMateProfitabilityService] Got datewise profitability', {
            userId, country, region,
            duration: Date.now() - startTime,
            daysCount: datewiseData.length
        });
        
        return {
            success: true,
            source: 'economics_metrics',
            data: {
                datewiseData,
                summary: {
                    totalSales: parseFloat(totalSales.toFixed(2)),
                    totalGrossProfit: parseFloat(totalGrossProfit.toFixed(2)),
                    totalPpcSpend: parseFloat(totalPpcSpend.toFixed(2)),
                    totalPpcSales: parseFloat(totalPpcSales.toFixed(2)),
                    totalAmazonFees: parseFloat(totalAmazonFees.toFixed(2)),
                    totalUnitsSold,
                    profitMargin: totalSales > 0 ? parseFloat(((totalGrossProfit / totalSales) * 100).toFixed(2)) : 0,
                    daysCount: datewiseData.length,
                    currencyCode,
                    dateRange: economicsMetrics.dateRange || null
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateProfitabilityService] Error getting datewise profitability', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get ASIN-wise profitability data with full breakdown
 * Matches the Profitability Dashboard table exactly
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {number} limit - Maximum ASINs to return (default 100)
 * @returns {Promise<Object>} ASIN-wise profitability data
 */
async function getAsinWiseProfitability(userId, country, region, limit = 100) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const [economicsMetrics, cogsDoc, sellerData, adsSpendByAsin] = await Promise.all([
            EconomicsMetrics.findLatest(userObjectId, region, country),
            CogsModel.findOne({ userId: userObjectId, countryCode: country }).lean(),
            Seller.findOne(
                { User: userId },
                { 'sellerAccount': { $elemMatch: { region, country } } }
            ).lean(),
            getAdsSpendByAsin(userId, country, region)
        ]);
        
        if (!economicsMetrics) {
            return {
                success: false,
                source: 'none',
                error: 'No economics data found',
                data: null
            };
        }
        
        const currencyCode = economicsMetrics.totalSales?.currencyCode || 'USD';
        
        const cogsMap = {};
        if (cogsDoc?.cogsEntries) {
            cogsDoc.cogsEntries.forEach(e => {
                cogsMap[e.asin] = e.cogs || 0;
            });
        }
        
        const productNameMap = new Map();
        const products = sellerData?.sellerAccount?.[0]?.products || [];
        products.forEach(p => {
            if (p.asin) {
                productNameMap.set(p.asin, {
                    itemName: p.itemName,
                    sku: p.sku,
                    status: p.status,
                    price: p.price
                });
            }
        });
        
        let asinData = [];
        const isBigAccount = economicsMetrics.isBig === true;
        
        if (isBigAccount || (!economicsMetrics.asinWiseSales?.length && economicsMetrics.totalSales?.amount > 5000)) {
            const profitMap = await AsinWiseSalesForBigAccounts.getProfitabilityMapByMetricsId(economicsMetrics._id);
            asinData = Array.from(profitMap.values());
        } else if (Array.isArray(economicsMetrics.asinWiseSales)) {
            const asinMap = new Map();
            economicsMetrics.asinWiseSales.forEach(item => {
                if (!item.asin) return;
                if (asinMap.has(item.asin)) {
                    const e = asinMap.get(item.asin);
                    e.sales += item.sales?.amount || 0;
                    e.grossProfit += item.grossProfit?.amount || 0;
                    e.unitsSold += item.unitsSold || 0;
                    e.fbaFees += item.fbaFees?.amount || 0;
                    e.storageFees += item.storageFees?.amount || 0;
                    e.totalFees += item.totalFees?.amount || 0;
                    e.amazonFees += item.amazonFees?.amount || item.totalFees?.amount || 0;
                    e.refunds += item.refunds?.amount || 0;
                } else {
                    asinMap.set(item.asin, {
                        asin: item.asin,
                        parentAsin: item.parentAsin || item.asin,
                        sales: item.sales?.amount || 0,
                        grossProfit: item.grossProfit?.amount || 0,
                        unitsSold: item.unitsSold || 0,
                        fbaFees: item.fbaFees?.amount || 0,
                        storageFees: item.storageFees?.amount || 0,
                        totalFees: item.totalFees?.amount || 0,
                        amazonFees: item.amazonFees?.amount || item.totalFees?.amount || 0,
                        refunds: item.refunds?.amount || 0
                    });
                }
            });
            asinData = Array.from(asinMap.values());
        }
        
        const profitabilityList = asinData.map(item => {
            const asin = item.asin;
            const productInfo = productNameMap.get(asin) || {};
            const adsSpend = adsSpendByAsin.get(asin) || 0;
            const cogsPerUnit = cogsMap[asin] || 0;
            const totalCogs = cogsPerUnit * (item.unitsSold || 0);
            const hasCOGS = cogsPerUnit > 0;
            
            const sales = item.sales || 0;
            const amazonFees = item.amazonFees || item.totalFees || 0;
            
            const grossProfit = sales - adsSpend - amazonFees;
            const netProfit = hasCOGS ? grossProfit - totalCogs : null;
            const profitMargin = sales > 0 ? (grossProfit / sales) * 100 : 0;
            const netProfitMargin = hasCOGS && sales > 0 ? (netProfit / sales) * 100 : null;
            
            return {
                asin,
                parentAsin: item.parentAsin || asin,
                itemName: productInfo.itemName || null,
                sku: productInfo.sku || null,
                status: productInfo.status || null,
                unitsSold: item.unitsSold || 0,
                sales: parseFloat(sales.toFixed(2)),
                adsSpend: parseFloat(adsSpend.toFixed(2)),
                amazonFees: parseFloat(amazonFees.toFixed(2)),
                fbaFees: parseFloat((item.fbaFees || 0).toFixed(2)),
                storageFees: parseFloat((item.storageFees || 0).toFixed(2)),
                refunds: parseFloat((item.refunds || 0).toFixed(2)),
                cogs: hasCOGS ? parseFloat(totalCogs.toFixed(2)) : null,
                cogsPerUnit: hasCOGS ? parseFloat(cogsPerUnit.toFixed(2)) : null,
                hasCOGS,
                grossProfit: parseFloat(grossProfit.toFixed(2)),
                netProfit: netProfit !== null ? parseFloat(netProfit.toFixed(2)) : null,
                profitMargin: parseFloat(profitMargin.toFixed(2)),
                netProfitMargin: netProfitMargin !== null ? parseFloat(netProfitMargin.toFixed(2)) : null
            };
        });
        
        profitabilityList.sort((a, b) => b.sales - a.sales);
        
        let totalSales = 0;
        let totalGrossProfit = 0;
        let totalAdsSpend = 0;
        let totalAmazonFees = 0;
        let totalUnitsSold = 0;
        let totalCogs = 0;
        let productsWithCOGS = 0;
        
        const lossMakingProducts = [];
        const profitableProducts = [];
        const lowMarginProducts = [];
        
        profitabilityList.forEach(item => {
            totalSales += item.sales;
            totalGrossProfit += item.grossProfit;
            totalAdsSpend += item.adsSpend;
            totalAmazonFees += item.amazonFees;
            totalUnitsSold += item.unitsSold;
            if (item.hasCOGS) {
                totalCogs += item.cogs;
                productsWithCOGS++;
            }
            if (item.grossProfit < 0) {
                lossMakingProducts.push(item);
            } else if (item.grossProfit > 0) {
                if (item.profitMargin < 15) {
                    lowMarginProducts.push(item);
                }
                profitableProducts.push(item);
            }
        });
        
        // Sort loss-making products by absolute loss (biggest losses first)
        lossMakingProducts.sort((a, b) => a.grossProfit - b.grossProfit);
        // Sort profitable products by profit (highest profit first)
        profitableProducts.sort((a, b) => b.grossProfit - a.grossProfit);
        // Sort low margin products by margin (lowest margin first)
        lowMarginProducts.sort((a, b) => a.profitMargin - b.profitMargin);
        
        const totalProducts = profitabilityList.length;
        const overallProfitMargin = totalSales > 0 ? (totalGrossProfit / totalSales) * 100 : 0;
        
        logger.info('[QMateProfitabilityService] Got ASIN-wise profitability', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalAsins: totalProducts,
            lossMaking: lossMakingProducts.length,
            profitable: profitableProducts.length
        });
        
        return {
            success: true,
            source: 'economics_metrics',
            data: {
                asinProfitability: profitabilityList.slice(0, limit),
                total: totalProducts,
                lossMakingProducts,
                lossMakingTotal: lossMakingProducts.length,
                profitableProducts,
                profitableTotal: profitableProducts.length,
                lowMarginProducts: lowMarginProducts.slice(0, 50),
                lowMarginTotal: lowMarginProducts.length,
                summary: {
                    totalProducts,
                    totalSales: parseFloat(totalSales.toFixed(2)),
                    totalGrossProfit: parseFloat(totalGrossProfit.toFixed(2)),
                    totalAdsSpend: parseFloat(totalAdsSpend.toFixed(2)),
                    totalAmazonFees: parseFloat(totalAmazonFees.toFixed(2)),
                    totalUnitsSold,
                    totalCogs: parseFloat(totalCogs.toFixed(2)),
                    productsWithCOGS,
                    overallProfitMargin: parseFloat(overallProfitMargin.toFixed(2)),
                    lossMakingCount: lossMakingProducts.length,
                    lowMarginCount: lowMarginProducts.length,
                    profitableCount: profitableProducts.length,
                    currencyCode,
                    dateRange: economicsMetrics.dateRange || null
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateProfitabilityService] Error getting ASIN-wise profitability', {
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
 * @param {Object} options - Options for data fetching
 * @param {number} options.asinLimit - Max ASINs to return (default 100)
 * @returns {Promise<Object>} Complete profitability context
 */
async function getQMateProfitabilityContext(userId, country, region, options = {}) {
    const startTime = Date.now();
    const { asinLimit = 100 } = options;
    
    try {
        // Fetch all data in parallel - including new datewise and ASIN-wise data
        const [
            cogsResult,
            marginCategoriesResult,
            parentChildResult,
            issuesResult,
            financialBreakdownResult,
            datewiseResult,
            asinWiseResult
        ] = await Promise.all([
            getCOGSData(userId, country),
            getProfitMarginCategories(userId, country, region),
            getParentChildAggregation(userId, country, region),
            getProfitabilityIssues(userId, country, region),
            getProductFinancialBreakdown(userId, country, region, 15),
            getDatewiseProfitability(userId, country, region),
            getAsinWiseProfitability(userId, country, region, asinLimit)
        ]);
        
        const context = {
            cogsData: null,
            marginCategories: null,
            parentChildAnalysis: null,
            issues: null,
            financialBreakdown: null,
            datewiseProfitability: null,
            asinWiseProfitability: null
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
        
        if (datewiseResult?.success) {
            context.datewiseProfitability = datewiseResult.data;
        }
        
        if (asinWiseResult?.success) {
            context.asinWiseProfitability = asinWiseResult.data;
        }
        
        // Generate overall profitability summary using ASIN-wise data for accuracy
        const asinSummary = context.asinWiseProfitability?.summary || {};
        const datewiseSummary = context.datewiseProfitability?.summary || {};
        
        context.overallSummary = {
            hasCOGSData: context.cogsData?.hasCOGS || false,
            totalProducts: asinSummary.totalProducts || context.marginCategories?.summary?.totalProducts || 0,
            totalSales: asinSummary.totalSales || datewiseSummary.totalSales || 0,
            totalGrossProfit: asinSummary.totalGrossProfit || datewiseSummary.totalGrossProfit || 0,
            totalAdsSpend: asinSummary.totalAdsSpend || datewiseSummary.totalPpcSpend || 0,
            totalAmazonFees: asinSummary.totalAmazonFees || datewiseSummary.totalAmazonFees || 0,
            totalUnitsSold: asinSummary.totalUnitsSold || datewiseSummary.totalUnitsSold || 0,
            overallProfitMargin: asinSummary.overallProfitMargin || context.marginCategories?.summary?.overallProfitMargin || 0,
            lossMakingCount: asinSummary.lossMakingCount || context.marginCategories?.summary?.lossMakingCount || 0,
            lowMarginCount: asinSummary.lowMarginCount || context.marginCategories?.summary?.lowMarginCount || 0,
            productsWithCOGS: asinSummary.productsWithCOGS || 0,
            totalCogs: asinSummary.totalCogs || 0,
            totalIssues: context.issues?.summary?.totalIssues || 0,
            currencyCode: asinSummary.currencyCode || datewiseSummary.currencyCode || 'USD',
            dateRange: asinSummary.dateRange || datewiseSummary.dateRange || null,
            topRecommendation: (asinSummary.lossMakingCount || 0) > 0 
                ? 'Review loss-making products and consider price adjustments or cost reduction'
                : ((asinSummary.lowMarginCount || 0) > 5 
                    ? 'Optimize low-margin products to improve overall profitability'
                    : 'Profitability is healthy, focus on scaling top performers')
        };
        
        logger.info('[QMateProfitabilityService] Got complete profitability context', {
            userId, country, region,
            duration: Date.now() - startTime,
            hasDatewise: !!context.datewiseProfitability,
            hasAsinWise: !!context.asinWiseProfitability,
            asinCount: context.asinWiseProfitability?.asinProfitability?.length || 0,
            datewiseDays: context.datewiseProfitability?.datewiseData?.length || 0
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
    getDatewiseProfitability,
    getAsinWiseProfitability,
    getQMateProfitabilityContext
};
