/**
 * Reimbursement Test Controller
 *
 * Test endpoint to fetch fresh data from SP-API and return the complete
 * reimbursement data exactly as sent to the frontend
 * 
 * Endpoint: POST /api/test/reimbursement
 * Body: { userId, region, country }
 */

const asyncHandler = require('../../utils/AsyncHandler.js');
const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const logger = require('../../utils/Logger.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { Integration } = require('../../Services/main/Integration.js');
const {
    calculateShipmentDiscrepancy,
    calculateLostInventoryReimbursement,
    calculateDamagedInventoryReimbursement,
    calculateDisposedInventoryReimbursement
} = require('../../Services/Calculations/Reimbursement.js');

// Import SP-API services for data fetching
const getLedgerSummaryViewData = require('../../Services/Sp_API/GET_LEDGER_SUMMARY_VIEW_DATA.js');
const getLedgerDetailViewData = require('../../Services/Sp_API/GET_LEDGER_DETAIL_VIEW_DATA.js');
const getFBAReimbursementsData = require('../../Services/Sp_API/GET_FBA_REIMBURSEMENTS_DATA.js');
const getMerchantListingsAllData = require('../../Services/Sp_API/GET_MERCHANT_LISTINGS_ALL_DATA.js');
const getShipmentData = require('../../Services/Sp_API/shipment.js');
const getTemporaryCredentials = require('../../utils/GenerateTemporaryCredentials.js');
const { spapiRegions } = require('../../controllers/config/config.js');

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
    } catch (err) {
        logger.warn('Failed to generate AWS credentials for shipment API', { error: err.message });
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
        throw new ApiError(400, 'country is required (e.g. US, CA, UK)');
    }

    return { userId, region, country };
};

/**
 * POST /api/test/reimbursement
 * 
 * Test endpoint to fetch fresh data from SP-API and return complete reimbursement data
 * Returns the exact same data structure as sent to the frontend
 * 
 * Request Body:
 * {
 *   "userId": "user_id_here",
 *   "region": "NA",
 *   "country": "US"
 * }
 */
const testReimbursementData = asyncHandler(async (req, res) => {
    const { userId, region, country } = validateBody(req);

    logger.info('Test Reimbursement Data triggered - fetching from SP-API', {
        userId,
        region,
        country
    });

    const startTime = Date.now();
    const fetchResults = {
        ledger: { success: false, message: '' },
        ledgerDetail: { success: false, message: '' },
        fbaReimbursements: { success: false, message: '' },
        shipment: { success: false, message: '' },
        listings: { success: false, message: '' }
    };

    try {
        // Step 1: Resolve SP-API context (access token, marketplace IDs, base URI)
        const { accessToken, marketplaceIds, marketplaceId, baseURI, credentials } = await resolveSpApiContext(
            userId,
            region,
            country
        );

        logger.info('SP-API context resolved', {
            userId,
            marketplaceIds,
            baseURI,
            hasAccessToken: !!accessToken,
            hasCredentials: !!credentials
        });

        // Step 2: Reimbursement reports use fixed 9-month date range (hardcoded in the services)
        // No custom date range is supported for Lost, Damaged, Disposed inventory reports
        logger.info('Fetching reimbursement data (fixed 9-month date range)');

        // Step 3: Fetch fresh data from SP-API in parallel
        logger.info('Fetching fresh data from SP-API...');
        const fetchStartTime = Date.now();

        const fetchPromises = [
            // Ledger Summary View Data (for Lost Inventory) - Fixed 9 months
            getLedgerSummaryViewData(accessToken, marketplaceIds, userId, baseURI, country, region)
                .then(result => {
                    fetchResults.ledger = { success: true, message: 'Ledger summary data fetched successfully' };
                    logger.info('Ledger summary data fetched successfully');
                    return result;
                })
                .catch(error => {
                    fetchResults.ledger = { success: false, message: error.message };
                    logger.warn('Ledger summary data fetch failed:', error.message);
                    return null;
                }),

            // Ledger Detail View Data (for Damaged/Disposed Inventory) - Fixed 9 months
            getLedgerDetailViewData(accessToken, marketplaceIds, userId, baseURI, country, region)
                .then(result => {
                    fetchResults.ledgerDetail = { success: true, message: 'Ledger detail data fetched successfully' };
                    logger.info('Ledger detail data fetched successfully');
                    return result;
                })
                .catch(error => {
                    fetchResults.ledgerDetail = { success: false, message: error.message };
                    logger.warn('Ledger detail data fetch failed:', error.message);
                    return null;
                }),

            // FBA Reimbursements Data (for Lost Inventory Reimbursed Units) - Fixed 9 months
            getFBAReimbursementsData(accessToken, marketplaceIds, userId, baseURI, country, region)
                .then(result => {
                    fetchResults.fbaReimbursements = { success: true, message: 'FBA reimbursements data fetched successfully' };
                    logger.info('FBA reimbursements data fetched successfully');
                    return result;
                })
                .catch(error => {
                    fetchResults.fbaReimbursements = { success: false, message: error.message };
                    logger.warn('FBA reimbursements data fetch failed:', error.message);
                    return null;
                }),


            // Merchant Listings (Product prices)
            getMerchantListingsAllData(accessToken, marketplaceIds, userId, country, region, baseURI)
                .then(result => {
                    fetchResults.listings = { success: true, message: 'Listings data fetched successfully' };
                    logger.info('Listings data fetched successfully');
                    return result;
                })
                .catch(error => {
                    fetchResults.listings = { success: false, message: error.message };
                    logger.warn('Listings data fetch failed:', error.message);
                    return null;
                }),

            // Shipment Data
            (async () => {
                if (!credentials) {
                    fetchResults.shipment = { success: false, message: 'AWS credentials not available' };
                    logger.warn('Shipment data fetch skipped - no AWS credentials');
                    return null;
                }
                const dataToReceive = {
                    AccessToken: accessToken,
                    AccessKey: credentials.AccessKey,
                    SecretKey: credentials.SecretKey,
                    SessionToken: credentials.SessionToken,
                    marketplaceId: marketplaceId
                };
                return getShipmentData(dataToReceive, userId, baseURI, country, region)
                    .then(result => {
                        fetchResults.shipment = { success: true, message: 'Shipment data fetched successfully' };
                        logger.info('Shipment data fetched successfully');
                        return result;
                    })
                    .catch(error => {
                        fetchResults.shipment = { success: false, message: error.message };
                        logger.warn('Shipment data fetch failed:', error.message);
                        return null;
                    });
            })()
        ];

        // Wait for all fetch operations to complete
        await Promise.all(fetchPromises);

        const fetchDuration = Date.now() - fetchStartTime;
        logger.info('SP-API data fetch completed', {
            userId,
            fetchDurationMs: fetchDuration,
            results: fetchResults,
            dateRange: 'Fixed 9 months (hardcoded in services)'
        });

        // Step 4: Calculate all reimbursement types in parallel
        logger.info('Calculating reimbursements...');
        const calcStartTime = Date.now();

        const [
            shipmentResult,
            lostInventoryResult,
            damagedInventoryResult,
            disposedInventoryResult
        ] = await Promise.all([
            calculateShipmentDiscrepancy(userId, country, region),
            calculateLostInventoryReimbursement(userId, country, region),
            calculateDamagedInventoryReimbursement(userId, country, region),
            calculateDisposedInventoryReimbursement(userId, country, region)
        ]);

        const calcDuration = Date.now() - calcStartTime;
        logger.info('Reimbursement calculations completed', {
            userId,
            calcDurationMs: calcDuration
        });

        // Step 5: Get seller data to map SKU to ASIN
        let skuToAsinMap = new Map();
        try {
            const sellerData = await Seller.findOne({ User: userId });
            if (sellerData && sellerData.sellerAccount) {
                const sellerAccount = sellerData.sellerAccount.find(
                    account => account.country === country && account.region === region
                );
                if (sellerAccount && sellerAccount.products) {
                    sellerAccount.products.forEach(product => {
                        if (product.sku && product.asin) {
                            skuToAsinMap.set(product.sku.trim(), product.asin.trim());
                        }
                    });
                }
            }
        } catch (error) {
            logger.warn(`Could not fetch seller data for ASIN mapping: ${error.message}`);
        }

        // Format shipment data for frontend
        const shipmentData = shipmentResult.data || [];
        const formattedShipmentData = shipmentData.map(item => ({
            date: item.date || new Date().toISOString().split('T')[0],
            shipmentId: item.shipmentId || '',
            shipmentName: item.shipmentName || '',
            asin: skuToAsinMap.get(item.sellerSKU) || '',
            sku: item.sellerSKU || '',
            quantityShipped: item.quantityShipped || 0,
            quantityReceived: item.quantityReceived || 0,
            discrepancyUnits: item.discrepancy || 0,
            expectedAmount: item.reimbursementAmount || 0
        }));

        // Create ASIN to SKU map for lost/damaged/disposed inventory
        const asinToSkuMap = new Map();
        try {
            const sellerData = await Seller.findOne({ User: userId });
            if (sellerData && sellerData.sellerAccount) {
                const sellerAccount = sellerData.sellerAccount.find(
                    account => account.country === country && account.region === region
                );
                if (sellerAccount && sellerAccount.products) {
                    sellerAccount.products.forEach(product => {
                        if (product.asin && product.sku) {
                            asinToSkuMap.set(product.asin.trim(), product.sku.trim());
                        }
                    });
                }
            }
        } catch (error) {
            logger.warn(`Could not fetch seller data for SKU mapping: ${error.message}`);
        }

        // Format lost inventory data for frontend
        // Now includes reimbursedUnits from FBA Reimbursements report
        // Date comes from ledger items (stored in MM/YYYY format, using most recent date per ASIN)
        const lostInventoryData = lostInventoryResult.data || [];
        const formattedLostInventoryData = lostInventoryData.map(item => ({
            date: item.date || '', // Date from ledger item (MM/YYYY format, most recent per ASIN)
            asin: item.asin || '',
            sku: asinToSkuMap.get(item.asin) || '',
            fnsku: item.fnsku || '',
            lostUnits: item.lostUnits || 0,
            foundUnits: item.foundUnits || 0,
            reimbursedUnits: item.reimbursedUnits || 0, // Now from FBA Reimbursements report
            discrepancyUnits: item.discrepancyUnits || 0, // Now calculated as: lost - found - reimbursed
            expectedAmount: item.expectedAmount || 0,
            isUnderpaid: false,
            underpaidExpectedAmount: 0
        }));

        // Format damaged inventory data for frontend
        // Now includes referenceId and reasonCode from Ledger Detail report
        const damagedInventoryData = damagedInventoryResult.data || [];
        const formattedDamagedInventoryData = damagedInventoryData.map(item => ({
            date: item.date || new Date().toISOString().split('T')[0],
            referenceId: item.referenceId || '',
            asin: item.asin || '',
            sku: asinToSkuMap.get(item.asin) || '',
            fnsku: item.fnsku || '',
            reasonCode: item.reasonCode || '',
            damagedUnits: item.damagedUnits || 0,
            salesPrice: item.salesPrice || 0,
            fees: item.estimatedFees || 0,
            reimbursementPerUnit: item.reimbursementPerUnit || 0,
            expectedAmount: item.expectedAmount || 0
        }));

        // Format disposed inventory data for frontend
        // Now includes referenceId and disposition from Ledger Detail report
        const disposedInventoryData = disposedInventoryResult.data || [];
        const formattedDisposedInventoryData = disposedInventoryData.map(item => ({
            date: item.date || new Date().toISOString().split('T')[0],
            referenceId: item.referenceId || '',
            asin: item.asin || '',
            sku: asinToSkuMap.get(item.asin) || '',
            fnsku: item.fnsku || '',
            disposition: item.disposition || '',
            disposedUnits: item.disposedUnits || 0,
            salesPrice: item.salesPrice || 0,
            fees: item.estimatedFees || 0,
            reimbursementPerUnit: item.reimbursementPerUnit || 0,
            expectedAmount: item.expectedAmount || 0
        }));

        // Calculate total recoverable (sum of all types)
        const totalRecoverable = 
            (shipmentResult.totalReimbursement || 0) +
            (lostInventoryResult.totalExpectedAmount || 0) +
            (damagedInventoryResult.totalExpectedAmount || 0) +
            (disposedInventoryResult.totalExpectedAmount || 0);

        // Build response matching frontend expectations (exact same format)
        const responseData = {
            totalRecoverableMonth: totalRecoverable,
            totalRecoverable: totalRecoverable,
            discrepanciesFound: 
                formattedShipmentData.length +
                formattedLostInventoryData.length +
                formattedDamagedInventoryData.length +
                formattedDisposedInventoryData.length,
            claimSuccessRate: 0,
            avgResolutionTime: 0,
            feeProtector: {
                backendShipmentItems: {
                    data: formattedShipmentData,
                    count: formattedShipmentData.length,
                    totalExpectedAmount: shipmentResult.totalReimbursement || 0
                }
            },
            backendLostInventory: {
                data: formattedLostInventoryData,
                itemCount: formattedLostInventoryData.length,
                totalExpectedAmount: lostInventoryResult.totalExpectedAmount || 0
            },
            backendDamagedInventory: {
                data: formattedDamagedInventoryData,
                itemCount: formattedDamagedInventoryData.length,
                totalExpectedAmount: damagedInventoryResult.totalExpectedAmount || 0
            },
            backendDisposedInventory: {
                data: formattedDisposedInventoryData,
                itemCount: formattedDisposedInventoryData.length,
                totalExpectedAmount: disposedInventoryResult.totalExpectedAmount || 0
            },
            // Additional metadata for testing
            _meta: {
                fetchResults,
                fetchDurationMs: fetchDuration,
                calculationDurationMs: calcDuration,
                totalDurationMs: Date.now() - startTime
            }
        };

        const totalDuration = Date.now() - startTime;

        logger.info('Reimbursement data fetched and calculated successfully', {
            userId,
            region,
            country,
            totalRecoverable,
            discrepanciesFound: responseData.discrepanciesFound,
            totalDurationMs: totalDuration
        });

        return res.status(200).json(
            new ApiResponse(200, responseData, "Reimbursement data fetched and calculated successfully")
        );

    } catch (error) {
        const duration = Date.now() - startTime;
        logger.error('Error fetching reimbursement data', {
            userId,
            region,
            country,
            error: error.message,
            stack: error.stack,
            durationMs: duration
        });

        return res.status(500).json(
            new ApiError(500, `Error fetching reimbursement data: ${error.message}`)
        );
    }
});

module.exports = {
    testReimbursementData
};
