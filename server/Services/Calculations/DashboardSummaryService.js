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
const { loadLiveEconomics } = require('../Finance/LiveEconomicsService.js');
const { sumEconomicsSales, convertEconomicsToFinanceFormat, toDatewiseSalesSeries } = require('../Finance/EconomicsFinanceFormat.js');
const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
const V2_Model = require('../../models/seller-performance/V2_Seller_Performance_ReportModel.js');
const V1_Model = require('../../models/seller-performance/V1_Seller_Performance_Report_Model.js');
const PPCMetrics = require('../../models/amazon-ads/PPCMetricsModel.js');
const GetOrderDataModel = require('../../models/products/OrderAndRevenueModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const adsKeywordsPerformanceModel = require('../../models/amazon-ads/adsKeywordsPerformanceModel.js');
const DataFetchTracking = require('../../models/system/DataFetchTrackingModel.js');
const { calculateAccountHealthPercentage, checkAccountHealth } = require('./AccountHealth.js');
const { loadV2History } = require('./AccountHealthHistory.js');
const IssueSummary = require('../../models/system/IssueSummaryModel.js');
const PPCCampaignAnalysisService = require('./PPCCampaignAnalysisService.js');
const { classifyBuyBoxLoss, summarizeBuyBoxCounts, activeAsinSetOf, buyBoxJudgedAsinSetOf } = require('./RecoverableAmountUtils.js');

// Only what classifyBuyBoxLoss needs to decide and count — not sales/pageViews
// for every ASIN on every one of the 7 days.
const BUYBOX_SUMMARY_PROJECTION = 'date dateRange createdAt totalProducts asinBuyBoxData.childAsin asinBuyBoxData.buyBoxPercentage asinBuyBoxData.sessions';

/**
 * Buy Box summary counts, decided the same way the issues pipeline decides them
 * (Analyse -> classifyBuyBoxLoss -> DashboardCalculation), so the dashboard's
 * "without Buy Box" number equals the number of No Buy Box tasks. Reading the
 * newest doc's stored productsWithoutBuyBox instead counted inactive and
 * zero-traffic ASINs, judged from one day, and read 0 whenever that day was empty.
 *
 * All counts are over ACTIVE ASINs (summarizeBuyBoxCounts), so with + without +
 * unknown = total; this used to mix an all-ASIN total with an active-only
 * "without" and drop productsWithLowBuyBox, which the client expects.
 *
 * @param {Array} days - findRecentDays result
 * @param {Array} products - this marketplace's sellerAccount.products
 * @returns {{totalProducts:number, productsWithBuyBox:number, productsWithoutBuyBox:number, productsWithLowBuyBox:number, productsWithUnknownBuyBox:number}}
 */
function summarizeBuyBoxDays(days, products) {
    return summarizeBuyBoxCounts(classifyBuyBoxLoss(days), buyBoxJudgedAsinSetOf(products));
}

/**
 * TACoS for the dashboard: PPC spend ÷ total (organic + PPC) sales over the SAME days.
 *
 * The denominator is aggregated over the rollup's exact window (DailySkuFinance, else
 * SalesOnlyMetrics — see PPCCampaignAnalysisService.aggregateTotalSales), the same formula
 * and source as the Campaign Audit KPI summary. null — "no data", not 0% — when there is
 * no PPC rollup, no sales in the window, or the read fails.
 */
async function resolveDashboardTacos(userId, country, region, ppcRollup) {
    if (!ppcRollup?.found || !ppcRollup.dateRange?.startDate || !ppcRollup.dateRange?.endDate) return null;
    try {
        const { totalSales } = await PPCCampaignAnalysisService.aggregateTotalSales(
            userId.toString(),
            country,
            region,
            ppcRollup.dateRange.startDate,
            ppcRollup.dateRange.endDate
        );
        const spend = Number(ppcRollup.summary?.totalSpend || 0);
        const total = Number(totalSales || 0);
        return total > 0 ? Math.round((spend / total) * 100 * 100) / 100 : null;
    } catch (err) {
        logger.warn('[DashboardSummary] resolveDashboardTacos failed', { error: err.message });
        return null;
    }
}

/**
 * The dashboard's sales and finance figures, from the same loader and the same
 * conversions the full pipeline uses (Analyse -> DashboardCalculation), so the
 * light endpoints and the full dashboard show one number. Window: the 30 days
 * ending yesterday (loadLiveEconomics default), as Analyse loads it.
 *
 * It replaces SalesOnlyMetrics.getRecentDays, which exists for only a few
 * marketplaces and has no fees, so every other account read $0 sales and $0
 * gross profit. With no data, sales/finance are null and the series is [].
 *
 * Split in two so a caller can load the doc in parallel with its other queries
 * and convert once the PPC spend is known; one load per request.
 */
async function loadDashboardEconomics(userId, country, region) {
    try {
        return await loadLiveEconomics(userId, region, country);
    } catch (err) {
        // Never fail the dashboard over finance; unknown is shown as "no data".
        logger.warn('[DashboardSummary] loadLiveEconomics failed', { error: err.message });
        return null;
    }
}

/**
 * @param {Object|null} doc - loadDashboardEconomics result
 * @param {number} ppcSpend - PPC spend for ProductAdsPayment (the PPC rollup's spend)
 * @returns {{doc: Object|null, totalWeeklySale: number|null, accountFinance: Object, totalSales: Array}}
 */
function buildDashboardSales(doc, ppcSpend = 0) {
    return {
        doc,
        totalWeeklySale: sumEconomicsSales(doc).totalSales,
        accountFinance: convertEconomicsToFinanceFormat(doc, ppcSpend),
        totalSales: toDatewiseSalesSeries(doc),
    };
}

/**
 * Money wasted in ads — same aggregation as Campaign Audit wasted-spend tab.
 */
async function resolveMoneyWastedInAds(userId, country, region, startDate, endDate) {
    try {
        const result = await PPCCampaignAnalysisService.getTotalWastedSpend(
            userId,
            country,
            region,
            startDate,
            endDate
        );
        return result.totalWastedSpend ?? 0;
    } catch (err) {
        logger.warn('[DashboardSummary] resolveMoneyWastedInAds failed', { error: err.message });
        return 0;
    }
}

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
            economicsDoc,
            buyBoxDays,
            v2Data,
            v1Data,
            v2History,
            orderData,
            sellerData,
            adsKeywordsData,
            dataFetchTracking,
            issueSummary
        ] = await Promise.all([
            loadDashboardEconomics(userId, country, region),

            // BuyBoxData: last 7 non-empty days, minimal projection (see summarizeBuyBoxDays)
            BuyBoxData.findRecentDays(userId, region, country, 7, BUYBOX_SUMMARY_PROJECTION),
            
            // V2 Seller Performance: Small doc, get all for account health
            V2_Model.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .lean(),
            
            // V1 Seller Performance: Small doc, get all for account health
            V1_Model.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .lean(),

            // Last 7 days of V2 reports: account health is judged over the week,
            // the same way the tasks and the Account Health page judge it.
            loadV2History(userId, country, region),
            
            // Orders: Only need RevenueData for order count (filter on client or use aggregation)
            GetOrderDataModel.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .select('RevenueData')
                .lean(),
            
            // Seller: Get products for count and basic info
            Seller.findOne({ User: userId })
                .select('sellerAccount brand')
                .lean(),
            
            // Ads keywords: merge per-day docs (or legacy single doc) for "Money Wasted" calc
            adsKeywordsPerformanceModel
                .findMergedKeywordsData(userId, country, region, {})
                .then((rows) => (rows?.length ? { keywordsData: rows } : null)),
            
            // DataFetchTracking: Get actual date range from last usable fetch (completed or partial)
            // Both 'completed' and 'partial' runs have valid data that can be used
            DataFetchTracking.findOne({ User: userId, country, region, status: { $in: ['completed', 'partial'] } })
                .sort({ fetchedAt: -1 })
                .select('dataRange status')
                .lean(),
            
            // IssueSummary: Get precomputed issue counts for quick dashboard display
            IssueSummary.getIssueSummary(userId, country, region)
        ]);

        const queryTime = Date.now() - startTime;
        logger.info(`[PERF] getDashboardSummary queries completed in ${queryTime}ms`);

        const ppcRollup = await PPCMetrics.rollupLastDays(userId.toString(), country, region, 30);
        const tacos = await resolveDashboardTacos(userId, country, region, ppcRollup);
        const ppcMetrics = ppcRollup?.found
            ? {
                  summary: ppcRollup.summary,
                  dateRange: ppcRollup.dateRange,
                  dateWiseMetrics: ppcRollup.dateWiseMetrics || []
              }
            : null;

        // Find the seller account for current region
        let sellerAccount = null;
        if (sellerData && sellerData.sellerAccount) {
            sellerAccount = sellerData.sellerAccount.find(
                acc => acc.country === country && acc.region === region
            );
        }

        // Calculate account health
        const accountHealthPercentage = calculateAccountHealthPercentage(v2Data);
        const accountErrors = checkAccountHealth(v2Data, v1Data, v2History);

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
        const buyBoxSummary = summarizeBuyBoxDays(buyBoxDays, totalProducts);

        const wastedStart = dataFetchTracking?.dataRange?.startDate || null;
        const wastedEnd = dataFetchTracking?.dataRange?.endDate || null;
        const moneyWastedInAds = await resolveMoneyWastedInAds(userId, country, region, wastedStart, wastedEnd);

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

        const sales = buildDashboardSales(economicsDoc, ppcSummary.totalSpend || 0);

        // Get date range (prefer DataFetchTracking, fallback to the economics window)
        let startDate = null;
        let endDate = null;
        let calendarMode = 'default';

        if (dataFetchTracking?.dataRange) {
            startDate = dataFetchTracking.dataRange.startDate;
            endDate = dataFetchTracking.dataRange.endDate;
        } else if (sales.doc?.dateRange) {
            startDate = sales.doc.dateRange.startDate;
            endDate = sales.doc.dateRange.endDate;
        }

        // Build minimal error counts (for quick stats)
        // Try to use precomputed IssueSummary first, fallback to approximations
        const hasIssueSummary = issueSummary && !issueSummary.isStale;
        const accountErrorCount = hasIssueSummary ? issueSummary.totalAccountErrors : (accountErrors?.TotalErrors || 0);
        const buyBoxErrorCount = buyBoxSummary.productsWithoutBuyBox;
        
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
            TotalWeeklySale: sales.totalWeeklySale,
            accountFinance: sales.accountFinance,
            TotalSales: sales.totalSales,
            
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
                tacos
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
            buyBoxSummary,
            
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
            DataFetchTracking.findOne({ User: userId, country, region, status: { $in: ['completed', 'partial'] } })
                .sort({ fetchedAt: -1 })
                .select('dataRange status')
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
        if (dataFetchTracking?.dataRange) {
            startDate = dataFetchTracking.dataRange.startDate;
            endDate = dataFetchTracking.dataRange.endDate;
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
 * - Live economics (loadLiveEconomics: fresh EconomicsMetrics, else DailySkuFinance):
 *   total sales and account finance (fees, refunds, gross profit)
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
        const [economicsDoc, v2Data, v1Data, buyBoxDays, sellerData, v2HistoryPhase2] = await Promise.all([
            loadDashboardEconomics(userId, country, region),
            V2_Model.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .lean(),
            V1_Model.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .lean(),
            BuyBoxData.findRecentDays(userId, region, country, 7, BUYBOX_SUMMARY_PROJECTION),
            // Needed only to count Active ASINs, so the Buy Box count matches the tasks.
            Seller.findOne({ User: userId })
                .select('sellerAccount.country sellerAccount.region sellerAccount.products.asin sellerAccount.products.status')
                .lean(),
            loadV2History(userId, country, region)
        ]);
        const phase2Account = (sellerData?.sellerAccount || []).find(
            (acc) => acc.country === country && acc.region === region
        );

        const ppcRollupPhase2 = await PPCMetrics.rollupLastDays(userId.toString(), country, region, 30);
        const ppcMetrics = ppcRollupPhase2?.found ? { summary: ppcRollupPhase2.summary } : null;
        const tacos = await resolveDashboardTacos(userId, country, region, ppcRollupPhase2);

        const accountHealthPercentage = calculateAccountHealthPercentage(v2Data);
        const accountErrors = checkAccountHealth(v2Data, v1Data, v2HistoryPhase2);

        const ppcSummary = ppcMetrics?.summary || {
            totalSales: 0, totalSpend: 0, overallAcos: 0, overallRoas: 0,
            totalImpressions: 0, totalClicks: 0, ctr: 0, cpc: 0
        };

        const sales = buildDashboardSales(economicsDoc, ppcSummary.totalSpend || 0);

        const phase2Data = {
            accountHealthPercentage,
            AccountErrors: accountErrors,
            TotalWeeklySale: sales.totalWeeklySale,
            accountFinance: sales.accountFinance,
            ppcSummary,
            sponsoredAdsMetrics: {
                totalCost: ppcSummary.totalSpend,
                totalSalesIn30Days: ppcSummary.totalSales,
                acos: ppcSummary.overallAcos || 0,
                tacos
            },
            buyBoxSummary: summarizeBuyBoxDays(buyBoxDays, phase2Account?.products),
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
 * - Live economics datewiseSales (loadLiveEconomics): sales chart
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
        const [economicsDoc, adsKeywordsData, orderData, sellerData, dataFetchTracking] = await Promise.all([
            loadDashboardEconomics(userId, country, region),
            adsKeywordsPerformanceModel
                .findMergedKeywordsData(userId, country, region, {})
                .then((rows) => (rows?.length ? { keywordsData: rows } : null)),
            GetOrderDataModel.findOne({ User: userId, country, region })
                .sort({ createdAt: -1 })
                .select('RevenueData')
                .lean(),
            Seller.findOne({ User: userId })
                .select('sellerAccount.country sellerAccount.region sellerAccount.products')
                .lean(),
            DataFetchTracking.findOne({ User: userId, country, region, status: { $in: ['completed', 'partial'] } })
                .sort({ fetchedAt: -1 })
                .select('dataRange status')
                .lean()
        ]);

        const ppcRollupPhase3 = await PPCMetrics.rollupLastDays(userId.toString(), country, region, 30);
        const ppcMetrics = ppcRollupPhase3?.found
            ? { dateWiseMetrics: ppcRollupPhase3.dateWiseMetrics || [], summary: ppcRollupPhase3.summary }
            : null;

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

        const keywordsData = adsKeywordsData?.keywordsData || [];
        const wastedStart = dataFetchTracking?.dataRange?.startDate || null;
        const wastedEnd = dataFetchTracking?.dataRange?.endDate || null;
        const moneyWastedInAds = await resolveMoneyWastedInAds(userId, country, region, wastedStart, wastedEnd);

        const dateWiseMetrics = ppcMetrics?.dateWiseMetrics || [];

        const phase3Data = {
            TotalSales: buildDashboardSales(economicsDoc).totalSales,
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
    getDashboardPhase3,
    summarizeBuyBoxDays,
    // Exported for tests: the dashboard's TACoS must divide by total sales over the PPC window.
    resolveDashboardTacos,
    buildDashboardSales
};
