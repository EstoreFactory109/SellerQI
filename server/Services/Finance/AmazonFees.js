const axios = require('axios');
const aws4 = require('aws4');
const FBAFeesModel = require('../../models/FBAFees.js');

// Helper function to add delay
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to fetch fee details for a single ASIN
const getAmazonFeesDetails = async (asin, itemPrice, accessToken, credentials, marketplaceId) => {
    const host = 'sellingpartnerapi-na.amazon.com';
    const path = `/products/fees/v0/items/${asin}/feesEstimate`;
    
    const body = {
        "FeesEstimateRequest": {
            "MarketplaceId": marketplaceId,
            "IsAmazonFulfilled": true,
            "Identifier": `request-${asin}-${Date.now()}`,
            "PriceToEstimateFees": {
                "ListingPrice": {
                    "CurrencyCode": "USD",
                    "Amount": itemPrice
                }
            }
        }
    };

    // Create a fresh request object for each API call
    const request = {
        host: host,
        method: 'POST',
        path: path,
        headers: {
            'content-type': 'application/json',
            'x-amz-access-token': accessToken
        },
        body: JSON.stringify(body),
        service: 'execute-api'
    };

    // Sign the request
    aws4.sign(request, credentials);

    try {
        const response = await axios({
            method: request.method,
            url: `https://${host}${path}`,
            headers: request.headers,
            data: body
        });

        // Log rate limit info if available
        const rateLimit = response.headers['x-amzn-ratelimit-limit'];
        if (rateLimit) {
            // console.log(`Rate limit info: ${rateLimit}`);
        }

        if (response && response.data && response.data.payload) {
            const feesResult = response.data.payload.FeesEstimateResult;
            if (feesResult && feesResult.FeesEstimate && feesResult.FeesEstimate.TotalFeesEstimate) {
                return {
                    amount: feesResult.FeesEstimate.TotalFeesEstimate.Amount,
                    feeDetails: feesResult.FeesEstimate.FeeDetailList || []
                };
            }
        }
        return null;
    } catch (error) {
        // Don't log 429 errors as we'll retry them
        if (!error.response || error.response.status !== 429) {
            console.error(`Error for ASIN ${asin}:`, error.response?.data || error.message);
        }
        throw error;
    }
};

const getAmazonFees = async (dataToReceive, UserId, baseuri, country, region, OrderDetails) => {
    // AWS credentials object
    const credentials = {
        accessKeyId: process.env.AWS_ACCESS_KEY,
        secretAccessKey: process.env.AWS_SECRET_KEY
    };
    
    // Add session token if available
    if (dataToReceive.SessionToken) {
        credentials.sessionToken = dataToReceive.SessionToken;
    }

    const feesResults = [];
    const failedASINs = [];
    const marketplaceId = dataToReceive.marketplaceId;
    
    // Process tracking
    const totalProducts = OrderDetails.length;
    let processedCount = 0;

    // console.log(`Starting to process ${totalProducts} products with rate limiting...`);

    try {
        // Process products one by one with rate limiting
        for (let i = 0; i < OrderDetails.length; i++) {
            const order = OrderDetails[i];
            let retries = 0;
            const maxRetries = 3;
            let success = false;
            
            while (retries < maxRetries && !success) {
                try {
                    // Make the API call
                    const feeData = await getAmazonFeesDetails(
                        order.asin,
                        order.price,
                        dataToReceive.AccessToken,
                        credentials,
                        marketplaceId
                    );

                    if (feeData) {
                        feesResults.push({
                            asin: order.asin,
                            fees: feeData.amount
                        });
                        success = true;
                        processedCount++;
                        // console.log(`✓ Processed ${processedCount}/${totalProducts} - ASIN: ${order.asin}`);
                    }
                } catch (error) {
                    if (error.response && error.response.status === 429) {
                        // Rate limit hit - wait longer
                        retries++;
                        if (retries < maxRetries) {
                            const waitTime = Math.pow(2, retries) * 1000; // 2s, 4s, 8s
                            // console.log(`⚠ Rate limited on ASIN ${order.asin}. Waiting ${waitTime/1000}s before retry ${retries}/${maxRetries}`);
                            await delay(waitTime);
                        } else {
                            failedASINs.push({
                                asin: order.asin,
                                error: 'Rate limit exceeded after retries'
                            });
                        }
                    } else {
                        // Other error - don't retry
                        failedASINs.push({
                            asin: order.asin,
                            error: error.response?.data?.errors?.[0]?.message || error.message
                        });
                        break;
                    }
                }
            }
            
            // Always wait at least 1.1 seconds between requests to respect rate limit
            // (except for the last request)
            if (i < OrderDetails.length - 1) {
                await delay(1100);
            }
        }

        // Return results with summary

        const saveFees = await FBAFeesModel.create({
            userId: UserId,
            country: country,
            region: region,
            FbaData: feesResults
        });

        if (!saveFees) {
            logger.error("Failed to save fees to database");
            return {
                success: false,
                error: "Failed to save fees to database"
            }
        }

        // Define summary object with processing statistics
        const summary = {
            total: totalProducts,
            successful: feesResults.length,
            failed: failedASINs.length
        };

        return {
            success: true,
            results: feesResults,
            failed: failedASINs,
            summary: summary
        };

    } catch (error) {
        console.error("❌ Unexpected error:", error.message);
        return {
            success: false,
            error: error.message,
            results: feesResults,
            failed: failedASINs,
            summary: {
                total: totalProducts,
                successful: feesResults.length,
                failed: failedASINs.length
            }
        };
    }
};

module.exports = getAmazonFees;