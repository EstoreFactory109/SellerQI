const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const { generateAccessToken } = require('./GenerateToken');
const gunzip = promisify(zlib.gunzip);
const userModel = require('../../models/userModel.js');
// You'll need to create this new model
const AutoCampaignSearchTermsModel = require('../../models/AutoCampaignSearchTermsModel.js');

// Base URIs for different regions
const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
};

async function getSearchTermReportId(accessToken, profileId, region) {
    try {
        // Validate region and get base URI
        const baseUri = BASE_URIS[region];
        if (!baseUri) {
            throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
        }

        // Construct the endpoint URL
        const url = `${baseUri}/reporting/reports`;

        // Set up headers
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
            'Amazon-Advertising-API-Scope': profileId,
            'Content-Type': 'application/vnd.createasyncreportrequest.v3+json'
        };

        // Set up request body for Search Term Report with AUTO campaigns filter
        const body = {
            "name": "Auto Campaign Search Terms Report",
            "startDate": "2025-05-01",
            "endDate": "2025-05-31",
            "configuration": {
                "adProduct": "SPONSORED_PRODUCTS",
                "reportTypeId": "spSearchTerm",  // Changed from spAdvertisedProduct
                "timeUnit": "DAILY",
                "format": "GZIP_JSON",
                "groupBy": ["searchTerm", "campaignId"],  // Group by search term and campaign
                "columns": [
                    "date",
                    "searchTerm",           // The actual search query
                    "campaignId",
                    "campaignName",
                    "adGroupId",
                    "adGroupName",
                    "advertisedAsin",       // Which ASIN was shown
                    "advertisedSku",
                    "impressions",
                    "clicks",
                    "cost",
                    "purchases1d",
                    "purchases7d",
                    "purchases14d",
                    "purchases30d",
                    "sales1d",
                    "sales7d",
                    "sales14d",
                    "sales30d",
                    "acos",                 // Advertising Cost of Sales
                    "roas"                  // Return on Ad Spend
                ],
                "filters": [
                    {
                        "field": "targetingType",
                        "values": ["AUTO"]  // CRITICAL: Only get auto campaigns
                    }
                ]
            }
        }

        // Make the API request
        const response = await axios.post(url, body, { headers });

        // Return the response data
        return response.data;

    } catch (error) {
        // Handle different types of errors
        if (error.response) {
            console.error('API Error Response:', {
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            });
            throw new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
            console.error('No response received:', error.request);
            throw new Error('No response received from Amazon Ads API');
        } else {
            console.error('Request setup error:', error.message);
            throw error;
        }
    }
}

async function checkReportStatus(reportId, accessToken, profileId, region, userId) {
    try {
        // Validate region and get base URI
        const baseUri = BASE_URIS[region];
        if (!baseUri) {
            throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
        }

        // Construct the endpoint URL with reportId as parameter
        const url = `${baseUri}/reporting/reports/${reportId}`;

        // Set up headers
        const headers = {
            'Authorization': `Bearer ${accessToken}`,
            'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
            'Amazon-Advertising-API-Scope': profileId,
            'Content-Type': 'application/vnd.createasyncreportrequest.v3+json'
        };

        // Poll for report status
        let attempts = 0;
        const maxAttempts = 30; // Maximum 30 minutes (30 * 60 seconds)

        while (true) {
            try {
                // Make GET request to check status
                const response = await axios.get(url, { headers });
                const { status } = response.data;
                const location = response.data.url;

                if (attempts === 58 || attempts === 118 || attempts === 178) {
                    const user = await userModel.findById(userId).select('spiRefreshToken');
                    if (!user || !user.spiRefreshToken) {
                        return {
                            status: 'FAILURE',
                            reportId: reportId,
                            error: 'Report generation failed - unable to refresh token'
                        }
                    }
                    accessToken = await generateAccessToken(user.spiRefreshToken);
                }

                console.log(`Report ${reportId} status: ${status} (attempt ${attempts + 1})`);

                // Check if report is complete
                if (status === 'COMPLETED') {
                    return {
                        status: 'COMPLETED',
                        location: location,
                        reportId: reportId
                    };
                } else if (status === 'FAILURE') {
                    return {
                        status: 'FAILURE',
                        reportId: reportId,
                        error: 'Report generation failed'
                    };
                }

                // If still processing, wait 60 seconds before next check
                if (status === 'PROCESSING' || status === 'PENDING') {
                    await new Promise(resolve => setTimeout(resolve, 60000)); // 60 seconds
                    attempts++;
                } else {
                    // Unknown status
                    throw new Error(`Unknown report status: ${status}`);
                }

            } catch (error) {
                // If it's a network error, we might want to retry
                if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT') {
                    console.error(`Network error checking report status, retrying... (attempt ${attempts + 1})`);
                    await new Promise(resolve => setTimeout(resolve, 60000));
                    attempts++;
                    continue;
                }
                throw error;
            }
        }

        // If we've exceeded max attempts
        throw new Error(`Report status check timed out after ${maxAttempts} attempts`);

    } catch (error) {
        // Handle different types of errors
        if (error.response) {
            console.error('API Error Response:', {
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            });
            throw new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
            console.error('No response received:', error.request);
            throw new Error('No response received from Amazon Ads API');
        } else {
            console.error('Report status check error:', error.message);
            throw error;
        }
    }
}

async function downloadSearchTermReportData(location, accessToken, profileId) {
    try {
        // 1) Always ask for binary so we can gunzip ourselves
        const response = await axios.get(location, {
            responseType: 'arraybuffer',  // get raw bytes
            decompress: false             // turn off axios's auto-inflate
        });

        // 2) Inflate the GZIP buffer
        const inflatedBuffer = await gunzip(response.data);
        const payloadText = inflatedBuffer.toString('utf8');

        // 3) Parse JSON
        const reportJson = JSON.parse(payloadText);
        
        if(!reportJson){
            return {
                success: false,
                message: "Error in downloading report",
            };
        }
        
        const searchTermsData = [];

        reportJson.forEach(item => {
            searchTermsData.push({
                date: item.date,
                searchTerm: item.searchTerm,  // The actual search query
                campaignId: item.campaignId,
                campaignName: item.campaignName,
                adGroupId: item.adGroupId,
                adGroupName: item.adGroupName,
                advertisedAsin: item.advertisedAsin,
                advertisedSku: item.advertisedSku,
                impressions: item.impressions,
                clicks: item.clicks,
                cost: item.cost,
                purchasesIn1Day: item.purchases1d,
                purchasesIn7Days: item.purchases7d,
                purchasesIn14Days: item.purchases14d,
                purchasesIn30Days: item.purchases30d,
                salesIn1Day: item.sales1d,
                salesIn7Days: item.sales7d,
                salesIn14Days: item.sales14d,
                salesIn30Days: item.sales30d,
                acos: item.acos,  // Advertising Cost of Sales percentage
                roas: item.roas,  // Return on Ad Spend
                // Calculate additional metrics if needed
                conversionRate: item.clicks > 0 ? (item.purchases7d / item.clicks * 100).toFixed(2) : 0,
                cpc: item.clicks > 0 ? (item.cost / item.clicks).toFixed(2) : 0
            });
        });
        
        return searchTermsData;

    } catch (err) {
        // 4) Better error logging
        if (err.response) {
            console.error('Status:', err.response.status);
            console.error('Body:', err.response.data.toString?.() ?? err.response.data);
            throw new Error(`Download failed: ${err.response.status} ${err.response.statusText}`);
        }
        console.error('Error downloading report:', err);
        throw err;
    }
}

async function getAutoSearchTermsWithSales(accessToken, profileId, userId, country, region) {
    console.log(`Getting search terms for auto campaigns in region: ${region}`);

    try {
        // Get the report ID first
        const reportData = await getSearchTermReportId(accessToken, profileId, region);

        if (!reportData || !reportData.reportId) {
            throw new Error('Failed to get report ID');
        }

        console.log(`Report ID generated: ${reportData.reportId}`);

        // Check report status until completion
        const reportStatus = await checkReportStatus(reportData.reportId, accessToken, profileId, region, userId);

        if (reportStatus.status === 'COMPLETED') {
            // Download and parse the report data
            const searchTermsContent = await downloadSearchTermReportData(reportStatus.location, accessToken, profileId);

            // Optional: Filter for high-performing search terms
            const highPerformingTerms = searchTermsContent.filter(term => 
                term.salesIn7Days > 0 || term.clicks >= 10
            );

            // Save to database
            const createSearchTermsData = await AutoCampaignSearchTermsModel.create({
                userId: userId,
                country: country,
                region: region,
                reportDate: new Date(),
                totalSearchTerms: searchTermsContent.length,
                highPerformingTerms: highPerformingTerms.length,
                searchTerms: searchTermsContent
            });

            if(!createSearchTermsData){
                return {
                    success: false,
                    message: "Error in creating search terms data",
                };
            }

            // Optional: Return summary statistics
            const summary = {
                totalSearchTerms: searchTermsContent.length,
                totalSpend: searchTermsContent.reduce((sum, term) => sum + term.cost, 0).toFixed(2),
                totalSales7d: searchTermsContent.reduce((sum, term) => sum + term.salesIn7Days, 0).toFixed(2),
                totalClicks: searchTermsContent.reduce((sum, term) => sum + term.clicks, 0),
                averageAcos: (searchTermsContent.reduce((sum, term) => sum + (term.acos || 0), 0) / searchTermsContent.length).toFixed(2)
            };

            return {
                success: true,
                message: "Auto campaign search terms data fetched successfully",
                data: createSearchTermsData,
                summary: summary
            };
        } else {
            console.error('Report generation failed:', reportStatus.error);
            return {
                success: false,
                reportId: reportStatus.reportId,
                error: reportStatus.error
            };
        }

    } catch (error) {
        console.error('Error in getAutoSearchTermsWithSales:', error.message);
        throw error;
    }
}

module.exports = {
    getAutoSearchTermsWithSales,
};