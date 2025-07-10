const axios = require('axios');
const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const SearchTerms = require('../../models/SearchTermsModel.js');

// Base URIs for different regions
const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
};

async function getReportId(accessToken, profileId, region) {
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

        // Calculate dynamic dates
        const now = new Date();
        const endDate = new Date(now.getTime() - (72 * 60 * 60 * 1000)); // 72 hours before now
        const startDate = new Date(now.getTime() - (31 * 24 * 60 * 60 * 1000)); // 31 days before now
        
        // Format dates as YYYY-MM-DD strings
        const formatDate = (date) => {
            return date.toISOString().split('T')[0];
        };

        // Generate unique report name to prevent duplicate requests
        const timestamp = Date.now();
        const uniqueReportName = `Search Terms With Zero Sales - ${timestamp}`;

        // Set up request body for ASIN/SKU level data
        const body = {
            "name": uniqueReportName,
            "startDate": formatDate(startDate),
            "endDate": formatDate(endDate),
            "configuration": {
                "adProduct": "SPONSORED_PRODUCTS",
                "reportTypeId": "spSearchTerm",
                "timeUnit": "SUMMARY",
                "format": "GZIP_JSON",
                "groupBy": ["searchTerm"],
                "columns": [
                    "campaignId",
                    "campaignName",
                    "searchTerm",
                    "keyword",
                    "clicks",
                    "sales30d",
                    "cost"
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
            // Preserve the original error structure for TokenManager to detect 401s
            const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            enhancedError.response = error.response;
            enhancedError.status = error.response.status;
            enhancedError.statusCode = error.response.status;
            throw enhancedError;
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

                // Token refresh is now handled automatically by TokenManager

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
            // Preserve the original error structure for TokenManager to detect 401s
            const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
            enhancedError.response = error.response;
            enhancedError.status = error.response.status;
            enhancedError.statusCode = error.response.status;
            throw enhancedError;
        } else if (error.request) {
            console.error('No response received:', error.request);
            throw new Error('No response received from Amazon Ads API');
        } else {
            console.error('Report status check error:', error.message);
            throw error;
        }
    }
}

async function downloadReportData(location, accessToken, profileId) {
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

        if (!reportJson) {
            return {
                success: false,
                message: "Error in downloading report",
            };
        }

        console.log(`Downloaded report with ${Array.isArray(reportJson) ? reportJson.length : 'unknown number of'} items`);

        // 4) Format the data to match the model schema
        const sponsoredAdsData = [];

        reportJson.forEach(item => {
            sponsoredAdsData.push({
                campaignId: item.campaignId || '',
                campaignName: item.campaignName || '',
                searchTerm: item.searchTerm || '',
                keyword: item.keyword || '',
                clicks: item.clicks || 0,
                sales: item.sales30d || 0,
                spend: item.cost || 0
            })
        });

        console.log(`Formatted ${sponsoredAdsData.length} search terms for database storage`);
        return sponsoredAdsData;

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

async function getSearchKeywords(accessToken, profileId, userId, country, region) {
            // console.log(`Getting search keywords for region: ${region}`);

    try {
        // Add a small delay to prevent rapid successive requests
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Get the report ID first
        const reportData = await getReportId(accessToken, profileId, region);

        if (!reportData || !reportData.reportId) {
            throw new Error('Failed to get report ID');
        }

        // console.log(`Report ID generated: ${reportData.reportId}`);

        // Check report status until completion
        const reportStatus = await checkReportStatus(reportData.reportId, accessToken, profileId, region, userId);

        if (reportStatus.status === 'COMPLETED') {
            // Download and parse the report data
            const reportContent = await downloadReportData(reportStatus.location, accessToken, profileId);

            // Add validation and logging
            console.log(`Processing ${reportContent.length} search terms for user ${userId}`);
            
            if (!reportContent || reportContent.length === 0) {
                console.log('No search terms data to save');
                return {
                    success: true,
                    message: "No search terms data available for the specified period",
                    data: null
                };
            }

            try {
                const createSearchTermsData = await SearchTerms.create({
                    userId: userId,
                    country: country,
                    region: region,
                    searchTermData: reportContent
                });
                
                if (!createSearchTermsData) {
                    console.error('Failed to create search terms data - no data returned from database');
                    return {
                        success: false,
                        message: "Error in creating search terms data",
                    };
                }
                
                console.log(`Successfully saved search terms data with ID: ${createSearchTermsData._id}`);
                return {
                    success: true,
                    message: "Search terms data fetched successfully",
                    data: createSearchTermsData
                };
            } catch (dbError) {
                console.error('Database error while saving search terms:', dbError);
                return {
                    success: false,
                    message: `Database error: ${dbError.message}`,
                    error: dbError
                };
            }
        } else {
            console.error('Report generation failed:', reportStatus.error);
            return {
                success: false,
                reportId: reportStatus.reportId,
                error: reportStatus.error
            };
        }

    } catch (error) {
        console.error('Error in getSearchKeywords:', error.message);
        
        // Handle specific 425 errors with more helpful messaging
        if (error.message.includes('425')) {
            throw new Error('Duplicate request detected by Amazon Ads API. Please wait a moment before retrying.');
        }
        
        throw error;
    }
}

module.exports = {
    getSearchKeywords
};