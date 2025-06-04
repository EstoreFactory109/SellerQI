const axios = require('axios');

const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
};

/**
 * Fetches ad groups from Amazon Advertising API
 * @param {string} accessToken - The access token for authentication
 * @param {string} profileId - The Amazon Advertising profile ID
 * @param {string} region - The region (NA, EU, or FE)
 * @param {Array<string|number>} campaignIds - Array of campaign IDs to filter by
 * @returns {Promise<Object>} Response data from the API
 */
async function getAdGroups(accessToken, profileId, region, campaignIds) {
    
    try {
        // Validate region
        if (!BASE_URIS[region]) {
            throw new Error(`Invalid region: ${region}. Must be NA, EU, or FE`);
        }

        // Get client ID from environment variables
        const clientId = process.env.AMAZON_ADS_CLIENT_ID;
        if (!clientId) {
            throw new Error('AMAZON_ADVERTISING_CLIENT_ID not found in environment variables');
        }

        // Construct the base URL
        const baseUrl = BASE_URIS[region];
        
        // Join campaign IDs with commas
        const campaignIdFilter = campaignIds.join(',');

        // Configure the request
        const config = {
            method: 'GET',
            url: `${baseUrl}/v2/adGroups`,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
                'Amazon-Advertising-API-Scope': profileId,
                'Content-Type': 'application/json'
            },
            params: {
                campaignIdFilter: campaignIdFilter
            }
        };

        // Make the request
        const response = await axios(config);
        
        return response.data;

    } catch (error) {
        // Handle specific axios errors
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('API Error Response:', {
                status: error.response.status,
                data: error.response.data,
                headers: error.response.headers
            });
            throw new Error(`API request failed with status ${error.response.status}: ${JSON.stringify(error.response.data)}`);
        } else if (error.request) {
            // The request was made but no response was received
            console.error('No response received:', error.request);
            throw new Error('No response received from Amazon Advertising API');
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('Request setup error:', error.message);
            throw error;
        }
    }
}

module.exports = {
    getAdGroups
}