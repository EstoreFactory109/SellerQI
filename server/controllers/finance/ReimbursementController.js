const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const {
    calculateShipmentDiscrepancy,
    calculateLostInventoryReimbursement,
    calculateDamagedInventoryReimbursement,
    calculateDisposedInventoryReimbursement
} = require('../../Services/Calculations/Reimbursement.js');

/**
 * Get reimbursement summary for all types with pagination support
 * 
 * Query params:
 * - page: Page number for each category (default: 1)
 * - limit: Items per page for each category (default: 20, max: 100)
 * - summaryOnly: If true, return only summary totals without detailed data (default: false)
 * - category: If specified, only return data for that category (shipment, lost, damaged, disposed)
 */
const getReimbursementSummary = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;
    
    // Pagination parameters
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
    const summaryOnly = req.query.summaryOnly === 'true';
    const category = req.query.category; // Optional: shipment, lost, damaged, disposed

    try {
        logger.info(`Fetching reimbursement summary for user ${userId}, country ${country}, region ${region}, page ${page}, limit ${limit}, summaryOnly ${summaryOnly}`);

        // Calculate all reimbursement types in parallel
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

        // Calculate totals first (always needed for summary)
        const totalRecoverable = 
            (shipmentResult.totalReimbursement || 0) +
            (lostInventoryResult.totalExpectedAmount || 0) +
            (damagedInventoryResult.totalExpectedAmount || 0) +
            (disposedInventoryResult.totalExpectedAmount || 0);

        // Get raw data lengths for counts
        const shipmentData = shipmentResult.data || [];
        const lostInventoryData = (lostInventoryResult.data || []).filter(item => (item.expectedAmount || 0) > 0);
        const damagedInventoryData = (damagedInventoryResult.data || []).filter(item => (item.expectedAmount || 0) > 0);
        const disposedInventoryData = (disposedInventoryResult.data || []).filter(item => (item.expectedAmount || 0) > 0);

        const discrepanciesFound = 
            shipmentData.length +
            lostInventoryData.length +
            damagedInventoryData.length +
            disposedInventoryData.length;

        // If summary only, return just the totals without detailed data
        if (summaryOnly) {
            const responseData = {
                totalRecoverableMonth: totalRecoverable,
                totalRecoverable: totalRecoverable,
                discrepanciesFound: discrepanciesFound,
                claimSuccessRate: 0,
                avgResolutionTime: 0,
                feeProtector: {
                    backendShipmentItems: {
                        data: [],
                        count: shipmentData.length,
                        totalExpectedAmount: shipmentResult.totalReimbursement || 0
                    }
                },
                backendLostInventory: {
                    data: [],
                    itemCount: lostInventoryData.length,
                    totalExpectedAmount: lostInventoryResult.totalExpectedAmount || 0
                },
                backendDamagedInventory: {
                    data: [],
                    itemCount: damagedInventoryData.length,
                    totalExpectedAmount: damagedInventoryResult.totalExpectedAmount || 0
                },
                backendDisposedInventory: {
                    data: [],
                    itemCount: disposedInventoryData.length,
                    totalExpectedAmount: disposedInventoryResult.totalExpectedAmount || 0
                },
                pagination: {
                    page,
                    limit,
                    summaryOnly: true
                }
            };

            return res.status(200).json(
                new ApiResponse(200, responseData, "Reimbursement summary fetched successfully")
            );
        }

        // Get seller data to map SKU to ASIN for shipment data
        let skuToAsinMap = new Map();
        let asinToSkuMap = new Map();
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
                            asinToSkuMap.set(product.asin.trim(), product.sku.trim());
                        }
                    });
                }
            }
        } catch (error) {
            logger.warn(`Could not fetch seller data for ASIN mapping: ${error.message}`);
        }

        // Helper function to paginate and format data
        const paginateData = (data, formatFn) => {
            const startIndex = (page - 1) * limit;
            const endIndex = startIndex + limit;
            const paginatedData = data.slice(startIndex, endIndex);
            return {
                data: paginatedData.map(formatFn),
                totalItems: data.length,
                totalPages: Math.ceil(data.length / limit),
                hasMore: page < Math.ceil(data.length / limit)
            };
        };

        // Format shipment data
        const shipmentFormatFn = (item) => ({
            date: item.date || new Date().toISOString().split('T')[0],
            shipmentId: item.shipmentId || '',
            shipmentName: item.shipmentName || '',
            asin: skuToAsinMap.get(item.sellerSKU) || '',
            sku: item.sellerSKU || '',
            quantityShipped: item.quantityShipped || 0,
            quantityReceived: item.quantityReceived || 0,
            discrepancyUnits: item.discrepancy || 0,
            expectedAmount: item.reimbursementAmount || 0
        });

        // Format lost inventory data
        const lostFormatFn = (item) => ({
            date: item.date || '',
            asin: item.asin || '',
            sku: asinToSkuMap.get(item.asin) || '',
            fnsku: item.fnsku || '',
            lostUnits: item.lostUnits || 0,
            foundUnits: item.foundUnits || 0,
            reimbursedUnits: item.reimbursedUnits || 0,
            discrepancyUnits: item.discrepancyUnits || 0,
            expectedAmount: item.expectedAmount || 0,
            isUnderpaid: false,
            underpaidExpectedAmount: 0
        });

        // Format damaged inventory data
        const damagedFormatFn = (item) => ({
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
        });

        // Format disposed inventory data
        const disposedFormatFn = (item) => ({
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
        });

        // If a specific category is requested, only paginate that one
        // Otherwise, return first page of each with small limits
        let shipmentPaginated, lostPaginated, damagedPaginated, disposedPaginated;

        if (category === 'shipment') {
            shipmentPaginated = paginateData(shipmentData, shipmentFormatFn);
            lostPaginated = { data: [], totalItems: lostInventoryData.length, totalPages: Math.ceil(lostInventoryData.length / limit), hasMore: lostInventoryData.length > 0 };
            damagedPaginated = { data: [], totalItems: damagedInventoryData.length, totalPages: Math.ceil(damagedInventoryData.length / limit), hasMore: damagedInventoryData.length > 0 };
            disposedPaginated = { data: [], totalItems: disposedInventoryData.length, totalPages: Math.ceil(disposedInventoryData.length / limit), hasMore: disposedInventoryData.length > 0 };
        } else if (category === 'lost') {
            shipmentPaginated = { data: [], totalItems: shipmentData.length, totalPages: Math.ceil(shipmentData.length / limit), hasMore: shipmentData.length > 0 };
            lostPaginated = paginateData(lostInventoryData, lostFormatFn);
            damagedPaginated = { data: [], totalItems: damagedInventoryData.length, totalPages: Math.ceil(damagedInventoryData.length / limit), hasMore: damagedInventoryData.length > 0 };
            disposedPaginated = { data: [], totalItems: disposedInventoryData.length, totalPages: Math.ceil(disposedInventoryData.length / limit), hasMore: disposedInventoryData.length > 0 };
        } else if (category === 'damaged') {
            shipmentPaginated = { data: [], totalItems: shipmentData.length, totalPages: Math.ceil(shipmentData.length / limit), hasMore: shipmentData.length > 0 };
            lostPaginated = { data: [], totalItems: lostInventoryData.length, totalPages: Math.ceil(lostInventoryData.length / limit), hasMore: lostInventoryData.length > 0 };
            damagedPaginated = paginateData(damagedInventoryData, damagedFormatFn);
            disposedPaginated = { data: [], totalItems: disposedInventoryData.length, totalPages: Math.ceil(disposedInventoryData.length / limit), hasMore: disposedInventoryData.length > 0 };
        } else if (category === 'disposed') {
            shipmentPaginated = { data: [], totalItems: shipmentData.length, totalPages: Math.ceil(shipmentData.length / limit), hasMore: shipmentData.length > 0 };
            lostPaginated = { data: [], totalItems: lostInventoryData.length, totalPages: Math.ceil(lostInventoryData.length / limit), hasMore: lostInventoryData.length > 0 };
            damagedPaginated = { data: [], totalItems: damagedInventoryData.length, totalPages: Math.ceil(damagedInventoryData.length / limit), hasMore: damagedInventoryData.length > 0 };
            disposedPaginated = paginateData(disposedInventoryData, disposedFormatFn);
        } else {
            // Default: return first page of each category
            shipmentPaginated = paginateData(shipmentData, shipmentFormatFn);
            lostPaginated = paginateData(lostInventoryData, lostFormatFn);
            damagedPaginated = paginateData(damagedInventoryData, damagedFormatFn);
            disposedPaginated = paginateData(disposedInventoryData, disposedFormatFn);
        }

        // Build response matching frontend expectations
        const responseData = {
            totalRecoverableMonth: totalRecoverable,
            totalRecoverable: totalRecoverable,
            discrepanciesFound: discrepanciesFound,
            claimSuccessRate: 0,
            avgResolutionTime: 0,
            feeProtector: {
                backendShipmentItems: {
                    data: shipmentPaginated.data,
                    count: shipmentPaginated.totalItems,
                    totalExpectedAmount: shipmentResult.totalReimbursement || 0,
                    pagination: {
                        page,
                        limit,
                        totalItems: shipmentPaginated.totalItems,
                        totalPages: shipmentPaginated.totalPages,
                        hasMore: shipmentPaginated.hasMore
                    }
                }
            },
            backendLostInventory: {
                data: lostPaginated.data,
                itemCount: lostPaginated.totalItems,
                totalExpectedAmount: lostInventoryResult.totalExpectedAmount || 0,
                pagination: {
                    page,
                    limit,
                    totalItems: lostPaginated.totalItems,
                    totalPages: lostPaginated.totalPages,
                    hasMore: lostPaginated.hasMore
                }
            },
            backendDamagedInventory: {
                data: damagedPaginated.data,
                itemCount: damagedPaginated.totalItems,
                totalExpectedAmount: damagedInventoryResult.totalExpectedAmount || 0,
                pagination: {
                    page,
                    limit,
                    totalItems: damagedPaginated.totalItems,
                    totalPages: damagedPaginated.totalPages,
                    hasMore: damagedPaginated.hasMore
                }
            },
            backendDisposedInventory: {
                data: disposedPaginated.data,
                itemCount: disposedPaginated.totalItems,
                totalExpectedAmount: disposedInventoryResult.totalExpectedAmount || 0,
                pagination: {
                    page,
                    limit,
                    totalItems: disposedPaginated.totalItems,
                    totalPages: disposedPaginated.totalPages,
                    hasMore: disposedPaginated.hasMore
                }
            }
        };

        return res.status(200).json(
            new ApiResponse(200, responseData, "Reimbursement summary fetched successfully")
        );

    } catch (error) {
        logger.error(`Error fetching reimbursement summary: ${error.message}`, {
            error: error.stack,
            userId,
            country,
            region
        });

        return res.status(500).json(
            new ApiError(500, `Error fetching reimbursement summary: ${error.message}`)
        );
    }
});

/**
 * Get all reimbursements (for the reimbursements table - can be empty for now)
 */
const getAllReimbursements = asyncHandler(async (req, res) => {
    // This endpoint can return empty array for now
    // In the future, this could return actual reimbursement claims from Amazon
    return res.status(200).json(
        new ApiResponse(200, [], "Reimbursements fetched successfully")
    );
});

/**
 * Get reimbursement timeline data
 */
const getReimbursementTimeline = asyncHandler(async (req, res) => {
    const days = parseInt(req.query.days) || 30;
    
    // Return empty timeline data for now
    // In the future, this could return historical reimbursement data
    const timelineData = [];
    
    return res.status(200).json(
        new ApiResponse(200, timelineData, "Reimbursement timeline fetched successfully")
    );
});

module.exports = {
    getReimbursementSummary,
    getAllReimbursements,
    getReimbursementTimeline
};

