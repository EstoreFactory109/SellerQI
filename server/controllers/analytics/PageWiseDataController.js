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

/**
 * Get full dashboard data - calculates all data in backend
 * This is the main endpoint that replaces the old flow of:
 * 1. Frontend calling /getData
 * 2. Frontend calling calculation server
 * 3. Frontend displaying data
 */
const getDashboardData = asyncHandler(async (req, res) => {
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
        logger.info(`Getting dashboard data for user ${userId}, region ${Region}, country ${Country}`);

        // Step 1: Get raw data from Analyse service
        let analyseResult;
        try {
            analyseResult = await AnalyseService.Analyse(userId, Country, Region, adminId);
            logger.info(`Analyse service returned status: ${analyseResult?.status}`);
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
        try {
            logger.info('Starting dashboard calculation...');
            logger.info(`analyseResult.message type: ${typeof analyseResult.message}, keys: ${Object.keys(analyseResult.message || {}).join(', ')}`);
            calculatedData = await analyseData(analyseResult.message, userId);
            logger.info('Dashboard calculation completed successfully');
            
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

        // Extract profitability-specific data
        const profitabilityData = {
            profitibilityData: dashboardData.profitibilityData || [],
            totalProfitabilityErrors: dashboardData.totalProfitabilityErrors || 0,
            profitabilityErrorDetails: dashboardData.profitabilityErrorDetails || [],
            TotalProduct: dashboardData.TotalProduct || [],
            ActiveProducts: dashboardData.ActiveProducts || [],
            accountFinance: dashboardData.accountFinance || {},
            TotalWeeklySale: dashboardData.TotalWeeklySale || 0,
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

        // Extract PPC-specific data
        const ppcData = {
            sponsoredAdsMetrics: dashboardData.sponsoredAdsMetrics || {},
            negativeKeywordsMetrics: dashboardData.negativeKeywordsMetrics || [],
            ProductWiseSponsoredAds: dashboardData.ProductWiseSponsoredAds || [],
            ProductWiseSponsoredAdsGraphData: dashboardData.ProductWiseSponsoredAdsGraphData || [],
            totalSponsoredAdsErrors: dashboardData.totalSponsoredAdsErrors || 0,
            sponsoredAdsErrorDetails: dashboardData.sponsoredAdsErrorDetails || [],
            dateWiseTotalCosts: dashboardData.dateWiseTotalCosts || [],
            campaignWiseTotalSalesAndCost: dashboardData.campaignWiseTotalSalesAndCost || [],
            keywords: dashboardData.keywords || [],
            searchTerms: dashboardData.searchTerms || [],
            campaignData: dashboardData.campaignData || [],
            adsKeywordsPerformanceData: dashboardData.adsKeywordsPerformanceData || [],
            negetiveKeywords: dashboardData.negetiveKeywords || [],
            AdsGroupData: dashboardData.AdsGroupData || [],
            accountFinance: dashboardData.accountFinance || {},
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

        // Extract issues-specific data
        const issuesData = {
            productWiseError: dashboardData.productWiseError || [],
            rankingProductWiseErrors: dashboardData.rankingProductWiseErrors || [],
            conversionProductWiseErrors: dashboardData.conversionProductWiseErrors || [],
            inventoryProductWiseErrors: dashboardData.inventoryProductWiseErrors || [],
            totalErrorInAccount: dashboardData.totalErrorInAccount || 0,
            totalErrorInConversion: dashboardData.totalErrorInConversion || 0,
            TotalRankingerrors: dashboardData.TotalRankingerrors || 0,
            totalInventoryErrors: dashboardData.totalInventoryErrors || 0,
            totalProfitabilityErrors: dashboardData.totalProfitabilityErrors || 0,
            totalSponsoredAdsErrors: dashboardData.totalSponsoredAdsErrors || 0,
            profitabilityErrorDetails: dashboardData.profitabilityErrorDetails || [],
            sponsoredAdsErrorDetails: dashboardData.sponsoredAdsErrorDetails || [],
            AccountErrors: dashboardData.AccountErrors || {},
            first: dashboardData.first,
            second: dashboardData.second,
            third: dashboardData.third,
            fourth: dashboardData.fourth,
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

        // Extract keyword analysis specific data
        const keywordData = {
            keywords: dashboardData.keywords || [],
            searchTerms: dashboardData.searchTerms || [],
            negativeKeywordsMetrics: dashboardData.negativeKeywordsMetrics || [],
            negetiveKeywords: dashboardData.negetiveKeywords || [],
            adsKeywordsPerformanceData: dashboardData.adsKeywordsPerformanceData || [],
            keywordTrackingData: dashboardData.keywordTrackingData || {},
            campaignData: dashboardData.campaignData || [],
            AdsGroupData: dashboardData.AdsGroupData || [],
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

        logger.info('ASIN-wise sales endpoint - checking data source', {
            userId,
            country,
            region,
            isBig: economicsMetrics.isBig,
            totalSales: totalSalesAmount,
            asinWiseSalesInDoc: economicsMetrics.asinWiseSales?.length || 0
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
                    
                    logger.info('Fetched ASIN-wise sales from separate collection for big account', {
                        userId,
                        country,
                        region,
                        totalRecords: asinWiseSales.length,
                        totalDates: bigAccountAsinDocs.length
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
    getAsinWiseSalesData
};

