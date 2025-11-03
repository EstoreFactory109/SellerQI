const reverseAsin = require('./ReverseAsin');
const keywordTracking = require('./KeywordTracking');
const KeywordTrackingModel = require('../../models/KeywordTrackingModel');
const mongoose = require('mongoose');

const getKeywordData = async (asinArray, country, region, userId) => {
    const keywordData = [];
    // Sequential processing to reduce memory footprint
    const MAX_KEYWORDS_PER_ASIN = parseInt(process.env.MAX_KEYWORDS_PER_ASIN) || 200;

    for (const asin of asinArray) {
        try {
            const reverseAsinData = await reverseAsin(asin, country);
            const keywordList = Array.isArray(reverseAsinData.keyword_list) ? reverseAsinData.keyword_list : [];
            const keywordArray = keywordList.map(k => k.keyword).slice(0, MAX_KEYWORDS_PER_ASIN);

            const keywordTrackingData = await keywordTracking(keywordArray, asin, country);

            // Avoid logging huge payloads
            console.log('Final keywordTracking data:', {
                asin,
                count: Array.isArray(keywordTrackingData) ? keywordTrackingData.length : 0,
                sample: Array.isArray(keywordTrackingData) && keywordTrackingData[0] ? keywordTrackingData[0] : null
            });

            const mergedData = keywordList.map(reverseKeyword => {
            // Find matching keyword in tracking data
            const trackingKeyword = keywordTrackingData.find(trackKeyword => 
                trackKeyword.keyword && trackKeyword.keyword.toLowerCase() === reverseKeyword.keyword.toLowerCase()
            );
            
            // Helper function to convert "N/A" to null and parse numbers
            const parseRank = (value) => {
                if (value === "N/A" || value === null || value === undefined) return null;
                const num = Number(value);
                return isNaN(num) ? null : num;
            };

            // Helper function to parse searchVolume (handles strings like "<100" or "117")
            const parseSearchVolume = (value) => {
                if (!value || value === null || value === undefined) return 0;
                if (typeof value === 'number') return value;
                if (typeof value === 'string') {
                    // Handle "<100" format
                    if (value.startsWith('<')) {
                        const num = Number(value.substring(1));
                        return isNaN(num) ? 0 : Math.floor(num / 2); // Use midpoint as estimate
                    }
                    const num = Number(value);
                    return isNaN(num) ? 0 : num;
                }
                return 0;
            };

            // Normalize competition value to match enum
            const normalizeCompetition = (value) => {
                if (!value || value === 'unknown') return 'unknown';
                const normalized = value.toLowerCase();
                if (['low', 'medium', 'high'].includes(normalized)) {
                    return normalized;
                }
                return 'unknown';
            };

            // Create merged object
            const mergedKeyword = {
                asin: asin,
                keyword: reverseKeyword.keyword,
                // Reverse ASIN data
                searchVolume: parseSearchVolume(reverseKeyword.search_volume),
                competition: normalizeCompetition(reverseKeyword.competition),
                difficulty: Number(reverseKeyword.difficulty) || 0,
                cpc: Number(reverseKeyword.cpc) || 0,
                // Keyword tracking data (if available)
                rank: trackingKeyword ? parseRank(trackingKeyword.ProductRank) : null,
                pageRank: trackingKeyword ? parseRank(trackingKeyword["Page Rank"]) : null,
                isIndexed: trackingKeyword ? (trackingKeyword["Is Indexed"] === 1 || trackingKeyword["Is Indexed"] === true) : null,
                isSponsored: trackingKeyword ? (trackingKeyword.is_sponsored === 1 || trackingKeyword.is_sponsored === true) : false,
                // Country and region info
                country: country,
                region: region
            };
            
            return mergedKeyword;
        });
            keywordData.push(...mergedData);
        } catch (err) {
            console.error('[Integrate] Error processing ASIN', { asin, country, region, error: err.message });
        }
    }
    
    // Save to database if userId is provided
    console.log(`[Database Save] userId: ${userId}, keywordData length: ${keywordData.length}`);
    
    if (!userId) {
        console.warn('[Database Save] userId not provided, skipping database save');
    } else if (!keywordData || keywordData.length === 0) {
        console.warn('[Database Save] No keyword data to save, skipping database save');
    } else {
    
    try {
        // Validate userId is a valid ObjectId
        if (!mongoose.Types.ObjectId.isValid(userId)) {
            throw new Error(`Invalid userId format: ${userId}. Must be a valid MongoDB ObjectId.`);
        }

        console.log(`[Database Save] Validating userId: ${userId}`);
        const userIdObjectId = new mongoose.Types.ObjectId(userId);

        // Check if a record already exists for this user, country, and region
        console.log(`[Database Save] Checking for existing record - userId: ${userId}, country: ${country}, region: ${region}`);
        let existingRecord = await KeywordTrackingModel.findOne({
            userId: userIdObjectId,
            country: country,
            region: region
        });
        
        if (existingRecord) {
            console.log(`[Database Save] Found existing record with ID: ${existingRecord._id}, updating with ${keywordData.length} keywords`);
            
            // Update existing record with new keywords
            existingRecord.keywords = keywordData.map(keyword => ({
                asin: keyword.asin,
                keyword: keyword.keyword,
                searchVolume: keyword.searchVolume,
                competition: keyword.competition,
                difficulty: keyword.difficulty,
                cpc: keyword.cpc,
                rank: keyword.rank,
                pageRank: keyword.pageRank,
                isIndexed: keyword.isIndexed,
                isSponsored: keyword.isSponsored,
                createdAt: new Date(),
                updatedAt: new Date()
            }));
            
            console.log(`[Database Save] Calling save() on existing record...`);
            await existingRecord.save();
            
            // Verify the record was actually updated
            const verifyRecord = await KeywordTrackingModel.findById(existingRecord._id);
            if (verifyRecord && verifyRecord.keywords.length === keywordData.length) {
                console.log(`[Database Save] ✅ Successfully updated existing keyword tracking record for user ${userId} in ${country}/${region}`);
                console.log(`[Database Save] Verified: Record exists in database with ${verifyRecord.keywords.length} keywords`);
            } else {
                console.error(`[Database Save] ⚠️ Record updated but verification failed! Expected ${keywordData.length} keywords, got ${verifyRecord ? verifyRecord.keywords.length : 0}`);
            }
        } else {
            console.log(`[Database Save] No existing record found, creating new record with ${keywordData.length} keywords`);
            
            // Create new record
            const keywordTrackingRecord = new KeywordTrackingModel({
                userId: userIdObjectId,
                country: country,
                region: region,
                keywords: keywordData.map(keyword => ({
                    asin: keyword.asin,
                    keyword: keyword.keyword,
                    searchVolume: keyword.searchVolume,
                    competition: keyword.competition,
                    difficulty: keyword.difficulty,
                    cpc: keyword.cpc,
                    rank: keyword.rank,
                    pageRank: keyword.pageRank,
                    isIndexed: keyword.isIndexed,
                    isSponsored: keyword.isSponsored,
                    createdAt: new Date(),
                    updatedAt: new Date()
                }))
            });
            
            console.log(`[Database Save] Attempting to save record with ${keywordTrackingRecord.keywords.length} keywords`);
            console.log(`[Database Save] Sample keyword data:`, JSON.stringify(keywordTrackingRecord.keywords[0], null, 2));
            
            const savedRecord = await keywordTrackingRecord.save();
            
            // Verify the record was actually saved
            const verifyRecord = await KeywordTrackingModel.findById(savedRecord._id);
            if (verifyRecord) {
                console.log(`[Database Save] ✅ Successfully created new keyword tracking record for user ${userId} in ${country}/${region} with ${keywordData.length} keywords. Record ID: ${savedRecord._id}`);
                console.log(`[Database Save] Verified: Record exists in database with ${verifyRecord.keywords.length} keywords`);
            } else {
                console.error(`[Database Save] ⚠️ Record saved but verification failed! Record ID: ${savedRecord._id}`);
            }
        }
    } catch (error) {
        console.error('[Database Save] ❌ Error saving keyword tracking data to database:');
        console.error('[Database Save] Error message:', error.message);
        console.error('[Database Save] Error stack:', error.stack);
        console.error('[Database Save] Error details:', JSON.stringify(error, null, 2));
        
        // Check if it's a validation error
        if (error.name === 'ValidationError') {
            console.error('[Database Save] Validation errors:', error.errors);
        }
        
        // Re-throw the error so it can be handled upstream
        throw error;
    }
    }
    
    return keywordData;
}

module.exports = getKeywordData;