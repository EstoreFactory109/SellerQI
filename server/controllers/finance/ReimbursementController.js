const { ApiError } = require('../../utils/ApiError.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const asyncHandler = require('../../utils/AsyncHandler.js');
const logger = require('../../utils/Logger.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const {
    calculateShipmentDiscrepancy,
    calculateLostInventoryReimbursement,
    calculateDamagedInventoryReimbursement,
    calculateDisposedInventoryReimbursement,
    calculateFeeReimbursement
} = require('../../Services/Calculations/Reimbursement.js');

/**
 * Get reimbursement summary for all types
 */
const getReimbursementSummary = asyncHandler(async (req, res) => {
    const userId = req.userId;
    const country = req.country;
    const region = req.region;

    try {
        logger.info(`Fetching reimbursement summary for user ${userId}, country ${country}, region ${region}`);

        // Calculate all reimbursement types in parallel
        const [
            shipmentResult,
            lostInventoryResult,
            damagedInventoryResult,
            disposedInventoryResult,
            feeReimbursementResult
        ] = await Promise.all([
            calculateShipmentDiscrepancy(userId, country, region),
            calculateLostInventoryReimbursement(userId, country, region),
            calculateDamagedInventoryReimbursement(userId, country, region),
            calculateDisposedInventoryReimbursement(userId, country, region),
            calculateFeeReimbursement(userId, country, region)
        ]);

        // Get seller data to map SKU to ASIN for shipment data
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
            date: item.date || new Date().toISOString().split('T')[0], // Use date extracted from shipment name
            shipmentId: item.shipmentId || '',
            shipmentName: item.shipmentName || '',
            asin: skuToAsinMap.get(item.sellerSKU) || '', // Get ASIN from SKU mapping
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
        const lostInventoryData = lostInventoryResult.data || [];
        const formattedLostInventoryData = lostInventoryData.map(item => ({
            date: new Date().toISOString().split('T')[0],
            asin: item.asin || '',
            sku: asinToSkuMap.get(item.asin) || '', // Get SKU from ASIN mapping
            fnsku: item.fnsku || '',
            lostUnits: item.lostUnits || 0,
            foundUnits: item.found || 0,
            reimbursedUnits: 0, // This would come from actual reimbursement records
            discrepancyUnits: item.lostUnits || 0,
            expectedAmount: item.expectedAmount || 0,
            isUnderpaid: false, // This would need to be calculated based on actual reimbursements
            underpaidExpectedAmount: 0
        }));

        // Format damaged inventory data for frontend
        const damagedInventoryData = damagedInventoryResult.data || [];
        const formattedDamagedInventoryData = damagedInventoryData.map(item => ({
            date: new Date().toISOString().split('T')[0],
            asin: item.asin || '',
            sku: asinToSkuMap.get(item.asin) || '', // Get SKU from ASIN mapping
            fnsku: item.fnsku || '',
            damagedUnits: item.damagedUnits || 0,
            salesPrice: item.salesPrice || 0,
            fees: item.estimatedFees || 0,
            reimbursementPerUnit: item.reimbursementPerUnit || 0,
            expectedAmount: item.expectedAmount || 0
        }));

        // Format disposed inventory data for frontend
        const disposedInventoryData = disposedInventoryResult.data || [];
        const formattedDisposedInventoryData = disposedInventoryData.map(item => ({
            date: new Date().toISOString().split('T')[0],
            asin: item.asin || '',
            sku: asinToSkuMap.get(item.asin) || '', // Get SKU from ASIN mapping
            fnsku: item.fnsku || '',
            disposedUnits: item.disposedUnits || 0,
            salesPrice: item.salesPrice || 0,
            fees: item.estimatedFees || 0,
            reimbursementPerUnit: item.reimbursementPerUnit || 0,
            expectedAmount: item.expectedAmount || 0
        }));

        // Format fee reimbursement data for frontend
        const feeReimbursementData = feeReimbursementResult.data || [];
        const formattedFeeReimbursementData = feeReimbursementData.map(item => ({
            date: new Date().toISOString().split('T')[0],
            asin: item.asin || '',
            fnsku: item.fnsku || '',
            productName: item.productName || '',
            chargedFees: item.chargedFees || 0,
            actualFees: item.actualFees || 0,
            feeDifference: item.feeDifference || 0,
            unitsSold: item.unitsSold || 0,
            expectedAmount: item.expectedAmount || 0
        }));

        // Calculate total recoverable (sum of all types)
        const totalRecoverable = 
            (shipmentResult.totalReimbursement || 0) +
            (lostInventoryResult.totalExpectedAmount || 0) +
            (damagedInventoryResult.totalExpectedAmount || 0) +
            (disposedInventoryResult.totalExpectedAmount || 0) +
            (feeReimbursementResult.totalExpectedAmount || 0);

        // Build response matching frontend expectations
        const responseData = {
            totalRecoverableMonth: totalRecoverable,
            totalRecoverable: totalRecoverable,
            discrepanciesFound: 
                formattedShipmentData.length +
                formattedLostInventoryData.length +
                formattedDamagedInventoryData.length +
                formattedDisposedInventoryData.length +
                formattedFeeReimbursementData.length,
            claimSuccessRate: 0, // This would need to be calculated from actual claims
            avgResolutionTime: 0, // This would need to be calculated from actual claims
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
            backendFeeReimbursement: {
                data: formattedFeeReimbursementData,
                itemCount: formattedFeeReimbursementData.length,
                totalExpectedAmount: feeReimbursementResult.totalExpectedAmount || 0
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

