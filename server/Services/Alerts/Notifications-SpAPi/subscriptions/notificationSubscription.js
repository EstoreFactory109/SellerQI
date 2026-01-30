const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../../../.env') });

const logger = require('../../../../utils/Logger');
const axios = require('axios');
const aws4 = require('aws4');
const { URL } = require('url');
const { ApiError } = require('../../../../utils/ApiError');

/**
 * Sign request with AWS Signature V4
 */
const signRequest = (url, method, body, headers, region) => {
    const awsAccessKey = process.env.ACCESS_KEY_ID;
    const awsSecretKey = process.env.SECRETACCESSKEY;

    if (!awsAccessKey || !awsSecretKey) {
        throw new Error('AWS credentials not configured');
    }

    const parsedUrl = new URL(url);
    
    const requestOptions = {
        host: parsedUrl.hostname,
        path: parsedUrl.pathname,
        method: method,
        service: 'execute-api',
        region: region,
        headers: {
            ...headers,
            'host': parsedUrl.hostname
        },
        body: JSON.stringify(body)
    };

    return aws4.sign(requestOptions, {
        accessKeyId: awsAccessKey,
        secretAccessKey: awsSecretKey
    });
};

/**
 * Base subscription creator - handles common subscription logic
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {string} notificationType - The notification type to subscribe to
 * @param {Object} requestBody - The request body for the subscription
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createSubscription = async (baseUri, accessToken, notificationType, requestBody, options = {}) => {
    try {
        logger.info(`Creating ${notificationType} subscription`);

        // Validate required parameters
        if (!baseUri) {
            throw new ApiError(400, 'Base URI is required');
        }

        if (!accessToken) {
            throw new ApiError(400, 'Access token is required');
        }

        // Get configuration from environment
        const awsRegion = options.region || process.env.AWS_REGION || 'us-east-1';

        if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
            throw new ApiError(500, 'AWS credentials not configured in environment');
        }

        // Build request
        const endpoint = `/notifications/v1/subscriptions/${notificationType}`;
        const url = `${baseUri}${endpoint}`;

        logger.info(`Creating subscription: ${url}`);
        logger.debug('Request body:', requestBody);

        // Sign request
        const signedRequest = signRequest(
            url,
            'POST',
            requestBody,
            {
                'x-amz-access-token': accessToken,
                'Content-Type': 'application/json'
            },
            awsRegion
        );

        // Make request
        const response = await axios.post(url, requestBody, {
            headers: signedRequest.headers,
            timeout: options.timeout || 30000,
            validateStatus: (status) => status < 500
        });

        // Handle non-2xx responses
        if (response.status >= 400) {
            const errors = response.data?.errors || [];
            const error = errors[0] || {};
            
            throw new ApiError(
                response.status,
                error.message || 'Subscription creation failed',
                response.data
            );
        }

        // Validate response
        const subscriptionId = response.data?.payload?.subscriptionId;
        
        if (!subscriptionId) {
            logger.warn('No subscription ID in response');
        }

        logger.info(`${notificationType} subscription created: ${subscriptionId}`);

        return {
            success: true,
            subscriptionId: subscriptionId,
            destinationId: requestBody.destinationId,
            notificationType: notificationType,
            data: response.data
        };

    } catch (error) {
        logger.error(`${notificationType} subscription creation failed:`, error.message);

        if (error.response) {
            const errors = error.response.data?.errors || [];
            const spError = errors[0] || {};
            
            logger.error(`SP-API Error: [${spError.code}] ${spError.message}`);
            
            throw new ApiError(
                error.response.status,
                spError.message || 'Amazon API error',
                error.response.data
            );
        }

        if (error instanceof ApiError) {
            throw error;
        }

        throw new ApiError(500, `Subscription failed: ${error.message}`);
    }
};

// ============================================================================
// ORDER_CHANGE - Order status changes and buyer requested cancellations
// ============================================================================
/**
 * Create subscription for Order Change notifications
 * Supports processingDirective with eventFilter for OrderStatusChange and BuyerRequestedChange
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createOrderChangeSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId,
        processingDirective: {
            eventFilter: {
                eventFilterType: 'ORDER_CHANGE',
                orderChangeTypes: options.orderChangeTypes || [
                    'OrderStatusChange',
                    'BuyerRequestedChange'
                ]
            }
        }
    };

    return createSubscription(baseUri, accessToken, 'ORDER_CHANGE', requestBody, options);
};

// ============================================================================
// ANY_OFFER_CHANGED - Competitor pricing changes on your ASINs (top 20 offers)
// ============================================================================
/**
 * Create subscription for Any Offer Changed notifications
 * Sent when there is a listing change for any of the top 20 offers, by condition
 * Supports processingDirective with eventFilter for marketplaceIds and aggregationSettings
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options including marketplaceIds and aggregationTimePeriod
 * @returns {Promise<Object>} The subscription response
 */
const createAnyOfferChangedSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    // Add processingDirective if marketplaceIds or aggregationSettings are provided
    if (options.marketplaceIds || options.aggregationTimePeriod) {
        const eventFilter = {
            eventFilterType: 'ANY_OFFER_CHANGED'
        };

        // Add marketplace filter if specified
        if (options.marketplaceIds && options.marketplaceIds.length > 0) {
            eventFilter.marketplaceIds = options.marketplaceIds;
        }

        // Add aggregation settings if specified (FiveMinutes or TenMinutes)
        if (options.aggregationTimePeriod) {
            eventFilter.aggregationSettings = {
                aggregationTimePeriod: options.aggregationTimePeriod // 'FiveMinutes' or 'TenMinutes'
            };
        }

        requestBody.processingDirective = { eventFilter };
    }

    return createSubscription(baseUri, accessToken, 'ANY_OFFER_CHANGED', requestBody, options);
};

// ============================================================================
// B2B_ANY_OFFER_CHANGED - B2B pricing changes (quantity discount tier prices)
// ============================================================================
/**
 * Create subscription for B2B Any Offer Changed notifications
 * Sent when there is a change in any of the top 20 B2B offers
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createB2BAnyOfferChangedSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'B2B_ANY_OFFER_CHANGED', requestBody, options);
};

// ============================================================================
// FBA_OUTBOUND_SHIPMENT_STATUS - FBA shipment status changes
// ============================================================================
/**
 * Create subscription for FBA Outbound Shipment Status notifications
 * Sent when we create or cancel a Fulfillment by Amazon shipment for a seller
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createFBAOutboundShipmentStatusSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'FBA_OUTBOUND_SHIPMENT_STATUS', requestBody, options);
};

// ============================================================================
// FEE_PROMOTION - Fee changes for your offers
// ============================================================================
/**
 * Create subscription for Fee Promotion notifications
 * Sent when a promotion becomes active. When initially enabled, receives all currently active promotions.
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createFeePromotionSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'FEE_PROMOTION', requestBody, options);
};

// ============================================================================
// REPORT_PROCESSING_FINISHED - When requested report is ready
// ============================================================================
/**
 * Create subscription for Report Processing Finished notifications
 * Sent when any report reaches processing status of DONE, CANCELLED, or FATAL
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createReportProcessingFinishedSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'REPORT_PROCESSING_FINISHED', requestBody, options);
};

// ============================================================================
// FEED_PROCESSING_FINISHED - When bulk upload feed completes
// ============================================================================
/**
 * Create subscription for Feed Processing Finished notifications
 * Sent when any feed reaches processing status of DONE, CANCELLED, or FATAL
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createFeedProcessingFinishedSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'FEED_PROCESSING_FINISHED', requestBody, options);
};

// ============================================================================
// PRICING_HEALTH - When offer is ineligible for Featured Offer due to price
// ============================================================================
/**
 * Create subscription for Pricing Health notifications
 * Sent when a seller offer is ineligible to be the Featured Offer (Buy Box) 
 * because of an uncompetitive price
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createPricingHealthSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'PRICING_HEALTH', requestBody, options);
};

// ============================================================================
// ACCOUNT_STATUS_CHANGED - Account status changes (NORMAL, AT_RISK, DEACTIVATED)
// ============================================================================
/**
 * Create subscription for Account Status Changed notifications
 * Sent when the selling partner's account status changes
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createAccountStatusChangedSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'ACCOUNT_STATUS_CHANGED', requestBody, options);
};

// ============================================================================
// FBA_INVENTORY_AVAILABILITY_CHANGES - FBA inventory quantity changes
// ============================================================================
/**
 * Create subscription for FBA Inventory Availability Changes notifications
 * Sent when there is a change in the FBA inventory quantities
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createFBAInventoryAvailabilityChangesSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'FBA_INVENTORY_AVAILABILITY_CHANGES', requestBody, options);
};

// ============================================================================
// FULFILLMENT_ORDER_STATUS - MCF (Multi-Channel Fulfillment) order status changes
// ============================================================================
/**
 * Create subscription for Fulfillment Order Status notifications
 * Sent when there is a change in the status of a Multi-Channel Fulfillment order
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createFulfillmentOrderStatusSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'FULFILLMENT_ORDER_STATUS', requestBody, options);
};

// ============================================================================
// ITEM_SALES_EVENT_CHANGE - Sales data at ASIN level (hourly)
// ============================================================================
/**
 * Create subscription for Item Sales Event Change notifications
 * Sent at the beginning of every hour with sales data at ASIN level
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createItemSalesEventChangeSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'ITEM_SALES_EVENT_CHANGE', requestBody, options);
};

// ============================================================================
// ITEM_INVENTORY_EVENT_CHANGE - Inventory data at ASIN level (hourly)
// ============================================================================
/**
 * Create subscription for Item Inventory Event Change notifications
 * Sent at the beginning of every hour with inventory data at ASIN level
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createItemInventoryEventChangeSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'ITEM_INVENTORY_EVENT_CHANGE', requestBody, options);
};

// ============================================================================
// DETAIL_PAGE_TRAFFIC_EVENT - Traffic data at ASIN level (hourly)
// ============================================================================
/**
 * Create subscription for Detail Page Traffic Event notifications
 * Sent at the beginning of every hour with traffic data at ASIN level
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createDetailPageTrafficEventSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'DETAIL_PAGE_TRAFFIC_EVENT', requestBody, options);
};

// ============================================================================
// TRANSACTION_UPDATE - New transactions posted to seller account
// ============================================================================
/**
 * Create subscription for Transaction Update notifications
 * Sent whenever there is a new transaction posted to the seller's account
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createTransactionUpdateSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'TRANSACTION_UPDATE', requestBody, options);
};

// ============================================================================
// EXTERNAL_FULFILLMENT_SHIPMENT_STATUS_CHANGE - External fulfillment shipment changes
// ============================================================================
/**
 * Create subscription for External Fulfillment Shipment Status Change notifications
 * Sent when there is a change in a shipment for the External Fulfillment API
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} The subscription response
 */
const createExternalFulfillmentShipmentStatusChangeSubscription = async (baseUri, accessToken, options = {}) => {
    const destinationId = process.env.DESTINATION_ID;

    if (!destinationId) {
        throw new ApiError(500, 'DESTINATION_ID not configured in environment');
    }

    const requestBody = {
        payloadVersion: options.payloadVersion || '1.0',
        destinationId: destinationId
    };

    return createSubscription(baseUri, accessToken, 'EXTERNAL_FULFILLMENT_SHIPMENT_STATUS_CHANGE', requestBody, options);
};

// ============================================================================
// Utility function to create all subscriptions at once
// ============================================================================
/**
 * Create all SQS-supported subscriptions at once
 * @param {string} baseUri - The base URI for the SP-API endpoint
 * @param {string} accessToken - The access token for authentication
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Results of all subscription attempts
 */
const createAllSubscriptions = async (baseUri, accessToken, options = {}) => {
    const results = {
        successful: [],
        failed: []
    };

    const subscriptions = [
        { name: 'ORDER_CHANGE', fn: createOrderChangeSubscription },
        { name: 'ANY_OFFER_CHANGED', fn: createAnyOfferChangedSubscription },
        { name: 'B2B_ANY_OFFER_CHANGED', fn: createB2BAnyOfferChangedSubscription },
        { name: 'FBA_OUTBOUND_SHIPMENT_STATUS', fn: createFBAOutboundShipmentStatusSubscription },
        { name: 'FEE_PROMOTION', fn: createFeePromotionSubscription },
        { name: 'REPORT_PROCESSING_FINISHED', fn: createReportProcessingFinishedSubscription },
        { name: 'FEED_PROCESSING_FINISHED', fn: createFeedProcessingFinishedSubscription },
        { name: 'PRICING_HEALTH', fn: createPricingHealthSubscription },
        { name: 'ACCOUNT_STATUS_CHANGED', fn: createAccountStatusChangedSubscription },
        { name: 'FBA_INVENTORY_AVAILABILITY_CHANGES', fn: createFBAInventoryAvailabilityChangesSubscription },
        { name: 'FULFILLMENT_ORDER_STATUS', fn: createFulfillmentOrderStatusSubscription },
        { name: 'ITEM_SALES_EVENT_CHANGE', fn: createItemSalesEventChangeSubscription },
        { name: 'ITEM_INVENTORY_EVENT_CHANGE', fn: createItemInventoryEventChangeSubscription },
        { name: 'DETAIL_PAGE_TRAFFIC_EVENT', fn: createDetailPageTrafficEventSubscription },
        { name: 'TRANSACTION_UPDATE', fn: createTransactionUpdateSubscription },
        { name: 'EXTERNAL_FULFILLMENT_SHIPMENT_STATUS_CHANGE', fn: createExternalFulfillmentShipmentStatusChangeSubscription }
    ];

    for (const sub of subscriptions) {
        try {
            const result = await sub.fn(baseUri, accessToken, options);
            results.successful.push({ name: sub.name, ...result });
            logger.info(`Successfully created ${sub.name} subscription`);
        } catch (error) {
            results.failed.push({ 
                name: sub.name, 
                error: error.message,
                details: error.details || null
            });
            logger.error(`Failed to create ${sub.name} subscription: ${error.message}`);
        }
    }

    return results;
};

module.exports = {
    // Base function
    createSubscription,
    
    // Individual subscription creators
    createOrderChangeSubscription,
    createAnyOfferChangedSubscription,
    createB2BAnyOfferChangedSubscription,
    createFBAOutboundShipmentStatusSubscription,
    createFeePromotionSubscription,
    createReportProcessingFinishedSubscription,
    createFeedProcessingFinishedSubscription,
    createPricingHealthSubscription,
    createAccountStatusChangedSubscription,
    createFBAInventoryAvailabilityChangesSubscription,
    createFulfillmentOrderStatusSubscription,
    createItemSalesEventChangeSubscription,
    createItemInventoryEventChangeSubscription,
    createDetailPageTrafficEventSubscription,
    createTransactionUpdateSubscription,
    createExternalFulfillmentShipmentStatusChangeSubscription,
    
    // Utility function
    createAllSubscriptions
};