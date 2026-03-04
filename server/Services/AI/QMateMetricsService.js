/**
 * QMateMetricsService
 * 
 * Optimized service for fetching financial metrics for QMate AI.
 * This service reads directly from pre-computed MongoDB collections:
 * - EconomicsMetrics: Sales, profit, fees, refunds
 * - PPCMetrics: Ad spend, ACOS, ROAS, datewise PPC data
 * - IssueSummary/IssuesDataChunks: Issue counts
 * 
 * Benefits:
 * - Direct database queries instead of full analysis pipeline
 * - Uses existing pre-computed data from scheduled updates
 * - Fast response times for AI context building
 * 
 * This service is INDEPENDENT and does not affect any existing flows.
 */

const logger = require('../../utils/Logger.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
const IssueSummary = require('../../models/system/IssueSummaryModel.js');
const IssuesDataChunks = require('../../models/system/IssuesDataChunksModel.js');
const CogsModel = require('../../models/finance/CogsModel.js');
const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
const V2SellerPerformance = require('../../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const V1SellerPerformance = require('../../models/seller-performance/V1_Seller_Performance_Report_Model.js');
const OrderAndRevenue = require('../../models/products/OrderAndRevenueModel.js');
const adsKeywordsPerformance = require('../../models/amazon-ads/adsKeywordsPerformanceModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const mongoose = require('mongoose');

/**
 * Get summary financial metrics for QMate context
 * Returns sales, profit, fees in a single optimized query
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Financial summary
 */
async function getFinancialSummary(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Get latest EconomicsMetrics document
        const economicsMetrics = await EconomicsMetrics.findLatest(userObjectId, region, country);
        
        if (!economicsMetrics) {
            logger.warn('[QMateMetricsService] No economics metrics found', {
                userId,
                country,
                region,
                duration: Date.now() - startTime
            });
            
            return {
                success: false,
                source: 'none',
                error: 'No financial data found for this account',
                data: null
            };
        }
        
        // Calculate totals from datewiseSales and datewiseGrossProfit by summing
        // This matches DashboardCalculation.js getPpcSalesFromEconomics (line 55-72)
        let totalSales = 0;
        let totalGrossProfit = 0;
        
        if (Array.isArray(economicsMetrics.datewiseSales) && economicsMetrics.datewiseSales.length > 0) {
            economicsMetrics.datewiseSales.forEach(item => {
                totalSales += item.sales?.amount || 0;
                totalGrossProfit += item.grossProfit?.amount || 0;
            });
        } else {
            totalSales = economicsMetrics.totalSales?.amount || 0;
            totalGrossProfit = economicsMetrics.grossProfit?.amount || 0;
        }
        
        // Get individual components
        const ppcSpend = economicsMetrics.ppcSpent?.amount || 0;
        let amazonFees = economicsMetrics.amazonFees?.amount || 0;
        const fbaFees = economicsMetrics.fbaFees?.amount || 0;
        const storageFees = economicsMetrics.storageFees?.amount || 0;
        const refunds = economicsMetrics.refunds?.amount || 0;
        
        // Fallback: use fbaFees + storageFees if amazonFees is 0 (matches DashboardSummaryService)
        if (amazonFees === 0) {
            amazonFees = fbaFees + storageFees;
        }
        
        // DISPLAYED Gross Profit = Backend Gross Profit (from datewiseGrossProfit) - PPC Spend
        // This is what the dashboard displays to users as "Gross Profit"
        // NOTE: totalGrossProfit comes from datewiseGrossProfit which is already Sales - Amazon Fees - Refunds
        const displayedGrossProfit = totalGrossProfit - ppcSpend;
        
        const summary = {
            dateRange: economicsMetrics.dateRange,
            totalSales: parseFloat(totalSales.toFixed(2)),
            // grossProfit matches what dashboard DISPLAYS (includes PPC subtraction)
            grossProfit: parseFloat(displayedGrossProfit.toFixed(2)),
            ppcSpend: parseFloat(ppcSpend.toFixed(2)),
            fbaFees: parseFloat(fbaFees.toFixed(2)),
            storageFees: parseFloat(storageFees.toFixed(2)),
            amazonFees: parseFloat(amazonFees.toFixed(2)),
            totalFees: parseFloat((economicsMetrics.totalFees?.amount || 0).toFixed(2)),
            refunds: parseFloat(refunds.toFixed(2)),
            amazonFeesBreakdown: economicsMetrics.amazonFeesBreakdown || [],
            currency: economicsMetrics.totalSales?.currencyCode || 'USD',
            lastUpdated: economicsMetrics.processedAt || economicsMetrics.updatedAt
        };
        
        // Net profit is same as displayed gross profit (PPC already subtracted)
        summary.netProfit = parseFloat(displayedGrossProfit.toFixed(2));
        
        // Calculate profit margin based on displayed gross profit
        summary.profitMargin = summary.totalSales > 0 
            ? parseFloat(((displayedGrossProfit / summary.totalSales) * 100).toFixed(2))
            : 0;
        
        logger.info('[QMateMetricsService] Got financial summary', {
            userId,
            country,
            region,
            duration: Date.now() - startTime,
            totalSales: summary.totalSales
        });
        
        return {
            success: true,
            source: 'economics_metrics',
            data: summary
        };
        
    } catch (error) {
        logger.error('[QMateMetricsService] Error getting financial summary', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });
        
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

/**
 * Get PPC/Ads metrics for QMate context
 * Returns ad spend, ACOS, ROAS, and campaign breakdown
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} PPC metrics summary
 */
async function getPPCMetrics(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userIdStr = userId?.toString() || userId;
        
        // Get latest PPCMetrics document
        const ppcMetrics = await PPCMetrics.findLatestForUser(userIdStr, country, region);
        
        if (!ppcMetrics) {
            logger.warn('[QMateMetricsService] No PPC metrics found', {
                userId,
                country,
                region,
                duration: Date.now() - startTime
            });
            
            return {
                success: false,
                source: 'none',
                error: 'No PPC data found for this account',
                data: null
            };
        }
        
        const summary = {
            dateRange: ppcMetrics.dateRange,
            totalSpend: ppcMetrics.summary?.totalSpend || 0,
            totalSales: ppcMetrics.summary?.totalSales || 0,
            totalImpressions: ppcMetrics.summary?.totalImpressions || 0,
            totalClicks: ppcMetrics.summary?.totalClicks || 0,
            overallAcos: ppcMetrics.summary?.overallAcos || 0,
            overallRoas: ppcMetrics.summary?.overallRoas || 0,
            ctr: ppcMetrics.summary?.ctr || 0,
            cpc: ppcMetrics.summary?.cpc || 0,
            campaignTypeBreakdown: {
                sponsoredProducts: ppcMetrics.campaignTypeBreakdown?.sponsoredProducts || null,
                sponsoredBrands: ppcMetrics.campaignTypeBreakdown?.sponsoredBrands || null,
                sponsoredDisplay: ppcMetrics.campaignTypeBreakdown?.sponsoredDisplay || null
            },
            dateWiseMetrics: (ppcMetrics.dateWiseMetrics || []).slice(-30), // Last 30 days
            lastUpdated: ppcMetrics.updatedAt
        };
        
        // Calculate TACOS if we have total sales data
        // Will be enhanced when combined with financial data
        
        logger.info('[QMateMetricsService] Got PPC metrics', {
            userId,
            country,
            region,
            duration: Date.now() - startTime,
            totalSpend: summary.totalSpend
        });
        
        return {
            success: true,
            source: 'ppc_metrics',
            data: summary
        };
        
    } catch (error) {
        logger.error('[QMateMetricsService] Error getting PPC metrics', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });
        
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

/**
 * Get datewise sales and profit data for charts
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {number} days - Number of days to return (default 30)
 * @returns {Promise<Object>} Datewise sales data
 */
async function getDatewiseSales(userId, country, region, days = 30) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const economicsMetrics = await EconomicsMetrics.findLatest(userObjectId, region, country);
        
        if (!economicsMetrics || !economicsMetrics.datewiseSales) {
            return {
                success: false,
                source: 'none',
                error: 'No datewise sales data found',
                data: null
            };
        }
        
        // Get last N days of data
        const datewiseData = (economicsMetrics.datewiseSales || [])
            .slice(-days)
            .map(item => ({
                date: item.date,
                sales: item.sales?.amount || 0,
                grossProfit: item.grossProfit?.amount || 0,
                currency: item.sales?.currencyCode || 'USD'
            }));
        
        logger.info('[QMateMetricsService] Got datewise sales', {
            userId,
            country,
            region,
            duration: Date.now() - startTime,
            daysReturned: datewiseData.length
        });
        
        return {
            success: true,
            source: 'economics_metrics',
            data: {
                dateRange: economicsMetrics.dateRange,
                datewiseSales: datewiseData
            }
        };
        
    } catch (error) {
        logger.error('[QMateMetricsService] Error getting datewise sales', {
            error: error.message,
            userId,
            country,
            region
        });
        
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

/**
 * Get top performing ASINs by sales
 * Uses optimized aggregation for big accounts
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {number} limit - Number of ASINs to return (default 25)
 * @returns {Promise<Object>} Top ASINs with sales data
 */
async function getTopAsinsBySales(userId, country, region, limit = 25) {
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
        
        let topAsins = [];
        
        // Check if big account (data stored separately)
        const isBigAccount = economicsMetrics.isBig === true;
        const hasEmptyAsinData = !economicsMetrics.asinWiseSales || economicsMetrics.asinWiseSales.length === 0;
        
        if (isBigAccount || (hasEmptyAsinData && economicsMetrics.totalSales?.amount > 5000)) {
            // Use optimized aggregation for big accounts
            topAsins = await AsinWiseSalesForBigAccounts.getTopAsinsBySales(economicsMetrics._id, limit);
        } else if (Array.isArray(economicsMetrics.asinWiseSales)) {
            // Aggregate and sort in memory for small accounts
            const asinMap = new Map();
            
            economicsMetrics.asinWiseSales.forEach(item => {
                if (!item.asin) return;
                
                if (asinMap.has(item.asin)) {
                    const existing = asinMap.get(item.asin);
                    existing.totalSales += item.sales?.amount || 0;
                    existing.unitsSold += item.unitsSold || 0;
                    existing.grossProfit += item.grossProfit?.amount || 0;
                    existing.ppcSpent += item.ppcSpent?.amount || 0;
                    existing.amazonFees += item.amazonFees?.amount || 0;
                } else {
                    asinMap.set(item.asin, {
                        asin: item.asin,
                        parentAsin: item.parentAsin || item.asin,
                        totalSales: item.sales?.amount || 0,
                        unitsSold: item.unitsSold || 0,
                        grossProfit: item.grossProfit?.amount || 0,
                        ppcSpent: item.ppcSpent?.amount || 0,
                        amazonFees: item.amazonFees?.amount || 0
                    });
                }
            });
            
            topAsins = Array.from(asinMap.values())
                .sort((a, b) => b.totalSales - a.totalSales)
                .slice(0, limit);
        }
        
        logger.info('[QMateMetricsService] Got top ASINs by sales', {
            userId,
            country,
            region,
            duration: Date.now() - startTime,
            asinsReturned: topAsins.length,
            isBigAccount
        });
        
        return {
            success: true,
            source: isBigAccount ? 'big_accounts_aggregation' : 'economics_metrics',
            data: {
                topAsins,
                dateRange: economicsMetrics.dateRange
            }
        };
        
    } catch (error) {
        logger.error('[QMateMetricsService] Error getting top ASINs', {
            error: error.message,
            userId,
            country,
            region
        });
        
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

/**
 * Get profitability data for ASINs
 * Returns sales, profit, margins, and identifies loss-making products
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {number} limit - Number of ASINs to return (default 30)
 * @returns {Promise<Object>} Profitability data with categorization
 */
async function getProfitabilityData(userId, country, region, limit = 30) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Get economics metrics
        const economicsMetrics = await EconomicsMetrics.findLatest(userObjectId, region, country);
        
        if (!economicsMetrics) {
            return {
                success: false,
                source: 'none',
                error: 'No economics data found',
                data: null
            };
        }
        
        // Get COGS data if available
        let cogsValues = {};
        try {
            const cogsDoc = await CogsModel.findOne({ User: userObjectId, country }).lean();
            if (cogsDoc && cogsDoc.cogsValues) {
                cogsValues = cogsDoc.cogsValues;
            }
        } catch (cogsError) {
            logger.warn('[QMateMetricsService] Failed to get COGS data', { error: cogsError.message });
        }
        
        let profitabilityData = [];
        
        const isBigAccount = economicsMetrics.isBig === true;
        const hasEmptyAsinData = !economicsMetrics.asinWiseSales || economicsMetrics.asinWiseSales.length === 0;
        
        if (isBigAccount || (hasEmptyAsinData && economicsMetrics.totalSales?.amount > 5000)) {
            // Use optimized aggregation for big accounts
            const profitMap = await AsinWiseSalesForBigAccounts.getProfitabilityMapByMetricsId(economicsMetrics._id);
            
            profitabilityData = Array.from(profitMap.values()).map(item => {
                const cogsPerUnit = cogsValues[item.asin] || 0;
                const totalCogs = cogsPerUnit * (item.unitsSold || 0);
                const netProfit = (item.grossProfit || 0) - totalCogs;
                const profitMargin = item.sales > 0 ? (netProfit / item.sales) * 100 : 0;
                
                return {
                    asin: item.asin,
                    sales: parseFloat((item.sales || 0).toFixed(2)),
                    grossProfit: parseFloat((item.grossProfit || 0).toFixed(2)),
                    adsSpend: parseFloat((item.ads || 0).toFixed(2)),
                    amazonFees: parseFloat((item.amzFee || 0).toFixed(2)),
                    totalFees: parseFloat((item.totalFees || 0).toFixed(2)),
                    cogs: parseFloat(totalCogs.toFixed(2)),
                    netProfit: parseFloat(netProfit.toFixed(2)),
                    profitMargin: parseFloat(profitMargin.toFixed(2)),
                    unitsSold: item.unitsSold || 0,
                    status: netProfit < 0 ? 'loss' : profitMargin < 10 ? 'low_margin' : 'healthy'
                };
            });
        } else if (Array.isArray(economicsMetrics.asinWiseSales)) {
            // Aggregate in memory for small accounts
            const asinMap = new Map();
            
            economicsMetrics.asinWiseSales.forEach(item => {
                if (!item.asin) return;
                
                if (asinMap.has(item.asin)) {
                    const existing = asinMap.get(item.asin);
                    existing.sales += item.sales?.amount || 0;
                    existing.grossProfit += item.grossProfit?.amount || 0;
                    existing.adsSpend += item.ppcSpent?.amount || 0;
                    existing.amazonFees += item.amazonFees?.amount || 0;
                    existing.totalFees += item.totalFees?.amount || 0;
                    existing.unitsSold += item.unitsSold || 0;
                } else {
                    asinMap.set(item.asin, {
                        asin: item.asin,
                        sales: item.sales?.amount || 0,
                        grossProfit: item.grossProfit?.amount || 0,
                        adsSpend: item.ppcSpent?.amount || 0,
                        amazonFees: item.amazonFees?.amount || 0,
                        totalFees: item.totalFees?.amount || 0,
                        unitsSold: item.unitsSold || 0
                    });
                }
            });
            
            profitabilityData = Array.from(asinMap.values()).map(item => {
                const cogsPerUnit = cogsValues[item.asin] || 0;
                const totalCogs = cogsPerUnit * item.unitsSold;
                const netProfit = item.grossProfit - totalCogs;
                const profitMargin = item.sales > 0 ? (netProfit / item.sales) * 100 : 0;
                
                return {
                    ...item,
                    cogs: parseFloat(totalCogs.toFixed(2)),
                    netProfit: parseFloat(netProfit.toFixed(2)),
                    profitMargin: parseFloat(profitMargin.toFixed(2)),
                    status: netProfit < 0 ? 'loss' : profitMargin < 10 ? 'low_margin' : 'healthy'
                };
            });
        }
        
        // Sort by sales and categorize
        profitabilityData.sort((a, b) => b.sales - a.sales);
        
        const topAsins = profitabilityData.slice(0, limit);
        const lossMaking = profitabilityData.filter(p => p.status === 'loss').slice(0, 15);
        const lowMargin = profitabilityData.filter(p => p.status === 'low_margin').slice(0, 15);
        
        logger.info('[QMateMetricsService] Got profitability data', {
            userId,
            country,
            region,
            duration: Date.now() - startTime,
            totalAsins: profitabilityData.length,
            lossMakingCount: lossMaking.length,
            lowMarginCount: lowMargin.length
        });
        
        return {
            success: true,
            source: isBigAccount ? 'big_accounts_aggregation' : 'economics_metrics',
            data: {
                topAsins,
                lossMakingAsins: lossMaking,
                lowMarginAsins: lowMargin,
                dateRange: economicsMetrics.dateRange
            }
        };
        
    } catch (error) {
        logger.error('[QMateMetricsService] Error getting profitability data', {
            error: error.message,
            userId,
            country,
            region
        });
        
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

/**
 * Get BuyBox data for QMate context
 * Returns products with/without buy box
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} BuyBox data
 */
async function getBuyBoxData(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const buyBoxData = await BuyBoxData.findLatest(userObjectId, region, country);
        
        if (!buyBoxData) {
            return {
                success: false,
                source: 'none',
                error: 'No BuyBox data found',
                data: null
            };
        }
        
        const summary = {
            totalProducts: buyBoxData.totalProducts || 0,
            productsWithBuyBox: buyBoxData.productsWithBuyBox || 0,
            productsWithoutBuyBox: buyBoxData.productsWithoutBuyBox || 0,
            buyBoxPercentage: buyBoxData.totalProducts > 0 
                ? parseFloat(((buyBoxData.productsWithBuyBox / buyBoxData.totalProducts) * 100).toFixed(2))
                : 0,
            dateRange: buyBoxData.dateRange
        };
        
        // Get top products without buybox (for recommendations)
        const productsWithoutBuyBox = (buyBoxData.asinBuyBoxData || [])
            .filter(p => p.buyBoxPercentage < 50)
            .sort((a, b) => (b.sales?.amount || 0) - (a.sales?.amount || 0))
            .slice(0, 20)
            .map(p => ({
                asin: p.childAsin,
                parentAsin: p.parentAsin,
                buyBoxPercentage: p.buyBoxPercentage,
                sales: p.sales?.amount || 0,
                pageViews: p.pageViews || 0,
                sessions: p.sessions || 0
            }));
        
        logger.info('[QMateMetricsService] Got BuyBox data', {
            userId, country, region,
            duration: Date.now() - startTime,
            productsWithoutBuyBox: summary.productsWithoutBuyBox
        });
        
        return {
            success: true,
            source: 'buybox_data',
            data: {
                summary,
                productsWithoutBuyBox
            }
        };
        
    } catch (error) {
        logger.error('[QMateMetricsService] Error getting BuyBox data', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get Account Health data for QMate context
 * Returns V1/V2 seller performance metrics
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Account health data
 */
async function getAccountHealthData(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Fetch V2 and V1 data in parallel
        const [v2Data, v1Data] = await Promise.all([
            V2SellerPerformance.findOne({ User: userObjectId, country, region })
                .sort({ createdAt: -1 }).lean(),
            V1SellerPerformance.findOne({ User: userObjectId, country, region })
                .sort({ createdAt: -1 }).lean()
        ]);
        
        if (!v2Data && !v1Data) {
            return {
                success: false,
                source: 'none',
                error: 'No account health data found',
                data: null
            };
        }
        
        // Calculate account health percentage (matches AccountHealth.js calculation)
        let healthPercentage = 100;
        let status = 'GOOD';
        const issues = [];
        
        if (v2Data) {
            // Check each metric and deduct points for issues
            if (v2Data.CancellationRate && v2Data.CancellationRate !== 'GOOD' && v2Data.CancellationRate !== '') {
                healthPercentage -= 15;
                issues.push({ type: 'CancellationRate', status: v2Data.CancellationRate, impact: 'High cancellation rate affects account health' });
            }
            if (v2Data.orderWithDefectsStatus && v2Data.orderWithDefectsStatus !== 'GOOD' && v2Data.orderWithDefectsStatus !== '') {
                healthPercentage -= 20;
                issues.push({ type: 'OrderDefects', status: v2Data.orderWithDefectsStatus, impact: 'Order defects can lead to account suspension' });
            }
            if (v2Data.lateShipmentRateStatus && v2Data.lateShipmentRateStatus !== 'GOOD' && v2Data.lateShipmentRateStatus !== '') {
                healthPercentage -= 15;
                issues.push({ type: 'LateShipment', status: v2Data.lateShipmentRateStatus, impact: 'Late shipments affect customer experience' });
            }
            if (v2Data.validTrackingRateStatus && v2Data.validTrackingRateStatus !== 'GOOD' && v2Data.validTrackingRateStatus !== '') {
                healthPercentage -= 10;
                issues.push({ type: 'ValidTracking', status: v2Data.validTrackingRateStatus, impact: 'Missing tracking info reduces buyer confidence' });
            }
            if (v2Data.listingPolicyViolations && v2Data.listingPolicyViolations !== '' && v2Data.listingPolicyViolations !== '0') {
                healthPercentage -= 10;
                issues.push({ type: 'PolicyViolations', count: v2Data.listingPolicyViolations, impact: 'Policy violations require immediate attention' });
            }
        }
        
        // Add V1 data issues
        if (v1Data) {
            const negativeFeedbackCount = parseInt(v1Data.negativeFeedbacks?.count) || 0;
            if (negativeFeedbackCount > 0) {
                healthPercentage -= Math.min(negativeFeedbackCount * 2, 10);
                issues.push({ type: 'NegativeFeedback', count: negativeFeedbackCount, impact: 'Negative feedback affects Buy Box eligibility' });
            }
            
            const azClaimsCount = parseInt(v1Data.a_z_claims?.count) || 0;
            if (azClaimsCount > 0) {
                healthPercentage -= Math.min(azClaimsCount * 5, 15);
                issues.push({ type: 'AZClaims', count: azClaimsCount, impact: 'A-to-z claims significantly impact account health' });
            }
        }
        
        healthPercentage = Math.max(0, healthPercentage);
        if (healthPercentage < 50) status = 'CRITICAL';
        else if (healthPercentage < 80) status = 'AT_RISK';
        
        const accountHealth = {
            percentage: healthPercentage,
            status,
            ahrScore: v2Data?.ahrScore || null,
            accountStatuses: v2Data?.accountStatuses || '',
            metrics: {
                cancellationRate: v2Data?.CancellationRate || 'N/A',
                orderDefects: v2Data?.orderWithDefectsStatus || 'N/A',
                lateShipmentRate: v2Data?.lateShipmentRateStatus || 'N/A',
                validTrackingRate: v2Data?.validTrackingRateStatus || 'N/A',
                policyViolations: v2Data?.listingPolicyViolations || '0'
            },
            v1Metrics: v1Data ? {
                negativeFeedbacks: parseInt(v1Data.negativeFeedbacks?.count) || 0,
                lateShipments: parseInt(v1Data.lateShipmentCount?.count) || 0,
                cancellations: parseInt(v1Data.preFulfillmentCancellationCount?.count) || 0,
                refunds: parseInt(v1Data.refundsCount?.count) || 0,
                azClaims: parseInt(v1Data.a_z_claims?.count) || 0
            } : null,
            issues
        };
        
        logger.info('[QMateMetricsService] Got account health data', {
            userId, country, region,
            duration: Date.now() - startTime,
            healthPercentage,
            issuesCount: issues.length
        });
        
        return {
            success: true,
            source: 'v2_v1_performance',
            data: accountHealth
        };
        
    } catch (error) {
        logger.error('[QMateMetricsService] Error getting account health data', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get Orders summary for QMate context
 * Returns order counts by status
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Orders summary
 */
async function getOrdersSummary(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const orderData = await OrderAndRevenue.findOne({ User: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!orderData || !orderData.RevenueData) {
            return {
                success: false,
                source: 'none',
                error: 'No order data found',
                data: null
            };
        }
        
        const orders = orderData.RevenueData;
        
        // Count by status
        const statusCounts = {
            shipped: 0,
            unshipped: 0,
            partiallyShipped: 0,
            pending: 0,
            cancelled: 0,
            total: orders.length
        };
        
        let totalRevenue = 0;
        let totalUnits = 0;
        
        orders.forEach(order => {
            const status = (order.orderStatus || '').toLowerCase();
            if (status === 'shipped') statusCounts.shipped++;
            else if (status === 'unshipped') statusCounts.unshipped++;
            else if (status === 'partiallyshipped') statusCounts.partiallyShipped++;
            else if (status === 'pending') statusCounts.pending++;
            else if (status === 'cancelled') statusCounts.cancelled++;
            
            if (status !== 'cancelled') {
                totalRevenue += order.itemPrice || 0;
                totalUnits += order.quantity || 0;
            }
        });
        
        // Active orders (shipped + unshipped + partially shipped)
        const activeOrders = statusCounts.shipped + statusCounts.unshipped + statusCounts.partiallyShipped;
        
        logger.info('[QMateMetricsService] Got orders summary', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalOrders: orders.length,
            activeOrders
        });
        
        return {
            success: true,
            source: 'orders_revenue',
            data: {
                statusCounts,
                activeOrders,
                totalRevenue: parseFloat(totalRevenue.toFixed(2)),
                totalUnits
            }
        };
        
    } catch (error) {
        logger.error('[QMateMetricsService] Error getting orders summary', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get Money Wasted in Ads for QMate context
 * Keywords with cost > 0 but sales < 0.01
 * Supports date filtering to match dashboard behavior
 *
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Object} options - Options for filtering
 * @param {string} options.startDate - Start date for filtering (YYYY-MM-DD)
 * @param {string} options.endDate - End date for filtering (YYYY-MM-DD)
 * @returns {Promise<Object>} Wasted spend data
 */
async function getMoneyWastedInAds(userId, country, region, options = {}) {
    const startTime = Date.now();
    const { startDate, endDate } = options;
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const adsData = await adsKeywordsPerformance.findOne({ userId: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!adsData || !adsData.keywordsData) {
            return {
                success: false,
                source: 'none',
                error: 'No ads keywords data found',
                data: null
            };
        }
        
        let keywordsData = adsData.keywordsData;
        
        // Apply date filtering if date range is provided (matches Dashboard.jsx behavior)
        const shouldFilterByDate = startDate && endDate;
        if (shouldFilterByDate) {
            const parseLocalDate = (dateString) => {
                const [year, month, day] = dateString.split('-').map(Number);
                return new Date(year, month - 1, day);
            };
            
            const startDateObj = parseLocalDate(startDate);
            const endDateObj = parseLocalDate(endDate);
            startDateObj.setHours(0, 0, 0, 0);
            endDateObj.setHours(23, 59, 59, 999);
            
            keywordsData = keywordsData.filter(keyword => {
                if (!keyword.date) return true;
                const itemDate = new Date(keyword.date);
                return itemDate >= startDateObj && itemDate <= endDateObj;
            });
            
            logger.info('[QMateMetricsService] Filtered keywords by date range', {
                startDate, endDate,
                originalCount: adsData.keywordsData.length,
                filteredCount: keywordsData.length
            });
        }
        
        // Filter wasted keywords: cost > 0 but sales < 0.01
        const wastedKeywords = keywordsData.filter(keyword => {
            const cost = parseFloat(keyword.cost) || 0;
            const sales = parseFloat(keyword.attributedSales30d) || 0;
            return cost > 0 && sales < 0.01;
        });
        
        let totalWastedSpend = 0;
        wastedKeywords.forEach(kw => {
            totalWastedSpend += parseFloat(kw.cost) || 0;
        });
        
        // Get top wasted keywords for recommendations
        const topWastedKeywords = wastedKeywords
            .sort((a, b) => (b.cost || 0) - (a.cost || 0))
            .slice(0, 20)
            .map(kw => ({
                keyword: kw.keyword,
                campaignName: kw.campaignName,
                adGroupName: kw.adGroupName,
                matchType: kw.matchType,
                cost: parseFloat((kw.cost || 0).toFixed(2)),
                clicks: kw.clicks || 0,
                impressions: kw.impressions || 0,
                sales: parseFloat((kw.attributedSales30d || 0).toFixed(2))
            }));
        
        logger.info('[QMateMetricsService] Got money wasted in ads', {
            userId, country, region,
            duration: Date.now() - startTime,
            wastedKeywordsCount: wastedKeywords.length,
            totalWastedSpend,
            dateFiltered: shouldFilterByDate
        });
        
        return {
            success: true,
            source: 'ads_keywords_performance',
            data: {
                totalWastedSpend: parseFloat(totalWastedSpend.toFixed(2)),
                wastedKeywordsCount: wastedKeywords.length,
                topWastedKeywords
            }
        };
        
    } catch (error) {
        logger.error('[QMateMetricsService] Error getting money wasted in ads', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get Top Error Products for QMate context
 * Returns products with most issues
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {number} limit - Number of products to return
 * @returns {Promise<Object>} Top error products
 */
async function getTopErrorProducts(userId, country, region, limit = 10) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Get product-wise errors from IssuesDataChunks
        const productWiseErrors = await IssuesDataChunks.getFieldData(
            userObjectId, country, region, 'productWiseError'
        );
        
        if (!productWiseErrors || productWiseErrors.length === 0) {
            return {
                success: false,
                source: 'none',
                error: 'No product error data found',
                data: null
            };
        }
        
        // Sort by total errors and get top N
        const topProducts = productWiseErrors
            .filter(p => p && p.asin)
            .sort((a, b) => (b.totalErrors || 0) - (a.totalErrors || 0))
            .slice(0, limit)
            .map(p => ({
                asin: p.asin,
                productName: p.name || p.productName || 'Unknown',
                totalErrors: p.totalErrors || 0,
                rankingErrors: p.rankingErrors || 0,
                conversionErrors: p.conversionErrors || 0,
                inventoryErrors: p.inventoryErrors || 0,
                profitabilityErrors: p.profitabilityErrors || 0,
                sponsoredAdsErrors: p.sponsoredAdsErrors || 0,
                errors: p.errors || []
            }));
        
        logger.info('[QMateMetricsService] Got top error products', {
            userId, country, region,
            duration: Date.now() - startTime,
            productsReturned: topProducts.length
        });
        
        return {
            success: true,
            source: 'issues_data_chunks',
            data: {
                topErrorProducts: topProducts
            }
        };
        
    } catch (error) {
        logger.error('[QMateMetricsService] Error getting top error products', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get Amazon Ready Products count
 * Products meeting all quality criteria
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Amazon ready products data
 */
async function getAmazonReadyProducts(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Get seller data with products
        const sellerData = await Seller.findOne({ User: userObjectId })
            .select('sellerAccount')
            .lean();
        
        if (!sellerData || !sellerData.sellerAccount) {
            return {
                success: false,
                source: 'none',
                error: 'No seller data found',
                data: null
            };
        }
        
        // Find the matching account
        const account = sellerData.sellerAccount.find(
            acc => acc.country === country && acc.region === region
        );
        
        if (!account || !account.products) {
            return {
                success: false,
                source: 'none',
                error: 'No products found for this marketplace',
                data: null
            };
        }
        
        const products = account.products;
        const totalProducts = products.length;
        const activeProducts = products.filter(p => p.status === 'Active');
        
        // Get issue data to determine amazon ready products
        const issueSummary = await IssueSummary.getIssueSummary(userObjectId, country, region);
        const productsWithIssues = issueSummary?.numberOfProductsWithIssues || 0;
        
        // Amazon ready = Active products without issues
        const amazonReadyCount = Math.max(0, activeProducts.length - productsWithIssues);
        
        logger.info('[QMateMetricsService] Got Amazon ready products', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalProducts,
            activeProducts: activeProducts.length,
            amazonReadyCount
        });
        
        return {
            success: true,
            source: 'seller_data',
            data: {
                totalProducts,
                activeProducts: activeProducts.length,
                inactiveProducts: totalProducts - activeProducts.length,
                amazonReadyProducts: amazonReadyCount,
                productsWithIssues
            }
        };
        
    } catch (error) {
        logger.error('[QMateMetricsService] Error getting Amazon ready products', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get complete metrics context for QMate AI
 * Combines financial, PPC, and profitability data in a single call
 * Optimized for providing full context to AI in one request
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Object} options - Options
 * @param {number} options.topAsinsLimit - Max ASINs to include (default 25)
 * @param {string} options.startDate - Start date for filtering (YYYY-MM-DD)
 * @param {string} options.endDate - End date for filtering (YYYY-MM-DD)
 * @param {string} options.calendarMode - Calendar mode (default, last7, custom)
 * @returns {Promise<Object>} Complete metrics context
 */
async function getQMateMetricsContext(userId, country, region, options = {}) {
    const startTime = Date.now();
    const { topAsinsLimit = 25, startDate, endDate, calendarMode = 'default' } = options;
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        const userIdStr = userId?.toString() || userId;
        
        // Determine if we need to apply date filtering
        const shouldFilterByDate = startDate && endDate && calendarMode !== 'default';
        
        // Fetch all data in parallel for performance
        const [
            economicsMetrics, 
            ppcMetrics, 
            issueSummary, 
            cogsDoc,
            buyBoxResult,
            accountHealthResult,
            ordersResult,
            wastedAdsResult,
            topErrorsResult,
            amazonReadyResult
        ] = await Promise.all([
            EconomicsMetrics.findLatest(userObjectId, region, country),
            PPCMetrics.findLatestForUser(userIdStr, country, region),
            IssueSummary.getIssueSummary(userObjectId, country, region),
            CogsModel.findOne({ User: userObjectId, country }).lean().catch(() => null),
            getBuyBoxData(userId, country, region).catch(() => ({ success: false })),
            getAccountHealthData(userId, country, region).catch(() => ({ success: false })),
            getOrdersSummary(userId, country, region).catch(() => ({ success: false })),
            getMoneyWastedInAds(userId, country, region, { startDate, endDate }).catch(() => ({ success: false })),
            getTopErrorProducts(userId, country, region, 10).catch(() => ({ success: false })),
            getAmazonReadyProducts(userId, country, region).catch(() => ({ success: false }))
        ]);
        
        // Build context object
        const context = {
            summary: null,
            ppc: null,
            profitability: null,
            buyBox: null,
            accountHealth: null,
            orders: null,
            wastedAds: null,
            topErrorProducts: null,
            productCounts: null,
            datewiseSales: [],
            datewisePPC: []
        };
        
        // Process Economics Metrics
        // CRITICAL: Use the EXACT same calculation as Analyse.js processCustomDateRange()
        // Dashboard displays: Gross Profit (from datewiseGrossProfit) - PPC Spend
        if (economicsMetrics) {
            // Get raw datewise data
            let datewiseSalesData = economicsMetrics.datewiseSales || [];
            const datewiseGrossProfitData = economicsMetrics.datewiseGrossProfit || [];
            const datewiseFeesAndRefunds = economicsMetrics.datewiseFeesAndRefunds || [];
            const datewiseAmazonFees = economicsMetrics.datewiseAmazonFees || [];
            
            // Apply date filtering if date range is provided
            let filteredSales = datewiseSalesData;
            let filteredGrossProfit = datewiseGrossProfitData;
            let filteredFeesAndRefunds = datewiseFeesAndRefunds;
            let filteredAmazonFees = datewiseAmazonFees;
            let effectiveDateRange = economicsMetrics.dateRange;
            
            // Check if custom date range matches stored range (same logic as Analyse.js)
            // If so, use pre-aggregated totals for consistency
            let usesPreAggregated = false;
            
            if (shouldFilterByDate) {
                const filterStartDate = new Date(startDate);
                filterStartDate.setHours(0, 0, 0, 0);
                const filterEndDate = new Date(endDate);
                filterEndDate.setHours(23, 59, 59, 999);
                
                // Check if dates match stored range (like Analyse.js does)
                const storedStartDate = economicsMetrics.dateRange?.startDate;
                const storedEndDate = economicsMetrics.dateRange?.endDate;
                
                if (storedStartDate && storedEndDate) {
                    const storedStart = new Date(storedStartDate);
                    storedStart.setHours(0, 0, 0, 0);
                    const storedEnd = new Date(storedEndDate);
                    storedEnd.setHours(0, 0, 0, 0);
                    
                    const requestedStart = new Date(startDate);
                    requestedStart.setHours(0, 0, 0, 0);
                    const requestedEnd = new Date(endDate);
                    requestedEnd.setHours(0, 0, 0, 0);
                    
                    usesPreAggregated = storedStart.getTime() === requestedStart.getTime() && 
                                        storedEnd.getTime() === requestedEnd.getTime();
                }
                
                if (!usesPreAggregated) {
                    // Filter datewise data by date range
                    filteredSales = datewiseSalesData.filter(item => {
                        const itemDate = new Date(item.date);
                        return itemDate >= filterStartDate && itemDate <= filterEndDate;
                    });
                    
                    filteredGrossProfit = datewiseGrossProfitData.filter(item => {
                        const itemDate = new Date(item.date);
                        return itemDate >= filterStartDate && itemDate <= filterEndDate;
                    });
                    
                    filteredFeesAndRefunds = datewiseFeesAndRefunds.filter(item => {
                        const itemDate = new Date(item.date);
                        return itemDate >= filterStartDate && itemDate <= filterEndDate;
                    });
                    
                    filteredAmazonFees = datewiseAmazonFees.filter(item => {
                        const itemDate = new Date(item.date);
                        return itemDate >= filterStartDate && itemDate <= filterEndDate;
                    });
                    
                    effectiveDateRange = { startDate, endDate };
                    
                    logger.info('[QMateMetricsService] Applied date filtering (custom range)', {
                        userId,
                        originalDataPoints: datewiseSalesData.length,
                        filteredDataPoints: filteredSales.length,
                        startDate,
                        endDate
                    });
                } else {
                    logger.info('[QMateMetricsService] Using pre-aggregated totals (dates match stored range)', {
                        userId,
                        startDate,
                        endDate
                    });
                }
            }
            
            // Calculate totals - EXACTLY like Analyse.js processCustomDateRange()
            let totalSales = 0;
            let totalGrossProfit = 0;
            let totalFbaFees = 0;
            let totalStorageFees = 0;
            let totalAmazonFees = 0;
            let totalRefunds = 0;
            let ppcSpend = 0;
            
            if (usesPreAggregated) {
                // Use pre-aggregated totals from the document (matches Analyse.js line 1463-1485)
                totalSales = economicsMetrics.totalSales?.amount || 0;
                totalGrossProfit = economicsMetrics.grossProfit?.amount || 0;
                totalFbaFees = economicsMetrics.fbaFees?.amount || 0;
                totalStorageFees = economicsMetrics.storageFees?.amount || 0;
                totalAmazonFees = totalFbaFees + totalStorageFees;
                totalRefunds = economicsMetrics.refunds?.amount || 0;
                ppcSpend = economicsMetrics.ppcSpent?.amount || 0;
            } else if (shouldFilterByDate) {
                // Sum from filtered datewise data (matches Analyse.js line 1507-1599)
                
                // Build gross profit map from datewiseGrossProfit (like Analyse.js line 1523-1536)
                const processedGrossProfitDates = new Set();
                filteredGrossProfit.forEach(item => {
                    const itemDate = new Date(item.date);
                    const dateKey = itemDate.toISOString().split('T')[0];
                    if (!processedGrossProfitDates.has(dateKey)) {
                        totalGrossProfit += item.grossProfit?.amount || 0;
                        processedGrossProfitDates.add(dateKey);
                    }
                });
                
                // Sum sales from filtered datewiseSales (like Analyse.js line 1538-1561)
                const processedSalesDates = new Set();
                filteredSales.forEach(item => {
                    const itemDate = new Date(item.date);
                    const dateKey = itemDate.toISOString().split('T')[0];
                    if (!processedSalesDates.has(dateKey)) {
                        totalSales += item.sales?.amount || 0;
                        processedSalesDates.add(dateKey);
                    }
                });
                
                // Sum fees and refunds from filtered datewiseFeesAndRefunds (like Analyse.js line 1564-1577)
                const processedFeeDates = new Set();
                filteredFeesAndRefunds.forEach(item => {
                    const itemDate = new Date(item.date);
                    const dateKey = itemDate.toISOString().split('T')[0];
                    if (!processedFeeDates.has(dateKey)) {
                        totalFbaFees += item.fbaFulfillmentFee?.amount || 0;
                        totalStorageFees += item.storageFee?.amount || 0;
                        totalRefunds += item.refunds?.amount || 0;
                        processedFeeDates.add(dateKey);
                    }
                });
                
                totalAmazonFees = totalFbaFees + totalStorageFees;
                
                // Calculate PPC spend proportionally (like Analyse.js line 1579-1598)
                // For simplicity, sum from ppcMetrics dateWiseMetrics filtered by date
                if (ppcMetrics?.dateWiseMetrics) {
                    const filterStartDate = new Date(startDate);
                    filterStartDate.setHours(0, 0, 0, 0);
                    const filterEndDate = new Date(endDate);
                    filterEndDate.setHours(23, 59, 59, 999);
                    
                    ppcMetrics.dateWiseMetrics.forEach(item => {
                        const itemDate = new Date(item.date);
                        if (itemDate >= filterStartDate && itemDate <= filterEndDate) {
                            ppcSpend += item.spend || 0;
                        }
                    });
                }
                
                // If no dateWise PPC data, use proportional calculation like Analyse.js
                if (ppcSpend === 0 && economicsMetrics.ppcSpent?.amount > 0) {
                    const docStartDate = economicsMetrics.dateRange?.startDate ? new Date(economicsMetrics.dateRange.startDate) : null;
                    const docEndDate = economicsMetrics.dateRange?.endDate ? new Date(economicsMetrics.dateRange.endDate) : null;
                    
                    if (docStartDate && docEndDate) {
                        const filterStartDate = new Date(startDate);
                        const filterEndDate = new Date(endDate);
                        
                        const overlapStart = new Date(Math.max(filterStartDate.getTime(), docStartDate.getTime()));
                        const overlapEnd = new Date(Math.min(filterEndDate.getTime(), docEndDate.getTime()));
                        const overlapDays = Math.max(0, Math.ceil((overlapEnd - overlapStart + 1) / (1000 * 60 * 60 * 24)));
                        const docTotalDays = Math.max(1, Math.ceil((docEndDate - docStartDate + 1) / (1000 * 60 * 60 * 24)));
                        
                        const proportion = Math.min(overlapDays / docTotalDays, 1);
                        ppcSpend = (economicsMetrics.ppcSpent?.amount || 0) * proportion;
                    }
                }
            } else {
                // No date filtering - sum from datewiseSales (like DashboardCalculation.js line 55-72)
                if (Array.isArray(datewiseSalesData) && datewiseSalesData.length > 0) {
                    datewiseSalesData.forEach(item => {
                        totalSales += item.sales?.amount || 0;
                        totalGrossProfit += item.grossProfit?.amount || 0;
                    });
                } else {
                    totalSales = economicsMetrics.totalSales?.amount || 0;
                    totalGrossProfit = economicsMetrics.grossProfit?.amount || 0;
                }
                
                totalFbaFees = economicsMetrics.fbaFees?.amount || 0;
                totalStorageFees = economicsMetrics.storageFees?.amount || 0;
                totalAmazonFees = economicsMetrics.amazonFees?.amount || 0;
                totalRefunds = economicsMetrics.refunds?.amount || 0;
                ppcSpend = ppcMetrics?.summary?.totalSpend || economicsMetrics.ppcSpent?.amount || 0;
                
                // Fallback: use fbaFees + storageFees if amazonFees is 0 (matches DashboardSummaryService)
                if (totalAmazonFees === 0) {
                    totalAmazonFees = totalFbaFees + totalStorageFees;
                }
            }
            
            // DISPLAYED Gross Profit = Backend Gross Profit (from datewiseGrossProfit) - PPC Spend
            // This is what the dashboard displays to users as "Gross Profit"
            // See: TotalSales.jsx line 198: grossProfitRaw = grossProfitFromBackend - ppcSpent
            // See: ProfitibilityDashboard.jsx line 569: grossProfit = grossProfitFromBackend - adSpend
            // NOTE: totalGrossProfit already comes from datewiseGrossProfit which is Sales - Amazon Fees - Refunds
            const displayedGrossProfit = totalGrossProfit - ppcSpend;
            
            // Add datewise sales for charts (use filtered data)
            if (Array.isArray(filteredSales) && filteredSales.length > 0) {
                context.datewiseSales = filteredSales.slice(-30).map(item => {
                    const daySales = item.sales?.amount || 0;
                    return {
                        date: item.date,
                        TotalAmount: daySales,
                        Profit: item.grossProfit?.amount || 0
                    };
                });
            }
            
            context.summary = {
                brand: null, // Will be set from user data if needed
                country,
                dateRange: effectiveDateRange,
                totalSales: parseFloat(totalSales.toFixed(2)),
                // grossProfit now matches what dashboard DISPLAYS (includes PPC subtraction)
                grossProfit: parseFloat(displayedGrossProfit.toFixed(2)),
                // netProfit is same as grossProfit here since PPC is already subtracted
                netProfit: parseFloat(displayedGrossProfit.toFixed(2)),
                profitMargin: totalSales > 0 ? parseFloat(((displayedGrossProfit / totalSales) * 100).toFixed(2)) : 0,
                ppcSpend: parseFloat(ppcSpend.toFixed(2)),
                fbaFees: parseFloat(totalFbaFees.toFixed(2)),
                storageFees: parseFloat(totalStorageFees.toFixed(2)),
                amazonFees: parseFloat(totalAmazonFees.toFixed(2)),
                totalFees: parseFloat((economicsMetrics.totalFees?.amount || 0).toFixed(2)),
                refunds: parseFloat(totalRefunds.toFixed(2)),
                currency: economicsMetrics.totalSales?.currencyCode || 'USD'
            };
        }
        
        // Process PPC Metrics
        if (ppcMetrics) {
            const totalSalesForTacos = context.summary?.totalSales || 0;
            const ppcSpend = ppcMetrics.summary?.totalSpend || 0;
            
            context.ppc = {
                dateRange: ppcMetrics.dateRange,
                totalSpend: ppcMetrics.summary?.totalSpend || 0,
                totalSalesFromAds: ppcMetrics.summary?.totalSales || 0,
                overallAcos: ppcMetrics.summary?.overallAcos || 0,
                overallRoas: ppcMetrics.summary?.overallRoas || 0,
                tacos: totalSalesForTacos > 0 ? parseFloat(((ppcSpend / totalSalesForTacos) * 100).toFixed(2)) : 0,
                totalImpressions: ppcMetrics.summary?.totalImpressions || 0,
                totalClicks: ppcMetrics.summary?.totalClicks || 0,
                ctr: ppcMetrics.summary?.ctr || 0,
                cpc: ppcMetrics.summary?.cpc || 0,
                campaignTypeBreakdown: ppcMetrics.campaignTypeBreakdown || null
            };
            
            // Add datewise PPC for charts
            context.datewisePPC = (ppcMetrics.dateWiseMetrics || []).slice(-30).map(item => ({
                date: item.date,
                totalCost: item.spend || 0,
                sales: item.sales || 0,
                acos: item.acos || 0
            }));
        }
        
        // Process Profitability (top ASINs with issues)
        const cogsValues = cogsDoc?.cogsValues || {};
        
        if (economicsMetrics) {
            const isBigAccount = economicsMetrics.isBig === true;
            const hasEmptyAsinData = !economicsMetrics.asinWiseSales || economicsMetrics.asinWiseSales.length === 0;
            
            let profitabilityData = [];
            
            if (isBigAccount || (hasEmptyAsinData && economicsMetrics.totalSales?.amount > 5000)) {
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
                        e.amzFee += item.amazonFees?.amount || 0;
                        e.totalFees += item.totalFees?.amount || 0;
                        e.unitsSold += item.unitsSold || 0;
                    } else {
                        asinMap.set(item.asin, {
                            asin: item.asin,
                            sales: item.sales?.amount || 0,
                            grossProfit: item.grossProfit?.amount || 0,
                            ads: item.ppcSpent?.amount || 0,
                            amzFee: item.amazonFees?.amount || 0,
                            totalFees: item.totalFees?.amount || 0,
                            unitsSold: item.unitsSold || 0
                        });
                    }
                });
                profitabilityData = Array.from(asinMap.values());
            }
            
            // Calculate margins and categorize
            const processed = profitabilityData.map(item => {
                const cogsPerUnit = cogsValues[item.asin] || 0;
                const totalCogs = cogsPerUnit * (item.unitsSold || 0);
                const netProfit = (item.grossProfit || 0) - totalCogs;
                const profitMargin = item.sales > 0 ? (netProfit / item.sales) * 100 : 0;
                
                return {
                    asin: item.asin,
                    sales: parseFloat((item.sales || 0).toFixed(2)),
                    grossProfit: parseFloat((item.grossProfit || 0).toFixed(2)),
                    ads: parseFloat((item.ads || 0).toFixed(2)),
                    amazonFees: parseFloat((item.amzFee || 0).toFixed(2)),
                    netProfit: parseFloat(netProfit.toFixed(2)),
                    profitMargin: parseFloat(profitMargin.toFixed(2)),
                    quantity: item.unitsSold || 0
                };
            });
            
            processed.sort((a, b) => b.sales - a.sales);
            
            context.profitability = {
                topAsins: processed.slice(0, topAsinsLimit),
                lowMarginAsins: processed.filter(p => p.profitMargin >= 0 && p.profitMargin < 10).slice(0, 15),
                lossMakingAsins: processed.filter(p => p.netProfit < 0).slice(0, 15)
            };
        }
        
        // Add issue counts if available
        if (issueSummary) {
            context.issues = {
                totalErrors: issueSummary.totalIssues || 0,
                profitabilityErrors: issueSummary.totalProfitabilityErrors || 0,
                sponsoredAdsErrors: issueSummary.totalSponsoredAdsErrors || 0,
                inventoryErrors: issueSummary.totalInventoryErrors || 0,
                rankingErrors: issueSummary.totalRankingErrors || 0,
                conversionErrors: issueSummary.totalConversionErrors || 0,
                accountErrors: issueSummary.totalAccountErrors || 0
            };
        }
        
        // Add BuyBox data
        if (buyBoxResult?.success && buyBoxResult.data) {
            context.buyBox = {
                summary: buyBoxResult.data.summary,
                productsWithoutBuyBox: buyBoxResult.data.productsWithoutBuyBox?.slice(0, 10) || []
            };
        }
        
        // Add Account Health data
        if (accountHealthResult?.success && accountHealthResult.data) {
            context.accountHealth = accountHealthResult.data;
        }
        
        // Add Orders summary
        if (ordersResult?.success && ordersResult.data) {
            context.orders = ordersResult.data;
        }
        
        // Add Wasted Ads spend data
        if (wastedAdsResult?.success && wastedAdsResult.data) {
            context.wastedAds = {
                totalWastedSpend: wastedAdsResult.data.totalWastedSpend,
                wastedKeywordsCount: wastedAdsResult.data.wastedKeywordsCount,
                topWastedKeywords: wastedAdsResult.data.topWastedKeywords?.slice(0, 10) || []
            };
        }
        
        // Add Top Error Products
        if (topErrorsResult?.success && topErrorsResult.data) {
            context.topErrorProducts = topErrorsResult.data.topErrorProducts;
        }
        
        // Add Product Counts
        if (amazonReadyResult?.success && amazonReadyResult.data) {
            context.productCounts = amazonReadyResult.data;
        }
        
        logger.info('[QMateMetricsService] Got complete QMate metrics context', {
            userId,
            country,
            region,
            duration: Date.now() - startTime,
            hasSummary: !!context.summary,
            hasPPC: !!context.ppc,
            hasProfitability: !!context.profitability
        });
        
        return {
            success: true,
            source: 'pre_computed',
            data: context
        };
        
    } catch (error) {
        logger.error('[QMateMetricsService] Error getting QMate metrics context', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });
        
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

module.exports = {
    getFinancialSummary,
    getPPCMetrics,
    getDatewiseSales,
    getTopAsinsBySales,
    getProfitabilityData,
    getBuyBoxData,
    getAccountHealthData,
    getOrdersSummary,
    getMoneyWastedInAds,
    getTopErrorProducts,
    getAmazonReadyProducts,
    getQMateMetricsContext
};
