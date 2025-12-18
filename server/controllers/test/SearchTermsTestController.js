/**
 * Search Terms Test Controller
 * 
 * Test endpoints for Search Terms functionality with adGroup support
 * No authentication required (for Postman testing)
 */

const SearchTerms = require('../../models/amazon-ads/SearchTermsModel.js');
const AdsGroup = require('../../models/amazon-ads/adsgroupModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { ApiResponse } = require('../../utils/ApiResponse.js');
const { ApiError } = require('../../utils/ApiError.js');
const { generateAdsAccessToken } = require('../../Services/AmazonAds/GenerateToken.js');
const { getProfileById } = require('../../Services/AmazonAds/GenerateProfileId.js');
const { getSearchKeywords } = require('../../Services/AmazonAds/GetSearchKeywords.js');
const logger = require('../../utils/Logger.js');

/**
 * GET /api/test/search-terms/get
 * Get search terms data from database
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc"
 * }
 */
const testGetSearchTerms = async (req, res) => {
    try {
        const { userId, region, country } = req.body;

        // Validate required fields
        if (!userId || !region || !country) {
            return res.status(400).json(
                new ApiError(400, 'Missing required fields: userId, region, and country are required')
            );
        }

        logger.info('Test: Fetching search terms', { userId, region, country });

        // Find the latest search terms data
        const searchTermsData = await SearchTerms.findOne({ 
            userId, 
            region, 
            country 
        }).sort({ createdAt: -1 });

        if (!searchTermsData) {
            return res.status(404).json(
                new ApiError(404, 'No search terms data found for the specified user, region, and country')
            );
        }

        const searchTerms = searchTermsData.searchTermData || [];

        // Get adGroups data for matching
        const adsGroups = await AdsGroup.find({ userId, region, country }).sort({ createdAt: -1 });
        const latestAdsGroups = adsGroups[0]?.adsGroupData || [];

        // Helper function to get adGroup name (same as frontend)
        const getAdGroupName = (searchTerm) => {
            if (!searchTerm || !latestAdsGroups.length) return 'N/A';
            
            // First try to find by adGroupId if available
            if (searchTerm.adGroupId) {
                const adGroup = latestAdsGroups.find(ag => ag.adGroupId === searchTerm.adGroupId);
                if (adGroup) return adGroup.name;
            }
            
            // Then try to find by campaignId (get first adGroup for that campaign)
            if (searchTerm.campaignId) {
                const adGroup = latestAdsGroups.find(ag => ag.campaignId === searchTerm.campaignId);
                if (adGroup) return adGroup.name;
            }
            
            return 'N/A';
        };

        // Enrich search terms with adGroup names if missing
        const enrichedSearchTerms = searchTerms.map(term => {
            const adGroupName = term.adGroupName || getAdGroupName(term);
            return {
                ...term.toObject ? term.toObject() : term,
                adGroupName: adGroupName !== 'N/A' ? adGroupName : (term.adGroupName || 'N/A'),
                hasAdGroup: !!(term.adGroupId || term.adGroupName || adGroupName !== 'N/A')
            };
        });

        // Statistics
        const stats = {
            totalSearchTerms: searchTerms.length,
            withAdGroupId: searchTerms.filter(t => t.adGroupId).length,
            withAdGroupName: searchTerms.filter(t => t.adGroupName).length,
            withImpressions: searchTerms.filter(t => t.impressions && t.impressions > 0).length,
            zeroSales: searchTerms.filter(t => t.sales === 0).length,
            highClicks: searchTerms.filter(t => t.clicks >= 10).length
        };

        return res.status(200).json(
            new ApiResponse(200, {
                metadata: {
                    userId,
                    region,
                    country,
                    fetchedAt: searchTermsData.createdAt,
                    dataAge: Math.floor((Date.now() - new Date(searchTermsData.createdAt).getTime()) / (1000 * 60 * 60)) + ' hours ago'
                },
                statistics: stats,
                searchTerms: enrichedSearchTerms,
                sample: enrichedSearchTerms.slice(0, 5) // First 5 as sample
            }, 'Search terms data retrieved successfully')
        );

    } catch (error) {
        logger.error('Error in testGetSearchTerms:', error);
        return res.status(500).json(
            new ApiError(500, `Error fetching search terms: ${error.message}`)
        );
    }
};

/**
 * POST /api/test/search-terms/filter
 * Filter search terms with various criteria
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc",
 *   "filters": {
 *     "minClicks": 10,
 *     "maxClicks": null,
 *     "zeroSales": true,
 *     "hasAdGroup": true,
 *     "campaignId": "campaign_id",
 *     "adGroupId": "adgroup_id"
 *   }
 * }
 */
const testFilterSearchTerms = async (req, res) => {
    try {
        const { userId, region, country, filters = {} } = req.body;

        // Validate required fields
        if (!userId || !region || !country) {
            return res.status(400).json(
                new ApiError(400, 'Missing required fields: userId, region, and country are required')
            );
        }

        logger.info('Test: Filtering search terms', { userId, region, country, filters });

        // Find the latest search terms data
        const searchTermsData = await SearchTerms.findOne({ 
            userId, 
            region, 
            country 
        }).sort({ createdAt: -1 });

        if (!searchTermsData) {
            return res.status(404).json(
                new ApiError(404, 'No search terms data found for the specified user, region, and country')
            );
        }

        let filteredTerms = searchTermsData.searchTermData || [];

        // Apply filters
        if (filters.minClicks !== undefined && filters.minClicks !== null) {
            filteredTerms = filteredTerms.filter(t => t.clicks >= filters.minClicks);
        }

        if (filters.maxClicks !== undefined && filters.maxClicks !== null) {
            filteredTerms = filteredTerms.filter(t => t.clicks <= filters.maxClicks);
        }

        if (filters.zeroSales === true) {
            filteredTerms = filteredTerms.filter(t => t.sales === 0);
        }

        if (filters.hasAdGroup === true) {
            filteredTerms = filteredTerms.filter(t => t.adGroupId || t.adGroupName);
        }

        if (filters.campaignId) {
            filteredTerms = filteredTerms.filter(t => t.campaignId === filters.campaignId);
        }

        if (filters.adGroupId) {
            filteredTerms = filteredTerms.filter(t => t.adGroupId === filters.adGroupId);
        }

        if (filters.searchTerm) {
            const searchLower = filters.searchTerm.toLowerCase();
            filteredTerms = filteredTerms.filter(t => 
                t.searchTerm?.toLowerCase().includes(searchLower) ||
                t.keyword?.toLowerCase().includes(searchLower)
            );
        }

        return res.status(200).json(
            new ApiResponse(200, {
                filters: filters,
                totalResults: filteredTerms.length,
                searchTerms: filteredTerms,
                sample: filteredTerms.slice(0, 10) // First 10 as sample
            }, 'Search terms filtered successfully')
        );

    } catch (error) {
        logger.error('Error in testFilterSearchTerms:', error);
        return res.status(500).json(
            new ApiError(500, `Error filtering search terms: ${error.message}`)
        );
    }
};

/**
 * POST /api/test/search-terms/stats
 * Get statistics about search terms with adGroup breakdown
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc"
 * }
 */
const testGetSearchTermsStats = async (req, res) => {
    try {
        const { userId, region, country } = req.body;

        // Validate required fields
        if (!userId || !region || !country) {
            return res.status(400).json(
                new ApiError(400, 'Missing required fields: userId, region, and country are required')
            );
        }

        logger.info('Test: Getting search terms statistics', { userId, region, country });

        // Find the latest search terms data
        const searchTermsData = await SearchTerms.findOne({ 
            userId, 
            region, 
            country 
        }).sort({ createdAt: -1 });

        if (!searchTermsData) {
            return res.status(404).json(
                new ApiError(404, 'No search terms data found for the specified user, region, and country')
            );
        }

        const searchTerms = searchTermsData.searchTermData || [];

        // Calculate statistics
        const stats = {
            total: searchTerms.length,
            withAdGroupId: searchTerms.filter(t => t.adGroupId).length,
            withAdGroupName: searchTerms.filter(t => t.adGroupName).length,
            withoutAdGroup: searchTerms.filter(t => !t.adGroupId && !t.adGroupName).length,
            withImpressions: searchTerms.filter(t => t.impressions && t.impressions > 0).length,
            zeroSales: searchTerms.filter(t => t.sales === 0).length,
            highClicks: searchTerms.filter(t => t.clicks >= 10).length,
            totalClicks: searchTerms.reduce((sum, t) => sum + (t.clicks || 0), 0),
            totalSales: searchTerms.reduce((sum, t) => sum + (t.sales || 0), 0),
            totalSpend: searchTerms.reduce((sum, t) => sum + (t.spend || 0), 0),
            totalImpressions: searchTerms.reduce((sum, t) => sum + (t.impressions || 0), 0),
            uniqueCampaigns: new Set(searchTerms.map(t => t.campaignId)).size,
            uniqueAdGroups: new Set(searchTerms.filter(t => t.adGroupId).map(t => t.adGroupId)).size
        };

        // AdGroup breakdown
        const adGroupBreakdown = {};
        searchTerms.forEach(term => {
            const adGroupId = term.adGroupId || 'no-adgroup';
            const adGroupName = term.adGroupName || 'No Ad Group';
            
            if (!adGroupBreakdown[adGroupId]) {
                adGroupBreakdown[adGroupId] = {
                    adGroupId: adGroupId === 'no-adgroup' ? null : adGroupId,
                    adGroupName,
                    count: 0,
                    totalClicks: 0,
                    totalSales: 0,
                    totalSpend: 0
                };
            }
            
            adGroupBreakdown[adGroupId].count++;
            adGroupBreakdown[adGroupId].totalClicks += term.clicks || 0;
            adGroupBreakdown[adGroupId].totalSales += term.sales || 0;
            adGroupBreakdown[adGroupId].totalSpend += term.spend || 0;
        });

        return res.status(200).json(
            new ApiResponse(200, {
                metadata: {
                    userId,
                    region,
                    country,
                    fetchedAt: searchTermsData.createdAt
                },
                statistics: stats,
                adGroupBreakdown: Object.values(adGroupBreakdown).slice(0, 20) // Top 20 adGroups
            }, 'Search terms statistics retrieved successfully')
        );

    } catch (error) {
        logger.error('Error in testGetSearchTermsStats:', error);
        return res.status(500).json(
            new ApiError(500, `Error getting search terms statistics: ${error.message}`)
        );
    }
};

/**
 * POST /api/test/search-terms/fetch
 * Fetch new search terms data from Amazon Ads API
 * 
 * Request body:
 * {
 *   "userId": "user_id_string",
 *   "region": "NA|EU|FE",
 *   "country": "US|CA|UK|AU|etc",
 *   "refreshToken": "optional_refresh_token",
 *   "accessToken": "optional_access_token",
 *   "profileId": "optional_profile_id"
 * }
 */
const testFetchSearchTerms = async (req, res) => {
    // Immediate console.log to verify function is called
    console.log('🟢 [Test] testFetchSearchTerms CONTROLLER function called at', new Date().toISOString());
    
    try {
        logger.info('🚀 [Test] testFetchSearchTerms function called', {
            method: req.method,
            url: req.url,
            bodyKeys: Object.keys(req.body || {}),
            timestamp: new Date().toISOString()
        });

        const { userId, region, country, refreshToken, accessToken, profileId } = req.body;

        logger.info('📥 [Test] Request body parsed', {
            userId: !!userId,
            region: !!region,
            country: !!country,
            refreshToken: !!refreshToken,
            accessToken: !!accessToken,
            profileId: !!profileId
        });

        // Validate required fields
        if (!userId || !region || !country) {
            logger.error('❌ [Test] Missing required fields', { userId: !!userId, region: !!region, country: !!country });
            return res.status(400).json(
                new ApiError(400, 'Missing required fields: userId, region, and country are required')
            );
        }

        logger.info('✅ [Test] All required fields present, proceeding to fetch tokens', { 
            userId, 
            region, 
            country,
            hasRefreshToken: !!refreshToken,
            hasAccessToken: !!accessToken,
            hasProfileId: !!profileId
        });

        // Get refreshToken from seller account if not provided
        // Trim and validate tokens (handle empty strings)
        let finalRefreshToken = refreshToken && typeof refreshToken === 'string' && refreshToken.trim() ? refreshToken.trim() : null;
        let finalAccessToken = accessToken && typeof accessToken === 'string' && accessToken.trim() ? accessToken.trim() : null;
        let finalProfileId = profileId && typeof profileId === 'string' && profileId.trim() ? profileId.trim() : null;

        logger.info('Token validation', {
            finalRefreshToken: !!finalRefreshToken,
            finalAccessToken: !!finalAccessToken,
            finalProfileId: !!finalProfileId,
            willFetchFromDB: !finalRefreshToken || !finalAccessToken || !finalProfileId
        });

        if (!finalRefreshToken || !finalAccessToken || !finalProfileId) {
            logger.info('Fetching tokens from Seller account', { userId, region, country });
            
            const sellerDoc = await Seller.findOne({ User: userId }).lean();

            if (!sellerDoc) {
                return res.status(404).json(
                    new ApiError(404, 'No seller account found for this user')
                );
            }

            const accounts = Array.isArray(sellerDoc.sellerAccount) 
                ? sellerDoc.sellerAccount 
                : [];

            // Try to find matching region + country
            let matchedAccount = accounts.find(
                (acc) => acc && acc.country === country && acc.region === region
            );

            // If not found, fall back to first available account
            if (!matchedAccount && accounts.length > 0) {
                logger.warn('No exact match found, using first available account');
                matchedAccount = accounts[0];
            }

            if (!matchedAccount) {
                return res.status(404).json(
                    new ApiError(404, 'No seller account found for the specified region and country')
                );
            }

            // Get refreshToken if not provided
            if (!finalRefreshToken) {
                finalRefreshToken = matchedAccount.adsRefreshToken;
            }

            if (!finalRefreshToken) {
                logger.error('No refreshToken found after seller account lookup');
                return res.status(404).json(
                    new ApiError(404, 'adsRefreshToken not found. Please provide refreshToken in request body or ensure seller account has adsRefreshToken.')
                );
            }
        } else {
            logger.info('All tokens provided in request body, skipping seller account lookup');
        }

        // Generate access token if not provided
        if (!finalAccessToken && finalRefreshToken) {
            logger.info('Generating access token from refresh token');
            finalAccessToken = await generateAdsAccessToken(finalRefreshToken);
            
            if (!finalAccessToken) {
                logger.error('Failed to generate access token');
                return res.status(500).json(
                    new ApiError(500, 'Failed to generate access token from refresh token')
                );
            }
            logger.info('Access token generated successfully');
        } else {
            logger.info('Access token already provided, skipping generation');
        }

        // Get profileId if not provided
        if (!finalProfileId && finalAccessToken) {
            logger.info('Getting profile ID from access token');
            const profileResult = await getProfileById(finalAccessToken, region);
            
            if (!profileResult || !profileResult.profileId) {
                logger.error('Failed to get profile ID', { profileResult });
                return res.status(500).json(
                    new ApiError(500, 'Failed to get profile ID from access token')
                );
            }
            
            finalProfileId = profileResult.profileId;
            logger.info('Profile ID retrieved successfully', { profileId: finalProfileId });
        } else {
            logger.info('Profile ID already provided, skipping lookup');
        }

        // Final validation before calling service
        logger.info('Final token validation before service call', {
            hasAccessToken: !!finalAccessToken,
            hasProfileId: !!finalProfileId,
            hasRefreshToken: !!finalRefreshToken,
            accessTokenLength: finalAccessToken?.length || 0,
            profileId: finalProfileId
        });

        if (!finalAccessToken || !finalProfileId) {
            logger.error('Missing required tokens after all attempts', {
                hasAccessToken: !!finalAccessToken,
                hasProfileId: !!finalProfileId
            });
            return res.status(400).json(
                new ApiError(400, 'Access token and profile ID are required. Provide them in request body or ensure seller account has valid tokens.')
            );
        }

        logger.info('Calling getSearchKeywords service', {
            userId,
            region,
            country,
            hasAccessToken: !!finalAccessToken,
            hasProfileId: !!finalProfileId,
            hasRefreshToken: !!finalRefreshToken,
            timestamp: new Date().toISOString()
        });

        // Call the service to fetch and store search terms
        let result;
        try {
            logger.info('🔄 [Test] Invoking getSearchKeywords service...');
            result = await getSearchKeywords(
                finalAccessToken,
                finalProfileId,
                userId,
                country,
                region,
                finalRefreshToken
            );
            logger.info('✅ [Test] getSearchKeywords service completed', {
                success: result?.success,
                hasData: !!result?.data,
                dataLength: result?.data?.searchTermData?.length || result?.data?.searchTermsData?.length || 0
            });
        } catch (serviceError) {
            logger.error('❌ [Test] Error calling getSearchKeywords service', {
                error: serviceError.message,
                stack: serviceError.stack,
                userId,
                region,
                country
            });
            return res.status(500).json(
                new ApiError(500, `Service error: ${serviceError.message}`)
            );
        }

        if (!result || !result.success) {
            logger.error('Failed to fetch search terms', {
                userId,
                region,
                country,
                error: result?.error || result?.message || 'Unknown error',
                result: result
            });
            return res.status(500).json(
                new ApiError(500, result?.error || result?.message || 'Failed to fetch search terms from Amazon Ads API')
            );
        }

        // Extract data from result
        const savedData = result.data;
        const searchTermsData = savedData?.searchTermData || savedData?.searchTermsData || [];

        logger.info('✅ [Test] Search terms fetched successfully', {
            totalCount: searchTermsData.length,
            savedToDb: !!savedData?._id,
            isTemporary: savedData?._isTemporary || false
        });

        return res.status(200).json(
            new ApiResponse(200, {
                message: result.message || 'Search terms data fetched successfully',
                serviceCalled: true,
                result: {
                    success: result.success,
                    message: result.message,
                    dataLength: searchTermsData.length,
                    isTemporary: savedData?._isTemporary || false,
                    dbError: savedData?._dbError || null
                },
                savedData: savedData ? {
                    id: savedData._id || 'N/A',
                    userId: savedData.userId,
                    region: savedData.region,
                    country: savedData.country,
                    createdAt: savedData.createdAt || new Date(),
                    searchTermsCount: searchTermsData.length,
                    searchTerms: searchTermsData // Return ALL search terms, not just sample
                } : null
            }, 'Search terms fetched successfully')
        );

    } catch (error) {
        logger.error('❌ [Test] Error in testFetchSearchTerms:', {
            error: error.message,
            stack: error.stack,
            name: error.name,
            userId: req.body?.userId,
            region: req.body?.region,
            country: req.body?.country
        });
        return res.status(500).json(
            new ApiError(500, `Error fetching search terms: ${error.message}`, {
                stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
            })
        );
    }
};

module.exports = {
    testGetSearchTerms,
    testFilterSearchTerms,
    testGetSearchTermsStats,
    testFetchSearchTerms
};

