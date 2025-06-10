const axios = require('axios');
const NegetiveKeywords = require('../../models/NegetiveKeywords.js');


const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
};


async function getKeywords(accessToken, profileId, userId, country, region = 'NA', campaignIdArray, adGroupIdArray) {
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

        // Configure the request
        const config = {
            method: 'GET',
            url: `${baseUrl}/v2/negativeKeywords`,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Amazon-Advertising-API-ClientId': clientId,
                'Amazon-Advertising-API-Scope': profileId,
                'Content-Type': 'application/json'
            },
            params: {
                campaignIdFilter: campaignIdArray.join(','),
                adGroupIdFilter: adGroupIdArray.join(',')
            }
        };

        // Make the request
        const response = await axios(config);

        if(response.data.length === 0){
            return false;
        }

        const negetiveKeywordsData = response.data.map(item => ({
            campaignId: item.campaignId,
            adGroupId: item.adGroupId,
            keywordId: item.keywordId,
            keywordText: item.keywordText,
            state: item.state
        }));

        const negetiveKeywords = NegetiveKeywords.create({
            userId: userId,
            country: country,
            region: region,
            negetiveKeywordsData: negetiveKeywordsData
        })
        
        if(!negetiveKeywords){
            return false;
        }
        return negetiveKeywords;

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


module.exports = { getKeywords }