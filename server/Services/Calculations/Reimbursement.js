const ShipmentModel = require('../../models/inventory/ShipmentModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
// Use service layer for LedgerSummaryView (handles both old and new formats)
const { getLedgerSummaryViewData } = require('../Finance/LedgerSummaryViewService.js');
const LedgerDetailView = require('../../models/finance/LedgerDetailViewModel.js');
const FBAReimbursements = require('../../models/finance/FBAReimbursementsModel.js');
// Use service layer to get ProductWiseFBAData (handles both old and new formats)
const { getProductWiseFBAData } = require('../inventory/ProductWiseFBADataService.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const { calculateFees } = require('./ActualFeesCalculations.js');
const logger = require('../../utils/Logger.js');

// Chunk size for yielding to event loop during large data processing
const YIELD_CHUNK_SIZE = 500;

/**
 * Yield to event loop to allow timers (like lock extension) to fire.
 * Critical for preventing job stalling during large data processing.
 * @returns {Promise<void>}
 */
async function yieldToEventLoop() {
    return new Promise(resolve => setImmediate(resolve));
}

/**
 * Reimbursement Calculation Service
 * 
 * Implements inventory calculations matching the Refunds system specification:
 * 
 * 1. Lost Inventory:
 *    - Uses GET_LEDGER_SUMMARY_VIEW_DATA for Lost/Found units
 *    - Uses GET_FBA_REIMBURSEMENTS_DATA for ReimbursedUnits (reason = "lost_warehouse")
 *    - Formula: DiscrepancyUnits = LostUnits - FoundUnits - ReimbursedUnits
 * 
 * 2. Damaged Inventory:
 *    - Uses GET_LEDGER_DETAIL_VIEW_DATA
 *    - Filters by Reason codes: "6", "7", "E", "H", "K", "U"
 *    - Uses Unreconciled Quantity field
 *    - Tracks by Reference ID for unique incidents
 * 
 * 3. Disposed Inventory:
 *    - Uses GET_LEDGER_DETAIL_VIEW_DATA
 *    - Filters by Reason code: "D"
 *    - Filters by Disposition: "SELLABLE", "WAREHOUSE_DAMAGED", "EXPIRED"
 *    - Uses Quantity field (absolute value)
 *    - Tracks by Reference ID for unique incidents
 * 
 * All calculations use: ExpectedAmount = DiscrepancyUnits × (SalesPrice - EstimatedFeesTotal)
 */

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
        // Uses service layer that handles both old (embedded array) and new (separate collection) formats
        const ledgerData = await getLedgerSummaryViewData(userId, country, region);

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
        // Uses service layer that handles both old (embedded array) and new (separate collection) formats
        const productWiseFBAData = await getProductWiseFBAData(userId, country, region);

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

                // Only include items with discrepancy > 0 AND reimbursementAmount > 0
                // Refunds system only saves records with ExpectedAmount >= 0
                if (discrepancy > 0 && reimbursementAmount > 0) {
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
 * 
 * IMPLEMENTATION MATCHING REFUNDS SYSTEM:
 * - Report 1: GET_LEDGER_SUMMARY_VIEW_DATA - provides LostUnits and FoundUnits
 * - Report 2: GET_FBA_REIMBURSEMENTS_DATA - provides ReimbursedUnits (reason = "lost_warehouse")
 * - Formula: DiscrepancyUnits = LostUnits - FoundUnits - ReimbursedUnits
 * - ExpectedAmount = DiscrepancyUnits × (SalesPrice - EstimatedFeesTotal)
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} JSON object with lost inventory reimbursement calculations
 */
const calculateLostInventoryReimbursement = async (userId, country, region) => {
    try {
        // 1. Get ledger summary data to get lost and found units (Report 1)
        // Uses service layer that handles both old (embedded array) and new (separate collection) formats
        const ledgerData = await getLedgerSummaryViewData(userId, country, region);

        if (!ledgerData || !ledgerData.data || ledgerData.data.length === 0) {
            logger.info(`[Lost Inventory] No ledger summary data found for userId: ${userId}, country: ${country}, region: ${region}`);
            return {
                success: true,
                message: "No ledger data found",
                data: [],
                totalLostUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // Log sample data structure to verify date field exists
        if (ledgerData.data.length > 0) {
            const sampleItem = ledgerData.data[0];
            logger.info(`[Lost Inventory] Sample ledger item keys: ${Object.keys(sampleItem).join(', ')}`);
            logger.info(`[Lost Inventory] Sample ledger item date field: ${sampleItem.date || 'NOT FOUND'}`);
            logger.info(`[Lost Inventory] Sample ledger item (first 3 fields): ${JSON.stringify({
                date: sampleItem.date,
                asin: sampleItem.asin,
                lost: sampleItem.lost,
                found: sampleItem.found
            })}`);
        }

        // 2. Get FBA reimbursements data (Report 2) - for already reimbursed units
        const fbaReimbursementsData = await FBAReimbursements.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        // 3. Get seller product data to get prices
        const sellerData = await Seller.findOne({ User: userId });

        if (!sellerData || !sellerData.sellerAccount || sellerData.sellerAccount.length === 0) {
            logger.warn(`[Lost Inventory] No seller data found for userId: ${userId}`);
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
            logger.warn(`[Lost Inventory] No products found for userId: ${userId}, country: ${country}, region: ${region}`);
            return {
                success: false,
                message: "No products found for the specified country and region",
                data: [],
                totalLostUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // 4. Get estimated fees from ProductWiseFBAData model
        // Uses service layer that handles both old (embedded array) and new (separate collection) formats
        const productWiseFBAData = await getProductWiseFBAData(userId, country, region);

        // Create maps for quick lookup
        const asinToPriceMap = new Map();
        const asinToEstimatedFeesMap = new Map();
        const fnskuToEstimatedFeesMap = new Map();
        const asinToReimbursedUnitsMap = new Map(); // Track already reimbursed units by ASIN

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

        // 5. Aggregate reimbursed units by ASIN from FBA Reimbursements data
        // Filter for reason = "lost_warehouse" as per Refunds system specification
        if (fbaReimbursementsData && fbaReimbursementsData.data && Array.isArray(fbaReimbursementsData.data)) {
            fbaReimbursementsData.data.forEach(reimbursementItem => {
                // Only count reimbursements with reason "lost_warehouse"
                const reason = (reimbursementItem.reason || '').toLowerCase().trim();
                if (reason === 'lost_warehouse') {
                    const asin = reimbursementItem.asin?.trim();
                    if (asin) {
                        const reimbursedQty = parseFloat(reimbursementItem.quantity_reimbursed_total?.toString().replace(/[^0-9.-]/g, '') || '0') || 0;
                        
                        if (asinToReimbursedUnitsMap.has(asin)) {
                            asinToReimbursedUnitsMap.set(asin, asinToReimbursedUnitsMap.get(asin) + reimbursedQty);
                        } else {
                            asinToReimbursedUnitsMap.set(asin, reimbursedQty);
                        }
                    }
                }
            });
        }

        /**
         * Compare two dates in MM/YYYY format
         * Returns 1 if date1 > date2, -1 if date1 < date2, 0 if equal
         * Example: "01/2026" > "12/2025"
         */
        const compareMMYYYYDates = (date1, date2) => {
            if (!date1 && !date2) return 0;
            if (!date1) return -1;
            if (!date2) return 1;
            
            // Parse MM/YYYY format
            const parseDate = (dateStr) => {
                const parts = dateStr.trim().split('/');
                if (parts.length !== 2) return null;
                const month = parseInt(parts[0], 10);
                const year = parseInt(parts[1], 10);
                if (isNaN(month) || isNaN(year)) return null;
                return { year, month };
            };
            
            const d1 = parseDate(date1);
            const d2 = parseDate(date2);
            
            if (!d1 && !d2) return 0;
            if (!d1) return -1;
            if (!d2) return 1;
            
            // Compare year first, then month
            if (d1.year !== d2.year) {
                return d1.year > d2.year ? 1 : -1;
            }
            if (d1.month !== d2.month) {
                return d1.month > d2.month ? 1 : -1;
            }
            return 0;
        };

        // 6. Aggregate lost and found units by ASIN from ledger data
        // Track the most recent date for each ASIN (date is in MM/YYYY format - stored as-is)
        const asinLostFoundMap = new Map(); // Map<asin, {lost: number, found: number, fnsku: string, title: string, latestDate: string}>

        let dateFieldFound = false;
        let dateFieldMissing = 0;
        let dateFieldPresent = 0;

        ledgerData.data.forEach(ledgerItem => {
            if (!ledgerItem.asin) return;

            const asin = ledgerItem.asin.trim();
            // Convert negative lost values to positive (as per Refunds system)
            let lost = parseFloat(ledgerItem.lost?.toString().replace(/[^0-9.-]/g, '') || '0') || 0;
            if (lost < 0) {
                lost = Math.abs(lost);
            }
            const found = parseFloat(ledgerItem.found?.toString().replace(/[^0-9.-]/g, '') || '0') || 0;
            
            // Store date in original MM/YYYY format (no conversion)
            const itemDate = ledgerItem.date?.trim() || null;
            
            // Track date field presence for logging
            if (itemDate) {
                dateFieldPresent++;
                if (!dateFieldFound) {
                    dateFieldFound = true;
                    logger.info(`[Lost Inventory] Date field found in report! Sample date: ${itemDate} (format: MM/YYYY)`);
                }
            } else {
                dateFieldMissing++;
            }

            if (asinLostFoundMap.has(asin)) {
                const existing = asinLostFoundMap.get(asin);
                existing.lost += lost;
                existing.found += found;
                // Update to most recent date (compare MM/YYYY format)
                if (itemDate && (!existing.latestDate || compareMMYYYYDates(itemDate, existing.latestDate) > 0)) {
                    existing.latestDate = itemDate;
                }
            } else {
                asinLostFoundMap.set(asin, {
                    lost: lost,
                    found: found,
                    fnsku: ledgerItem.fnsku?.trim() || '',
                    title: ledgerItem.title || '',
                    latestDate: itemDate || null
                });
            }
        });

        // Log date field statistics
        if (dateFieldFound) {
            logger.info(`[Lost Inventory] Date field statistics: ${dateFieldPresent} items with date, ${dateFieldMissing} items without date`);
        } else {
            logger.warn(`[Lost Inventory] ⚠️ Date field NOT FOUND in report data! All ${dateFieldMissing} items are missing date field.`);
            logger.warn(`[Lost Inventory] This means the date field may not be present in the Amazon report, or the column name is different.`);
        }

        // 7. Calculate lost inventory reimbursement for each product
        const calculations = [];
        let totalLostUnits = 0;
        let totalExpectedAmount = 0;

        asinLostFoundMap.forEach((lostFoundData, asin) => {
            // Get reimbursed units for this ASIN
            const reimbursedUnits = asinToReimbursedUnitsMap.get(asin) || 0;
            
            // CORRECT FORMULA: DiscrepancyUnits = LostUnits - FoundUnits - ReimbursedUnits
            const discrepancyUnits = lostFoundData.lost - lostFoundData.found - reimbursedUnits;

            // Only process if there are discrepancy units (discrepancyUnits > 0)
            if (discrepancyUnits > 0) {
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

                // Calculate reimbursement per unit = Sales Price - Estimated Fees
                const reimbursementPerUnit = salesPrice - estimatedFees;

                // Calculate expected amount = Discrepancy Units × Reimbursement Per Unit
                const expectedAmount = discrepancyUnits * reimbursementPerUnit;

                // Exclude negative or zero expected amounts (as per Refunds system)
                // Refunds system deletes records with ExpectedAmount <= 0
                if (expectedAmount > 0) {
                calculations.push({
                    asin: asin,
                    fnsku: lostFoundData.fnsku,
                    title: lostFoundData.title,
                        date: lostFoundData.latestDate || null, // Most recent date from ledger items (stored in MM/YYYY format)
                        lostUnits: lostFoundData.lost,
                        foundUnits: lostFoundData.found,
                        reimbursedUnits: reimbursedUnits,
                        discrepancyUnits: discrepancyUnits,
                    salesPrice: parseFloat(salesPrice.toFixed(2)),
                    estimatedFees: parseFloat(estimatedFees.toFixed(2)),
                    reimbursementPerUnit: parseFloat(reimbursementPerUnit.toFixed(2)),
                    expectedAmount: parseFloat(expectedAmount.toFixed(2))
                });

                    totalLostUnits += discrepancyUnits;
                totalExpectedAmount += expectedAmount;
                }
            }
        });

        // Round totals to 2 decimal places
        totalExpectedAmount = parseFloat(totalExpectedAmount.toFixed(2));

        logger.info(`[Lost Inventory] Calculation completed: ${calculations.length} products with discrepancy, total units: ${totalLostUnits}, total amount: ${totalExpectedAmount}`);

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
        logger.error(`[Lost Inventory] Error calculating reimbursement: ${error.message}`);
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
 * Damaged inventory reason codes as per Refunds system specification
 */
const DAMAGED_REASON_CODES = ['6', '7', 'E', 'H', 'K', 'U'];

/**
 * Calculate damaged inventory reimbursement amounts
 * 
 * IMPLEMENTATION MATCHING REFUNDS SYSTEM:
 * - Report: GET_LEDGER_DETAIL_VIEW_DATA
 * - Filter by Reason codes: "6", "7", "E", "H", "K", "U"
 * - Uses Unreconciled Quantity field (not regular Quantity)
 * - Tracks by Reference ID for unique incidents
 * - Formula: ExpectedAmount = UnreconciledQuantity × (SalesPrice - EstimatedFeesTotal)
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} JSON object with damaged inventory reimbursement calculations
 */
const calculateDamagedInventoryReimbursement = async (userId, country, region) => {
    try {
        // 1. Get ledger detail data for damaged inventory
        const ledgerDetailData = await LedgerDetailView.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        // Fallback to ledger summary if detail not available
        if (!ledgerDetailData || !ledgerDetailData.data || ledgerDetailData.data.length === 0) {
            logger.info(`[Damaged Inventory] No ledger detail data found, falling back to ledger summary for userId: ${userId}`);
            return await calculateDamagedInventoryFromSummary(userId, country, region);
        }

        // 2. Get seller product data to get prices
        const sellerData = await Seller.findOne({ User: userId });

        if (!sellerData || !sellerData.sellerAccount || sellerData.sellerAccount.length === 0) {
            logger.warn(`[Damaged Inventory] No seller data found for userId: ${userId}`);
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
            logger.warn(`[Damaged Inventory] No products found for userId: ${userId}, country: ${country}, region: ${region}`);
            return {
                success: false,
                message: "No products found for the specified country and region",
                data: [],
                totalDamagedUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // 3. Get estimated fees from ProductWiseFBAData model
        // Uses service layer that handles both old (embedded array) and new (separate collection) formats
        const productWiseFBAData = await getProductWiseFBAData(userId, country, region);

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

        // 4. Filter and process damaged inventory records
        // Track by Reference ID to identify unique incidents
        const processedReferenceIds = new Set();
        const calculations = [];
        let totalDamagedUnits = 0;
        let totalExpectedAmount = 0;

        ledgerDetailData.data.forEach(ledgerItem => {
            if (!ledgerItem.asin) return;

            // Filter by reason codes (6, 7, E, H, K, U)
            const reason = (ledgerItem.reason || '').toString().trim().toUpperCase();
            if (!DAMAGED_REASON_CODES.includes(reason)) return;

            // Use Unreconciled Quantity (as per Refunds system)
            const unreconciledQty = parseFloat(ledgerItem.unreconciled_quantity?.toString().replace(/[^0-9.-]/g, '') || '0') || 0;

            // Only process if unreconciled quantity > 0
            if (unreconciledQty <= 0) return;

            // Track by Reference ID to avoid duplicates
            const referenceId = ledgerItem.reference_id?.trim() || '';
            const uniqueKey = `${referenceId}-${ledgerItem.asin}-${ledgerItem.fnsku || ''}`;
            
            if (processedReferenceIds.has(uniqueKey)) return;
            processedReferenceIds.add(uniqueKey);

            const asin = ledgerItem.asin.trim();
            const fnsku = ledgerItem.fnsku?.trim() || '';

                // Get sales price from seller model
                const salesPrice = asinToPriceMap.get(asin) || 0;

                // Get estimated fees - try fnsku first, then asin
                let estimatedFees = 0;
            if (fnsku) {
                estimatedFees = fnskuToEstimatedFeesMap.get(fnsku) || 0;
                }
                if (estimatedFees === 0) {
                    estimatedFees = asinToEstimatedFeesMap.get(asin) || 0;
                }

            // Calculate reimbursement per unit = Sales Price - Estimated Fees
                const reimbursementPerUnit = salesPrice - estimatedFees;

            // Calculate expected amount = Unreconciled Quantity × Reimbursement Per Unit
            const expectedAmount = unreconciledQty * reimbursementPerUnit;

            // Exclude negative or zero expected amounts (as per Refunds system)
            // Refunds system excludes records with ExpectedAmount < 0 from dashboard totals
            if (expectedAmount > 0) {
                calculations.push({
                    referenceId: referenceId,
                    date: ledgerItem.date_and_time || '',
                    asin: asin,
                    fnsku: fnsku,
                    title: ledgerItem.title || '',
                    reasonCode: reason,
                    damagedUnits: unreconciledQty,
                    salesPrice: parseFloat(salesPrice.toFixed(2)),
                    estimatedFees: parseFloat(estimatedFees.toFixed(2)),
                    reimbursementPerUnit: parseFloat(reimbursementPerUnit.toFixed(2)),
                    expectedAmount: parseFloat(expectedAmount.toFixed(2))
                });

                totalDamagedUnits += unreconciledQty;
                totalExpectedAmount += expectedAmount;
            }
        });

        // Round totals to 2 decimal places
        totalExpectedAmount = parseFloat(totalExpectedAmount.toFixed(2));

        logger.info(`[Damaged Inventory] Calculation completed: ${calculations.length} incidents, total units: ${totalDamagedUnits}, total amount: ${totalExpectedAmount}`);

        return {
            success: true,
            message: "Damaged inventory reimbursement calculation completed successfully",
            data: calculations,
            totalDamagedUnits: totalDamagedUnits,
            totalExpectedAmount: totalExpectedAmount,
            summary: {
                totalIncidents: calculations.length,
                totalDamagedUnits: totalDamagedUnits,
                totalExpectedAmount: totalExpectedAmount
            }
        };

    } catch (error) {
        logger.error(`[Damaged Inventory] Error calculating reimbursement: ${error.message}`);
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
 * Fallback function to calculate damaged inventory from summary view
 * Used when ledger detail data is not available
 */
const calculateDamagedInventoryFromSummary = async (userId, country, region) => {
    try {
        // Get ledger summary data
        // Uses service layer that handles both old (embedded array) and new (separate collection) formats
        const ledgerData = await getLedgerSummaryViewData(userId, country, region);

        if (!ledgerData || !ledgerData.data || ledgerData.data.length === 0) {
            logger.info(`[Damaged Inventory Fallback] No ledger summary data found for userId: ${userId}`);
            return {
                success: true,
                message: "No ledger data found",
                data: [],
                totalDamagedUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // Get seller and FBA data
        const sellerData = await Seller.findOne({ User: userId });
        const sellerAccount = sellerData?.sellerAccount?.find(
            account => account.country === country && account.region === region
        );

        if (!sellerAccount?.products?.length) {
            return {
                success: false,
                message: "No products found",
                data: [],
                totalDamagedUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // Uses service layer that handles both old (embedded array) and new (separate collection) formats
        const productWiseFBAData = await getProductWiseFBAData(userId, country, region);

        // Create maps
        const asinToPriceMap = new Map();
        const asinToEstimatedFeesMap = new Map();
        const fnskuToEstimatedFeesMap = new Map();

        sellerAccount.products.forEach(product => {
            if (product.asin && product.price) {
                asinToPriceMap.set(product.asin.trim(), parseFloat(product.price.toString().replace(/[^0-9.]/g, '')) || 0);
            }
        });

        if (productWiseFBAData?.fbaData) {
            productWiseFBAData.fbaData.forEach(fbaItem => {
                if (fbaItem['estimated-fee-total']) {
                    const fees = parseFloat(fbaItem['estimated-fee-total'].toString().replace(/[^0-9.-]/g, '')) || 0;
                    if (fbaItem.fnsku) fnskuToEstimatedFeesMap.set(fbaItem.fnsku.trim(), fees);
                    if (fbaItem.asin) asinToEstimatedFeesMap.set(fbaItem.asin.trim(), fees);
                }
            });
        }

        // Aggregate damaged by ASIN
        const asinDamagedMap = new Map();
        ledgerData.data.forEach(item => {
            if (!item.asin) return;
            const asin = item.asin.trim();
            const damaged = parseFloat(item.damaged?.toString().replace(/[^0-9.-]/g, '') || '0') || 0;
            if (damaged > 0) {
                if (asinDamagedMap.has(asin)) {
                    asinDamagedMap.get(asin).damaged += damaged;
                } else {
                    asinDamagedMap.set(asin, { damaged, fnsku: item.fnsku?.trim() || '', title: item.title || '' });
                }
            }
        });

        // Calculate
        const calculations = [];
        let totalDamagedUnits = 0;
        let totalExpectedAmount = 0;

        asinDamagedMap.forEach((data, asin) => {
            if (data.damaged > 0) {
                const salesPrice = asinToPriceMap.get(asin) || 0;
                let estimatedFees = data.fnsku ? fnskuToEstimatedFeesMap.get(data.fnsku) || 0 : 0;
                if (!estimatedFees) estimatedFees = asinToEstimatedFeesMap.get(asin) || 0;
                
                const reimbursementPerUnit = salesPrice - estimatedFees;
                const expectedAmount = data.damaged * reimbursementPerUnit;

                calculations.push({
                    asin,
                    fnsku: data.fnsku,
                    title: data.title,
                    damagedUnits: data.damaged,
                    salesPrice: parseFloat(salesPrice.toFixed(2)),
                    estimatedFees: parseFloat(estimatedFees.toFixed(2)),
                    reimbursementPerUnit: parseFloat(reimbursementPerUnit.toFixed(2)),
                    expectedAmount: parseFloat(expectedAmount.toFixed(2))
                });

                totalDamagedUnits += data.damaged;
                totalExpectedAmount += expectedAmount;
            }
        });

        return {
            success: true,
            message: "Damaged inventory reimbursement calculation completed (from summary)",
            data: calculations,
            totalDamagedUnits,
            totalExpectedAmount: parseFloat(totalExpectedAmount.toFixed(2)),
            summary: {
                totalProductsWithDamagedInventory: calculations.length,
                totalDamagedUnits,
                totalExpectedAmount: parseFloat(totalExpectedAmount.toFixed(2))
            }
        };
    } catch (error) {
        logger.error(`[Damaged Inventory Fallback] Error: ${error.message}`);
        return {
            success: false,
            message: `Error: ${error.message}`,
            data: [],
            totalDamagedUnits: 0,
            totalExpectedAmount: 0
        };
    }
};

/**
 * Disposed inventory disposition types as per Refunds system specification
 */
const DISPOSED_DISPOSITIONS = ['SELLABLE', 'WAREHOUSE_DAMAGED', 'EXPIRED'];

/**
 * Calculate disposed inventory reimbursement amounts
 * 
 * IMPLEMENTATION MATCHING REFUNDS SYSTEM:
 * - Report: GET_LEDGER_DETAIL_VIEW_DATA
 * - Filter by Reason code: "D"
 * - Filter by Disposition: "SELLABLE", "WAREHOUSE_DAMAGED", "EXPIRED"
 * - Uses Quantity field (absolute value)
 * - Tracks by Reference ID for unique incidents
 * - Formula: ExpectedAmount = |Quantity| × (SalesPrice - EstimatedFeesTotal)
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} JSON object with disposed inventory reimbursement calculations
 */
const calculateDisposedInventoryReimbursement = async (userId, country, region) => {
    try {
        // 1. Get ledger detail data for disposed inventory
        const ledgerDetailData = await LedgerDetailView.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        // Fallback to ledger summary if detail not available
        if (!ledgerDetailData || !ledgerDetailData.data || ledgerDetailData.data.length === 0) {
            logger.info(`[Disposed Inventory] No ledger detail data found, falling back to ledger summary for userId: ${userId}`);
            return await calculateDisposedInventoryFromSummary(userId, country, region);
        }

        // 2. Get seller product data to get prices
        const sellerData = await Seller.findOne({ User: userId });

        if (!sellerData || !sellerData.sellerAccount || sellerData.sellerAccount.length === 0) {
            logger.warn(`[Disposed Inventory] No seller data found for userId: ${userId}`);
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
            logger.warn(`[Disposed Inventory] No products found for userId: ${userId}, country: ${country}, region: ${region}`);
            return {
                success: false,
                message: "No products found for the specified country and region",
                data: [],
                totalDisposedUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // 3. Get estimated fees from ProductWiseFBAData model
        // Uses service layer that handles both old (embedded array) and new (separate collection) formats
        const productWiseFBAData = await getProductWiseFBAData(userId, country, region);

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

        // 4. Filter and process disposed inventory records
        // Track by Reference ID to identify unique incidents
        const processedReferenceIds = new Set();
        const calculations = [];
        let totalDisposedUnits = 0;
        let totalExpectedAmount = 0;

        ledgerDetailData.data.forEach(ledgerItem => {
            if (!ledgerItem.asin) return;

            // Filter by reason code "D" (Disposed)
            const reason = (ledgerItem.reason || '').toString().trim().toUpperCase();
            if (reason !== 'D') return;

            // Filter by disposition (SELLABLE, WAREHOUSE_DAMAGED, EXPIRED)
            const disposition = (ledgerItem.disposition || '').toString().trim().toUpperCase();
            if (!DISPOSED_DISPOSITIONS.includes(disposition)) return;

            // Use Quantity field (absolute value as per Refunds system)
            let quantity = parseFloat(ledgerItem.quantity?.toString().replace(/[^0-9.-]/g, '') || '0') || 0;
            quantity = Math.abs(quantity); // Convert negative to positive
            
            // Only process if quantity > 0
            if (quantity <= 0) return;

            // Track by Reference ID to avoid duplicates
            const referenceId = ledgerItem.reference_id?.trim() || '';
            const uniqueKey = `${referenceId}-${ledgerItem.asin}-${ledgerItem.fnsku || ''}-${disposition}`;
            
            if (processedReferenceIds.has(uniqueKey)) return;
            processedReferenceIds.add(uniqueKey);

            const asin = ledgerItem.asin.trim();
            const fnsku = ledgerItem.fnsku?.trim() || '';

                // Get sales price from seller model
                const salesPrice = asinToPriceMap.get(asin) || 0;

                // Get estimated fees - try fnsku first, then asin
                let estimatedFees = 0;
            if (fnsku) {
                estimatedFees = fnskuToEstimatedFeesMap.get(fnsku) || 0;
                }
                if (estimatedFees === 0) {
                    estimatedFees = asinToEstimatedFeesMap.get(asin) || 0;
                }

            // Calculate reimbursement per unit = Sales Price - Estimated Fees
                const reimbursementPerUnit = salesPrice - estimatedFees;

            // Calculate expected amount = Quantity × Reimbursement Per Unit
            const expectedAmount = quantity * reimbursementPerUnit;

            // Exclude negative or zero expected amounts (as per Refunds system)
            // Refunds system excludes records with ExpectedAmount < 0 from dashboard totals
            if (expectedAmount > 0) {
                calculations.push({
                    referenceId: referenceId,
                    date: ledgerItem.date_and_time || '',
                    asin: asin,
                    fnsku: fnsku,
                    title: ledgerItem.title || '',
                    disposition: disposition,
                    disposedUnits: quantity,
                    salesPrice: parseFloat(salesPrice.toFixed(2)),
                    estimatedFees: parseFloat(estimatedFees.toFixed(2)),
                    reimbursementPerUnit: parseFloat(reimbursementPerUnit.toFixed(2)),
                    expectedAmount: parseFloat(expectedAmount.toFixed(2))
                });

                totalDisposedUnits += quantity;
                totalExpectedAmount += expectedAmount;
            }
        });

        // Round totals to 2 decimal places
        totalExpectedAmount = parseFloat(totalExpectedAmount.toFixed(2));

        logger.info(`[Disposed Inventory] Calculation completed: ${calculations.length} incidents, total units: ${totalDisposedUnits}, total amount: ${totalExpectedAmount}`);

        return {
            success: true,
            message: "Disposed inventory reimbursement calculation completed successfully",
            data: calculations,
            totalDisposedUnits: totalDisposedUnits,
            totalExpectedAmount: totalExpectedAmount,
            summary: {
                totalIncidents: calculations.length,
                totalDisposedUnits: totalDisposedUnits,
                totalExpectedAmount: totalExpectedAmount
            }
        };

    } catch (error) {
        logger.error(`[Disposed Inventory] Error calculating reimbursement: ${error.message}`);
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
 * Fallback function to calculate disposed inventory from summary view
 * Used when ledger detail data is not available
 */
const calculateDisposedInventoryFromSummary = async (userId, country, region) => {
    try {
        // Get ledger summary data
        // Uses service layer that handles both old (embedded array) and new (separate collection) formats
        const ledgerData = await getLedgerSummaryViewData(userId, country, region);

        if (!ledgerData || !ledgerData.data || ledgerData.data.length === 0) {
            logger.info(`[Disposed Inventory Fallback] No ledger summary data found for userId: ${userId}`);
            return {
                success: true,
                message: "No ledger data found",
                data: [],
                totalDisposedUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // Get seller and FBA data
        const sellerData = await Seller.findOne({ User: userId });
        const sellerAccount = sellerData?.sellerAccount?.find(
            account => account.country === country && account.region === region
        );

        if (!sellerAccount?.products?.length) {
            return {
                success: false,
                message: "No products found",
                data: [],
                totalDisposedUnits: 0,
                totalExpectedAmount: 0
            };
        }

        // Uses service layer that handles both old (embedded array) and new (separate collection) formats
        const productWiseFBAData = await getProductWiseFBAData(userId, country, region);

        // Create maps
        const asinToPriceMap = new Map();
        const asinToEstimatedFeesMap = new Map();
        const fnskuToEstimatedFeesMap = new Map();

        sellerAccount.products.forEach(product => {
            if (product.asin && product.price) {
                asinToPriceMap.set(product.asin.trim(), parseFloat(product.price.toString().replace(/[^0-9.]/g, '')) || 0);
            }
        });

        if (productWiseFBAData?.fbaData) {
            productWiseFBAData.fbaData.forEach(fbaItem => {
                if (fbaItem['estimated-fee-total']) {
                    const fees = parseFloat(fbaItem['estimated-fee-total'].toString().replace(/[^0-9.-]/g, '')) || 0;
                    if (fbaItem.fnsku) fnskuToEstimatedFeesMap.set(fbaItem.fnsku.trim(), fees);
                    if (fbaItem.asin) asinToEstimatedFeesMap.set(fbaItem.asin.trim(), fees);
                }
            });
        }

        // Aggregate disposed by ASIN
        const asinDisposedMap = new Map();
        ledgerData.data.forEach(item => {
            if (!item.asin) return;
            const asin = item.asin.trim();
            const disposed = parseFloat(item.disposed?.toString().replace(/[^0-9.-]/g, '') || '0') || 0;
            if (disposed > 0) {
                if (asinDisposedMap.has(asin)) {
                    asinDisposedMap.get(asin).disposed += disposed;
                } else {
                    asinDisposedMap.set(asin, { disposed, fnsku: item.fnsku?.trim() || '', title: item.title || '' });
                }
            }
        });

        // Calculate
        const calculations = [];
        let totalDisposedUnits = 0;
        let totalExpectedAmount = 0;

        asinDisposedMap.forEach((data, asin) => {
            if (data.disposed > 0) {
                const salesPrice = asinToPriceMap.get(asin) || 0;
                let estimatedFees = data.fnsku ? fnskuToEstimatedFeesMap.get(data.fnsku) || 0 : 0;
                if (!estimatedFees) estimatedFees = asinToEstimatedFeesMap.get(asin) || 0;
                
                const reimbursementPerUnit = salesPrice - estimatedFees;
                const expectedAmount = data.disposed * reimbursementPerUnit;

                calculations.push({
                    asin,
                    fnsku: data.fnsku,
                    title: data.title,
                    disposedUnits: data.disposed,
                    salesPrice: parseFloat(salesPrice.toFixed(2)),
                    estimatedFees: parseFloat(estimatedFees.toFixed(2)),
                    reimbursementPerUnit: parseFloat(reimbursementPerUnit.toFixed(2)),
                    expectedAmount: parseFloat(expectedAmount.toFixed(2))
                });

                totalDisposedUnits += data.disposed;
                totalExpectedAmount += expectedAmount;
            }
        });

        return {
            success: true,
            message: "Disposed inventory reimbursement calculation completed (from summary)",
            data: calculations,
            totalDisposedUnits,
            totalExpectedAmount: parseFloat(totalExpectedAmount.toFixed(2)),
            summary: {
                totalProductsWithDisposedInventory: calculations.length,
                totalDisposedUnits,
                totalExpectedAmount: parseFloat(totalExpectedAmount.toFixed(2))
            }
        };
    } catch (error) {
        logger.error(`[Disposed Inventory Fallback] Error: ${error.message}`);
        return {
            success: false,
            message: `Error: ${error.message}`,
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
 * Convert weight to the correct unit for fee calculation based on region
 * Matches Refunds system logic:
 * - AUS: weight in grams (converts kg to grams, otherwise assumes grams)
 * - USA: weight in pounds (converts oz to pounds, otherwise assumes pounds)
 * @param {string} weightValue - Weight value as string
 * @param {string} unitOfWeight - Weight unit (grams, kg, oz, lbs, etc.)
 * @param {string} feesRegion - Region code ("US" or "AU")
 * @returns {number} Weight in the correct unit for fee calculation
 */
const convertWeightForFeeCalculation = (weightValue, unitOfWeight, feesRegion) => {
    if (!weightValue || isNaN(parseFloat(weightValue))) return 0;
    
    const numValue = parseFloat(weightValue);
    const unitLower = (unitOfWeight || '').toLowerCase().trim();
    
    if (feesRegion === "AU") {
        // For AUS region: CalculateFees expects weight in GRAMS
        if (unitLower === 'kg' || unitLower === 'kgs' || unitLower === 'kilogram' || unitLower === 'kilograms') {
            return numValue * 1000; // Convert kg to grams
        } else {
            // Otherwise assume grams (matches Refunds system logic)
            return numValue;
        }
    } else if (feesRegion === "US") {
        // For USA region: CalculateFees expects weight in POUNDS
        if (unitLower === 'oz' || unitLower === 'ozs' || unitLower === 'ounce' || unitLower === 'ounces') {
            return numValue / 16; // Convert oz to pounds (matches Refunds system)
        } else if (unitLower === 'lbs' || unitLower === 'pounds' || unitLower === 'lb') {
            return numValue; // Already in pounds
        } else if (unitLower === 'kg' || unitLower === 'kgs' || unitLower === 'kilogram' || unitLower === 'kilograms') {
            return numValue * 2.20462; // Convert kg to pounds
        } else if (unitLower === 'grams' || unitLower === 'gram' || unitLower === 'g') {
            return numValue / 453.592; // Convert grams to pounds
        } else {
            // Default assume pounds (matches Refunds system logic)
            return numValue;
        }
    }
    
    // Default fallback (shouldn't reach here)
    return numValue;
};

/**
 * Calculate fee reimbursement amounts
 * Uses EconomicsMetrics.asinWiseSales for units sold data (from MCP Data Kiosk API)
 * This provides more accurate and up-to-date sales data compared to legacy ProductWiseSales
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @returns {Object} JSON object with fee reimbursement calculations
 */
const calculateFeeReimbursement = async (userId, country, region) => {
    try {
        // 1. Get product wise FBA data (contains charged fees and dimensions)
        // Uses service layer that handles both old (embedded array) and new (separate collection) formats
        const productWiseFBAData = await getProductWiseFBAData(userId, country, region);

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

        // 2. Get units sold from EconomicsMetrics (MCP Data Kiosk API)
        // This provides ASIN-wise daily sales data with accurate units sold
        const economicsMetrics = await EconomicsMetrics.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 });

        // Create a map of ASIN to total units sold (summed across all dates)
        const asinToUnitsSoldMap = new Map();
        
        // Get asinWiseSales - either from main document or separate collection (for big accounts)
        let asinWiseSales = [];
        
        if (economicsMetrics) {
            // For big accounts (isBig=true), asinWiseSales is stored in a separate collection
            if (economicsMetrics.isBig && (!economicsMetrics.asinWiseSales || economicsMetrics.asinWiseSales.length === 0)) {
                try {
                    const bigAccountAsinDocs = await AsinWiseSalesForBigAccounts.findByMetricsId(economicsMetrics._id);
                    if (bigAccountAsinDocs && bigAccountAsinDocs.length > 0) {
                        // Flatten all ASIN sales from all date documents
                        let processedCount = 0;
                        for (const doc of bigAccountAsinDocs) {
                            if (doc.asinSales && Array.isArray(doc.asinSales)) {
                                for (const asinSale of doc.asinSales) {
                                    asinWiseSales.push({
                                        asin: asinSale.asin,
                                        unitsSold: asinSale.unitsSold
                                    });
                                    // Yield to event loop periodically to prevent blocking
                                    processedCount++;
                                    if (processedCount % YIELD_CHUNK_SIZE === 0) {
                                        await yieldToEventLoop();
                                    }
                                }
                            }
                        }
                        logger.info(`Fetched ${asinWiseSales.length} ASIN-wise sales from separate collection for big account`);
                    }
                } catch (fetchError) {
                    logger.error('Error fetching ASIN data for big account in Reimbursement', {
                        metricsId: economicsMetrics._id,
                        error: fetchError.message
                    });
                }
            } else if (economicsMetrics.asinWiseSales && Array.isArray(economicsMetrics.asinWiseSales)) {
                asinWiseSales = economicsMetrics.asinWiseSales;
            }
        }
        
        if (asinWiseSales.length > 0) {
            logger.info(`Processing ${asinWiseSales.length} ASIN-wise sales records from EconomicsMetrics`);
            
            asinWiseSales.forEach(sale => {
                if (sale.asin) {
                    const asin = sale.asin.trim();
                    // unitsSold is per day per ASIN, so we sum across all dates
                    const unitsSold = parseInt(sale.unitsSold) || 0;
                    
                    if (asinToUnitsSoldMap.has(asin)) {
                        asinToUnitsSoldMap.set(asin, asinToUnitsSoldMap.get(asin) + unitsSold);
                    } else {
                        asinToUnitsSoldMap.set(asin, unitsSold);
                    }
                }
            });
            
            logger.info(`Built units sold map with ${asinToUnitsSoldMap.size} unique ASINs from EconomicsMetrics`);
        } else {
            logger.warn(`No EconomicsMetrics data found for userId: ${userId}, country: ${country}, region: ${region}. Units sold will be 0.`);
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

            // Convert weight to the correct unit for fee calculation based on region
            // AUS: grams, USA: pounds (matching Refunds system logic)
            const weightForCalculation = convertWeightForFeeCalculation(itemPackageWeight, unitOfWeight, feesRegion);

            // Only process if we have required data
            if (longestCm > 0 && medianCm > 0 && shortestCm > 0 && weightForCalculation > 0) {
                // Step 1: Calculate actual fees using ActualFeesCalculations
                // Note: weightForCalculation is in grams for AU, pounds for US (matching Refunds system)
                const actualFees = calculateFees(feesRegion, longestCm, medianCm, shortestCm, weightForCalculation, productGroup);

                // Step 2: Calculate fee difference = Charged Fee - Actual Fee
                const feeDifference = chargedFees - actualFees;

                // Step 3: Get units sold for this ASIN
                const unitsSold = asinToUnitsSoldMap.get(asin) || 0;

                // Step 4: Calculate expected amount = Fee Difference × Units Sold
                const expectedAmount = feeDifference * unitsSold;

                // Only include products with fee difference (overcharged) AND expectedAmount > 0
                // Refunds system excludes records with ExpectedAmount < 0 from dashboard totals
                if (feeDifference > 0 && unitsSold > 0 && expectedAmount > 0) {
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
    calculateDisposedInventoryReimbursement
    // calculateFeeReimbursement - Temporarily disabled
};
