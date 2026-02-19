/**
 * DashboardSummaryService.js
 * 
 * Lightweight service for fetching only the data needed for the main dashboard.
 * This replaces the heavy AnalyseService.Analyse() + analyseData() flow for first load.
 * 
 * Optimizations:
 * 1. Only loads collections needed for dashboard (not all 24+)
 * 2. Uses projections (.select()) to avoid loading large arrays
 * 3. Uses .lean() for all queries to reduce memory and CPU
 * 4. Runs all queries in parallel
 * 5. Minimal calculations - only what dashboard needs
 */

const logger = require('../../utils/Logger.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
const V2_Model = require('../../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const V1_Model = require('../../models/seller-performance/V1_Seller_Performance_Report_Model.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
const GetOrderDataModel = require('../../models/products/OrderAndRevenueModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const adsKeywordsPerformanceModel = require('../../models/amazon-ads/adsKeywordsPerformanceModel.js');
const DataFetchTracking = require('../../models/system/DataFetchTrackingModel.js');
const { calculateAccountHealthPercentage, checkAccountHealth } = require('./AccountHealth.js');
const IssueSummary = require('../../models/system/IssueSummaryModel.js');

/**
 * Get dashboard summary data with optimized queries
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} Dashboard summary data
 */
async function getDashboardSummary(userId, country, region) {
    const startTime = Date.now();
    logger.info(`[PERF] Starting getDashboardSummary for user ${userId}, country ${country}, region ${region}`);

    try {
        // Run all queries in parallel with projections and .lean()
        const [
            economicsMetrics,
            buyBoxData,
            v2Data,
            v1Data,
            ppcMetrics,
            orderData,
            sellerData,
            adsKeywordsData,
            dataFetchTracking,
            issueSummary
        ] = await Promise.all([
            // EconomicsMetrics: Only select fields needed for dashboard totals
            EconomicsMetrics.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .select('totalSales grossProfit datewiseSales dateRange ppcSpent fbaFees storageFees amazonFees totalFees refunds isBig')
                .lean(),
            
            // BuyBoxData: Only select summary fields, not full asinBuyBoxData array
            BuyBoxData.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .select('totalProducts productsWithBuyBox productsWithoutBuyBox dateRange')
                .lean(),
            
            // V2 Seller Performance: Small doc, get all for account health
            V2_Model.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .lean(),
            
            // V1 Seller Performance: Small doc, get all for account health
            V1_Model.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .lean(),
            
            // PPCMetrics: Only select summary for ACOS/spend display
            PPCMetrics.findOne({ userId: userId.toString(), country, region })
                .sort({ createdAt: -1 })
                .select('summary dateRange dateWiseMetrics')
                .lean(),
            
            // Orders: Only need RevenueData for order count (filter on client or use aggregation)
            GetOrderDataModel.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .select('RevenueData')
                .lean(),
            
            // Seller: Get products for count and basic info
            Seller.findOne({ User: userId })
                .select('sellerAccount brand')
                .lean(),
            
            // Ads Keywords: Only select cost and attributedSales30d for "Money Wasted" calc
            adsKeywordsPerformanceModel.findOne({ userId, country, region })
                .sort({ createdAt: -1 })
                .select('keywordsData')
                .lean(),
            
            // DataFetchTracking: Get actual date range from last fetch
            DataFetchTracking.findOne({ User: userId, country, region, status: 'completed' })
                .sort({ fetchedAt: -1 })
                .select('dateRange calendarMode')
                .lean(),
            
            // IssueSummary: Get precomputed issue counts for quick dashboard display
            IssueSummary.getIssueSummary(userId, country, region)
        ]);

        const queryTime = Date.now() - startTime;
        logger.info(`[PERF] getDashboardSummary queries completed in ${queryTime}ms`);

        // Find the seller account for current region
        let sellerAccount = null;
        if (sellerData && sellerData.sellerAccount) {
            sellerAccount = sellerData.sellerAccount.find(
                acc => acc.country === country && acc.region === region
            );
        }

        // Calculate account health
        const accountHealthPercentage = calculateAccountHealthPercentage(v2Data);
        const accountErrors = checkAccountHealth(v2Data, v1Data);

        // Calculate total sales from datewiseSales for consistency
        let totalWeeklySale = 0;
        if (economicsMetrics?.datewiseSales && Array.isArray(economicsMetrics.datewiseSales)) {
            totalWeeklySale = economicsMetrics.datewiseSales.reduce(
                (sum, item) => sum + (item.sales?.amount || 0), 0
            );
            totalWeeklySale = parseFloat(totalWeeklySale.toFixed(2));
        } else if (economicsMetrics?.totalSales?.amount) {
            totalWeeklySale = economicsMetrics.totalSales.amount;
        }

        // Calculate order count (Shipped, Unshipped, PartiallyShipped)
        let totalOrdersCount = 0;
        let filteredOrders = [];
        if (orderData?.RevenueData && Array.isArray(orderData.RevenueData)) {
            filteredOrders = orderData.RevenueData.filter(order =>
                order?.orderStatus === 'Shipped' ||
                order?.orderStatus === 'Unshipped' ||
                order?.orderStatus === 'PartiallyShipped'
            );
            totalOrdersCount = filteredOrders.length;
        }

        // Calculate product counts
        const totalProducts = sellerAccount?.products || [];
        const totalProductCount = totalProducts.length;
        const activeProducts = totalProducts.filter(p => p.status === 'Active');
        const activeProductCount = activeProducts.length;

        // Calculate "Money Wasted in Ads" - keywords with cost > 0 but sales < 0.01
        let moneyWastedInAds = 0;
        if (adsKeywordsData?.keywordsData && Array.isArray(adsKeywordsData.keywordsData)) {
            const wastedKeywords = adsKeywordsData.keywordsData.filter(keyword => {
                if (!keyword) return false;
                const cost = parseFloat(keyword.cost) || 0;
                const sales = parseFloat(keyword.attributedSales30d) || 0;
                return cost > 0 && sales < 0.01;
            });
            moneyWastedInAds = wastedKeywords.reduce((total, kw) => {
                return total + (parseFloat(kw.cost) || 0);
            }, 0);
            moneyWastedInAds = Math.round(moneyWastedInAds * 100) / 100;
        }

        // Get PPC summary from PPCMetrics
        const ppcSummary = ppcMetrics?.summary || {
            totalSales: 0,
            totalSpend: 0,
            overallAcos: 0,
            overallRoas: 0,
            totalImpressions: 0,
            totalClicks: 0,
            ctr: 0,
            cpc: 0
        };

        // Get date range (prefer DataFetchTracking, fallback to economicsMetrics)
        let startDate = null;
        let endDate = null;
        let calendarMode = 'default';
        
        if (dataFetchTracking?.dateRange) {
            startDate = dataFetchTracking.dateRange.startDate;
            endDate = dataFetchTracking.dateRange.endDate;
            calendarMode = dataFetchTracking.calendarMode || 'default';
        } else if (economicsMetrics?.dateRange) {
            startDate = economicsMetrics.dateRange.startDate;
            endDate = economicsMetrics.dateRange.endDate;
        }

        // Build minimal error counts (for quick stats)
        // Try to use precomputed IssueSummary first, fallback to approximations
        const hasIssueSummary = issueSummary && !issueSummary.isStale;
        const accountErrorCount = hasIssueSummary ? issueSummary.totalAccountErrors : (accountErrors?.TotalErrors || 0);
        const buyBoxErrorCount = buyBoxData?.productsWithoutBuyBox || 0;
        
        // Log whether we're using precomputed or fallback
        if (hasIssueSummary) {
            logger.info(`[PERF] Using precomputed IssueSummary for user ${userId}`, {
                totalIssues: issueSummary.totalIssues,
                lastCalculatedAt: issueSummary.lastCalculatedAt
            });
        } else {
            logger.info(`[PERF] No precomputed IssueSummary available for user ${userId}, using fallback`);
        }

        // Build dashboard summary response
        const dashboardSummary = {
            // Account Health
            accountHealthPercentage,
            AccountErrors: accountErrors,
            
            // Sales and Finance
            TotalWeeklySale: totalWeeklySale,
            accountFinance: (() => {
                const fbaFees = economicsMetrics?.fbaFees?.amount || 0;
                const storageFees = economicsMetrics?.storageFees?.amount || 0;
                let amazonFees = economicsMetrics?.amazonFees?.amount || 0;
                const refunds = economicsMetrics?.refunds?.amount || 0;
                
                // Fallback: use fbaFees + storageFees if amazonFees is 0
                if (amazonFees === 0) {
                    amazonFees = fbaFees + storageFees;
                }
                
                // Calculate Gross Profit: Sales - Amazon Fees - Refunds
                // This matches the calculation in Analyse.js convertEconomicsToFinanceFormat
                // Note: PPC is subtracted in frontend for display, not in backend
                const grossProfit = totalWeeklySale - amazonFees - refunds;
                
                // Other_Amazon_Fees = Total Amazon Fees - FBA Fees (for TotalSales component)
                const otherAmazonFees = Math.max(0, amazonFees - fbaFees);
                
                return {
                    Gross_Profit: parseFloat(grossProfit.toFixed(2)),
                    Total_Sales: totalWeeklySale,
                    ProductAdsPayment: ppcSummary.totalSpend || 0,
                    FBA_Fees: fbaFees,
                    Storage: storageFees,
                    Amazon_Fees: amazonFees,
                    Amazon_Charges: amazonFees, // Alias for Profitability page
                    Other_Amazon_Fees: parseFloat(otherAmazonFees.toFixed(2)), // For TotalSales component
                    Refunds: refunds
                };
            })(),
            TotalSales: economicsMetrics?.datewiseSales || [],
            
            // Orders
            GetOrderData: filteredOrders,
            totalOrdersCount,
            
            // Products
            TotalProduct: totalProducts,
            ActiveProducts: activeProducts,
            totalProductCount,
            activeProductCount,
            
            // PPC Summary (from PPCMetrics model)
            ppcSummary: {
                ...ppcSummary,
                moneyWastedInAds
            },
            sponsoredAdsMetrics: {
                totalCost: ppcSummary.totalSpend,
                totalSalesIn30Days: ppcSummary.totalSales,
                acos: ppcSummary.overallAcos || 0,
                tacos: 0 // TACOS requires total sales which we have, but keeping simple for now
            },
            ppcDateWiseMetrics: ppcMetrics?.dateWiseMetrics || [],
            // dateWiseTotalCosts - derived from ppcDateWiseMetrics for TotalSales component fallback
            dateWiseTotalCosts: (ppcMetrics?.dateWiseMetrics || []).map(item => ({
                date: item.date,
                totalCost: item.spend || 0,
                sales: item.sales || 0
            })),
            
            // "Money Wasted in Ads" for quick stat
            adsKeywordsPerformanceData: adsKeywordsData?.keywordsData || [],
            
            // BuyBox summary (not full array)
            buyBoxSummary: {
                totalProducts: buyBoxData?.totalProducts || 0,
                productsWithBuyBox: buyBoxData?.productsWithBuyBox || 0,
                productsWithoutBuyBox: buyBoxData?.productsWithoutBuyBox || 0
            },
            
            // Date range
            calendarMode,
            startDate,
            endDate,
            Country: country,
            
            // Quick error counts for "Total Issues"
            // Uses precomputed IssueSummary if available, otherwise falls back to approximations
            totalErrorInAccount: hasIssueSummary ? issueSummary.totalAccountErrors : accountErrorCount,
            totalProfitabilityErrors: hasIssueSummary ? issueSummary.totalProfitabilityErrors : 0,
            totalSponsoredAdsErrors: hasIssueSummary ? issueSummary.totalSponsoredAdsErrors : 0,
            totalInventoryErrors: hasIssueSummary ? issueSummary.totalInventoryErrors : 0,
            TotalRankingerrors: hasIssueSummary ? issueSummary.totalRankingErrors : 0,
            totalErrorInConversion: hasIssueSummary ? issueSummary.totalConversionErrors : buyBoxErrorCount,
            
            // Total issues (sum of all 6 categories)
            totalIssues: hasIssueSummary 
                ? issueSummary.totalIssues 
                : (accountErrorCount + buyBoxErrorCount), // Fallback approximation
            
            // Number of products with issues
            numberOfProductsWithIssues: hasIssueSummary ? issueSummary.numberOfProductsWithIssues : 0,
            
            // Flag indicating whether precomputed data was used
            isLightweightSummary: true,
            hasPrecomputedIssues: hasIssueSummary,
            issueDataLastUpdated: hasIssueSummary ? issueSummary.lastCalculatedAt : null
        };

        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] getDashboardSummary total time: ${totalTime}ms`);

        return {
            success: true,
            data: dashboardSummary
        };

    } catch (error) {
        logger.error('Error in getDashboardSummary:', {
            message: error.message,
            stack: error.stack
        });
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get full dashboard data with all error calculations
 * This is called for Phase 2 (Product Checker) or when full data is needed
 * Falls back to the existing AnalyseService flow
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} Full dashboard data
 */
async function getFullDashboardData(userId, country, region) {
    // Import existing services
    const { AnalyseService } = require('../main/Analyse.js');
    const { analyseData } = require('./DashboardCalculation.js');
    
    const startTime = Date.now();
    logger.info(`[PERF] Starting getFullDashboardData for user ${userId}`);

    try {
        const analyseResult = await AnalyseService.Analyse(userId, country, region, null);
        
        if (!analyseResult || analyseResult.status !== 200) {
            return {
                success: false,
                error: analyseResult?.message || 'Analysis failed'
            };
        }

        const calculatedData = await analyseData(analyseResult.message, userId);
        
        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] getFullDashboardData total time: ${totalTime}ms`);

        return {
            success: true,
            data: calculatedData.dashboardData
        };
    } catch (error) {
        logger.error('Error in getFullDashboardData:', {
            message: error.message,
            stack: error.stack
        });
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * OPTIMIZED Phase 2: Get only top 4 products for Product Checker
 * 
 * This is a lightweight endpoint that ONLY returns the top 4 products by sales
 * that have issues. It does NOT run the full Analyse + analyseData flow.
 * 
 * Optimizations:
 * 1. Single MongoDB aggregation on AsinWiseSalesForBigAccounts (indexed)
 * 2. Single query to Seller model for products with issueCount
 * 3. Runs both in parallel
 * 4. Returns minimal payload (just 4 products)
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} Top 4 products { first, second, third, fourth }
 */
async function getProductCheckerOptimized(userId, country, region) {
    const startTime = Date.now();
    logger.info(`[PERF] Starting getProductCheckerOptimized for user ${userId}, country ${country}, region ${region}`);

    try {
        // Import the optimized function from DashboardCalculation
        const { getTop4ProductsByIssuesOptimized } = require('./DashboardCalculation.js');
        
        // Get top 4 products using optimized MongoDB aggregation
        const top4 = await getTop4ProductsByIssuesOptimized(userId, region, country);
        
        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] getProductCheckerOptimized completed in ${totalTime}ms`, {
            hasFirst: !!top4.first,
            hasSecond: !!top4.second,
            hasThird: !!top4.third,
            hasFourth: !!top4.fourth
        });

        return {
            success: true,
            data: {
                first: top4.first,
                second: top4.second,
                third: top4.third,
                fourth: top4.fourth
            }
        };

    } catch (error) {
        logger.error('Error in getProductCheckerOptimized:', {
            message: error.message,
            stack: error.stack
        });
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * PHASE 1: Instant data - precomputed counts (~50ms)
 * 
 * Returns only precomputed/indexed data for immediate first paint:
 * - IssueSummary: all 6 error category counts (precomputed)
 * - Seller: product counts (just counts, not full array)
 * - DataFetchTracking: date range, calendarMode
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} Phase 1 data
 */
async function getDashboardPhase1(userId, country, region) {
    const startTime = Date.now();
    logger.info(`[PERF] Starting getDashboardPhase1 for user ${userId}, country ${country}, region ${region}`);

    try {
        const [issueSummary, sellerData, dataFetchTracking] = await Promise.all([
            IssueSummary.getIssueSummary(userId, country, region),
            Seller.findOne({ User: userId })
                .select('sellerAccount.country sellerAccount.region sellerAccount.products.status')
                .lean(),
            DataFetchTracking.findOne({ User: userId, country, region, status: 'completed' })
                .sort({ fetchedAt: -1 })
                .select('dateRange calendarMode')
                .lean()
        ]);

        let sellerAccount = null;
        if (sellerData?.sellerAccount) {
            sellerAccount = sellerData.sellerAccount.find(
                acc => acc.country === country && acc.region === region
            );
        }

        const products = sellerAccount?.products || [];
        const totalProductCount = products.length;
        const activeProductCount = products.filter(p => p.status === 'Active').length;

        let startDate = null;
        let endDate = null;
        let calendarMode = 'default';
        if (dataFetchTracking?.dateRange) {
            startDate = dataFetchTracking.dateRange.startDate;
            endDate = dataFetchTracking.dateRange.endDate;
            calendarMode = dataFetchTracking.calendarMode || 'default';
        }

        const hasIssueSummary = issueSummary && !issueSummary.isStale;

        const phase1Data = {
            totalProfitabilityErrors: hasIssueSummary ? issueSummary.totalProfitabilityErrors : 0,
            totalSponsoredAdsErrors: hasIssueSummary ? issueSummary.totalSponsoredAdsErrors : 0,
            totalInventoryErrors: hasIssueSummary ? issueSummary.totalInventoryErrors : 0,
            TotalRankingerrors: hasIssueSummary ? issueSummary.totalRankingErrors : 0,
            totalErrorInConversion: hasIssueSummary ? issueSummary.totalConversionErrors : 0,
            totalErrorInAccount: hasIssueSummary ? issueSummary.totalAccountErrors : 0,
            totalIssues: hasIssueSummary ? issueSummary.totalIssues : 0,
            numberOfProductsWithIssues: hasIssueSummary ? issueSummary.numberOfProductsWithIssues : 0,
            totalProductCount,
            activeProductCount,
            calendarMode,
            startDate,
            endDate,
            Country: country,
            hasPrecomputedIssues: hasIssueSummary,
            issueDataLastUpdated: hasIssueSummary ? issueSummary.lastCalculatedAt : null,
            phase: 1
        };

        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] getDashboardPhase1 completed in ${totalTime}ms`);

        return { success: true, data: phase1Data };
    } catch (error) {
        logger.error('Error in getDashboardPhase1:', { message: error.message, stack: error.stack });
        return { success: false, error: error.message };
    }
}

/**
 * PHASE 2: Core metrics (~150ms)
 * 
 * Returns core financial/health metrics with minimal projections:
 * - EconomicsMetrics: totalSales, fees (no arrays)
 * - V2/V1: account health
 * - BuyBox: summary counts
 * - PPCMetrics: summary only
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} Phase 2 data
 */
async function getDashboardPhase2(userId, country, region) {
    const startTime = Date.now();
    logger.info(`[PERF] Starting getDashboardPhase2 for user ${userId}, country ${country}, region ${region}`);

    try {
        const [economicsMetrics, v2Data, v1Data, buyBoxData, ppcMetrics] = await Promise.all([
            EconomicsMetrics.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .select('totalSales grossProfit fbaFees storageFees amazonFees refunds dateRange')
                .lean(),
            V2_Model.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .lean(),
            V1_Model.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .lean(),
            BuyBoxData.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .select('totalProducts productsWithBuyBox productsWithoutBuyBox')
                .lean(),
            PPCMetrics.findOne({ userId: userId.toString(), country, region })
                .sort({ createdAt: -1 })
                .select('summary')
                .lean()
        ]);

        const accountHealthPercentage = calculateAccountHealthPercentage(v2Data);
        const accountErrors = checkAccountHealth(v2Data, v1Data);

        const totalWeeklySale = economicsMetrics?.totalSales?.amount || 0;
        const fbaFees = economicsMetrics?.fbaFees?.amount || 0;
        const storageFees = economicsMetrics?.storageFees?.amount || 0;
        let amazonFees = economicsMetrics?.amazonFees?.amount || 0;
        const refunds = economicsMetrics?.refunds?.amount || 0;
        if (amazonFees === 0) amazonFees = fbaFees + storageFees;
        const grossProfit = totalWeeklySale - amazonFees - refunds;
        const otherAmazonFees = Math.max(0, amazonFees - fbaFees);

        const ppcSummary = ppcMetrics?.summary || {
            totalSales: 0, totalSpend: 0, overallAcos: 0, overallRoas: 0,
            totalImpressions: 0, totalClicks: 0, ctr: 0, cpc: 0
        };

        const phase2Data = {
            accountHealthPercentage,
            AccountErrors: accountErrors,
            TotalWeeklySale: parseFloat(totalWeeklySale.toFixed(2)),
            accountFinance: {
                Gross_Profit: parseFloat(grossProfit.toFixed(2)),
                Total_Sales: parseFloat(totalWeeklySale.toFixed(2)),
                ProductAdsPayment: ppcSummary.totalSpend || 0,
                FBA_Fees: fbaFees,
                Storage: storageFees,
                Amazon_Fees: amazonFees,
                Amazon_Charges: amazonFees,
                Other_Amazon_Fees: parseFloat(otherAmazonFees.toFixed(2)),
                Refunds: refunds
            },
            ppcSummary,
            sponsoredAdsMetrics: {
                totalCost: ppcSummary.totalSpend,
                totalSalesIn30Days: ppcSummary.totalSales,
                acos: ppcSummary.overallAcos || 0,
                tacos: 0
            },
            buyBoxSummary: {
                totalProducts: buyBoxData?.totalProducts || 0,
                productsWithBuyBox: buyBoxData?.productsWithBuyBox || 0,
                productsWithoutBuyBox: buyBoxData?.productsWithoutBuyBox || 0
            },
            phase: 2
        };

        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] getDashboardPhase2 completed in ${totalTime}ms`);

        return { success: true, data: phase2Data };
    } catch (error) {
        logger.error('Error in getDashboardPhase2:', { message: error.message, stack: error.stack });
        return { success: false, error: error.message };
    }
}

/**
 * PHASE 3: Charts and arrays (~200ms)
 * 
 * Returns larger data arrays for charts and detailed views:
 * - EconomicsMetrics.datewiseSales: sales chart
 * - PPCMetrics.dateWiseMetrics: PPC chart
 * - adsKeywordsPerformanceData: "Money Wasted" calculation
 * - Orders: filtered orders
 * - Seller.products: full product array
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} Phase 3 data
 */
async function getDashboardPhase3(userId, country, region) {
    const startTime = Date.now();
    logger.info(`[PERF] Starting getDashboardPhase3 for user ${userId}, country ${country}, region ${region}`);

    try {
        const [economicsMetrics, ppcMetrics, adsKeywordsData, orderData, sellerData] = await Promise.all([
            EconomicsMetrics.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .select('datewiseSales')
                .lean(),
            PPCMetrics.findOne({ userId: userId.toString(), country, region })
                .sort({ createdAt: -1 })
                .select('dateWiseMetrics')
                .lean(),
            adsKeywordsPerformanceModel.findOne({ userId, country, region })
                .sort({ createdAt: -1 })
                .select('keywordsData')
                .lean(),
            GetOrderDataModel.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .select('RevenueData')
                .lean(),
            Seller.findOne({ User: userId })
                .select('sellerAccount.country sellerAccount.region sellerAccount.products')
                .lean()
        ]);

        let sellerAccount = null;
        if (sellerData?.sellerAccount) {
            sellerAccount = sellerData.sellerAccount.find(
                acc => acc.country === country && acc.region === region
            );
        }

        const totalProducts = sellerAccount?.products || [];
        const activeProducts = totalProducts.filter(p => p.status === 'Active');

        let filteredOrders = [];
        let totalOrdersCount = 0;
        if (orderData?.RevenueData && Array.isArray(orderData.RevenueData)) {
            filteredOrders = orderData.RevenueData.filter(order =>
                order?.orderStatus === 'Shipped' ||
                order?.orderStatus === 'Unshipped' ||
                order?.orderStatus === 'PartiallyShipped'
            );
            totalOrdersCount = filteredOrders.length;
        }

        let moneyWastedInAds = 0;
        const keywordsData = adsKeywordsData?.keywordsData || [];
        if (keywordsData.length > 0) {
            const wastedKeywords = keywordsData.filter(kw => {
                if (!kw) return false;
                const cost = parseFloat(kw.cost) || 0;
                const sales = parseFloat(kw.attributedSales30d) || 0;
                return cost > 0 && sales < 0.01;
            });
            moneyWastedInAds = wastedKeywords.reduce((total, kw) => total + (parseFloat(kw.cost) || 0), 0);
            moneyWastedInAds = Math.round(moneyWastedInAds * 100) / 100;
        }

        const dateWiseMetrics = ppcMetrics?.dateWiseMetrics || [];

        const phase3Data = {
            TotalSales: economicsMetrics?.datewiseSales || [],
            TotalProduct: totalProducts,
            ActiveProducts: activeProducts,
            GetOrderData: filteredOrders,
            totalOrdersCount,
            ppcDateWiseMetrics: dateWiseMetrics,
            dateWiseTotalCosts: dateWiseMetrics.map(item => ({
                date: item.date,
                totalCost: item.spend || 0,
                sales: item.sales || 0
            })),
            adsKeywordsPerformanceData: keywordsData,
            moneyWastedInAds,
            phase: 3
        };

        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] getDashboardPhase3 completed in ${totalTime}ms`);

        return { success: true, data: phase3Data };
    } catch (error) {
        logger.error('Error in getDashboardPhase3:', { message: error.message, stack: error.stack });
        return { success: false, error: error.message };
    }
}

module.exports = {
    getDashboardSummary,
    getFullDashboardData,
    getProductCheckerOptimized,
    getDashboardPhase1,
    getDashboardPhase2,
    getDashboardPhase3
};
