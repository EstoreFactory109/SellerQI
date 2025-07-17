const axios = require('axios');
const NegativeKeywords = require('../../models/NegetiveKeywords.js');


const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
};


// Helper function to chunk arrays into smaller pieces
function chunkArray(array, chunkSize) {
    const chunks = [];
    for (let i = 0; i < array.length; i += chunkSize) {
        chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
}

async function getNegativeKeywords(accessToken, profileId, userId, country, region = 'NA', campaignIdArray, adGroupIdArray) {
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

        // VALIDATE INPUT ARRAYS
        if (!Array.isArray(campaignIdArray)) {
            console.warn('Campaign ID array is not an array, converting to empty array', { campaignIdArray, userId });
            campaignIdArray = [];
        }

        if (!Array.isArray(adGroupIdArray)) {
            console.warn('Ad Group ID array is not an array, converting to empty array', { adGroupIdArray, userId });
            adGroupIdArray = [];
        }

        // Filter out invalid IDs
        const validCampaignIds = campaignIdArray.filter(id => id !== null && id !== undefined && id !== '');
        const validAdGroupIds = adGroupIdArray.filter(id => id !== null && id !== undefined && id !== '');

        console.log(`📊 Negative Keywords Input Validation:`, {
            originalCampaignIds: campaignIdArray.length,
            validCampaignIds: validCampaignIds.length,
            originalAdGroupIds: adGroupIdArray.length,
            validAdGroupIds: validAdGroupIds.length,
            userId
        });

        // Check if we have any valid IDs to work with
        if (validCampaignIds.length === 0 && validAdGroupIds.length === 0) {
            console.warn('No valid campaign or ad group IDs provided, returning empty negative keywords result', { userId, region, country });
            
            // Save empty result to database for consistency
            const negativeKeywords = await NegativeKeywords.findOneAndUpdate(
                { 
                    userId: userId,
                    country: country,
                    region: region 
                },
                { 
                    negativeKeywordsData: []
                },
                { 
                    new: true, 
                    upsert: true 
                }
            );
            
            return negativeKeywords;
        }

        // Construct the base URL
        const baseUrl = BASE_URIS[region];

        // Chunk the arrays into groups of 50
        const campaignIdChunks = chunkArray(validCampaignIds, 50);
        const adGroupIdChunks = chunkArray(validAdGroupIds, 50);

        // If one array is empty, create a single chunk with empty array to ensure at least one iteration
        const finalCampaignChunks = campaignIdChunks.length > 0 ? campaignIdChunks : [[]];
        const finalAdGroupChunks = adGroupIdChunks.length > 0 ? adGroupIdChunks : [[]];

        // Array to store all fetched data
        let allNegativeKeywordsData = [];

        console.log(`📡 Processing ${finalCampaignChunks.length} campaign chunks × ${finalAdGroupChunks.length} ad group chunks for negative keywords`);

        // Fetch data for each combination of chunks
        for (const campaignChunk of finalCampaignChunks) {
            for (const adGroupChunk of finalAdGroupChunks) {
                try {
                    // Skip if both chunks are empty
                    if (campaignChunk.length === 0 && adGroupChunk.length === 0) {
                        continue;
                    }

                    // Build query parameters dynamically
                    const params = {};
                    if (campaignChunk.length > 0) {
                        params.campaignIdFilter = campaignChunk.join(',');
                    }
                    if (adGroupChunk.length > 0) {
                        params.adGroupIdFilter = adGroupChunk.join(',');
                    }

                    // Configure the request for current chunks
                    const config = {
                        method: 'GET',
                        url: `${baseUrl}/v2/negativeKeywords`,
                        headers: {
                            'Authorization': `Bearer ${accessToken}`,
                            'Amazon-Advertising-API-ClientId': clientId,
                            'Amazon-Advertising-API-Scope': profileId,
                            'Content-Type': 'application/json'
                        },
                        params: params
                    };

                    // Make the request for current chunk combination
                    const response = await axios(config);

                    if (response && response.data && response.data.length > 0) {
                        // Process and add the chunk data to the main array
                        const chunkData = response.data.map(item => ({
                            campaignId: item.campaignId || '',
                            adGroupId: item.adGroupId || '',
                            keywordId: item.keywordId || '',
                            keywordText: item.keywordText || '',
                            state: item.state || 'enabled'
                        }));
                        
                        allNegativeKeywordsData.push(...chunkData);
                        console.log(`✅ Negative keywords chunk processed: ${chunkData.length} keywords`);
                    }

                    // Add a small delay between requests to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (chunkError) {
                    console.error(`Error fetching negative keywords chunk - Campaign IDs: ${campaignChunk.join(',')}, AdGroup IDs: ${adGroupChunk.join(',')}:`, chunkError.message);
                    // Continue with other chunks even if one fails
                    continue;
                }
            }
        }

        // Remove duplicates based on keywordId (if any)
        const uniqueNegativeKeywordsData = allNegativeKeywordsData.filter((item, index, self) => 
            index === self.findIndex(t => t.keywordId === item.keywordId)
        );

        console.log(`✅ Negative keywords processing complete: ${uniqueNegativeKeywordsData.length} unique keywords found`);

        // Save all merged data to database (update if exists, create if not)
        const negativeKeywords = await NegativeKeywords.findOneAndUpdate(
            { 
                userId: userId,
                country: country,
                region: region 
            },
            { 
                negativeKeywordsData: uniqueNegativeKeywordsData
            },
            { 
                new: true, 
                upsert: true 
            }
        );
        
        if(!negativeKeywords){
            return false;
        }
        return negativeKeywords;

    } catch (error) {
        console.error('Error in getNegativeKeywords:', error.message);
        throw error;
    }
}

module.exports = {
    getNegativeKeywords
};