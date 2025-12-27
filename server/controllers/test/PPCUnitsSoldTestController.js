/**
 * PPC Units Sold Test Controller
 * 
 * Test endpoints for fetching PPC units sold data with date-wise breakdown.
 * This controller is for testing purposes and fetches data from Amazon Ads API.
 * 
 * Endpoints:
 * - POST /api/test/ppc-units-sold - Fetch units sold data
 * 
 * Request Body:
 * {
 *   "userId": "string (required)",
 *   "country": "string (required) - US, UK, DE, etc.",
 *   "region": "string (required) - NA, EU, FE",
 *   "startDate": "string (optional) - YYYY-MM-DD format",
 *   "endDate": "string (optional) - YYYY-MM-DD format"
 * }
 */

const mongoose = require('mongoose');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');
const { getPPCUnitsSold } = require('../../Services/AmazonAds/GetPPCUnitsSold.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const logger = require('../../utils/Logger.js');

/**
 * POST /api/test/ppc-units-sold
 * Fetch PPC units sold data with date-wise breakdown
 * 
 * This endpoint fetches units sold data from Amazon Ads API across all campaign types:
 * - Sponsored Products: unitsSoldClicks1d, unitsSoldClicks7d, unitsSoldClicks14d, unitsSoldClicks30d
 * - Sponsored Brands: unitsSold14d, newToBrandUnitsSold14d
 * - Sponsored Display: unitsSold14d
 */
const testGetPPCUnitsSold = async (req, res) => {
    console.log('🟢 [Test] testGetPPCUnitsSold controller called at', new Date().toISOString());
    
    try {
        const { userId, country, region, startDate, endDate } = req.body;

        // Validate required fields
        if (!userId) {
            return res.status(400).json(
                new ApiError(400, 'userId is required')
            );
        }

        if (!country) {
            return res.status(400).json(
                new ApiError(400, 'country is required (e.g., US, UK, DE, CA)')
            );
        }

        if (!region) {
            return res.status(400).json(
                new ApiError(400, 'region is required (NA, EU, or FE)')
            );
        }

        // Validate region
        const validRegions = ['NA', 'EU', 'FE'];
        if (!validRegions.includes(region)) {
            return res.status(400).json(
                new ApiError(400, `Invalid region: ${region}. Valid values are: ${validRegions.join(', ')}`)
            );
        }

        // Validate date format if provided
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (startDate && !dateRegex.test(startDate)) {
            return res.status(400).json(
                new ApiError(400, 'Invalid startDate format. Use YYYY-MM-DD')
            );
        }
        if (endDate && !dateRegex.test(endDate)) {
            return res.status(400).json(
                new ApiError(400, 'Invalid endDate format. Use YYYY-MM-DD')
            );
        }

        logger.info('📦 [testGetPPCUnitsSold] Fetching seller account from database...', { userId, country, region });

        // Convert userId to ObjectId if needed
        let userIdQuery = userId;
        if (typeof userId === 'string' && mongoose.Types.ObjectId.isValid(userId)) {
            userIdQuery = new mongoose.Types.ObjectId(userId);
        }

        // Find the Seller document
        const sellerCentral = await Seller.findOne({ User: userIdQuery });

        if (!sellerCentral) {
            return res.status(404).json(
                new ApiError(404, 'Seller account not found for the provided userId', {
                    suggestion: 'Please ensure the user has connected their Amazon Seller Central account.'
                })
            );
        }

        // Find the specific seller account for this country/region
        const sellerAccount = sellerCentral.sellerAccount?.find(
            acc => acc.country === country && acc.region === region
        );

        if (!sellerAccount) {
            return res.status(404).json(
                new ApiError(404, `No seller account found for country: ${country}, region: ${region}`, {
                    availableAccounts: sellerCentral.sellerAccount?.map(acc => ({
                        country: acc.country,
                        region: acc.region,
                        hasAdsToken: !!acc.adsRefreshToken,
                        hasProfileId: !!acc.ProfileId
                    })) || []
                })
            );
        }

        // Check for required tokens
        if (!sellerAccount.adsRefreshToken) {
            return res.status(400).json(
                new ApiError(400, 'Ads refresh token not found for this seller account', {
                    suggestion: 'Please connect Amazon Ads account first.'
                })
            );
        }

        logger.info(`✅ [testGetPPCUnitsSold] Found seller account for ${country}/${region}`);

        // Generate access token from refresh token
        let adsAccessToken;
        try {
            adsAccessToken = await generateAdsAccessToken(sellerAccount.adsRefreshToken);
            if (!adsAccessToken) {
                return res.status(500).json(
                    new ApiError(500, 'Failed to generate Ads access token', {
                        suggestion: 'Please check if the refresh token is valid. You may need to reconnect your Amazon Ads account.'
                    })
                );
            }
        } catch (tokenError) {
            logger.error('❌ [testGetPPCUnitsSold] Token generation failed:', tokenError.message);
            return res.status(500).json(
                new ApiError(500, 'Failed to generate Ads access token', {
                    message: tokenError.message,
                    suggestion: 'The refresh token may be invalid or expired. Please reconnect your Amazon Ads account.'
                })
            );
        }

        // Get profile ID
        let profileId = sellerAccount.ProfileId;
        if (!profileId) {
            logger.info('🔄 [testGetPPCUnitsSold] Profile ID not found in database, fetching from Amazon Ads API...');
            try {
                const profiles = await getProfileById(adsAccessToken, region, country, userId);
                if (profiles && Array.isArray(profiles) && profiles.length > 0) {
                    // Find the matching profile for the country
                    const countryCodeMap = {
                        'US': 'US', 'CA': 'CA', 'MX': 'MX', 'BR': 'BR',
                        'UK': 'UK', 'GB': 'UK', 'DE': 'DE', 'FR': 'FR', 
                        'ES': 'ES', 'IT': 'IT', 'NL': 'NL', 'SE': 'SE', 
                        'PL': 'PL', 'BE': 'BE',
                        'JP': 'JP', 'AU': 'AU', 'SG': 'SG', 'IN': 'IN', 
                        'AE': 'AE', 'SA': 'SA'
                    };
                    const targetCountryCode = countryCodeMap[country] || country;
                    
                    const matchingProfile = profiles.find(p => 
                        p.countryCode === targetCountryCode || 
                        p.countryCode?.toUpperCase() === country?.toUpperCase()
                    ) || profiles[0];
                    
                    profileId = matchingProfile.profileId?.toString();
                    logger.info(`✅ [testGetPPCUnitsSold] Auto-selected profile ID: ${profileId} for country: ${matchingProfile.countryCode}`);
                } else {
                    return res.status(400).json(
                        new ApiError(400, 'Could not find any Amazon Ads profiles for this account', {
                            suggestion: 'Please ensure you have active Amazon Advertising campaigns.'
                        })
                    );
                }
            } catch (profileError) {
                logger.error('⚠️ [testGetPPCUnitsSold] Error fetching profile ID:', profileError.message);
                return res.status(400).json(
                    new ApiError(400, 'Failed to fetch Amazon Ads profile ID', {
                        message: profileError.message
                    })
                );
            }
        }

        logger.info('🚀 [testGetPPCUnitsSold] Starting units sold fetch:', {
            userId,
            country,
            region,
            profileId,
            hasAccessToken: !!adsAccessToken,
            startDate: startDate || 'auto (30 days ago)',
            endDate: endDate || 'auto (yesterday)'
        });

        // Fetch PPC units sold data (with saveToDatabase: true to persist data)
        const result = await getPPCUnitsSold(
            adsAccessToken,
            profileId,
            userId,
            country,
            region,
            sellerAccount.adsRefreshToken,
            startDate,
            endDate,
            true  // saveToDatabase = true - ensures data is saved for dashboard use
        );

        if (!result.success) {
            return res.status(500).json(
                new ApiError(500, 'Failed to fetch PPC units sold data', {
                    message: result.message || result.error
                })
            );
        }

        // Format the response
        return res.status(200).json(
            new ApiResponse(200, {
                dateRange: result.data.dateRange,
                totalUnits: result.data.totalUnits,
                summary: result.data.summary,
                campaignTypeBreakdown: result.data.campaignTypeBreakdown,
                dateWiseUnits: result.data.dateWiseUnits,
                processedCampaignTypes: result.data.processedCampaignTypes,
                metadata: {
                    userId,
                    country,
                    region,
                    profileId,
                    processedAt: result.metadata.processedAt
                }
            }, 'PPC units sold data fetched successfully')
        );

    } catch (error) {
        logger.error('❌ [testGetPPCUnitsSold] Error:', {
            message: error.message,
            stack: error.stack
        });

        // Handle specific error cases
        if (error.response) {
            const status = error.response.status || 500;
            const errorData = error.response.data || {};

            if (status === 401 || status === 403) {
                return res.status(status).json(
                    new ApiError(status, 'Authentication Error', {
                        message: error.message,
                        details: errorData,
                        suggestion: 'Please reconnect your Amazon Ads account.'
                    })
                );
            }

            if (status === 429) {
                return res.status(status).json(
                    new ApiError(status, 'Rate Limit Exceeded', {
                        message: 'Too many requests. Please wait before making another request.',
                        suggestion: 'The API has rate limits. Please wait a moment and try again.'
                    })
                );
            }

            return res.status(status).json(
                new ApiError(status, 'Amazon Ads API Error', {
                    message: error.message,
                    details: errorData
                })
            );
        }

        return res.status(500).json(
            new ApiError(500, 'Internal Server Error', {
                message: error.message || 'An unexpected error occurred while fetching PPC units sold data'
            })
        );
    }
};

/**
 * GET /api/test/ppc-units-sold/info
 * Get information about available units sold metrics
 */
const getUnitsMetricsInfo = async (req, res) => {
    return res.status(200).json(
        new ApiResponse(200, {
            description: 'PPC Units Sold API provides date-wise breakdown of units sold across different campaign types',
            availableMetrics: {
                sponsoredProducts: {
                    metrics: [
                        'unitsSoldClicks1d - Units sold within 1 day of click',
                        'unitsSoldClicks7d - Units sold within 7 days of click (standard)',
                        'unitsSoldClicks14d - Units sold within 14 days of click',
                        'unitsSoldClicks30d - Units sold within 30 days of click'
                    ],
                    primaryAttribution: '7 days'
                },
                sponsoredBrands: {
                    metrics: [
                        'unitsSold14d - Total units sold within 14 days',
                        'newToBrandUnitsSold14d - Units sold to new-to-brand customers'
                    ],
                    primaryAttribution: '14 days'
                },
                sponsoredDisplay: {
                    metrics: [
                        'unitsSold14d - Total units sold within 14 days'
                    ],
                    primaryAttribution: '14 days'
                }
            },
            requestFormat: {
                method: 'POST',
                endpoint: '/api/test/ppc-units-sold',
                body: {
                    userId: 'string (required)',
                    country: 'string (required) - US, UK, DE, etc.',
                    region: 'string (required) - NA, EU, FE',
                    startDate: 'string (optional) - YYYY-MM-DD format, defaults to 30 days ago',
                    endDate: 'string (optional) - YYYY-MM-DD format, defaults to yesterday'
                }
            },
            responseFormat: {
                dateRange: { startDate: 'YYYY-MM-DD', endDate: 'YYYY-MM-DD' },
                totalUnits: {
                    units1d: 'number',
                    units7d: 'number (primary for SP)',
                    units14d: 'number (primary for SB/SD)',
                    units30d: 'number',
                    newToBrandUnits: 'number'
                },
                summary: {
                    primaryUnits: 'number (7-day units for SP)',
                    totalUnits14d: 'number',
                    newToBrandUnits: 'number',
                    newToBrandPercentage: 'number',
                    averageDailyUnits: 'number'
                },
                dateWiseUnits: 'array of { date, units1d, units7d, units14d, units30d, newToBrandUnits, sales, spend }'
            }
        }, 'PPC Units Sold API Information')
    );
};

module.exports = {
    testGetPPCUnitsSold,
    getUnitsMetricsInfo
};

