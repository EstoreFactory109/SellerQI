const reverseAsin = require('./ReverseAsin');
const keywordTracking = require('./KeywordTracking');

const getKeywordData = async (asinArray,country,region)=>{
    const keywordData = [];
    await Promise.all(asinArray.map(async (asin)=>{
        const reverseAsinData = await reverseAsin(asin, country);
        const keywordArray = reverseAsinData.keyword_list.map(keywordData=>keywordData.keyword);
        const keywordTrackingData = await keywordTracking(keywordArray,asin,country);
        
        // Merge reverse ASIN data with keyword tracking data based on keywords
        const mergedData = reverseAsinData.keyword_list.map(reverseKeyword => {
            // Find matching keyword in tracking data
            const trackingKeyword = keywordTrackingData.find(trackKeyword => 
                trackKeyword.keyword && trackKeyword.keyword.toLowerCase() === reverseKeyword.keyword.toLowerCase()
            );
            
            // Create merged object
            const mergedKeyword = {
                asin: asin,
                keyword: reverseKeyword.keyword,
                // Reverse ASIN data
                searchVolume: reverseKeyword.search_volume || 0,
                competition: reverseKeyword.competition || 'unknown',
                difficulty: reverseKeyword.difficulty || 0,
                cpc: reverseKeyword.cpc || 0,
                // Keyword tracking data (if available)
                rank: trackingKeyword ? trackingKeyword.rank : null,
                isIndexed: trackingKeyword ? trackingKeyword.is_indexed : null,
                lastChecked: trackingKeyword ? trackingKeyword.last_checked : null,
                // Additional tracking metrics
                impressions: trackingKeyword ? trackingKeyword.impressions : 0,
                clicks: trackingKeyword ? trackingKeyword.clicks : 0,
                ctr: trackingKeyword ? trackingKeyword.ctr : 0,
                // Country and region info
                country: country,
                region: region
            };
            
            return mergedKeyword;
        });
        
        // Add merged data to keywordData array
        keywordData.push(...mergedData);
    }));
    
    return keywordData;
}

module.exports = getKeywordData;