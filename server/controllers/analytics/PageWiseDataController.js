/**
 * Page-wise Data Controller
 * 
 * This controller provides separate endpoints for each dashboard page.
 * Data is calculated in the backend and sent to the frontend ready for display.
 * 
 * NOTE: History recording is NOT done here. History is recorded:
 * 1. After first integration completes (in Integration.js)
 * 2. Weekly via dedicated WeeklyHistoryWorker (runs on Sundays)
 */

const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const { AnalyseService } = require('../../Services/main/Analyse.js');
const { analyseData } = require('../../Services/Calculations/DashboardCalculation.js');
const CreateTaskService = require('../../Services/Calculations/CreateTasksService.js');
const logger = require('../../utils/Logger.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const NumberOfProductReviews = require('../../models/seller-performance/NumberOfProductReviewsModel.js');
const APlusContent = require('../../models/seller-performance/APlusContentModel.js');
const AccountHistory = require('../../models/user-auth/AccountHistory.js');
const User = require('../../models/user-auth/userModel.js');
const { getProductWiseSponsoredAdsData } = require('../../Services/amazon-ads/ProductWiseSponsoredAdsService.js');

/**
 * Get full dashboard data - calculates all data in backend
 * This is the main endpoint that replaces the old flow of:
 * 1. Frontend calling /getData
 * 2. Frontend calling calculation server
 * 3. Frontend displaying data
 */
const getDashboardData = asyncHandler(async (req, res) => {
    const startTime = Date.now();
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    const adminId = req.query.adminId || null;

    // Validate required parameters
    if (!userId) {
        logger.error('Missing userId in request');
        return res.status(400).json(
            new ApiError(400, 'User ID is required')
        );
    }
    
    if (!Country || !Region) {
        logger.error('Missing country or region in request', { Country, Region });
        return res.status(400).json(
            new ApiError(400, 'Country and region are required')
        );
    }

    try {
        logger.info(`[PERF] Getting dashboard data for user ${userId}, region ${Region}, country ${Country}`);

        // Step 1: Get raw data from Analyse service
        let analyseResult;
        const analyseStartTime = Date.now();
        try {
            analyseResult = await AnalyseService.Analyse(userId, Country, Region, adminId);
            const analyseEndTime = Date.now();
            logger.info(`[PERF] Analyse service completed in ${analyseEndTime - analyseStartTime}ms, status: ${analyseResult?.status}`);
        } catch (analyseError) {
            logger.error('Error calling AnalyseService.Analyse:', {
                message: analyseError.message,
                stack: analyseError.stack,
                name: analyseError.name
            });
            return res.status(500).json(
                new ApiError(500, `Error fetching analysis data: ${analyseError.message || 'Unknown error'}`)
            );
        }
        
        if (!analyseResult || analyseResult.status !== 200) {
            logger.error('Analyse service returned error', { 
                status: analyseResult?.status, 
                message: analyseResult?.message 
            });
            return res.status(analyseResult?.status || 500).json(
                new ApiError(analyseResult?.status || 500, analyseResult?.message || 'Analysis failed')
            );
        }

        // Validate that analyseResult.message exists
        if (!analyseResult.message) {
            logger.error('Analyse service returned success but message is missing', { analyseResult });
            return res.status(500).json(
                new ApiError(500, 'Analysis data is missing')
            );
        }

        // Step 2: Calculate dashboard data using the calculation service
        let calculatedData;
        const calcStartTime = Date.now();
        try {
            logger.info('[PERF] Starting dashboard calculation...');
            logger.info(`analyseResult.message type: ${typeof analyseResult.message}, keys: ${Object.keys(analyseResult.message || {}).join(', ')}`);
            calculatedData = await analyseData(analyseResult.message, userId);
            const calcEndTime = Date.now();
            logger.info(`[PERF] Dashboard calculation completed in ${calcEndTime - calcStartTime}ms`);
            
            if (!calculatedData || !calculatedData.dashboardData) {
                throw new Error('Calculated data is missing dashboardData property');
            }
        } catch (calcError) {
            logger.error('Error in analyseData calculation:', {
                message: calcError.message,
                stack: calcError.stack,
                name: calcError.name
            });
            return res.status(500).json(
                new ApiError(500, `Error calculating dashboard data: ${calcError.message || 'Unknown error'}`)
            );
        }

        // NOTE: History recording removed from here
        // History is now recorded only:
        // 1. After first integration completes (Integration.js)
        // 2. Weekly via WeeklyHistoryWorker (runs on Sundays)

        const totalTime = Date.now() - startTime;
        logger.info(`[PERF] Dashboard data total processing time: ${totalTime}ms`);

        // Return calculated dashboard data
        return res.status(200).json(
            new ApiResponse(200, {
                dashboardData: calculatedData.dashboardData
            }, "Dashboard data calculated successfully")
        );

    } catch (error) {
        logger.error("Unexpected error in getDashboardData:", {
            message: error.message,
            stack: error.stack,
            name: error.name
        });
        return res.status(500).json(
            new ApiError(500, `Error getting dashboard data: ${error.message || 'Unknown error'}`)
        );
    }
});

/**
 * Get profitability dashboard data
 */
const getProfitabilityData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Getting profitability data for user ${userId}`);

        // Get raw data
        const analyseResult = await AnalyseService.Analyse(userId, Country, Region);
        
        if (analyseResult.status !== 200) {
            return res.status(analyseResult.status).json(
                new ApiError(analyseResult.status, analyseResult.message)
            );
        }

        // Calculate full dashboard data
        const calculatedData = await analyseData(analyseResult.message, userId);
        const dashboardData = calculatedData.dashboardData;

        // Extract profitability-specific data - all data needed by ProfitabilityDashboard.jsx
        const profitabilityData = {
            // Core profitability data
            profitibilityData: dashboardData.profitibilityData || [],
            totalProfitabilityErrors: dashboardData.totalProfitabilityErrors || 0,
            profitabilityErrorDetails: dashboardData.profitabilityErrorDetails || [],
            
            // Product data
            TotalProduct: dashboardData.TotalProduct || [],
            ActiveProducts: dashboardData.ActiveProducts || [],
            SalesByProducts: dashboardData.SalesByProducts || [],
            
            // Finance and sales data
            accountFinance: dashboardData.accountFinance || {},
            TotalWeeklySale: dashboardData.TotalWeeklySale || 0,
            TotalSales: dashboardData.TotalSales || [],
            economicsMetrics: dashboardData.economicsMetrics || {},
            
            // PPC/Ads data for profit calculation
            ProductWiseSponsoredAdsGraphData: dashboardData.ProductWiseSponsoredAdsGraphData || {},
            sponsoredAdsMetrics: dashboardData.sponsoredAdsMetrics || {},
            dateWiseTotalCosts: dashboardData.dateWiseTotalCosts || [],
            
            // Date range
            calendarMode: dashboardData.calendarMode || 'default',
            Country: dashboardData.Country,
            startDate: dashboardData.startDate,
            endDate: dashboardData.endDate
        };

        return res.status(200).json(
            new ApiResponse(200, profitabilityData, "Profitability data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getProfitabilityData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting profitability data: ${error.message}`)
        );
    }
});

/**
 * Get PPC/Sponsored Ads dashboard data
 */
const getPPCData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Getting PPC data for user ${userId}`);

        // Get raw data
        const analyseResult = await AnalyseService.Analyse(userId, Country, Region);
        
        if (analyseResult.status !== 200) {
            return res.status(analyseResult.status).json(
                new ApiError(analyseResult.status, analyseResult.message)
            );
        }

        // Calculate full dashboard data
        const calculatedData = await analyseData(analyseResult.message, userId);
        const dashboardData = calculatedData.dashboardData;

        // Extract PPC-specific data - all data needed by PPCDashboard.jsx
        const ppcData = {
            // Core PPC metrics
            sponsoredAdsMetrics: dashboardData.sponsoredAdsMetrics || {},
            negativeKeywordsMetrics: dashboardData.negativeKeywordsMetrics || [],
            ProductWiseSponsoredAds: dashboardData.ProductWiseSponsoredAds || [],
            ProductWiseSponsoredAdsGraphData: dashboardData.ProductWiseSponsoredAdsGraphData || [],
            totalSponsoredAdsErrors: dashboardData.totalSponsoredAdsErrors || 0,
            sponsoredAdsErrorDetails: dashboardData.sponsoredAdsErrorDetails || [],
            
            // Cost and sales data
            dateWiseTotalCosts: dashboardData.dateWiseTotalCosts || [],
            campaignWiseTotalSalesAndCost: dashboardData.campaignWiseTotalSalesAndCost || [],
            
            // Keywords and search terms
            keywords: dashboardData.keywords || [],
            searchTerms: dashboardData.searchTerms || [],
            adsKeywordsPerformanceData: dashboardData.adsKeywordsPerformanceData || [],
            negetiveKeywords: dashboardData.negetiveKeywords || [],
            
            // Campaign and ad group data
            campaignData: dashboardData.campaignData || [],
            AdsGroupData: dashboardData.AdsGroupData || [],
            
            // PPCUnitsSold data
            PPCUnitsSold: dashboardData.PPCUnitsSold || { totalUnits: 0, dateWiseUnits: [] },
            
            // Sales data for TACOS calculation
            TotalSales: dashboardData.TotalSales || [],
            TotalWeeklySale: dashboardData.TotalWeeklySale || 0,
            accountFinance: dashboardData.accountFinance || {},
            
            // Date range
            calendarMode: dashboardData.calendarMode || 'default',
            Country: dashboardData.Country,
            startDate: dashboardData.startDate,
            endDate: dashboardData.endDate
        };

        return res.status(200).json(
            new ApiResponse(200, ppcData, "PPC data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getPPCData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting PPC data: ${error.message}`)
        );
    }
});

/**
 * Get Issues page data
 */
const getIssuesData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Getting issues data for user ${userId}`);

        // Get raw data
        const analyseResult = await AnalyseService.Analyse(userId, Country, Region);
        
        if (analyseResult.status !== 200) {
            return res.status(analyseResult.status).json(
                new ApiError(analyseResult.status, analyseResult.message)
            );
        }

        // Calculate full dashboard data
        const calculatedData = await analyseData(analyseResult.message, userId);
        const dashboardData = calculatedData.dashboardData;

        // Extract issues-specific data - all data needed by Issues page (Category.jsx + Account.jsx)
        const issuesData = {
            // Product-wise error data for Category.jsx
            productWiseError: dashboardData.productWiseError || [],
            rankingProductWiseErrors: dashboardData.rankingProductWiseErrors || [],
            conversionProductWiseErrors: dashboardData.conversionProductWiseErrors || [],
            inventoryProductWiseErrors: dashboardData.inventoryProductWiseErrors || [],
            
            // Error counts
            totalErrorInAccount: dashboardData.totalErrorInAccount || 0,
            totalErrorInConversion: dashboardData.totalErrorInConversion || 0,
            TotalRankingerrors: dashboardData.TotalRankingerrors || 0,
            totalInventoryErrors: dashboardData.totalInventoryErrors || 0,
            totalProfitabilityErrors: dashboardData.totalProfitabilityErrors || 0,
            totalSponsoredAdsErrors: dashboardData.totalSponsoredAdsErrors || 0,
            
            // Error details
            profitabilityErrorDetails: dashboardData.profitabilityErrorDetails || [],
            sponsoredAdsErrorDetails: dashboardData.sponsoredAdsErrorDetails || [],
            
            // Account errors for Account.jsx
            AccountErrors: dashboardData.AccountErrors || {},
            accountHealthPercentage: dashboardData.accountHealthPercentage || { Percentage: 0, status: 'Unknown' },
            
            // Buy Box data for Category.jsx
            buyBoxData: dashboardData.buyBoxData || { asinBuyBoxData: [] },
            
            // Top error products
            first: dashboardData.first,
            second: dashboardData.second,
            third: dashboardData.third,
            fourth: dashboardData.fourth,
            
            // Product data for lookups
            TotalProduct: dashboardData.TotalProduct || [],
            ActiveProducts: dashboardData.ActiveProducts || [],
            Country: dashboardData.Country
        };

        return res.status(200).json(
            new ApiResponse(200, issuesData, "Issues data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getIssuesData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting issues data: ${error.message}`)
        );
    }
});

/**
 * Get Issues by Product data
 */
const getIssuesByProductData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Getting issues by product data for user ${userId}`);

        // Get raw data
        const analyseResult = await AnalyseService.Analyse(userId, Country, Region);
        
        if (analyseResult.status !== 200) {
            return res.status(analyseResult.status).json(
                new ApiError(analyseResult.status, analyseResult.message)
            );
        }

        // Calculate full dashboard data
        const calculatedData = await analyseData(analyseResult.message, userId);
        const dashboardData = calculatedData.dashboardData;

        // Extract issues by product specific data
        const issuesByProductData = {
            productWiseError: dashboardData.productWiseError || [],
            rankingProductWiseErrors: dashboardData.rankingProductWiseErrors || [],
            conversionProductWiseErrors: dashboardData.conversionProductWiseErrors || [],
            inventoryProductWiseErrors: dashboardData.inventoryProductWiseErrors || [],
            TotalProduct: dashboardData.TotalProduct || [],
            ActiveProducts: dashboardData.ActiveProducts || [],
            InventoryAnalysis: dashboardData.InventoryAnalysis || {},
            Country: dashboardData.Country
        };

        return res.status(200).json(
            new ApiResponse(200, issuesByProductData, "Issues by product data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getIssuesByProductData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting issues by product data: ${error.message}`)
        );
    }
});

/**
 * Get Keyword Analysis data
 */
const getKeywordAnalysisData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Getting keyword analysis data for user ${userId}`);

        // Get raw data
        const analyseResult = await AnalyseService.Analyse(userId, Country, Region);
        
        if (analyseResult.status !== 200) {
            return res.status(analyseResult.status).json(
                new ApiError(analyseResult.status, analyseResult.message)
            );
        }

        // Calculate full dashboard data
        const calculatedData = await analyseData(analyseResult.message, userId);
        const dashboardData = calculatedData.dashboardData;

        // Extract keyword analysis specific data - all data needed by KeywordAnalysisDashboard.jsx
        const keywordData = {
            // Keywords and search terms
            keywords: dashboardData.keywords || [],
            searchTerms: dashboardData.searchTerms || [],
            negativeKeywordsMetrics: dashboardData.negativeKeywordsMetrics || [],
            negetiveKeywords: dashboardData.negetiveKeywords || [],
            adsKeywordsPerformanceData: dashboardData.adsKeywordsPerformanceData || [],
            keywordTrackingData: dashboardData.keywordTrackingData || {},
            
            // Campaign and ad group data
            campaignData: dashboardData.campaignData || [],
            AdsGroupData: dashboardData.AdsGroupData || [],
            
            // Product data for ASIN/SKU lookups
            TotalProduct: dashboardData.TotalProduct || [],
            productWiseError: dashboardData.productWiseError || [],
            
            Country: dashboardData.Country
        };

        return res.status(200).json(
            new ApiResponse(200, keywordData, "Keyword analysis data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getKeywordAnalysisData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting keyword analysis data: ${error.message}`)
        );
    }
});

/**
 * Get Reimbursement data
 */
const getReimbursementData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Getting reimbursement data for user ${userId}`);

        // Get raw data
        const analyseResult = await AnalyseService.Analyse(userId, Country, Region);
        
        if (analyseResult.status !== 200) {
            return res.status(analyseResult.status).json(
                new ApiError(analyseResult.status, analyseResult.message)
            );
        }

        // Calculate full dashboard data
        const calculatedData = await analyseData(analyseResult.message, userId);
        const dashboardData = calculatedData.dashboardData;

        // Extract reimbursement specific data
        const reimbursementData = {
            reimbustment: dashboardData.reimbustment || { totalReimbursement: 0 },
            TotalProduct: dashboardData.TotalProduct || [],
            ActiveProducts: dashboardData.ActiveProducts || [],
            accountFinance: dashboardData.accountFinance || {},
            Country: dashboardData.Country,
            startDate: dashboardData.startDate,
            endDate: dashboardData.endDate
        };

        return res.status(200).json(
            new ApiResponse(200, reimbursementData, "Reimbursement data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getReimbursementData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting reimbursement data: ${error.message}`)
        );
    }
});

/**
 * Get Tasks data
 */
const getTasksData = asyncHandler(async (req, res) => {
    const userId = req.userId;

    try {
        logger.info(`Getting tasks data for user ${userId}`);

        // Get tasks from CreateTaskService
        const tasksDocument = await CreateTaskService.getUserTasks(userId);

        if (!tasksDocument) {
            return res.status(200).json(
                new ApiResponse(200, { tasks: [], taskRenewalDate: null }, "No tasks found")
            );
        }

        return res.status(200).json(
            new ApiResponse(200, {
                tasks: tasksDocument.tasks || [],
                taskRenewalDate: tasksDocument.taskRenewalDate
            }, "Tasks data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getTasksData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting tasks data: ${error.message}`)
        );
    }
});

/**
 * Update task status
 */
const updateTaskStatus = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const { taskId, status } = req.body;

    if (!taskId || !status) {
        return res.status(400).json(
            new ApiError(400, "taskId and status are required")
        );
    }

    try {
        logger.info(`Updating task ${taskId} status to ${status} for user ${userId}`);

        const updatedDocument = await CreateTaskService.updateTaskStatus(userId, taskId, status);

        return res.status(200).json(
            new ApiResponse(200, {
                tasks: updatedDocument.tasks,
                taskRenewalDate: updatedDocument.taskRenewalDate
            }, "Task status updated successfully")
        );

    } catch (error) {
        logger.error("Error in updateTaskStatus:", error);
        return res.status(500).json(
            new ApiError(500, `Error updating task status: ${error.message}`)
        );
    }
});

/**
 * Get inventory data
 */
const getInventoryData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Getting inventory data for user ${userId}`);

        // Get raw data
        const analyseResult = await AnalyseService.Analyse(userId, Country, Region);
        
        if (analyseResult.status !== 200) {
            return res.status(analyseResult.status).json(
                new ApiError(analyseResult.status, analyseResult.message)
            );
        }

        // Calculate full dashboard data
        const calculatedData = await analyseData(analyseResult.message, userId);
        const dashboardData = calculatedData.dashboardData;

        // Extract inventory specific data
        const inventoryData = {
            InventoryAnalysis: dashboardData.InventoryAnalysis || {},
            inventoryProductWiseErrors: dashboardData.inventoryProductWiseErrors || [],
            totalInventoryErrors: dashboardData.totalInventoryErrors || 0,
            TotalProduct: dashboardData.TotalProduct || [],
            ActiveProducts: dashboardData.ActiveProducts || [],
            Country: dashboardData.Country
        };

        return res.status(200).json(
            new ApiResponse(200, inventoryData, "Inventory data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getInventoryData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting inventory data: ${error.message}`)
        );
    }
});

/**
 * Get ASIN-wise sales data for profitability table
 * This is a separate endpoint to handle big accounts where asinWiseSales is stored separately
 * to avoid memory issues with the main dashboard endpoint.
 * 
 * For normal accounts: Returns asinWiseSales from EconomicsMetrics
 * For big accounts (isBig=true): Returns asinWiseSales from AsinWiseSalesForBigAccounts collection
 */
const getAsinWiseSalesData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const region = req.region;
    const country = req.country;

    try {
        logger.info(`Getting ASIN-wise sales data for user ${userId}`, { country, region });

        // Get the latest EconomicsMetrics document
        const economicsMetrics = await EconomicsMetrics.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!economicsMetrics) {
            logger.warn('No economics metrics found for ASIN-wise sales', { userId, country, region });
            return res.status(200).json(
                new ApiResponse(200, { asinWiseSales: [], isBig: false }, "No economics metrics data found")
            );
        }

        let asinWiseSales = [];
        const totalSalesAmount = economicsMetrics.totalSales?.amount || 0;

        // Debug: Check parentAsin in stored data
        const storedAsinData = economicsMetrics.asinWiseSales || [];
        const recordsWithParentAsin = storedAsinData.filter(item => item.parentAsin && item.parentAsin !== item.asin);
        
        logger.info('ASIN-wise sales endpoint - checking data source', {
            userId,
            country,
            region,
            isBig: economicsMetrics.isBig,
            totalSales: totalSalesAmount,
            asinWiseSalesInDoc: storedAsinData.length,
            recordsWithDifferentParentAsin: recordsWithParentAsin.length,
            sampleRecord: storedAsinData[0] ? {
                asin: storedAsinData[0].asin,
                parentAsin: storedAsinData[0].parentAsin,
                date: storedAsinData[0].date
            } : null
        });

        // Try to fetch from separate collection if:
        // 1. isBig is explicitly true, OR
        // 2. totalSales > 5000 and asinWiseSales is empty (legacy data that might have been migrated)
        const shouldTrySeparateCollection = economicsMetrics.isBig === true || 
            (totalSalesAmount > 5000 && (!economicsMetrics.asinWiseSales || economicsMetrics.asinWiseSales.length === 0));

        if (shouldTrySeparateCollection) {
            // Try fetching from separate collection for big accounts
            try {
                const bigAccountAsinDocs = await AsinWiseSalesForBigAccounts.findByMetricsId(economicsMetrics._id);
                
                if (bigAccountAsinDocs && bigAccountAsinDocs.length > 0) {
                    // Flatten all ASIN sales from all date documents
                    bigAccountAsinDocs.forEach(doc => {
                        const docDate = doc.date;
                        if (doc.asinSales && Array.isArray(doc.asinSales)) {
                            doc.asinSales.forEach(asinSale => {
                                asinWiseSales.push({
                                    date: docDate === 'no_date' ? null : docDate,
                                    asin: asinSale.asin,
                                    parentAsin: asinSale.parentAsin,
                                    sales: asinSale.sales,
                                    grossProfit: asinSale.grossProfit,
                                    unitsSold: asinSale.unitsSold,
                                    refunds: asinSale.refunds,
                                    ppcSpent: asinSale.ppcSpent,
                                    fbaFees: asinSale.fbaFees,
                                    storageFees: asinSale.storageFees,
                                    amazonFees: asinSale.amazonFees,
                                    totalFees: asinSale.totalFees,
                                    feeBreakdown: asinSale.feeBreakdown
                                });
                            });
                        }
                    });
                    
                    // Debug: Check parentAsin in fetched data
                    const fetchedRecordsWithParentAsin = asinWiseSales.filter(item => item.parentAsin && item.parentAsin !== item.asin);
                    
                    logger.info('Fetched ASIN-wise sales from separate collection for big account', {
                        userId,
                        country,
                        region,
                        totalRecords: asinWiseSales.length,
                        totalDates: bigAccountAsinDocs.length,
                        recordsWithDifferentParentAsin: fetchedRecordsWithParentAsin.length,
                        sampleRecord: asinWiseSales[0] ? {
                            asin: asinWiseSales[0].asin,
                            parentAsin: asinWiseSales[0].parentAsin,
                            date: asinWiseSales[0].date
                        } : null
                    });
                } else {
                    // No data in separate collection - fall back to main document (legacy data)
                    logger.info('No data in separate collection, falling back to main document', {
                        userId,
                        country,
                        region
                    });
                    asinWiseSales = economicsMetrics.asinWiseSales || [];
                }
            } catch (fetchError) {
                logger.error('Error fetching ASIN data for big account, falling back to main document', {
                    metricsId: economicsMetrics._id,
                    error: fetchError.message
                });
                // Fallback to main document
                asinWiseSales = economicsMetrics.asinWiseSales || [];
            }
        } else {
            // Normal account - get from main document
            asinWiseSales = economicsMetrics.asinWiseSales || [];
            logger.info('Returning ASIN-wise sales from main document', {
                userId,
                country,
                region,
                totalRecords: asinWiseSales.length
            });
        }

        return res.status(200).json(
            new ApiResponse(200, {
                asinWiseSales: asinWiseSales,
                isBig: economicsMetrics.isBig || false,
                dateRange: economicsMetrics.dateRange,
                metricsId: economicsMetrics._id
            }, "ASIN-wise sales data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getAsinWiseSalesData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting ASIN-wise sales data: ${error.message}`)
        );
    }
});

/**
 * Get Your Products data with pagination support
 * Returns products with their details including status, ratings, A+ content status
 * 
 * Query params:
 * - page: Page number (default: 1)
 * - limit: Items per page (default: 20, max: 100)
 * - summaryOnly: If true, return only summary data (default: false)
 */
const getYourProductsData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;
    
    // Pagination parameters
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const summaryOnly = req.query.summaryOnly === 'true';
    
    // Status filter parameter (optional): 'Active', 'Inactive', 'Incomplete', or undefined (all)
    const statusFilter = req.query.status || undefined;

    try {
        logger.info(`Getting Your Products data for user ${userId}, region ${Region}, country ${Country}, page ${page}, limit ${limit}, status: ${statusFilter || 'all'}`);

        // Get seller data with products
        const seller = await Seller.findOne({ User: userId });
        
        if (!seller) {
            return res.status(404).json(
                new ApiError(404, 'Seller account not found')
            );
        }

        // Find the seller account for the current region
        const sellerAccount = seller.sellerAccount.find(
            acc => acc.region === Region
        );

        if (!sellerAccount) {
            return res.status(404).json(
                new ApiError(404, 'No seller account found for this region')
            );
        }

        // Get products from seller account - convert Mongoose subdocuments to plain objects
        // This ensures all fields including 'issues' array are properly accessible
        const allProducts = (sellerAccount.products || []).map(p => p.toObject ? p.toObject() : p);
        const totalProducts = allProducts.length;

        // Calculate summary metrics first (always needed)
        // We need to calculate this from all products, not just paginated
        let activeProducts = 0;
        let inactiveProducts = 0;
        let incompleteProducts = 0;
        
        allProducts.forEach(p => {
            if (p.status === 'Active') activeProducts++;
            else if (p.status === 'Inactive') inactiveProducts++;
            else if (p.status === 'Incomplete') incompleteProducts++;
        });
        
        // Filter products by status BEFORE pagination (if status filter is provided)
        let filteredProducts = allProducts;
        if (statusFilter && ['Active', 'Inactive', 'Incomplete'].includes(statusFilter)) {
            filteredProducts = allProducts.filter(p => p.status === statusFilter);
        }
        
        // IMPORTANT: Sort products consistently before pagination to ensure stable pagination
        // Sort by ASIN (ascending) to ensure the same products appear on the same page
        // This prevents pagination issues where the same page returns different products
        filteredProducts.sort((a, b) => {
            const asinA = (a.asin || '').toUpperCase();
            const asinB = (b.asin || '').toUpperCase();
            return asinA.localeCompare(asinB);
        });
        
        const filteredTotal = filteredProducts.length;

        // If only summary is requested, return early without processing all product details
        if (summaryOnly) {
            // Get A+ content count (quick aggregation)
            let productsWithAPlus = 0;
            let aPlusContent = await APlusContent.findOne({
                User: userId,
                region: Region,
                country: Country
            }).sort({ createdAt: -1 }).select('ApiContentDetails');

            if (!aPlusContent) {
                aPlusContent = await APlusContent.findOne({
                    User: userId
                }).sort({ createdAt: -1 }).select('ApiContentDetails');
            }

            if (aPlusContent && aPlusContent.ApiContentDetails) {
                // Create a set of product ASINs for quick lookup
                const productAsinSet = new Set(allProducts.map(p => p.asin?.toUpperCase()));
                
                aPlusContent.ApiContentDetails.forEach(item => {
                    const asinKey = item.Asins?.toUpperCase() || '';
                    if (productAsinSet.has(asinKey) && 
                        (item.status === 'APPROVED' || item.status === 'PUBLISHED')) {
                        productsWithAPlus++;
                    }
                });
            }
            
            // Check if any active product has brand story
            let hasBrandStory = false;
            const [productReviewsWithRegion, productReviewsWithoutRegion] = await Promise.all([
                NumberOfProductReviews.findOne({
                    User: userId,
                    region: Region,
                    country: Country
                }).sort({ createdAt: -1 }).lean(),
                NumberOfProductReviews.findOne({
                    User: userId
                }).sort({ createdAt: -1 }).lean()
            ]);
            
            const productReviews = productReviewsWithRegion || productReviewsWithoutRegion;
            if (productReviews && productReviews.Products) {
                // Create a set of active product ASINs for quick lookup
                const activeProductAsinSet = new Set(
                    allProducts
                        .filter(p => p.status === 'Active')
                        .map(p => (p.asin || '').toUpperCase())
                );
                
                // Check if any active product has brand story
                for (const product of productReviews.Products) {
                    const asinKey = (product.asin || '').toUpperCase();
                    if (activeProductAsinSet.has(asinKey) && product.has_brandstory === true) {
                        hasBrandStory = true;
                        break; // Found one, no need to check further
                    }
                }
            }

            return res.status(200).json(
                new ApiResponse(200, {
                    products: [], // Empty array for summary only
                    summary: {
                        totalProducts,
                        activeProducts,
                        inactiveProducts,
                        incompleteProducts,
                        productsWithAPlus,
                        productsWithoutAPlus: totalProducts - productsWithAPlus,
                        hasBrandStory: hasBrandStory
                    },
                    pagination: {
                        page,
                        limit,
                        totalItems: totalProducts,
                        totalPages: Math.ceil(totalProducts / limit),
                        hasMore: false
                    },
                    country: Country,
                    region: Region
                }, "Your Products summary retrieved successfully")
            );
        }

        // Apply pagination to FILTERED products (not all products)
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;
        const paginatedProducts = filteredProducts.slice(startIndex, endIndex);
        
        // Debug logging for pagination
        logger.info(`[getYourProductsData] Pagination details:`, {
            page,
            limit,
            filteredTotal,
            startIndex,
            endIndex,
            paginatedCount: paginatedProducts.length,
            firstAsin: paginatedProducts[0]?.asin,
            lastAsin: paginatedProducts[paginatedProducts.length - 1]?.asin,
            statusFilter: statusFilter || 'all'
        });

        // Get product reviews data - OPTIMIZATION: Run both queries in parallel with fallback
        const [productReviewsWithRegion, productReviewsWithoutRegion, aPlusContentWithRegion, aPlusContentWithoutRegion, sponsoredAdsData] = await Promise.all([
            NumberOfProductReviews.findOne({
                User: userId,
                region: Region,
                country: Country
            }).sort({ createdAt: -1 }).lean(),
            NumberOfProductReviews.findOne({
                User: userId
            }).sort({ createdAt: -1 }).lean(),
            APlusContent.findOne({
                User: userId,
                region: Region,
                country: Country
            }).sort({ createdAt: -1 }).lean(),
            APlusContent.findOne({
                User: userId
            }).sort({ createdAt: -1 }).lean(),
            // Get ProductWiseSponsoredAds to determine which ASINs are targeted in ads
            getProductWiseSponsoredAdsData(userId, Country, Region).catch(err => {
                logger.warn('Could not fetch sponsored ads data for YourProducts:', err.message);
                return null;
            })
        ]);

        // Use the one with region/country if available, otherwise fallback
        const productReviews = productReviewsWithRegion || productReviewsWithoutRegion;
        const aPlusContent = aPlusContentWithRegion || aPlusContentWithoutRegion;

        // Create a map for quick lookup of reviews by ASIN
        const reviewsMap = new Map();
        if (productReviews && productReviews.Products) {
            productReviews.Products.forEach(product => {
                const asinKey = product.asin?.toUpperCase() || '';
                const videoUrls = product.video_url || [];
                reviewsMap.set(asinKey, {
                    numRatings: product.product_num_ratings || '0',
                    starRatings: product.product_star_ratings || '0',
                    title: product.product_title || '',
                    photos: product.product_photos || [],
                    hasVideo: Array.isArray(videoUrls) && videoUrls.length > 0
                });
            });
        }
        
        // Check if any active product has brand story
        let hasBrandStory = false;
        if (productReviews && productReviews.Products) {
            // Create a set of active product ASINs for quick lookup
            const activeProductAsinSet = new Set(
                allProducts
                    .filter(p => p.status === 'Active')
                    .map(p => (p.asin || '').toUpperCase())
            );
            
            // Check if any active product has brand story
            for (const product of productReviews.Products) {
                const asinKey = (product.asin || '').toUpperCase();
                if (activeProductAsinSet.has(asinKey) && product.has_brandstory === true) {
                    hasBrandStory = true;
                    break; // Found one, no need to check further
                }
            }
        }

        // Create a map for A+ content status by ASIN
        const aPlusMap = new Map();
        let productsWithAPlus = 0;
        if (aPlusContent && aPlusContent.ApiContentDetails) {
            // Create a set of all product ASINs for quick lookup
            const productAsinSet = new Set(allProducts.map(p => p.asin?.toUpperCase()));
            
            aPlusContent.ApiContentDetails.forEach(item => {
                const asinKey = item.Asins?.toUpperCase() || '';
                aPlusMap.set(asinKey, item.status);
                
                // Count products with A+ (only count if ASIN is in our products)
                if (productAsinSet.has(asinKey) && 
                    (item.status === 'APPROVED' || item.status === 'PUBLISHED' || 
                     item.status === 'true' || item.status === true)) {
                    productsWithAPlus++;
                }
            });
        }

        // Create a Set of ASINs that are targeted in ads (have any ad spend or activity)
        const asinsTargetedInAds = new Set();
        if (sponsoredAdsData && sponsoredAdsData.sponsoredAds && Array.isArray(sponsoredAdsData.sponsoredAds)) {
            sponsoredAdsData.sponsoredAds.forEach(adItem => {
                const asin = adItem.asin || adItem.ASIN;
                if (asin) {
                    // Add ASIN to Set (uppercase for consistent comparison)
                    asinsTargetedInAds.add(asin.toUpperCase());
                }
            });
            logger.info(`[getYourProductsData] Found ${asinsTargetedInAds.size} ASINs targeted in ads`);
        }

        // Enrich only paginated products
        const enrichedProducts = paginatedProducts.map(product => {
            const asinKey = product.asin?.toUpperCase() || '';
            const reviewData = reviewsMap.get(asinKey) || {};
            const aPlusStatus = aPlusMap.get(asinKey);
            
            const hasAPlusContent = aPlusStatus === 'APPROVED' || 
                                    aPlusStatus === 'PUBLISHED' || 
                                    aPlusStatus === 'true' ||
                                    aPlusStatus === true;
            
            // Check if this ASIN is targeted in ads
            const isTargetedInAds = asinsTargetedInAds.has(asinKey);
            
            return {
                asin: product.asin,
                sku: product.sku,
                title: product.itemName || reviewData.title || '',
                price: product.price || '0',
                status: product.status || 'Unknown',
                quantity: product.quantity !== undefined && product.quantity !== null ? product.quantity : 0,
                numRatings: reviewData.numRatings || '0',
                starRatings: reviewData.starRatings || '0',
                hasAPlus: hasAPlusContent,
                aPlusStatus: aPlusStatus || 'Not Available',
                hasVideo: reviewData.hasVideo || false,
                image: reviewData.photos && reviewData.photos.length > 0 ? reviewData.photos[0] : null,
                updatedAt: product.updatedAt || null,
                issues: product.issues || [], // Include issues from seller model for inactive/incomplete products
                has_b2b_pricing: product.has_b2b_pricing || false, // Include B2B pricing status
                isTargetedInAds: isTargetedInAds // Whether this product has ads targeting
            };
        });

        // Calculate pagination based on FILTERED products, not all products
        const totalPages = Math.ceil(filteredTotal / limit);
        const hasMore = page < totalPages;

        // Get issues data for frontend calculation (same as IssuesByProduct page)
        // OPTIMIZATION: Only load issues data for Active products (not needed for inactive/incomplete)
        // Also make it optional via query parameter to allow skipping for faster loads
        let issuesData = null;
        const includeIssues = req.query.includeIssues !== 'false' && statusFilter === 'Active';
        
        if (includeIssues) {
            try {
                logger.info('[getYourProductsData] Fetching issues data for Active products...');
                const analyseResult = await AnalyseService.Analyse(userId, Country, Region, null);
                logger.info('[getYourProductsData] AnalyseService result status:', analyseResult?.status);
                
                if (analyseResult && analyseResult.status === 200 && analyseResult.message) {
                    const calculatedData = await analyseData(analyseResult.message, userId);
                    logger.info('[getYourProductsData] calculatedData exists:', !!calculatedData);
                    logger.info('[getYourProductsData] dashboardData exists:', !!calculatedData?.dashboardData);
                    
                    if (calculatedData && calculatedData.dashboardData) {
                        const dashboardData = calculatedData.dashboardData;
                        issuesData = {
                            rankingProductWiseErrors: dashboardData.rankingProductWiseErrors || [],
                            TotalProduct: dashboardData.TotalProduct || [],
                            buyBoxData: dashboardData.buyBoxData || {}
                        };
                        logger.info('[getYourProductsData] issuesData populated:', {
                            rankingCount: issuesData.rankingProductWiseErrors.length,
                            totalProductCount: issuesData.TotalProduct.length,
                            hasBuyBoxData: !!issuesData.buyBoxData?.asinBuyBoxData
                        });
                    }
                }
            } catch (issueError) {
                logger.warn('Could not fetch issues data for YourProducts:', issueError.message);
            }
        } else {
            logger.info('[getYourProductsData] Skipping issues data (not needed for inactive/incomplete products or explicitly disabled)');
        }

        return res.status(200).json(
            new ApiResponse(200, {
                products: enrichedProducts,
                summary: {
                    totalProducts,
                    activeProducts,
                    inactiveProducts,
                    incompleteProducts,
                    productsWithAPlus,
                    productsWithoutAPlus: totalProducts - productsWithAPlus,
                    hasBrandStory: hasBrandStory
                },
                pagination: {
                    page,
                    limit,
                    totalItems: filteredTotal, // Use filtered total for pagination
                    totalPages,
                    hasMore
                },
                country: Country,
                region: Region,
                issuesData: issuesData
            }, "Your Products data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getYourProductsData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting Your Products data: ${error.message}`)
        );
    }
});

/**
 * Get navbar data - minimal data for top navigation bar
 * This endpoint is called on initial app load instead of full dashboard data
 * Returns only: user info, all seller accounts, brand name, account health
 */
const getNavbarData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Region = req.region;
    const Country = req.country;

    try {
        logger.info(`Getting navbar data for user ${userId}, region ${Region}, country ${Country}`);

        // Get user data
        const user = await User.findById(userId).select('name email profilePic selectedPlan accessType isSuperAdminSession').lean();
        
        if (!user) {
            return res.status(404).json(
                new ApiError(404, 'User not found')
            );
        }

        // Get seller data with all accounts
        const seller = await Seller.findOne({ User: userId }).lean();
        
        let allSellerAccounts = [];
        let brandName = '';
        let accountHealthPercentage = 0;

        if (seller) {
            // Brand is stored at root level of seller document
            brandName = seller.brand || '';
            
            if (seller.sellerAccount) {
                // Get all seller accounts for account switcher
                allSellerAccounts = seller.sellerAccount.map(acc => ({
                    sellerId: acc.sellerId,
                    region: acc.region,
                    country: acc.country || acc.region,
                    marketplaceId: acc.marketplaceId,
                    isConnected: acc.isConnected || false,
                    brand: seller.brand || '' // Include brand in each account for display
                }));
            }
        }

        // Get account health percentage (lightweight query)
        // This is a simplified calculation - just checking if we have health data
        try {
            const economicsMetrics = await EconomicsMetrics.findOne({
                User: userId,
                country: Country,
                region: Region
            }).sort({ createdAt: -1 }).select('accountHealthPercentage').lean();

            if (economicsMetrics && economicsMetrics.accountHealthPercentage) {
                accountHealthPercentage = economicsMetrics.accountHealthPercentage;
            }
        } catch (healthError) {
            logger.warn('Could not fetch account health for navbar:', healthError.message);
        }

        return res.status(200).json(
            new ApiResponse(200, {
                user: {
                    _id: user._id,
                    name: user.name,
                    email: user.email,
                    profilePic: user.profilePic,
                    selectedPlan: user.selectedPlan,
                    accessType: user.accessType,
                    isSuperAdminSession: user.isSuperAdminSession
                },
                AllSellerAccounts: allSellerAccounts,
                Brand: brandName,
                accountHealthPercentage,
                Country,
                Region
            }, "Navbar data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getNavbarData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting navbar data: ${error.message}`)
        );
    }
});

/**
 * Get Account History data
 * Returns historical account metrics over time
 */
const getAccountHistoryData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const Country = req.country;
    const Region = req.region;

    try {
        logger.info(`Getting account history data for user ${userId}, country ${Country}, region ${Region}`);

        if (!userId || !Country || !Region) {
            return res.status(400).json(
                new ApiError(400, 'User ID, country and region are required')
            );
        }

        const accountHistory = await AccountHistory.findOne({
            User: userId,
            country: Country,
            region: Region
        }).lean();

        if (!accountHistory) {
            return res.status(200).json(
                new ApiResponse(200, { accountHistory: [] }, "No account history found")
            );
        }

        return res.status(200).json(
            new ApiResponse(200, {
                accountHistory: accountHistory.accountHistory || []
            }, "Account history data retrieved successfully")
        );

    } catch (error) {
        logger.error("Error in getAccountHistoryData:", error);
        return res.status(500).json(
            new ApiError(500, `Error getting account history data: ${error.message}`)
        );
    }
});

module.exports = {
    getDashboardData,
    getProfitabilityData,
    getPPCData,
    getIssuesData,
    getIssuesByProductData,
    getKeywordAnalysisData,
    getReimbursementData,
    getTasksData,
    updateTaskStatus,
    getInventoryData,
    getAsinWiseSalesData,
    getYourProductsData,
    getNavbarData,
    getAccountHistoryData
};

