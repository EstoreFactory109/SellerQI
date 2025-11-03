const { ApiError } = require('../utils/ApiError.js');
const { ApiResponse } = require('../utils/ApiResponse.js');
const asyncHandler = require('../utils/AsyncHandler.js');
const ReimbursementModel = require('../models/ReimbursementModel.js');
const {
    getReimbursementSummary,
    getDetailedReimbursements,
    updateProductCosts,
    mergeReimbursementData,
    calculateShipmentDiscrepancies
} = require('../Services/Calculations/EnhancedReimbursement.js');
const GET_FBA_REIMBURSEMENT_DATA = require('../Services/Sp_API/GET_FBA_REIMBURSEMENT_DATA.js');
const logger = require('../utils/Logger.js');
const Seller = require('../models/sellerCentralModel.js');
const tokenManager = require('../utils/TokenManager.js');
const { generateAccessToken } = require('../Services/Sp_API/GenerateTokens.js');
const getTemporaryCredentials = require('../utils/GenerateTemporaryCredentials.js');
const getshipment = require('../Services/Sp_API/shipment.js');
const { URIs, marketplaceConfig, spapiRegions } = require('./config/config.js');

/**
 * @desc Get reimbursement summary for dashboard
 * @route GET /app/reimbursements/summary
 * @access Private
 */
const getReimbursementSummaryController = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;

    if (!userId || !country || !region) {
        logger.error('Missing required parameters for reimbursement summary', {
            userId: !!userId,
            country: country || 'missing',
            region: region || 'missing',
            hasCountryFromQuery: !!req.query.country,
            hasRegionFromQuery: !!req.query.region,
            hasCountryFromReq: !!req.country,
            hasRegionFromReq: !!req.region
        });
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    logger.info('Fetching reimbursement summary:', { userId, country, region });

    try {
        const summary = await getReimbursementSummary(userId, country, region);
        
        logger.info('Reimbursement summary fetched successfully', {
            userId,
            country,
            region,
            hasData: summary.reimbursementCount > 0,
            totalReceived: summary.totalReceived,
            totalPending: summary.totalPending,
            totalPotential: summary.totalPotential
        });

        return res.status(200).json(
            new ApiResponse(200, summary, 'Reimbursement summary retrieved successfully')
        );
    } catch (error) {
        logger.error('Error in getReimbursementSummaryController', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });
        throw error;
    }
});

/**
 * @desc Get all reimbursements with optional filters
 * @route GET /app/reimbursements
 * @access Private
 */
const getAllReimbursements = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    // Extract filters from query parameters
    const filters = {
        status: req.query.status, // APPROVED, PENDING, POTENTIAL, DENIED
        type: req.query.type, // LOST, DAMAGED, etc.
        startDate: req.query.startDate,
        endDate: req.query.endDate
    };

    logger.info('Fetching reimbursements:', { userId, country, region, filters });

    const reimbursements = await getDetailedReimbursements(userId, country, region, filters);

    return res.status(200).json(
        new ApiResponse(200, reimbursements, 'Reimbursements retrieved successfully')
    );
});

/**
 * @desc Get potential reimbursement claims (not yet filed)
 * @route GET /app/reimbursements/potential
 * @access Private
 */
const getPotentialClaims = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    logger.info('Fetching potential claims:', { userId, country, region });

    const filters = { status: 'POTENTIAL' };
    const potentialClaims = await getDetailedReimbursements(userId, country, region, filters);

    // Sort by urgency (claims expiring soon first)
    potentialClaims.sort((a, b) => {
        const daysA = a.daysToDeadline || 999;
        const daysB = b.daysToDeadline || 999;
        return daysA - daysB;
    });

    return res.status(200).json(
        new ApiResponse(200, potentialClaims, 'Potential claims retrieved successfully')
    );
});

/**
 * @desc Get reimbursements by product (ASIN)
 * @route GET /app/reimbursements/product/:asin
 * @access Private
 */
const getReimbursementsByProduct = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;
    const asin = req.params.asin;

    if (!userId || !country || !region || !asin) {
        throw new ApiError(400, 'User ID, country, region, and ASIN are required');
    }

    logger.info('Fetching reimbursements by product:', { userId, country, region, asin });

    const reimbursementRecord = await ReimbursementModel.findOne({
        User: userId,
        country: country,
        region: region
    }).sort({ createdAt: -1 });

    if (!reimbursementRecord) {
        return res.status(200).json(
            new ApiResponse(200, [], 'No reimbursements found')
        );
    }

    const productReimbursements = reimbursementRecord.reimbursements.filter(
        r => r.asin === asin
    );

    // Calculate totals for this product
    const totalAmount = productReimbursements.reduce((sum, r) => sum + (r.amount || 0), 0);
    const totalQuantity = productReimbursements.reduce((sum, r) => sum + (r.quantity || 0), 0);

    return res.status(200).json(
        new ApiResponse(200, {
            reimbursements: productReimbursements,
            summary: {
                totalAmount,
                totalQuantity,
                count: productReimbursements.length
            }
        }, 'Product reimbursements retrieved successfully')
    );
});

/**
 * @desc Get reimbursement statistics by type
 * @route GET /app/reimbursements/stats/by-type
 * @access Private
 */
const getReimbursementStatsByType = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    logger.info('Fetching reimbursement stats by type:', { userId, country, region });

    const reimbursementRecord = await ReimbursementModel.findOne({
        User: userId,
        country: country,
        region: region
    }).sort({ createdAt: -1 });

    if (!reimbursementRecord) {
        return res.status(200).json(
            new ApiResponse(200, { byType: {}, total: 0 }, 'No reimbursements found')
        );
    }

    const stats = {
        byType: reimbursementRecord.summary.amountByType || {},
        countByType: reimbursementRecord.summary.countByType || {},
        total: reimbursementRecord.summary.totalReceived || 0
    };

    return res.status(200).json(
        new ApiResponse(200, stats, 'Reimbursement statistics retrieved successfully')
    );
});

/**
 * @desc Get reimbursement timeline data for charts
 * @route GET /app/reimbursements/timeline
 * @access Private
 */
const getReimbursementTimeline = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;
    const days = parseInt(req.query.days) || 30;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    logger.info('Fetching reimbursement timeline:', { userId, country, region, days });

    const reimbursementRecord = await ReimbursementModel.findOne({
        User: userId,
        country: country,
        region: region
    }).sort({ createdAt: -1 });

    if (!reimbursementRecord) {
        return res.status(200).json(
            new ApiResponse(200, [], 'No reimbursements found')
        );
    }

    // Filter reimbursements by date range
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    const timelineData = {};

    reimbursementRecord.reimbursements
        .filter(r => {
            const date = r.reimbursementDate || r.discoveryDate;
            return date && date >= startDate;
        })
        .forEach(r => {
            const date = r.reimbursementDate || r.discoveryDate;
            const dateKey = date.toISOString().split('T')[0]; // YYYY-MM-DD

            if (!timelineData[dateKey]) {
                timelineData[dateKey] = {
                    date: dateKey,
                    totalAmount: 0,
                    count: 0,
                    byType: {}
                };
            }

            timelineData[dateKey].totalAmount += r.amount || 0;
            timelineData[dateKey].count++;

            const type = r.reimbursementType || 'OTHER';
            if (!timelineData[dateKey].byType[type]) {
                timelineData[dateKey].byType[type] = 0;
            }
            timelineData[dateKey].byType[type] += r.amount || 0;
        });

    // Convert to array and sort by date
    const timeline = Object.values(timelineData).sort((a, b) => 
        new Date(a.date) - new Date(b.date)
    );

    return res.status(200).json(
        new ApiResponse(200, timeline, 'Reimbursement timeline retrieved successfully')
    );
});

/**
 * @desc Update product costs for cost-based reimbursement calculations
 * @route POST /app/reimbursements/update-costs
 * @access Private
 */
const updateReimbursementCosts = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.body.country || req.country;
    const region = req.body.region || req.region;
    const cogsValues = req.body.cogsValues;

    if (!userId || !country || !region || !cogsValues) {
        throw new ApiError(400, 'User ID, country, region, and COGS values are required');
    }

    logger.info('Updating product costs for reimbursements:', { userId, country, region });

    const updated = await updateProductCosts(userId, country, region, cogsValues);

    if (!updated) {
        return res.status(404).json(
            new ApiResponse(404, null, 'No reimbursement data found to update')
        );
    }

    return res.status(200).json(
        new ApiResponse(200, { updated: true }, 'Product costs updated successfully')
    );
});

/**
 * @desc Get urgent claims (expiring soon)
 * @route GET /app/reimbursements/urgent
 * @access Private
 */
const getUrgentClaims = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.query.country || req.country;
    const region = req.query.region || req.region;
    const urgencyDays = parseInt(req.query.days) || 7;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    logger.info('Fetching urgent claims:', { userId, country, region, urgencyDays });

    const filters = { status: 'POTENTIAL' };
    const potentialClaims = await getDetailedReimbursements(userId, country, region, filters);

    // Filter claims expiring within urgency period
    const urgentClaims = potentialClaims.filter(claim => {
        return claim.daysToDeadline !== undefined && 
               claim.daysToDeadline >= 0 && 
               claim.daysToDeadline <= urgencyDays;
    });

    // Sort by urgency
    urgentClaims.sort((a, b) => a.daysToDeadline - b.daysToDeadline);

    return res.status(200).json(
        new ApiResponse(200, urgentClaims, 'Urgent claims retrieved successfully')
    );
});

/**
 * @desc Fetch reimbursement data from Amazon SP-API and store in database
 * @route POST /app/reimbursements/fetch
 * @access Private
 * 
 * This endpoint:
 * 1. Fetches reimbursement data from Amazon SP-API
 * 2. Calculates potential claims from shipment discrepancies
 * 3. Merges and saves everything to database
 */
const fetchReimbursementData = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.body.country || req.country;
    const region = req.body.region || req.region;

    if (!userId || !country || !region) {
        throw new ApiError(400, 'User ID, country, and region are required');
    }

    logger.info('Starting reimbursement data fetch:', { userId, country, region });

    try {
        // ===== GET SELLER DATA =====
        const getSellerData = await Seller.findOne({ User: userId });
        if (!getSellerData) {
            throw new ApiError(404, 'No seller account found for this user');
        }

        const sellerAccounts = Array.isArray(getSellerData.sellerAccount) 
            ? getSellerData.sellerAccount 
            : [];
        const getSellerAccount = sellerAccounts.find(
            item => item && item.country === country && item.region === region
        );

        if (!getSellerAccount) {
            throw new ApiError(400, `No seller account found for region ${region} and country ${country}`);
        }

        const RefreshToken = getSellerAccount.spiRefreshToken;
        if (!RefreshToken) {
            throw new ApiError(400, 'SP-API refresh token not found');
        }

        // ===== GET AWS CREDENTIALS =====
        // Validate configuration
        if (!URIs || !marketplaceConfig || !spapiRegions) {
            throw new ApiError(500, 'Server configuration error - missing config files');
        }

        // Base_URI might be from env vars, fallback to default if not set
        let Base_URI = URIs[region];
        if (!Base_URI) {
            // Fallback to default URIs if env vars not set
            const defaultURIs = {
                NA: 'sellingpartnerapi-na.amazon.com',
                EU: 'sellingpartnerapi-eu.amazon.com',
                FE: 'sellingpartnerapi-fe.amazon.com'
            };
            Base_URI = defaultURIs[region];
        }
        if (!Base_URI) {
            throw new ApiError(400, `Unsupported region: ${region}`);
        }

        const regionConfig = spapiRegions[region];
        if (!regionConfig) {
            throw new ApiError(400, `No credential configuration for region: ${region}`);
        }

        const credentials = await getTemporaryCredentials(regionConfig);
        if (!credentials || !credentials.AccessKey || !credentials.SecretKey) {
            throw new ApiError(500, 'Failed to generate AWS credentials');
        }

        // ===== GENERATE ACCESS TOKEN =====
        const AccessToken = await generateAccessToken(userId, RefreshToken);
        if (!AccessToken) {
            throw new ApiError(500, 'Failed to generate SP-API access token');
        }

        // Initialize token manager
        tokenManager.setTokens(userId, AccessToken, null, RefreshToken, null);

        // ===== PREPARE DATA FOR API CALL =====
        // Try to find marketplace ID (case-insensitive)
        let Marketplace_Id = marketplaceConfig[country] || marketplaceConfig[country.toUpperCase()];
        if (!Marketplace_Id && country) {
            const foundKey = Object.keys(marketplaceConfig).find(
                key => key.toLowerCase() === country.toLowerCase()
            );
            if (foundKey) {
                Marketplace_Id = marketplaceConfig[foundKey];
            }
        }
        if (!Marketplace_Id) {
            throw new ApiError(400, `Unsupported country: ${country}`);
        }

        const dataToSend = {
            marketplaceId: Marketplace_Id,
            AccessToken: AccessToken,
            AccessKey: credentials.AccessKey,
            SecretKey: credentials.SecretKey,
            SessionToken: credentials.SessionToken,
            SellerId: getSellerAccount.selling_partner_id
        };

        // ===== FETCH REIMBURSEMENT DATA FROM AMAZON SP-API =====
        logger.info('Fetching reimbursement data from Amazon SP-API...');
        let reimbursementDataFromAPI = null;

        try {
            reimbursementDataFromAPI = await tokenManager.wrapDataToSendFunction(
                GET_FBA_REIMBURSEMENT_DATA,
                userId,
                RefreshToken,
                null
            )(dataToSend, userId, Base_URI, country, region);

            if (reimbursementDataFromAPI) {
                logger.info('Successfully fetched reimbursement data from SP-API', {
                    count: reimbursementDataFromAPI.reimbursements?.length || 0
                });
            } else {
                logger.warn('No reimbursement data returned from SP-API');
            }
        } catch (apiError) {
            logger.error('Error fetching reimbursement data from SP-API:', {
                error: apiError.message
            });
            // Continue to calculate potential claims even if API fails
        }

        // ===== FETCH SHIPMENT DATA FOR POTENTIAL CLAIMS =====
        logger.info('Fetching shipment data for discrepancy calculation...');
        let shipmentResult = null;
        let productDetails = [];

        try {
            shipmentResult = await tokenManager.wrapDataToSendFunction(
                getshipment,
                userId,
                RefreshToken,
                null
            )(dataToSend, userId, Base_URI, country, region);

            // Get product details from merchant listings if needed
            // For now, we'll use shipment data as-is
        } catch (shipmentError) {
            logger.warn('Error fetching shipment data:', {
                error: shipmentError.message
            });
            // Continue without shipment data
        }

        // ===== CALCULATE POTENTIAL CLAIMS FROM SHIPMENT DISCREPANCIES =====
        let potentialClaims = [];
        // shipmentResult is a ShipmentModel object with shipmentData array directly
        if (shipmentResult && shipmentResult.shipmentData && Array.isArray(shipmentResult.shipmentData)) {
            try {
                // Get product details - simplified for testing
                // In production, you might fetch from merchant listings
                potentialClaims = calculateShipmentDiscrepancies(
                    shipmentResult.shipmentData,
                    productDetails // Empty for now, can be enhanced
                );
                logger.info(`Found ${potentialClaims.length} potential claims from shipment discrepancies`);
            } catch (calcError) {
                logger.error('Error calculating shipment discrepancies:', {
                    error: calcError.message
                });
            }
        }

        // ===== MERGE AND SAVE TO DATABASE =====
        let result = null;
        if (reimbursementDataFromAPI || potentialClaims.length > 0) {
            try {
                result = await mergeReimbursementData(
                    userId,
                    country,
                    region,
                    potentialClaims,
                    reimbursementDataFromAPI
                );

                logger.info('Successfully merged and saved reimbursement data:', {
                    totalReimbursements: result.reimbursements?.length || 0,
                    totalReceived: result.summary?.totalReceived || 0,
                    totalPotential: result.summary?.totalPotential || 0
                });
            } catch (mergeError) {
                logger.error('Error merging reimbursement data:', {
                    error: mergeError.message
                });
                throw new ApiError(500, `Failed to save reimbursement data: ${mergeError.message}`);
            }
        } else {
            logger.warn('No reimbursement data to save (no API data and no potential claims)');
            throw new ApiError(404, 'No reimbursement data found from Amazon SP-API or shipment discrepancies');
        }

        return res.status(200).json(
            new ApiResponse(200, {
                success: true,
                data: {
                    apiDataCount: reimbursementDataFromAPI?.reimbursements?.length || 0,
                    potentialClaimsCount: potentialClaims.length,
                    totalReimbursements: result.reimbursements?.length || 0,
                    summary: result.summary,
                    saved: true
                },
                message: 'Reimbursement data fetched and saved successfully'
            }, 'Reimbursement data fetched and saved successfully')
        );

    } catch (error) {
        logger.error('Error in fetchReimbursementData:', {
            error: error.message,
            userId,
            country,
            region
        });

        if (error instanceof ApiError) {
            throw error;
        }

        throw new ApiError(500, `Failed to fetch reimbursement data: ${error.message}`);
    }
});

module.exports = {
    getReimbursementSummaryController,
    getAllReimbursements,
    getPotentialClaims,
    getReimbursementsByProduct,
    getReimbursementStatsByType,
    getReimbursementTimeline,
    updateReimbursementCosts,
    getUrgentClaims,
    fetchReimbursementData
};

