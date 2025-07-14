const axios = require('axios');
const AdsGroup = require('../../models/adsgroupModel.js');
const logger = require('../../utils/Logger.js');

// Base URIs for different regions (same as PPCSpendsSalesUnitsSold.js)
const BASE_URIS = {
  'NA': 'https://advertising-api.amazon.com',
  'EU': 'https://advertising-api-eu.amazon.com',
  'FE': 'https://advertising-api-fe.amazon.com'
};


async function getAdGroups(accessToken, profileId, region,userId,country,campaignIds) {
  try {
    // Validate region and get base URI
    const baseUri = BASE_URIS[region];
    if (!baseUri) {
      throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
    }

    const query = campaignIds.map(campaignId => `${campaignId}`).join(',');

    // Construct the endpoint URL with query parameters
    const url = `${baseUri}/v2/adGroups?campaignIdFilter=${query}`;

    // Set up headers
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
      'Amazon-Advertising-API-Scope': String(profileId)
    };

    // Make the GET request
    const response = await axios.get(url, { headers });

    

    // Return the response data

    const createCampaignData= await AdsGroup.create({
      userId,
      country,
      region,
      adsGroupData: response.data
    })

    if(!createCampaignData){
      logger.error('Failed to create campaign data');
      return res.status(500).json({
        message: 'Failed to create campaign data'
      })
    }

    return createCampaignData;

  } catch (error) {
    // Handle different types of errors
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('API Error Response:', {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers
      });
      throw new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
    } else if (error.request) {
      // The request was made but no response was received
      console.error('No response received:', error.request);
      throw new Error('No response received from Amazon Ads API');
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('Request setup error:', error.message);
      throw error;
    }
  }
}

module.exports = {
    getAdGroups
};
