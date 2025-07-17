const axios = require('axios');
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const sellerCentral=require('../../models/sellerCentralModel.js');

const getProfileById = async (accessToken,region ,country) => {
    try {
        // Validate input
        if (!accessToken || !region) {
            logger.error(new ApiError(400, "Refresh token and region are required"));
            return false;
        }

        // Define region-specific endpoints
        const regionEndpoints = {
            'NA': 'https://advertising-api.amazon.com',
            'EU': 'https://advertising-api-eu.amazon.com',
            'FE': 'https://advertising-api-fe.amazon.com'
        };

        const baseURL = regionEndpoints[region] || regionEndpoints['NA'];

        // Make GET request to fetch specific profile
        const response = await axios.get(
            `${baseURL}/v2/profiles`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Amazon-Advertising-API-ClientId': process.env.AMAZON_ADS_CLIENT_ID,
                    'Content-Type': 'application/json'
                }
            }
        );

        if (!response || !response.data) {
            logger.error(new ApiError(404, 'Profile id not found'));
            return false;
        }

        const profileIdScope= response.data.find(scope => scope.countryCode === country);

        profileId= profileIdScope.profileId;

        // Log successful response
        logger.info(`Successfully fetched profile id`);

        const sellerCentral=await sellerCentral.findOne({User:userId});
        if(!sellerCentral){
            return res.status(404).json(new ApiError(404,"SellerCentral not found"));
        }

        sellerAccount = sellerCentral.sellerAccount.find(account => 
            account.country === country && account.region === region
        );

        sellerAccount.ProfileId=profileId;
        await sellerCentral.save();

        return {
            success: true,
            profile: profileId
        };

    } catch (error) {
        // Handle specific error cases
        if (error.response) {
            switch (error.response.status) {
                case 401:
                    logger.error(new ApiError(401, "Unauthorized - Invalid or expired access token"));
                    break;
                case 403:
                    logger.error(new ApiError(403, "Forbidden - Insufficient permissions"));
                    break;
                case 404:
                    logger.error(new ApiError(404, 'Profile ID not found'));
                    break;
                case 429:
                    logger.error(new ApiError(429, "Too many requests - Rate limit exceeded"));
                    break;
                default:
                    logger.error(new ApiError(error.response.status, `Amazon Ads API error: ${error.response.data?.message || error.message}`));
            }
        } else {
            logger.error(new ApiError(500, `Error fetching profile id: ${error.message}`));
        }
        
        return false;
    }
};

module.exports = {
    getProfileById
};
