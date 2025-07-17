const axios = require('axios');
const KeywordModel = require('../../models/keywordModel.js');


const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
};


async function getKeywords(accessToken, profileId, userId, country, region = 'NA') {
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

        if (!country) {
            throw new Error('Country is required');
        }

        // Validate region
        if (!BASE_URIS[region]) {
            throw new Error(`Invalid region: ${region}. Must be NA, EU, or FE`);
        }

        // Get client ID from environment variables
        const clientId = process.env.AMAZON_ADS_CLIENT_ID;
        if (!clientId) {
            throw new Error('AMAZON_ADVERTISING_CLIENT_ID not found in environment variables');
        }

        console.log(`📡 Getting keywords for region: ${region}, country: ${country}, userId: ${userId}`);

        // Construct the base URL
        const baseUrl = BASE_URIS[region];

        // Configure the request
        const config = {
            method: 'GET',
            url: `${baseUrl}/v2/keywords`,
            headers: {
                'Authorization': `Bearer ${accessToken}`,
                'Amazon-Advertising-API-ClientId': clientId,
                'Amazon-Advertising-API-Scope': profileId,
                'Content-Type': 'application/json'
            },
            params: {
                stateFilter:'enabled'
            }
        };

        // Make the request
        const response = await axios(config);

        // ===== VALIDATE API RESPONSE =====
        if (!response || !response.data) {
            throw new Error('Invalid response from Amazon Ads API - no data received');
        }

        if (!Array.isArray(response.data)) {
            console.warn('Keywords API response is not an array', { 
                responseType: typeof response.data,
                userId,
                region,
                country 
            });
            // Convert to array if it's not
            response.data = [];
        }

        console.log(`✅ Keywords API response received: ${response.data.length} keywords`);

        // ===== HANDLE EMPTY KEYWORDS GRACEFULLY =====
        if (response.data.length === 0) {
            console.warn('No keywords found for user', { userId, region, country });
            
            // Still save empty result to database for consistency
            const createdKeywords = await KeywordModel.findOneAndUpdate(
                { 
                    userId: userId,
                    country: country,
                    region: region 
                },
                { 
                    keywordData: []
                },
                { 
                    new: true, 
                    upsert: true 
                }
            );
            
            console.log(`✅ Empty keywords data saved for consistency`);
            return createdKeywords;
        } else {
            // Log some stats about the keywords
            const enabledKeywords = response.data.filter(keyword => 
                keyword && keyword.state === 'enabled'
            );
            console.log(`📊 Keywords breakdown: ${response.data.length} total, ${enabledKeywords.length} enabled`);
        }
        
        // ===== SAVE TO DATABASE WITH VALIDATION =====
        let createdKeywords;
        try {
            // Update if exists, create if not to prevent duplicates
            createdKeywords = await KeywordModel.findOneAndUpdate(
                { 
                    userId: userId,
                    country: country,
                    region: region 
                },
                { 
                    keywordData: response.data
                },
                { 
                    new: true, 
                    upsert: true 
                }
            );
            
            if (!createdKeywords) {
                // Log warning but don't fail - return the data anyway
                console.warn('Failed to save keywords data to database, but continuing with API data', { 
                    userId, 
                    region, 
                    country,
                    keywordCount: response.data.length 
                });
                
                // Return a mock object with the data for consistency
                return {
                    userId,
                    country,
                    region,
                    keywordData: response.data,
                    _isTemporary: true // Flag to indicate this wasn't saved to DB
                };
            }

            console.log(`✅ Keywords data saved successfully: ${response.data.length} keywords stored`);
            return createdKeywords;

        } catch (dbError) {
            console.error('Database error while saving keywords data', { 
                error: dbError.message, 
                userId, 
                region, 
                country,
                keywordCount: response.data.length
            });
            
            // Return the data anyway, even if DB save failed
            return {
                userId,
                country,
                region,
                keywordData: response.data,
                _isTemporary: true,
                _dbError: dbError.message
            };
        }

    } catch (error) {
        // ===== ENHANCED ERROR HANDLING FOR TOKEN MANAGER =====
        if (error.response) {
            // The request was made and the server responded with a status code
            // that falls out of the range of 2xx
            console.error('❌ Keywords API Error Response:', {
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
            console.error('❌ No response received from Keywords API:', {
                request: error.request,
                userId,
                region,
                country
            });
            throw new Error('No response received from Amazon Ads API');
        } else {
            // Something happened in setting up the request that triggered an Error
            console.error('❌ Keywords API request setup error:', {
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
    getKeywords
};