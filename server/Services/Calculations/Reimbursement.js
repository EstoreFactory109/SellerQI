const ShipmentModel = require('../../models/inventory/ShipmentModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const LedgerSummaryView = require('../../models/finance/LedgerSummaryViewModel.js');
const ProductWiseFBAData = require('../../models/inventory/ProductWiseFBADataModel.js');
 const ProductWiseSales = require('../../models/products/ProductWiseSalesModel.js');
const { calculateFees } = require('./ActualFeesCalculations.js');
const logger = require('../../utils/Logger.js');

/**
 * Extract date from shipment name
 * Shipment names follow pattern: "FBA (29/06/2020, 04:07) - 1"
 * The date is in format (DD/MM/YYYY, HH:mm)
 * @param {string} shipmentName - The shipment name containing the date
 * @returns {string} - Date string in YYYY-MM-DD format or today's date if not found
 */
const extractDateFromShipmentName = (shipmentName) => {
    if (!shipmentName) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = String(today.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }
    
    // Regex to match date pattern (DD/MM/YYYY, HH:mm) in parentheses
    // Example: "FBA (29/06/2020, 04:07) - 1"
    const datePattern = /\((\d{2})\/(\d{2})\/(\d{4}),?\s*(\d{2}):(\d{2})\)/;
    const match = shipmentName.match(datePattern);
    
    if (match) {
        const [, day, month, year] = match;
        // Validate day, month, year are valid numbers
        const dayNum = parseInt(day);
        const monthNum = parseInt(month);
        const yearNum = parseInt(year);
        
        if (dayNum >= 1 && dayNum <= 31 && monthNum >= 1 && monthNum <= 12 && yearNum >= 1900) {
            // Return date in YYYY-MM-DD format directly (avoids timezone issues)
            return `${year}-${month}-${day}`;
        }
    }
    
    // Return today's date as fallback
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
};

/**
 * Calculate shipment discrepancy and reimbursement amounts
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} JSON object with shipment discrepancy and reimbursement calculations
 */
const calculateShipmentDiscrepancy = async (userId, country, region) => {
    try {
        // 1. Get shipment data from Shipment model
        const shipmentData = await ShipmentModel.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!shipmentData || !shipmentData.shipmentData || shipmentData.shipmentData.length === 0) {
            logger.info(`No shipment data found for userId: ${userId}, country: ${country}, region: ${region}`);
            return {
                success: true,
                message: "No shipment data found",
                data: [],
                totalDiscrepancy: 0,
                totalReimbursement: 0
            };
        }

        // 2. Get seller product data to get prices
        const sellerData = await Seller.findOne({ User: userId });

        if (!sellerData || !sellerData.sellerAccount || sellerData.sellerAccount.length === 0) {
            logger.warn(`No seller data found for userId: ${userId}`);
            return {
                success: false,
                message: "No seller product data found",
                data: [],
                totalDiscrepancy: 0,
                totalReimbursement: 0
            };
        }

        // Find the seller account matching country and region
        const sellerAccount = sellerData.sellerAccount.find(
            account => account.country === country && account.region === region
        );

        if (!sellerAccount || !sellerAccount.products || sellerAccount.products.length === 0) {
            logger.warn(`No products found for userId: ${userId}, country: ${country}, region: ${region}`);
            return {
                success: false,
                message: "No products found for the specified country and region",
                data: [],
                totalDiscrepancy: 0,
                totalReimbursement: 0
            };
        }

        // 3. Get ledger summary data to get estimated fees by fnsku
        const ledgerData = await LedgerSummaryView.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        // Create a map of fnsku to estimated fees from ledger data
        const fnskuToEstimatedFeesMap = new Map();
        if (ledgerData && ledgerData.data && Array.isArray(ledgerData.data)) {
            ledgerData.data.forEach(ledgerItem => {
                if (ledgerItem.fnsku) {
                    const fnsku = ledgerItem.fnsku.trim();
                    // Look for estimated fees - could be in various fields
                    // Check for common fee field names
                    let estimatedFees = 0;
                    
                    // Try different possible field names for estimated fees
                    if (ledgerItem['estimated-fee-total']) {
                        estimatedFees = parseFloat(ledgerItem['estimated-fee-total'].toString().replace(/[^0-9.-]/g, '')) || 0;
                    } else if (ledgerItem.estimated_fee_total) {
                        estimatedFees = parseFloat(ledgerItem.estimated_fee_total.toString().replace(/[^0-9.-]/g, '')) || 0;
                    } else if (ledgerItem['estimated-fee']) {
                        estimatedFees = parseFloat(ledgerItem['estimated-fee'].toString().replace(/[^0-9.-]/g, '')) || 0;
                    }
                    
                    // If we found fees for this fnsku, store it (use the latest/most recent if multiple entries)
                    if (estimatedFees > 0 || fnskuToEstimatedFeesMap.has(fnsku)) {
                        // If multiple entries exist, use the one with higher fees (most recent or most accurate)
                        const existingFees = fnskuToEstimatedFeesMap.get(fnsku) || 0;
                        if (estimatedFees > existingFees) {
                            fnskuToEstimatedFeesMap.set(fnsku, estimatedFees);
                        }
                    } else if (estimatedFees === 0) {
                        // Store 0 if no fees found (to avoid repeated lookups)
                        fnskuToEstimatedFeesMap.set(fnsku, 0);
                    }
                }
            });
        }

        // Fallback: If no fees found in ledger, try ProductWiseFBAData model
        const productWiseFBAData = await ProductWiseFBAData.findOne({
            userId: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (productWiseFBAData && productWiseFBAData.fbaData && Array.isArray(productWiseFBAData.fbaData)) {
            productWiseFBAData.fbaData.forEach(fbaItem => {
                if (fbaItem.fnsku) {
                    const fnsku = fbaItem.fnsku.trim();
                    // Only add if not already found in ledger data
                    if (!fnskuToEstimatedFeesMap.has(fnsku) || fnskuToEstimatedFeesMap.get(fnsku) === 0) {
                        // Get estimated fee total from ProductWiseFBAData
                        if (fbaItem['estimated-fee-total']) {
                            const estimatedFees = parseFloat(fbaItem['estimated-fee-total'].toString().replace(/[^0-9.-]/g, '')) || 0;
                            if (estimatedFees > 0) {
                                fnskuToEstimatedFeesMap.set(fnsku, estimatedFees);
                            }
                        }
                    }
                }
            });
        }

        // Create a map of SKU to price for quick lookup
        const skuToPriceMap = new Map();
        sellerAccount.products.forEach(product => {
            if (product.sku && product.price) {
                // Parse price - remove any non-numeric characters except decimal point
                const price = parseFloat(product.price.toString().replace(/[^0-9.]/g, '')) || 0;
                skuToPriceMap.set(product.sku.trim(), price);
            }
        });

        // 4. Calculate discrepancy and reimbursement for each product
        const calculations = [];
        let totalDiscrepancy = 0;
        let totalReimbursement = 0;

        shipmentData.shipmentData.forEach(shipment => {
            if (!shipment.itemDetails || shipment.itemDetails.length === 0) {
                return;
            }

            shipment.itemDetails.forEach(item => {
                const sellerSKU = item.SellerSKU ? item.SellerSKU.trim() : '';
                const fnsku = item.FulfillmentNetworkSKU ? item.FulfillmentNetworkSKU.trim() : '';
                const quantityShipped = parseInt(item.QuantityShipped) || 0;
                const quantityReceived = parseInt(item.QuantityReceived) || 0;

                // Calculate shipment discrepancy
                const discrepancy = quantityShipped - quantityReceived;

                // Get product price from seller model
                const productPrice = skuToPriceMap.get(sellerSKU) || 0;

                // Get estimated fees from ledger summary view using fnsku
                const estimatedFees = fnskuToEstimatedFeesMap.get(fnsku) || 0;

                // Calculate actual amount = product price - estimated fees
                const actualAmount = productPrice - estimatedFees;

                // Calculate reimbursement amount = actual amount × discrepancy
                const reimbursementAmount = actualAmount * discrepancy;

                // Only include items with discrepancy (discrepancy > 0)
                if (discrepancy > 0) {
                    calculations.push({
                        date: extractDateFromShipmentName(shipment.shipmentName),
                        shipmentId: shipment.shipmentId || '',
                        shipmentName: shipment.shipmentName || '',
                        sellerSKU: sellerSKU,
                        fnsku: fnsku,
                        quantityShipped: quantityShipped,
                        quantityReceived: quantityReceived,
                        discrepancy: discrepancy,
                        productPrice: parseFloat(productPrice.toFixed(2)),
                        estimatedFees: parseFloat(estimatedFees.toFixed(2)),
                        actualAmount: parseFloat(actualAmount.toFixed(2)),
                        reimbursementAmount: parseFloat(reimbursementAmount.toFixed(2))
                    });

                    totalDiscrepancy += discrepancy;
                    totalReimbursement += reimbursementAmount;
                }
            });
        });

        // Round total reimbursement to 2 decimal places
        totalReimbursement = parseFloat(totalReimbursement.toFixed(2));

        return {
            success: true,
            message: "Shipment discrepancy calculation completed successfully",
            data: calculations,
            totalDiscrepancy: totalDiscrepancy,
            totalReimbursement: totalReimbursement,
            summary: {
                totalItemsWithDiscrepancy: calculations.length,
                totalDiscrepancy: totalDiscrepancy,
                totalReimbursement: totalReimbursement
            }
        };

    } catch (error) {
        logger.error(`Error calculating shipment discrepancy: ${error.message}`);
        return {
            success: false,
            message: `Error calculating shipment discrepancy: ${error.message}`,
            data: [],
            totalDiscrepancy: 0,
            totalReimbursement: 0
        };
    }
};

/**
 * Calculate lost inventory reimbursement amounts
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} JSON object with lost inventory reimbursement calculations
 */
const calculateLostInventoryReimbursement = async (userId, country, region) => {
    try {
        // 1. Get ledger summary data to get lost and found units
        const ledgerData = await LedgerSummaryView.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!ledgerData || !ledgerData.data || ledgerData.data.length === 0) {
            logger.info(`No ledger data found for userId: ${userId}, country: ${country}, region: ${region}`);
            return {
                success: true,
                message: "No ledger data found",
                data: [],
                totalLostUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // 2. Get seller product data to get prices
        const sellerData = await Seller.findOne({ User: userId });

        if (!sellerData || !sellerData.sellerAccount || sellerData.sellerAccount.length === 0) {
            logger.warn(`No seller data found for userId: ${userId}`);
            return {
                success: false,
                message: "No seller product data found",
                data: [],
                totalLostUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // Find the seller account matching country and region
        const sellerAccount = sellerData.sellerAccount.find(
            account => account.country === country && account.region === region
        );

        if (!sellerAccount || !sellerAccount.products || sellerAccount.products.length === 0) {
            logger.warn(`No products found for userId: ${userId}, country: ${country}, region: ${region}`);
            return {
                success: false,
                message: "No products found for the specified country and region",
                data: [],
                totalLostUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // 3. Get estimated fees from ProductWiseFBAData model
        const productWiseFBAData = await ProductWiseFBAData.findOne({
            userId: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        // Create maps for quick lookup
        const asinToPriceMap = new Map();
        const asinToEstimatedFeesMap = new Map();
        const fnskuToEstimatedFeesMap = new Map();

        // Map ASIN to price from seller products
        sellerAccount.products.forEach(product => {
            if (product.asin && product.price) {
                const asin = product.asin.trim();
                const price = parseFloat(product.price.toString().replace(/[^0-9.]/g, '')) || 0;
                asinToPriceMap.set(asin, price);
            }
        });

        // Map fnsku and asin to estimated fees from ProductWiseFBAData
        if (productWiseFBAData && productWiseFBAData.fbaData && Array.isArray(productWiseFBAData.fbaData)) {
            productWiseFBAData.fbaData.forEach(fbaItem => {
                if (fbaItem['estimated-fee-total']) {
                    const estimatedFees = parseFloat(fbaItem['estimated-fee-total'].toString().replace(/[^0-9.-]/g, '')) || 0;
                    
                    // Map by fnsku
                    if (fbaItem.fnsku) {
                        const fnsku = fbaItem.fnsku.trim();
                        if (!fnskuToEstimatedFeesMap.has(fnsku) || estimatedFees > fnskuToEstimatedFeesMap.get(fnsku)) {
                            fnskuToEstimatedFeesMap.set(fnsku, estimatedFees);
                        }
                    }
                    
                    // Map by asin
                    if (fbaItem.asin) {
                        const asin = fbaItem.asin.trim();
                        if (!asinToEstimatedFeesMap.has(asin) || estimatedFees > asinToEstimatedFeesMap.get(asin)) {
                            asinToEstimatedFeesMap.set(asin, estimatedFees);
                        }
                    }
                }
            });
        }

        // 4. Aggregate lost and found units by ASIN from ledger data
        const asinLostFoundMap = new Map(); // Map<asin, {lost: number, found: number, fnsku: string, title: string}>

        ledgerData.data.forEach(ledgerItem => {
            if (!ledgerItem.asin) return;

            const asin = ledgerItem.asin.trim();
            const lost = parseFloat(ledgerItem.lost?.toString().replace(/[^0-9.-]/g, '') || '0') || 0;
            const found = parseFloat(ledgerItem.found?.toString().replace(/[^0-9.-]/g, '') || '0') || 0;

            if (asinLostFoundMap.has(asin)) {
                const existing = asinLostFoundMap.get(asin);
                existing.lost += lost;
                existing.found += found;
            } else {
                asinLostFoundMap.set(asin, {
                    lost: lost,
                    found: found,
                    fnsku: ledgerItem.fnsku?.trim() || '',
                    title: ledgerItem.title || ''
                });
            }
        });

        // 5. Calculate lost inventory reimbursement for each product
        const calculations = [];
        let totalLostUnits = 0;
        let totalExpectedAmount = 0;

        asinLostFoundMap.forEach((lostFoundData, asin) => {
            // Step 1: Calculate lost units = Lost - Found
            const lostUnits = lostFoundData.lost - lostFoundData.found;

            // Only process if there are lost units (lostUnits > 0)
            if (lostUnits > 0) {
                // Get sales price from seller model
                const salesPrice = asinToPriceMap.get(asin) || 0;

                // Get estimated fees - try fnsku first, then asin
                let estimatedFees = 0;
                if (lostFoundData.fnsku) {
                    estimatedFees = fnskuToEstimatedFeesMap.get(lostFoundData.fnsku) || 0;
                }
                if (estimatedFees === 0) {
                    estimatedFees = asinToEstimatedFeesMap.get(asin) || 0;
                }

                // Step 2: Calculate reimbursement per unit = Sales Price - Estimated Fees
                const reimbursementPerUnit = salesPrice - estimatedFees;

                // Step 3: Calculate expected amount = Lost Units × Reimbursement Per Unit
                const expectedAmount = lostUnits * reimbursementPerUnit;

                calculations.push({
                    asin: asin,
                    fnsku: lostFoundData.fnsku,
                    title: lostFoundData.title,
                    lost: lostFoundData.lost,
                    found: lostFoundData.found,
                    lostUnits: lostUnits,
                    salesPrice: parseFloat(salesPrice.toFixed(2)),
                    estimatedFees: parseFloat(estimatedFees.toFixed(2)),
                    reimbursementPerUnit: parseFloat(reimbursementPerUnit.toFixed(2)),
                    expectedAmount: parseFloat(expectedAmount.toFixed(2))
                });

                totalLostUnits += lostUnits;
                totalExpectedAmount += expectedAmount;
            }
        });

        // Round totals to 2 decimal places
        totalExpectedAmount = parseFloat(totalExpectedAmount.toFixed(2));

        return {
            success: true,
            message: "Lost inventory reimbursement calculation completed successfully",
            data: calculations,
            totalLostUnits: totalLostUnits,
            totalExpectedAmount: totalExpectedAmount,
            summary: {
                totalProductsWithLostInventory: calculations.length,
                totalLostUnits: totalLostUnits,
                totalExpectedAmount: totalExpectedAmount
            }
        };

    } catch (error) {
        logger.error(`Error calculating lost inventory reimbursement: ${error.message}`);
        return {
            success: false,
            message: `Error calculating lost inventory reimbursement: ${error.message}`,
            data: [],
            totalLostUnits: 0,
            totalExpectedAmount: 0
        };
    }
};

/**
 * Calculate damaged inventory reimbursement amounts
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} JSON object with damaged inventory reimbursement calculations
 */
const calculateDamagedInventoryReimbursement = async (userId, country, region) => {
    try {
        // 1. Get ledger summary data to get damaged units
        const ledgerData = await LedgerSummaryView.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!ledgerData || !ledgerData.data || ledgerData.data.length === 0) {
            logger.info(`No ledger data found for userId: ${userId}, country: ${country}, region: ${region}`);
            return {
                success: true,
                message: "No ledger data found",
                data: [],
                totalDamagedUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // 2. Get seller product data to get prices
        const sellerData = await Seller.findOne({ User: userId });

        if (!sellerData || !sellerData.sellerAccount || sellerData.sellerAccount.length === 0) {
            logger.warn(`No seller data found for userId: ${userId}`);
            return {
                success: false,
                message: "No seller product data found",
                data: [],
                totalDamagedUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // Find the seller account matching country and region
        const sellerAccount = sellerData.sellerAccount.find(
            account => account.country === country && account.region === region
        );

        if (!sellerAccount || !sellerAccount.products || sellerAccount.products.length === 0) {
            logger.warn(`No products found for userId: ${userId}, country: ${country}, region: ${region}`);
            return {
                success: false,
                message: "No products found for the specified country and region",
                data: [],
                totalDamagedUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // 3. Get estimated fees from ProductWiseFBAData model
        const productWiseFBAData = await ProductWiseFBAData.findOne({
            userId: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        // Create maps for quick lookup
        const asinToPriceMap = new Map();
        const asinToEstimatedFeesMap = new Map();
        const fnskuToEstimatedFeesMap = new Map();

        // Map ASIN to price from seller products
        sellerAccount.products.forEach(product => {
            if (product.asin && product.price) {
                const asin = product.asin.trim();
                const price = parseFloat(product.price.toString().replace(/[^0-9.]/g, '')) || 0;
                asinToPriceMap.set(asin, price);
            }
        });

        // Map fnsku and asin to estimated fees from ProductWiseFBAData
        if (productWiseFBAData && productWiseFBAData.fbaData && Array.isArray(productWiseFBAData.fbaData)) {
            productWiseFBAData.fbaData.forEach(fbaItem => {
                if (fbaItem['estimated-fee-total']) {
                    const estimatedFees = parseFloat(fbaItem['estimated-fee-total'].toString().replace(/[^0-9.-]/g, '')) || 0;
                    
                    // Map by fnsku
                    if (fbaItem.fnsku) {
                        const fnsku = fbaItem.fnsku.trim();
                        if (!fnskuToEstimatedFeesMap.has(fnsku) || estimatedFees > fnskuToEstimatedFeesMap.get(fnsku)) {
                            fnskuToEstimatedFeesMap.set(fnsku, estimatedFees);
                        }
                    }
                    
                    // Map by asin
                    if (fbaItem.asin) {
                        const asin = fbaItem.asin.trim();
                        if (!asinToEstimatedFeesMap.has(asin) || estimatedFees > asinToEstimatedFeesMap.get(asin)) {
                            asinToEstimatedFeesMap.set(asin, estimatedFees);
                        }
                    }
                }
            });
        }

        // 4. Aggregate damaged units by ASIN from ledger data
        const asinDamagedMap = new Map(); // Map<asin, {damaged: number, fnsku: string, title: string}>

        ledgerData.data.forEach(ledgerItem => {
            if (!ledgerItem.asin) return;

            const asin = ledgerItem.asin.trim();
            const damaged = parseFloat(ledgerItem.damaged?.toString().replace(/[^0-9.-]/g, '') || '0') || 0;

            if (damaged > 0) {
                if (asinDamagedMap.has(asin)) {
                    const existing = asinDamagedMap.get(asin);
                    existing.damaged += damaged;
                } else {
                    asinDamagedMap.set(asin, {
                        damaged: damaged,
                        fnsku: ledgerItem.fnsku?.trim() || '',
                        title: ledgerItem.title || ''
                    });
                }
            }
        });

        // 5. Calculate damaged inventory reimbursement for each product
        const calculations = [];
        let totalDamagedUnits = 0;
        let totalExpectedAmount = 0;

        asinDamagedMap.forEach((damagedData, asin) => {
            // Step 1: Get damaged units = damaged (from ledger summary view model)
            const damagedUnits = damagedData.damaged;

            // Only process if there are damaged units (damagedUnits > 0)
            if (damagedUnits > 0) {
                // Get sales price from seller model
                const salesPrice = asinToPriceMap.get(asin) || 0;

                // Get estimated fees - try fnsku first, then asin
                let estimatedFees = 0;
                if (damagedData.fnsku) {
                    estimatedFees = fnskuToEstimatedFeesMap.get(damagedData.fnsku) || 0;
                }
                if (estimatedFees === 0) {
                    estimatedFees = asinToEstimatedFeesMap.get(asin) || 0;
                }

                // Step 2: Calculate reimbursement per unit = Sales Price - Estimated Fees
                const reimbursementPerUnit = salesPrice - estimatedFees;

                // Step 3: Calculate expected amount = Damaged Units × Reimbursement Per Unit
                const expectedAmount = damagedUnits * reimbursementPerUnit;

                calculations.push({
                    asin: asin,
                    fnsku: damagedData.fnsku,
                    title: damagedData.title,
                    damagedUnits: damagedUnits,
                    salesPrice: parseFloat(salesPrice.toFixed(2)),
                    estimatedFees: parseFloat(estimatedFees.toFixed(2)),
                    reimbursementPerUnit: parseFloat(reimbursementPerUnit.toFixed(2)),
                    expectedAmount: parseFloat(expectedAmount.toFixed(2))
                });

                totalDamagedUnits += damagedUnits;
                totalExpectedAmount += expectedAmount;
            }
        });

        // Round totals to 2 decimal places
        totalExpectedAmount = parseFloat(totalExpectedAmount.toFixed(2));

        return {
            success: true,
            message: "Damaged inventory reimbursement calculation completed successfully",
            data: calculations,
            totalDamagedUnits: totalDamagedUnits,
            totalExpectedAmount: totalExpectedAmount,
            summary: {
                totalProductsWithDamagedInventory: calculations.length,
                totalDamagedUnits: totalDamagedUnits,
                totalExpectedAmount: totalExpectedAmount
            }
        };

    } catch (error) {
        logger.error(`Error calculating damaged inventory reimbursement: ${error.message}`);
        return {
            success: false,
            message: `Error calculating damaged inventory reimbursement: ${error.message}`,
            data: [],
            totalDamagedUnits: 0,
            totalExpectedAmount: 0
        };
    }
};

/**
 * Calculate disposed inventory reimbursement amounts
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} JSON object with disposed inventory reimbursement calculations
 */
const calculateDisposedInventoryReimbursement = async (userId, country, region) => {
    try {
        // 1. Get ledger summary data to get disposed units
        const ledgerData = await LedgerSummaryView.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!ledgerData || !ledgerData.data || ledgerData.data.length === 0) {
            logger.info(`No ledger data found for userId: ${userId}, country: ${country}, region: ${region}`);
            return {
                success: true,
                message: "No ledger data found",
                data: [],
                totalDisposedUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // 2. Get seller product data to get prices
        const sellerData = await Seller.findOne({ User: userId });

        if (!sellerData || !sellerData.sellerAccount || sellerData.sellerAccount.length === 0) {
            logger.warn(`No seller data found for userId: ${userId}`);
            return {
                success: false,
                message: "No seller product data found",
                data: [],
                totalDisposedUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // Find the seller account matching country and region
        const sellerAccount = sellerData.sellerAccount.find(
            account => account.country === country && account.region === region
        );

        if (!sellerAccount || !sellerAccount.products || sellerAccount.products.length === 0) {
            logger.warn(`No products found for userId: ${userId}, country: ${country}, region: ${region}`);
            return {
                success: false,
                message: "No products found for the specified country and region",
                data: [],
                totalDisposedUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // 3. Get estimated fees from ProductWiseFBAData model
        const productWiseFBAData = await ProductWiseFBAData.findOne({
            userId: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        // Create maps for quick lookup
        const asinToPriceMap = new Map();
        const asinToEstimatedFeesMap = new Map();
        const fnskuToEstimatedFeesMap = new Map();

        // Map ASIN to price from seller products
        sellerAccount.products.forEach(product => {
            if (product.asin && product.price) {
                const asin = product.asin.trim();
                const price = parseFloat(product.price.toString().replace(/[^0-9.]/g, '')) || 0;
                asinToPriceMap.set(asin, price);
            }
        });

        // Map fnsku and asin to estimated fees from ProductWiseFBAData
        if (productWiseFBAData && productWiseFBAData.fbaData && Array.isArray(productWiseFBAData.fbaData)) {
            productWiseFBAData.fbaData.forEach(fbaItem => {
                if (fbaItem['estimated-fee-total']) {
                    const estimatedFees = parseFloat(fbaItem['estimated-fee-total'].toString().replace(/[^0-9.-]/g, '')) || 0;
                    
                    // Map by fnsku
                    if (fbaItem.fnsku) {
                        const fnsku = fbaItem.fnsku.trim();
                        if (!fnskuToEstimatedFeesMap.has(fnsku) || estimatedFees > fnskuToEstimatedFeesMap.get(fnsku)) {
                            fnskuToEstimatedFeesMap.set(fnsku, estimatedFees);
                        }
                    }
                    
                    // Map by asin
                    if (fbaItem.asin) {
                        const asin = fbaItem.asin.trim();
                        if (!asinToEstimatedFeesMap.has(asin) || estimatedFees > asinToEstimatedFeesMap.get(asin)) {
                            asinToEstimatedFeesMap.set(asin, estimatedFees);
                        }
                    }
                }
            });
        }

        // 4. Aggregate disposed units by ASIN from ledger data
        const asinDisposedMap = new Map(); // Map<asin, {disposed: number, fnsku: string, title: string}>

        ledgerData.data.forEach(ledgerItem => {
            if (!ledgerItem.asin) return;

            const asin = ledgerItem.asin.trim();
            const disposed = parseFloat(ledgerItem.disposed?.toString().replace(/[^0-9.-]/g, '') || '0') || 0;

            if (disposed > 0) {
                if (asinDisposedMap.has(asin)) {
                    const existing = asinDisposedMap.get(asin);
                    existing.disposed += disposed;
                } else {
                    asinDisposedMap.set(asin, {
                        disposed: disposed,
                        fnsku: ledgerItem.fnsku?.trim() || '',
                        title: ledgerItem.title || ''
                    });
                }
            }
        });

        // 5. Calculate disposed inventory reimbursement for each product
        const calculations = [];
        let totalDisposedUnits = 0;
        let totalExpectedAmount = 0;

        asinDisposedMap.forEach((disposedData, asin) => {
            // Step 1: Get disposed units = disposed (from ledger summary view model)
            const disposedUnits = disposedData.disposed;

            // Only process if there are disposed units (disposedUnits > 0)
            if (disposedUnits > 0) {
                // Get sales price from seller model
                const salesPrice = asinToPriceMap.get(asin) || 0;

                // Get estimated fees - try fnsku first, then asin
                let estimatedFees = 0;
                if (disposedData.fnsku) {
                    estimatedFees = fnskuToEstimatedFeesMap.get(disposedData.fnsku) || 0;
                }
                if (estimatedFees === 0) {
                    estimatedFees = asinToEstimatedFeesMap.get(asin) || 0;
                }

                // Step 2: Calculate reimbursement per unit = Sales Price - Estimated Fees
                const reimbursementPerUnit = salesPrice - estimatedFees;

                // Step 3: Calculate expected amount = Disposed Units × Reimbursement Per Unit
                const expectedAmount = disposedUnits * reimbursementPerUnit;

                calculations.push({
                    asin: asin,
                    fnsku: disposedData.fnsku,
                    title: disposedData.title,
                    disposedUnits: disposedUnits,
                    salesPrice: parseFloat(salesPrice.toFixed(2)),
                    estimatedFees: parseFloat(estimatedFees.toFixed(2)),
                    reimbursementPerUnit: parseFloat(reimbursementPerUnit.toFixed(2)),
                    expectedAmount: parseFloat(expectedAmount.toFixed(2))
                });

                totalDisposedUnits += disposedUnits;
                totalExpectedAmount += expectedAmount;
            }
        });

        // Round totals to 2 decimal places
        totalExpectedAmount = parseFloat(totalExpectedAmount.toFixed(2));

        return {
            success: true,
            message: "Disposed inventory reimbursement calculation completed successfully",
            data: calculations,
            totalDisposedUnits: totalDisposedUnits,
            totalExpectedAmount: totalExpectedAmount,
            summary: {
                totalProductsWithDisposedInventory: calculations.length,
                totalDisposedUnits: totalDisposedUnits,
                totalExpectedAmount: totalExpectedAmount
            }
        };

    } catch (error) {
        logger.error(`Error calculating disposed inventory reimbursement: ${error.message}`);
        return {
            success: false,
            message: `Error calculating disposed inventory reimbursement: ${error.message}`,
            data: [],
            totalDisposedUnits: 0,
            totalExpectedAmount: 0
        };
    }
};

/**
 * Helper function to convert dimensions and weight to required units
 * @param {string} value - The dimension or weight value
 * @param {string} unit - The unit (e.g., "inches", "cm", "lbs", "kg", "grams")
 * @param {string} type - "dimension" or "weight"
 * @returns {number} Converted value in cm (for dimensions) or grams (for weight)
 */
const convertToRequiredUnits = (value, unit, type) => {
    if (!value || isNaN(parseFloat(value))) return 0;
    
    const numValue = parseFloat(value);
    const unitLower = (unit || '').toLowerCase().trim();
    
    if (type === 'dimension') {
        // Convert to cm
        if (unitLower === 'inches' || unitLower === 'inch' || unitLower === 'in') {
            return numValue * 2.54; // inches to cm
        } else if (unitLower === 'cm' || unitLower === 'centimeters' || unitLower === 'centimetre') {
            return numValue;
        } else if (unitLower === 'm' || unitLower === 'meters' || unitLower === 'metres') {
            return numValue * 100; // meters to cm
        } else {
            // Default assume cm if no unit specified
            return numValue;
        }
    } else if (type === 'weight') {
        // Convert to grams
        if (unitLower === 'lbs' || unitLower === 'pounds' || unitLower === 'lb') {
            return numValue * 453.592; // lbs to grams
        } else if (unitLower === 'kg' || unitLower === 'kilograms' || unitLower === 'kilogram') {
            return numValue * 1000; // kg to grams
        } else if (unitLower === 'oz' || unitLower === 'ounces' || unitLower === 'ounce') {
            return numValue * 28.3495; // oz to grams
        } else if (unitLower === 'grams' || unitLower === 'gram' || unitLower === 'g') {
            return numValue;
        } else {
            // Default assume grams if no unit specified
            return numValue;
        }
    }
    
    return 0;
};

/**
 * Map region code to calculateFees region format
 * @param {string} region - Region code (NA, EU, FE, etc.)
 * @returns {string} Region code for calculateFees ("US" or "AU")
 */
const mapRegionForFees = (region) => {
    const regionUpper = (region || '').toUpperCase();
    // Map common regions - adjust based on your actual region codes
    if (regionUpper === 'NA' || regionUpper === 'US' || regionUpper === 'USA') {
        return 'US';
    } else if (regionUpper === 'AU' || regionUpper === 'AUS' || regionUpper === 'AUSTRALIA') {
        return 'AU';
    } else {
        // Default to US for other regions (EU, FE, etc.)
        return 'US';
    }
};

/**
 * Calculate fee reimbursement amounts
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} JSON object with fee reimbursement calculations
 */
const calculateFeeReimbursement = async (userId, country, region) => {
    try {
        // 1. Get product wise FBA data
        const productWiseFBAData = await ProductWiseFBAData.findOne({
            userId: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        if (!productWiseFBAData || !productWiseFBAData.fbaData || productWiseFBAData.fbaData.length === 0) {
            logger.info(`No product wise FBA data found for userId: ${userId}, country: ${country}, region: ${region}`);
            return {
                success: true,
                message: "No product wise FBA data found",
                data: [],
                totalFeeDifference: 0,
                totalExpectedAmount: 0
            };
        }

        // 2. Get product wise sales data to get units sold
        const productWiseSalesData = await ProductWiseSales.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        // Create a map of ASIN to total quantity sold
        const asinToUnitsSoldMap = new Map();
        if (productWiseSalesData && productWiseSalesData.productWiseSales && Array.isArray(productWiseSalesData.productWiseSales)) {
            productWiseSalesData.productWiseSales.forEach(sale => {
                if (sale.asin) {
                    const asin = sale.asin.trim();
                    const quantity = parseInt(sale.quantity) || 0;
                    
                    if (asinToUnitsSoldMap.has(asin)) {
                        asinToUnitsSoldMap.set(asin, asinToUnitsSoldMap.get(asin) + quantity);
                    } else {
                        asinToUnitsSoldMap.set(asin, quantity);
                    }
                }
            });
        }

        // 3. Map region for calculateFees function
        const feesRegion = mapRegionForFees(region);

        // 4. Calculate fee reimbursement for each product
        const calculations = [];
        let totalFeeDifference = 0;
        let totalExpectedAmount = 0;

        productWiseFBAData.fbaData.forEach(fbaItem => {
            if (!fbaItem.asin) return;

            const asin = fbaItem.asin.trim();
            
            // Get charged fees (estimated-fee-total)
            const chargedFees = parseFloat(fbaItem['estimated-fee-total']?.toString().replace(/[^0-9.-]/g, '') || '0') || 0;

            // Get dimensions and weight
            const longestSide = fbaItem['longest-side'] || '';
            const medianSide = fbaItem['median-side'] || '';
            const shortestSide = fbaItem['shortest-side'] || '';
            const itemPackageWeight = fbaItem['item-package-weight'] || '';
            const unitOfDimension = fbaItem['unit-of-dimension'] || '';
            const unitOfWeight = fbaItem['unit-of-weight'] || '';
            const productGroup = fbaItem['product-group'] || '';

            // Convert dimensions to cm
            const longestCm = convertToRequiredUnits(longestSide, unitOfDimension, 'dimension');
            const medianCm = convertToRequiredUnits(medianSide, unitOfDimension, 'dimension');
            const shortestCm = convertToRequiredUnits(shortestSide, unitOfDimension, 'dimension');

            // Convert weight to grams
            const weightGrams = convertToRequiredUnits(itemPackageWeight, unitOfWeight, 'weight');

            // Only process if we have required data
            if (longestCm > 0 && medianCm > 0 && shortestCm > 0 && weightGrams > 0) {
                // Step 1: Calculate actual fees using ActualFeesCalculations
                const actualFees = calculateFees(feesRegion, longestCm, medianCm, shortestCm, weightGrams, productGroup);

                // Step 2: Calculate fee difference = Charged Fee - Actual Fee
                const feeDifference = chargedFees - actualFees;

                // Step 3: Get units sold for this ASIN
                const unitsSold = asinToUnitsSoldMap.get(asin) || 0;

                // Step 4: Calculate expected amount = Fee Difference × Units Sold
                const expectedAmount = feeDifference * unitsSold;

                // Only include products with fee difference (overcharged)
                if (feeDifference > 0 && unitsSold > 0) {
                    calculations.push({
                        asin: asin,
                        fnsku: fbaItem.fnsku || '',
                        productName: fbaItem['product-name'] || '',
                        productGroup: productGroup,
                        longestSide: longestSide,
                        medianSide: medianSide,
                        shortestSide: shortestSide,
                        itemPackageWeight: itemPackageWeight,
                        unitOfDimension: unitOfDimension,
                        unitOfWeight: unitOfWeight,
                        chargedFees: parseFloat(chargedFees.toFixed(2)),
                        actualFees: parseFloat(actualFees.toFixed(2)),
                        feeDifference: parseFloat(feeDifference.toFixed(2)),
                        unitsSold: unitsSold,
                        expectedAmount: parseFloat(expectedAmount.toFixed(2))
                    });

                    totalFeeDifference += feeDifference;
                    totalExpectedAmount += expectedAmount;
                }
            }
        });

        // Round totals to 2 decimal places
        totalFeeDifference = parseFloat(totalFeeDifference.toFixed(2));
        totalExpectedAmount = parseFloat(totalExpectedAmount.toFixed(2));

        return {
            success: true,
            message: "Fee reimbursement calculation completed successfully",
            data: calculations,
            totalFeeDifference: totalFeeDifference,
            totalExpectedAmount: totalExpectedAmount,
            summary: {
                totalProductsWithFeeOvercharge: calculations.length,
                totalFeeDifference: totalFeeDifference,
                totalUnitsSold: calculations.reduce((sum, item) => sum + item.unitsSold, 0),
                totalExpectedAmount: totalExpectedAmount
            }
        };

    } catch (error) {
        logger.error(`Error calculating fee reimbursement: ${error.message}`);
        return {
            success: false,
            message: `Error calculating fee reimbursement: ${error.message}`,
            data: [],
            totalFeeDifference: 0,
            totalExpectedAmount: 0
        };
    }
};

module.exports = {
    calculateShipmentDiscrepancy,
    calculateLostInventoryReimbursement,
    calculateDamagedInventoryReimbursement,
    calculateDisposedInventoryReimbursement,
    calculateFeeReimbursement
};

