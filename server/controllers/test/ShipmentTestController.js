/**
 * Shipment Test Controller
 *
 * Test endpoint to fetch shipment data using the updated service with:
 * - API date filtering (last 30 days)
 * - UTC date format with Z suffix
 * - Pagination support
 * - Validation and duplicate prevention
 *
 * Endpoint: POST /api/test/shipment
 * Body: { userId, region, country }
 */

const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const { Integration } = require('../../Services/main/Integration.js');
const getShipmentData = require('../../Services/Sp_API/shipment.js');
const getTemporaryCredentials = require('../../utils/GenerateTemporaryCredentials.js');
const { spapiRegions } = require('../../controllers/config/config.js');
const ShipmentModel = require('../../models/inventory/ShipmentModel.js');

/**
 * Helper to fetch SP-API access token, marketplaceIds, baseURI for user/region/country
 */
const resolveSpApiContext = async (userId, region, country) => {
    // Validate inputs using Integration helper
    const validation = await Integration.validateInputs(userId, region, country);
    if (!validation.success) {
        throw new ApiError(validation.statusCode || 400, validation.error || 'Invalid inputs');
    }

    // Get region configuration (marketplace IDs, base URI)
    const regionConfigResult = Integration.getConfiguration(region, country);
    if (!regionConfigResult.success) {
        throw new ApiError(
            regionConfigResult.statusCode || 400,
            regionConfigResult.error || 'Failed to load region configuration'
        );
    }

    // Get seller account data and tokens
    const sellerConfig = await Integration.getSellerDataAndTokens(userId, region, country);
    if (!sellerConfig.success) {
        throw new ApiError(
            sellerConfig.statusCode || 400,
            sellerConfig.error || 'Failed to load seller account / tokens'
        );
    }

    // Generate SP-API access token
    const tokensResult = await Integration.generateTokens(
        userId,
        sellerConfig.RefreshToken,
        null,
        null
    );

    const AccessToken = tokensResult.AccessToken;

    if (!AccessToken) {
        throw new ApiError(400, tokensResult.error || 'Failed to generate SP-API access token');
    }

    // Generate AWS credentials for shipment API
    const regionConfig = spapiRegions[region];
    let credentials = null;
    try {
        credentials = await getTemporaryCredentials(regionConfig);
        if (!credentials) {
            throw new Error('Failed to generate AWS credentials');
        }
    } catch (err) {
        logger.warn('Failed to generate AWS credentials for shipment API', { error: err.message });
        throw new ApiError(500, `Failed to generate AWS credentials: ${err.message}`);
    }

    return {
        accessToken: AccessToken,
        marketplaceIds: regionConfigResult.marketplaceIds,
        marketplaceId: regionConfigResult.Marketplace_Id,
        baseURI: regionConfigResult.Base_URI,
        credentials
    };
};

/**
 * Validate request body
 */
const validateBody = (req) => {
    const { userId, region, country } = req.body;

    if (!userId) {
        throw new ApiError(400, 'userId is required');
    }
    if (!region) {
        throw new ApiError(400, 'region is required (NA, EU, FE)');
    }
    if (!country) {
        throw new ApiError(400, 'country is required (e.g. US, CA, UK, AU)');
    }

    // Validate region value
    const validRegions = ['NA', 'EU', 'FE'];
    if (!validRegions.includes(region.toUpperCase())) {
        throw new ApiError(400, `Invalid region. Must be one of: ${validRegions.join(', ')}`);
    }

    return { userId, region: region.toUpperCase(), country };
};

/**
 * POST /api/test/shipment
 *
 * Test endpoint to fetch shipment data using the updated service
 * Tests the new features:
 * - API date filtering (DATE_RANGE query for last 30 days)
 * - UTC date format with Z suffix
 * - Pagination support
 * - Validation and duplicate prevention
 *
 * Request Body:
 * {
 *   "userId": "user_id_here",
 *   "region": "NA",
 *   "country": "US"
 * }
 */
const testShipmentData = asyncHandler(async (req, res) => {
    const { userId, region, country } = validateBody(req);

    logger.info('Test Shipment Data triggered - testing new date filtering', {
        userId,
        region,
        country
    });

    const startTime = Date.now();

    try {
        // Step 1: Resolve SP-API context (access token, marketplace IDs, base URI, AWS credentials)
        logger.info('Resolving SP-API context...');
        const { accessToken, marketplaceId, baseURI, credentials } = await resolveSpApiContext(
            userId,
            region,
            country
        );

        logger.info('SP-API context resolved', {
            userId,
            marketplaceId,
            baseURI,
            hasAccessToken: !!accessToken,
            hasCredentials: !!credentials
        });

        // Step 2: Prepare data for shipment service
        const dataToReceive = {
            AccessToken: accessToken,
            AccessKey: credentials.AccessKey,
            SecretKey: credentials.SecretKey,
            SessionToken: credentials.SessionToken,
            marketplaceId: marketplaceId
        };

        // Step 3: Fetch shipment data using updated service
        logger.info('Fetching shipment data with new date filtering (last 30 days)...');
        const fetchStartTime = Date.now();

        const shipmentResult = await getShipmentData(
            dataToReceive,
            userId,
            baseURI,
            country,
            region
        );

        const fetchDuration = Date.now() - fetchStartTime;

        if (!shipmentResult) {
            logger.warn('Shipment data fetch returned null/undefined');
            return res.status(200).json(
                new ApiResponse(200, {
                    success: false,
                    message: 'No shipment data found or fetch failed',
                    fetchDurationMs: fetchDuration,
                    totalDurationMs: Date.now() - startTime
                }, 'Shipment fetch completed but no data returned')
            );
        }

        // Step 4: Get stored shipment data from database
        const storedShipment = await ShipmentModel.findOne({
            User: userId,
            region: region,
            country: country
        }).sort({ createdAt: -1 });

        // Step 5: Format response
        const shipmentCount = storedShipment?.shipmentData?.length || 0;
        const shipmentData = storedShipment?.shipmentData || [];

        // Calculate statistics
        const stats = {
            totalShipments: shipmentCount,
            shipmentsWithDetails: shipmentData.filter(s => s.itemDetails && s.itemDetails.length > 0).length,
            totalItems: shipmentData.reduce((sum, s) => sum + (s.itemDetails?.length || 0), 0),
            shipmentsWithDate: shipmentData.filter(s => s.shipmentDate).length
        };

        const responseData = {
            success: true,
            message: 'Shipment data fetched and stored successfully',
            summary: {
                region,
                country,
                shipmentsFetched: shipmentCount,
                statistics: stats
            },
            shipmentData: shipmentData.map(shipment => ({
                shipmentId: shipment.shipmentId,
                shipmentName: shipment.shipmentName,
                shipmentDate: shipment.shipmentDate,
                itemCount: shipment.itemDetails?.length || 0,
                items: shipment.itemDetails?.map(item => ({
                    sellerSKU: item.SellerSKU,
                    fnsku: item.FulfillmentNetworkSKU,
                    quantityShipped: item.QuantityShipped,
                    quantityReceived: item.QuantityReceived
                })) || []
            })),
            metadata: {
                fetchDurationMs: fetchDuration,
                totalDurationMs: Date.now() - startTime,
                storedAt: storedShipment?.createdAt || new Date(),
                dateRange: {
                    description: 'Last 30 days (CLOSED shipments only)',
                    queryType: 'DATE_RANGE',
                    dateFormat: 'UTC with Z suffix (ISO 8601)'
                },
                features: {
                    apiDateFiltering: true,
                    paginationSupport: true,
                    validation: true,
                    duplicatePrevention: true
                }
            }
        };

        logger.info('Shipment data fetched successfully', {
            userId,
            region,
            country,
            shipmentCount,
            fetchDurationMs: fetchDuration,
            totalDurationMs: Date.now() - startTime
        });

        return res.status(200).json(
            new ApiResponse(200, responseData, 'Shipment data fetched and stored successfully')
        );

    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('Error fetching shipment data', {
            userId,
            region,
            country,
            error: error.message,
            stack: error.stack,
            durationMs: duration
        });

        // Return appropriate error response
        if (error instanceof ApiError) {
            return res.status(error.statusCode).json(error);
        }

        return res.status(500).json(
            new ApiError(500, `Error fetching shipment data: ${error.message}`)
        );
    }
});

module.exports = {
    testShipmentData
};

