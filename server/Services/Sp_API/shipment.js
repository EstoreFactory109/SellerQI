const axios = require('axios');
const aws4 = require('aws4');
const promiseLimit = require('promise-limit');
const ShipmentModel = require('../../models/inventory/ShipmentModel.js');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError');

/**
 * Extract date from shipment name
 * Shipment names follow patterns like: "FBA (10/12/18 2:17 PM) - 1"
 * The date is in format (MM/DD/YY H:mm AM/PM)
 * @param {string} shipmentName - The shipment name containing the date
 * @returns {Date|null} - Parsed date or null if not found
 */
const extractDateFromShipmentName = (shipmentName) => {
    if (!shipmentName) return null;
    
    // Regex to match date pattern (MM/DD/YY H:mm AM/PM) in parentheses
    // Supports: 1 or 2 digit month/day, 2 or 4 digit year, 1 or 2 digit hour, AM/PM
    const datePattern = /\((\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)?\)/i;
    const match = shipmentName.match(datePattern);
    
    if (match) {
        const [, month, day, year, hour, minute, ampm] = match;
        
        // Handle 2-digit year (assume 2000s)
        let fullYear = parseInt(year);
        if (fullYear < 100) {
            fullYear = fullYear + 2000;
        }
        
        // Handle 12-hour format with AM/PM
        let hour24 = parseInt(hour);
        if (ampm) {
            const isPM = ampm.toUpperCase() === 'PM';
            if (isPM && hour24 !== 12) {
                hour24 += 12;
            } else if (!isPM && hour24 === 12) {
                hour24 = 0;
            }
        }
        
        // Create date object (month is 0-indexed in JavaScript)
        const parsedDate = new Date(
            fullYear,
            parseInt(month) - 1,
            parseInt(day),
            hour24,
            parseInt(minute)
        );
        
        // Validate the date is valid
        if (!isNaN(parsedDate.getTime())) {
            return parsedDate;
        }
    }
    
    return null;
};

// Helper function to fetch shipment item details
const getShipmentDetails = async (shipmentId, SessionToken, baseURI, AccessToken) => {
    const host = baseURI;
    const path = `/fba/inbound/v0/shipments/${shipmentId}/items`;

    let request = {
        host,
        path,
        method: "GET",
        headers: {
            "host": host,
            "user-agent": "MyApp/1.0",
            "content-type": "application/json",
            "x-amz-access-token": AccessToken
        }
    };

    aws4.sign(request, {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY,
        sessionToken: SessionToken
    });

    try {
        const response = await axios.get(`https://${host}${path}`, { headers: request.headers });

        let resultData = []

        response.data.payload.ItemData.forEach(item => {
            const data = {
                SellerSKU: item.SellerSKU,
                FulfillmentNetworkSKU: item.FulfillmentNetworkSKU,
                QuantityShipped: item.QuantityShipped,
                QuantityReceived: item.QuantityReceived
            };
            resultData.push(data);
        });

        return resultData;
    } catch (error) {
        console.error(`❌ Error fetching shipment details for ${shipmentId}:`, error.response?.data || error.message);
        return false;
    }
};

const getshipment = async (dataToReceive, UserId, baseuri, country, region) => {
    const host = baseuri;

    // Calculate date range for last 30 days in UTC
    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
    
    // Format dates in UTC with 'Z' suffix (ISO 8601 format required by Amazon SP-API)
    const formatDateUTC = (date) => {
        const year = date.getUTCFullYear();
        const month = String(date.getUTCMonth() + 1).padStart(2, '0');
        const day = String(date.getUTCDate()).padStart(2, '0');
        const hours = String(date.getUTCHours()).padStart(2, '0');
        const minutes = String(date.getUTCMinutes()).padStart(2, '0');
        const seconds = String(date.getUTCSeconds()).padStart(2, '0');
        return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}Z`;
    };

    const lastUpdatedBefore = formatDateUTC(now);
    const lastUpdatedAfter = formatDateUTC(thirtyDaysAgo);

    try {
        // Helper function to fetch shipments with pagination support
        const fetchShipmentsPage = async (nextToken = null) => {
            let queryParams;
            if (nextToken) {
                // Pagination request with NextToken
                queryParams = `ShipmentStatusList=CLOSED&QueryType=NEXT_TOKEN&NextToken=${encodeURIComponent(nextToken)}&LastUpdatedBefore=${encodeURIComponent(lastUpdatedBefore)}&LastUpdatedAfter=${encodeURIComponent(lastUpdatedAfter)}&MarketplaceId=${dataToReceive.marketplaceId}`;
            } else {
                // Initial request
                queryParams = `ShipmentStatusList=CLOSED&QueryType=DATE_RANGE&LastUpdatedBefore=${encodeURIComponent(lastUpdatedBefore)}&LastUpdatedAfter=${encodeURIComponent(lastUpdatedAfter)}&MarketplaceId=${dataToReceive.marketplaceId}`;
            }
            
            const pagePath = `/fba/inbound/v0/shipments?${queryParams}`;
            const pageRequest = {
                host,
                path: pagePath,
                method: "GET",
                headers: {
                    "host": host,
                    "user-agent": "MyApp/1.0",
                    "content-type": "application/json",
                    "x-amz-access-token": dataToReceive.AccessToken
                }
            };

            aws4.sign(pageRequest, {
                accessKeyId: dataToReceive.AccessKey,
                secretAccessKey: dataToReceive.SecretKey,
                sessionToken: dataToReceive.SessionToken,
                service: 'execute-api',
                region: 'us-east-1'
            });

            const pageResponse = await axios.get(`https://${host}${pagePath}`, { headers: pageRequest.headers });
            return pageResponse.data?.payload || null;
        };

        // Fetch all shipments with pagination
        let allShipments = [];
        let nextToken = null;
        let pageCount = 0;

        do {
            pageCount++;
            const payload = await fetchShipmentsPage(nextToken);
            
            if (!payload || !payload.ShipmentData) {
                break;
            }

            allShipments = allShipments.concat(payload.ShipmentData);
            nextToken = payload.NextToken || null;

            if (nextToken) {
                logger.info(`Fetched page ${pageCount} with ${payload.ShipmentData.length} shipments, more pages available`);
            }
        } while (nextToken);

        logger.info(`Fetched total ${allShipments.length} CLOSED shipments from last 30 days via API date filtering (${pageCount} page(s))`);

        if (allShipments.length === 0) {
            logger.info(`No shipments found in the last 30 days for user ${UserId}`);
            return false;
        }

        const limit = promiseLimit(3); // Limit to 3 concurrent getShipmentDetails requests

        const result = await Promise.all(
            allShipments.map(shipment =>
                limit(async () => {
                    const details = await getShipmentDetails(
                        shipment.ShipmentId,
                        dataToReceive.SessionToken,
                        baseuri,
                        dataToReceive.AccessToken
                    );

                    if (details) {
                        // Extract and store the shipment date for reference (optional, for display purposes)
                        const shipmentDate = extractDateFromShipmentName(shipment.ShipmentName);
                        
                        return {
                            shipmentId: shipment.ShipmentId,
                            shipmentName: shipment.ShipmentName,
                            shipmentDate: shipmentDate ? shipmentDate.toISOString() : null,
                            itemDetails: details
                        };
                    }

                    return null;
                })
            )
        );

        // Filter and validate shipments before storing
        const filteredResult = result
            .filter(Boolean) // Remove null/false values (failed detail fetches)
            .filter(shipment => {
                // Validate required fields
                if (!shipment.shipmentId || !shipment.shipmentName) {
                    logger.warn(`Skipping shipment with missing required fields: ${JSON.stringify(shipment)}`);
                    return false;
                }
                // Ensure itemDetails exists and is not empty
                if (!shipment.itemDetails || !Array.isArray(shipment.itemDetails) || shipment.itemDetails.length === 0) {
                    logger.warn(`Skipping shipment ${shipment.shipmentId} - no item details found`);
                    return false;
                }
                return true;
            })
            // Remove duplicates within the same batch (same shipmentId)
            .filter((shipment, index, self) => 
                index === self.findIndex(s => s.shipmentId === shipment.shipmentId)
            );

        if (filteredResult.length === 0) {
            logger.info(`No valid shipments to store for user ${UserId} after filtering`);
            return false;
        }

        // Check for existing shipments in database to avoid duplicates across multiple API calls
        const existingShipment = await ShipmentModel.findOne({
            User: UserId,
            region: region,
            country: country
        }).sort({ createdAt: -1 });

        // If existing shipment document exists, check for duplicates
        let shipmentsToStore = filteredResult;
        if (existingShipment && existingShipment.shipmentData && existingShipment.shipmentData.length > 0) {
            const existingShipmentIds = new Set(existingShipment.shipmentData.map(s => s.shipmentId));
            shipmentsToStore = filteredResult.filter(shipment => !existingShipmentIds.has(shipment.shipmentId));
            
            if (shipmentsToStore.length < filteredResult.length) {
                const duplicateCount = filteredResult.length - shipmentsToStore.length;
                logger.info(`Filtered out ${duplicateCount} duplicate shipment(s) that already exist in database`);
            }
        }

        if (shipmentsToStore.length === 0) {
            logger.info(`All shipments already exist in database for user ${UserId}`);
            return existingShipment || false;
        }

        const createShipping = await ShipmentModel.create({
            User: UserId,
            region: region,
            country: country,
            shipmentData: shipmentsToStore
        });

        if (!createShipping) {
            logger.error(new ApiError(400, "Error in creating shipment"));
            return false;
        }

        logger.info(`Successfully stored ${filteredResult.length} shipments from last 30 days for user ${UserId}`);
        return createShipping;
    } catch (error) {
        console.error("❌ Error fetching shipment list:", error.response?.data || error.message);
        logger.error(`Error fetching shipments: ${error.response?.data || error.message}`);
        return false;
    }
};

module.exports = getshipment;
