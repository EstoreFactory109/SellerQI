const axios = require('axios');
const Campaign = require('../../models/CampaignModel');
const logger = require('../../utils/Logger.js');

// Base URIs for different regions (same as PPCSpendsSalesUnitsSold.js)
const BASE_URIS = {
  'NA': 'https://advertising-api.amazon.com',
  'EU': 'https://advertising-api-eu.amazon.com',
  'FE': 'https://advertising-api-fe.amazon.com'
};


async function getCampaign(accessToken, profileId, region, userId, country) {
  try {
    // ===== INPUT VALIDATION =====
    if (!accessToken) {
      throw new Error('Access token is required');
    }

    if (!profileId) {
      throw new Error('Profile ID is required');
    }

    if (!userId) {
      throw new Error('User ID is required');
    }

    if (!region) {
      throw new Error('Region is required');
    }

    if (!country) {
      throw new Error('Country is required');
    }

    // Validate region and get base URI
    const baseUri = BASE_URIS[region];
    if (!baseUri) {
      throw new Error(`Invalid region: ${region}. Valid regions are: ${Object.keys(BASE_URIS).join(', ')}`);
    }

    // Validate environment variable
    const clientId = process.env.AMAZON_ADS_CLIENT_ID;
    if (!clientId) {
      throw new Error('AMAZON_ADS_CLIENT_ID not found in environment variables');
    }

    console.log(`📡 Getting campaigns for region: ${region}, country: ${country}, userId: ${userId}`);

    // Construct the endpoint URL with query parameters
    const url = `${baseUri}/v2/campaigns?stateFilter=enabled`;

    // Set up headers
    const headers = {
      'Authorization': `Bearer ${accessToken}`,
      'Amazon-Advertising-API-ClientId': clientId,
      'Amazon-Advertising-API-Scope': String(profileId)
    };

    // Make the GET request
    const response = await axios.get(url, { headers });

    // ===== VALIDATE API RESPONSE =====
    if (!response || !response.data) {
      throw new Error('Invalid response from Amazon Ads API - no data received');
    }

    if (!Array.isArray(response.data)) {
      logger.warn('Campaign API response is not an array', { 
        responseType: typeof response.data,
        userId,
        region,
        country 
      });
      // Convert to array if it's not
      response.data = [];
    }

    console.log(`✅ Campaign API response received: ${response.data.length} campaigns`);

    // ===== HANDLE EMPTY CAMPAIGNS GRACEFULLY =====
    if (response.data.length === 0) {
      logger.warn('No campaigns found for user', { userId, region, country });
    } else {
      // Log some stats about the campaigns
      const enabledCampaigns = response.data.filter(campaign => 
        campaign && campaign.state === 'enabled'
      );
      console.log(`📊 Campaign breakdown: ${response.data.length} total, ${enabledCampaigns.length} enabled`);
    }

    // ===== SAVE TO DATABASE WITH VALIDATION =====
    let createCampaignData;
    try {
      createCampaignData = await Campaign.create({
        userId,
        country,
        region,
        campaignData: response.data
      });

      if (!createCampaignData) {
        // Log warning but don't fail - return the data anyway
        logger.warn('Failed to save campaign data to database, but continuing with API data', { 
          userId, 
          region, 
          country,
          campaignCount: response.data.length 
        });
        
        // Return a mock object with the data for consistency
        return {
          userId,
          country,
          region,
          campaignData: response.data,
          _isTemporary: true // Flag to indicate this wasn't saved to DB
        };
      }

      console.log(`✅ Campaign data saved successfully: ${response.data.length} campaigns stored`);
      return createCampaignData;

    } catch (dbError) {
      logger.error('Database error while saving campaign data', { 
        error: dbError.message, 
        userId, 
        region, 
        country,
        campaignCount: response.data.length
      });
      
      // Return the data anyway, even if DB save failed
      return {
        userId,
        country,
        region,
        campaignData: response.data,
        _isTemporary: true,
        _dbError: dbError.message
      };
    }

  } catch (error) {
    // ===== ENHANCED ERROR HANDLING FOR TOKEN MANAGER =====
    if (error.response) {
      // The request was made and the server responded with a status code
      // that falls out of the range of 2xx
      console.error('❌ Campaign API Error Response:', {
        status: error.response.status,
        data: error.response.data,
        headers: error.response.headers,
        userId,
        region,
        country
      });

      // Create enhanced error for TokenManager compatibility
      const enhancedError = new Error(`Amazon Ads API Error: ${error.response.status} - ${JSON.stringify(error.response.data)}`);
      enhancedError.response = error.response;
      enhancedError.status = error.response.status;
      enhancedError.statusCode = error.response.status;
      
      // Flag for TokenManager to detect Amazon API errors
      if (error.response.status === 401 || error.response.status === 403) {
        enhancedError.amazonApiError = true;
      }
      
      throw enhancedError;
    } else if (error.request) {
      // The request was made but no response was received
      console.error('❌ No response received from Campaign API:', {
        request: error.request,
        userId,
        region,
        country
      });
      throw new Error('No response received from Amazon Ads API');
    } else {
      // Something happened in setting up the request that triggered an Error
      console.error('❌ Campaign API request setup error:', {
        message: error.message,
        userId,
        region,
        country
      });
      throw error;
    }
  }
}

module.exports = {
  getCampaign
};
