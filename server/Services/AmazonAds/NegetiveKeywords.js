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

        // Construct the base URL
        const baseUrl = BASE_URIS[region];

        // Chunk the arrays into groups of 50
        const campaignIdChunks = chunkArray(campaignIdArray, 50);
        const adGroupIdChunks = chunkArray(adGroupIdArray, 50);

        // Array to store all fetched data
        let allNegativeKeywordsData = [];

        // Fetch data for each combination of chunks
        for (const campaignChunk of campaignIdChunks) {
            for (const adGroupChunk of adGroupIdChunks) {
                try {
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
                        params: {
                            campaignIdFilter: campaignChunk.join(','),
                            adGroupIdFilter: adGroupChunk.join(',')
                        }
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
                    }

                    // Add a small delay between requests to avoid rate limiting
                    await new Promise(resolve => setTimeout(resolve, 100));
                    
                } catch (chunkError) {
                    console.error(`Error fetching chunk - Campaign IDs: ${campaignChunk.join(',')}, AdGroup IDs: ${adGroupChunk.join(',')}:`, chunkError.message);
                    // Continue with other chunks even if one fails
                    continue;
                }
            }
        }

        // Remove duplicates based on keywordId (if any)
        const uniqueNegativeKeywordsData = allNegativeKeywordsData.filter((item, index, self) => 
            index === self.findIndex(t => t.keywordId === item.keywordId)
        );

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


module.exports = { getNegativeKeywords }