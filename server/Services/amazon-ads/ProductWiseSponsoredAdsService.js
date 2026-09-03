/**
 * ProductWiseSponsoredAdsService.js
 * 
 * Service for managing Product-wise Sponsored Ads data in the database.
 * 
 * This service handles both old format (embedded sponsoredAds[] in a single document)
 * and new format (separate collection with one document per ad entry).
 * 
 * The migration is transparent - callers always receive data in the same format.
 */

const mongoose = require('mongoose');
const ProductWiseSponsoredAdsData = require('../../models/amazon-ads/ProductWiseSponseredAdsModel');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel');
const logger = require('../../utils/Logger');
const { getRedisClient } = require('../../config/redisConn');
const { insertManyChunked } = require('../../utils/chunkedInsert');

// Every ad type this collection stores, i.e. what "we measured everything" means. Mirrors the enum on
// ProductWiseSponsoredAdsItemModel.adType (:50-56); keep them in step.
const ALL_AD_TYPES = ['SP', 'SD'];

/**
 * Save Product-wise Sponsored Ads data to database
 * Always uses new format (separate collection) to prevent 16MB limit
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Array} sponsoredAdsArray - Array of sponsored ads items
 * @returns {Promise<Object>} Result with saved document info
 */
async function saveProductWiseSponsoredAdsData(userId, country, region, sponsoredAdsArray, options = {}) {
    try {
        // Which ad types this save actually MEASURED. The delete below is destructive and was scoped
        // only by date, so an SP-only save deleted the SD rows for those same dates and the SD half of
        // product-level ad spend vanished until a later full success. Scoping the delete to what we
        // measured is the fix.
        //
        // Defaults to every type, so a caller that cannot tell the difference gets today's exact
        // behaviour and nothing changes until it opts in.
        const usableAdTypes = Array.isArray(options.usableAdTypes) && options.usableAdTypes.length
            ? options.usableAdTypes
            : ALL_AD_TYPES;

        // Optional window for the ADOPTION step below. Adoption is otherwise scoped to the dates
        // present in THIS save, which is right for a combined save but not for a per-ad-type one:
        // a day the other ad type has and this one does not would be left in the previous batch
        // and go invisible to every newest-batch reader. Callers that save one ad type at a time
        // (the async finalize path) pass the report window so adoption covers every day the run
        // could have touched. Absent => previous behaviour exactly.
        const preserveDateRange = options.preserveDateRange &&
            options.preserveDateRange.startDate && options.preserveDateRange.endDate
            ? options.preserveDateRange
            : null;

        if (!userId) {
            throw new Error('User ID is required');
        }
        if (!country || !region) {
            throw new Error('Country and region are required');
        }

        // Convert userId to ObjectId if it's a string
        let userObjectId;
        try {
            userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
        } catch (err) {
            throw new Error(`Invalid User ID format: ${userId}`);
        }

        const itemCount = sponsoredAdsArray?.length || 0;

        logger.info('Saving Product-wise Sponsored Ads data using separate collection', {
            userId: userObjectId.toString(),
            country,
            region,
            itemCount
        });

        // Generate a batch ID to group all items from this save operation
        const batchId = new mongoose.Types.ObjectId();

        // If no data, just return success with 0 count
        if (itemCount === 0) {
            logger.info('No Sponsored Ads data to save');
            return {
                success: true,
                message: 'No data to save',
                itemCount: 0,
                batchId: batchId.toString()
            };
        }

        // Map to ProductWiseSponsoredAdsItem schema (adType, sales, purchases, …)
        const itemsToInsert = sponsoredAdsArray
            .filter((item) => item?.asin && item?.campaignId && item?.date)
            .map((item) => ({
                userId: userObjectId,
                country,
                region,
                batchId,
                adType: item.adType === 'SD' ? 'SD' : 'SP',
                date: item.date,
                asin: item.asin,
                sku: item.sku || '',
                spend: Number(item.spend) || 0,
                sales: Number(item.sales ?? item.salesIn7Days ?? item.salesIn14Days ?? item.salesIn30Days) || 0,
                purchases: Number(item.purchases ?? item.purchasedIn7Days ?? item.purchasedIn14Days ?? item.purchasedIn30Days) || 0,
                unitsSoldClicks: Number(item.unitsSoldClicks) || 0,
                campaignId: item.campaignId,
                campaignName: item.campaignName || 'Unknown',
                impressions: Number(item.impressions) || 0,
                adGroupId: item.adGroupId || '',
                adGroupName: item.adGroupName || '',
                clicks: Number(item.clicks) || 0,
            }));

        if (itemsToInsert.length === 0) {
            logger.warn('No valid Product-wise Sponsored Ads rows to insert after filtering', {
                userId: userObjectId.toString(),
                country,
                region,
                rawCount: itemCount,
            });
            return {
                success: true,
                message: 'No valid rows to save',
                itemCount: 0,
                batchId: batchId.toString(),
            };
        }

        const distinctDates = [...new Set(itemsToInsert.map((r) => r.date))];
        await ProductWiseSponsoredAdsItem.deleteMany({
            userId: userObjectId,
            country,
            region,
            // Scoped to what we measured — see usableAdTypes above. There is already an index on
            // (userId, country, region, date, adType) so this costs nothing.
            adType: { $in: usableAdTypes },
            date: { $in: distinctDates },
        });

        // Chunked to bound peak memory. Every document is still hydrated, so what lands in Mongo is
        // byte-identical — see utils/chunkedInsert.js for why this is NOT `{ lean: true }`.
        const insertedCountFromChunks = await insertManyChunked(ProductWiseSponsoredAdsItem, itemsToInsert, { ordered: false });

        // Scoping the delete is necessary but NOT sufficient, and this is the subtle half.
        // `findLatestByUserCountryRegion` reads only the NEWEST batchId
        // (ProductWiseSponsoredAdsItemModel.js:132-148), and it is the main dashboard read path
        // (Analyse.js, ProfitabilityService, OptimizationService, …). Rows we just preserved still
        // carry their OLD batchId, so they would survive in the collection yet be invisible to every
        // one of those readers — and deleteOldBatches(…, 3) below would purge them within three runs.
        // Adopting them into this batch keeps them both visible and alive. `createdAt` is untouched,
        // so the newest-batch sort and deleteOldBatches' ranking still resolve correctly.
        const preservedAdTypes = ALL_AD_TYPES.filter((t) => !usableAdTypes.includes(t));
        if (preservedAdTypes.length && (distinctDates.length || preserveDateRange)) {
            // `date` is a YYYY-MM-DD string, so a lexicographic range is a calendar range.
            const adoptDateFilter = preserveDateRange
                ? { $gte: preserveDateRange.startDate, $lte: preserveDateRange.endDate }
                : { $in: distinctDates };
            const adopted = await ProductWiseSponsoredAdsItem.updateMany(
                {
                    userId: userObjectId,
                    country,
                    region,
                    adType: { $in: preservedAdTypes },
                    date: adoptDateFilter,
                },
                { $set: { batchId } }
            );
            logger.warn(
                `[ProductWiseSponsoredAds] PARTIAL save for ${country}-${region}: measured ` +
                `[${usableAdTypes.join('+')}], carried ${adopted?.modifiedCount ?? 0} preserved ` +
                `[${preservedAdTypes.join('/')}] row(s) into batch ${batchId} across ` +
                `${distinctDates.length} date(s) rather than deleting them.`
            );
        }
        const insertedCount = insertedCountFromChunks;

        if (insertedCount === 0) {
            throw new Error('insertMany returned 0 documents — check schema validation');
        }

        logger.info('Product-wise Sponsored Ads data saved successfully', {
            userId: userObjectId.toString(),
            country,
            region,
            itemCount: insertedCount,
            rawCount: itemCount,
            batchId: batchId.toString(),
        });

        // Clean up old batches (keep only last 3)
        try {
            const deleteResult = await ProductWiseSponsoredAdsItem.deleteOldBatches(userObjectId, country, region, 3);
            if (deleteResult.deletedCount > 0) {
                logger.info('Cleaned up old Sponsored Ads batches', {
                    userId: userObjectId.toString(),
                    deletedCount: deleteResult.deletedCount
                });
            }
        } catch (cleanupError) {
            // Don't fail the save operation if cleanup fails
            logger.warn('Failed to cleanup old Sponsored Ads batches', {
                userId: userObjectId.toString(),
                error: cleanupError.message
            });
        }

        // Invalidate the ads spend cache since we have new data
        try {
            const cacheKey = adsSpendCacheKey(userObjectId.toString(), country, region);
            const redis = getRedisClient();
            await redis.del(cacheKey);
            logger.debug('Invalidated ads spend cache after save', {
                userId: userObjectId.toString(),
                country,
                region
            });
        } catch (cacheError) {
            // Don't fail the save operation if cache invalidation fails
            logger.warn('Failed to invalidate ads spend cache', {
                userId: userObjectId.toString(),
                error: cacheError.message
            });
        }

        return {
            success: true,
            message: 'Data saved successfully',
            itemCount: insertedCount,
            batchId: batchId.toString(),
            userId: userObjectId.toString(),
            country,
            region,
        };

    } catch (error) {
        logger.error('Error saving Product-wise Sponsored Ads data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Get Product-wise Sponsored Ads data by user/country/region
 * Handles both old format (embedded array) and new format (separate collection)
 * Returns data in a consistent format regardless of storage method
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object|null>} Sponsored Ads data object with sponsoredAds array, or null if not found
 */

// Cache key for the per-ASIN ad-spend map. VERSIONED, and built in one place.
//
// `v2` because the value shape changed from Map<asin, number> to Map<asin, {total, SP, SD}> without
// the key changing, so the two consumers went on reading it as a number — `sales - adsSpend` became
// NaN and `adsSpend.toFixed(2)` threw. The consumers are fixed to read `.total`; bumping the key
// means the first hour after deploy does not serve the old shape out of Redis. Built here rather
// than inlined because it was hand-written at three separate call sites.
const ADS_SPEND_CACHE_VERSION = 'v2';
const adsSpendCacheKey = (userIdStr, country, region) =>
    `ads_spend_by_asin:${ADS_SPEND_CACHE_VERSION}:${userIdStr}:${country}:${region}`;

async function getProductWiseSponsoredAdsData(userId, country, region) {
    try {
        if (!userId) {
            throw new Error('User ID is required');
        }

        // Convert userId to ObjectId if it's a string
        let userObjectId;
        try {
            userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
        } catch (err) {
            throw new Error(`Invalid User ID format: ${userId}`);
        }

        // NEW FORMAT — read by AGGREGATION, never by loading the batch.
        //
        // This used to be `findLatestByUserCountryRegion` -> `find({batchId}).lean()`, then a
        // per-row `.map()` into a second 19-field array. For one PRO account that is 234,035 rows /
        // 102 MB twice over against a 1536 MB heap, and the result was not slowness but a HANG:
        // `fetchAllDataModels` never returned, nothing threw, and BullMQ stall-reclaimed the job
        // every 20 minutes for over a week.
        //
        // Measured on that live batch — totals identical to the cent (spend 390069.62,
        // sales 1767428.84, purchases 128082), and the distinct id sets identical:
        //     raw                    234,035 rows  102.0 MB
        //     asin x adType x date    71,835 rows    9.7 MB
        //     campaign x date        100,934 rows   16.5 MB
        //     distinct campaign/adGroup ids            863 ms
        //
        // A full consumer census drove the split. Every server consumer of `sponsoredAds` wants a
        // per-ASIN or grand total; the ONLY readers of campaignId/adGroupId are the two
        // `getCampaignAndAdGroupIds` helpers (which want distinct sets, nothing more), and the only
        // reader of per-row campaign detail is the PPC dashboard's client-side rollup — which is a
        // GROUP BY campaignId. `adGroupName` is read by nothing, anywhere.
        const { batchId, createdAt } = await ProductWiseSponsoredAdsItem.findLatestBatchMeta(
            userObjectId, country, region
        );

        if (batchId) {
            const [asinRows, campaignRollup, entityIds] = await Promise.all([
                ProductWiseSponsoredAdsItem.aggregateBatchByAsinAdTypeDate(batchId),
                ProductWiseSponsoredAdsItem.aggregateBatchByCampaignDate(batchId),
                ProductWiseSponsoredAdsItem.distinctEntityIdsForBatch(batchId),
            ]);

            if (asinRows.length > 0) {
                logger.debug('Loaded Sponsored Ads data by aggregation', {
                    userId: userObjectId.toString(), country, region,
                    asinRows: asinRows.length, campaignRows: campaignRollup.length,
                });

                // Same field names the old per-row mapper produced, so every downstream consumer's
                // arithmetic is untouched. The SP/SD split is reproduced exactly: SD rows carry
                // their value in the 14-day fields and zero in the 7-day ones, and vice versa.
                // ProductPerformanceService coalesces `sales || salesIn7Days || salesIn14Days ||
                // salesIn30Days` PER ROW before summing, so getting this wrong would silently
                // change per-ASIN sales.
                const sponsoredAds = asinRows.map((r) => {
                    const isSd = r.adType === 'SD';
                    return {
                        date: r.date,
                        asin: r.asin,
                        adType: r.adType,
                        spend: r.spend,
                        sales: r.sales,
                        purchases: r.purchases,
                        unitsSoldClicks: r.unitsSoldClicks,
                        salesIn7Days: isSd ? 0 : r.sales,
                        salesIn14Days: isSd ? r.sales : 0,
                        salesIn30Days: r.sales,
                        impressions: r.impressions,
                        clicks: r.clicks,
                        purchasedIn7Days: isSd ? 0 : r.purchases,
                        purchasedIn14Days: isSd ? r.purchases : 0,
                        purchasedIn30Days: r.purchases,
                    };
                });

                return {
                    _id: batchId,
                    userId: userObjectId,
                    country,
                    region,
                    sponsoredAds,
                    // Per-campaign-per-day totals: what the PPC dashboard rebuilds client-side.
                    campaignRollup,
                    // Distinct sets for getCampaignAndAdGroupIds, which previously walked every row.
                    campaignIds: entityIds.campaignIds,
                    adGroupIds: entityIds.adGroupIds,
                    createdAt,
                    updatedAt: createdAt
                };
            }
        }

        // Fallback: Try to get data from old format (embedded array in single document)
        const oldFormatDoc = await ProductWiseSponsoredAdsData.findOne({
            userId: userObjectId,
            country,
            region
        }).sort({ createdAt: -1 }).lean();

        if (oldFormatDoc && oldFormatDoc.sponsoredAds && oldFormatDoc.sponsoredAds.length > 0) {
            logger.debug('Found Sponsored Ads data in old format (embedded array)', {
                userId: userObjectId.toString(),
                country,
                region,
                itemCount: oldFormatDoc.sponsoredAds.length
            });

            return oldFormatDoc;
        }

        logger.debug('No Sponsored Ads data found', {
            userId: userObjectId.toString(),
            country,
            region
        });

        return null;

    } catch (error) {
        logger.error('Error fetching Product-wise Sponsored Ads data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Delete Product-wise Sponsored Ads data by user/country/region
 * Deletes from both old and new format collections
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Delete result
 */
async function deleteProductWiseSponsoredAdsData(userId, country, region) {
    try {
        if (!userId) {
            throw new Error('User ID is required');
        }

        // Convert userId to ObjectId if it's a string
        let userObjectId;
        try {
            userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
        } catch (err) {
            throw new Error(`Invalid User ID format: ${userId}`);
        }

        // Delete from both collections
        const [oldFormatResult, newFormatResult] = await Promise.all([
            ProductWiseSponsoredAdsData.deleteMany({ userId: userObjectId, country, region }),
            ProductWiseSponsoredAdsItem.deleteMany({ userId: userObjectId, country, region })
        ]);

        logger.info('Product-wise Sponsored Ads data deleted', {
            userId: userObjectId.toString(),
            country,
            region,
            oldFormatDeleted: oldFormatResult.deletedCount,
            newFormatDeleted: newFormatResult.deletedCount
        });

        return {
            deletedCount: oldFormatResult.deletedCount + newFormatResult.deletedCount,
            oldFormatDeleted: oldFormatResult.deletedCount,
            newFormatDeleted: newFormatResult.deletedCount
        };

    } catch (error) {
        logger.error('Error deleting Product-wise Sponsored Ads data', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Get aggregated ad spend by ASIN (optimized for profitability table)
 * Uses MongoDB aggregation instead of loading all items, with Redis caching.
 * 
 * This is significantly faster than getProductWiseSponsoredAdsData for large datasets
 * because it aggregates spend per ASIN in MongoDB and only returns the aggregated map.
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Map<string, number>>} Map of ASIN to total spend
 */
async function getAdsSpendByAsin(userId, country, region) {
    try {
        if (!userId) {
            throw new Error('User ID is required');
        }

        // Convert userId to ObjectId if it's a string
        let userObjectId;
        try {
            userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
        } catch (err) {
            throw new Error(`Invalid User ID format: ${userId}`);
        }

        const userIdStr = userObjectId.toString();
        const cacheKey = adsSpendCacheKey(userIdStr, country, region);
        const CACHE_TTL = 3600; // 1 hour cache

        // Try to get from Redis cache first
        try {
            const redis = getRedisClient();
            const cachedData = await redis.get(cacheKey);
            
            if (cachedData) {
                logger.debug('Found ads spend by ASIN in Redis cache', {
                    userId: userIdStr,
                    country,
                    region
                });
                
                // Convert cached JSON back to Map
                const parsed = JSON.parse(cachedData);
                return new Map(Object.entries(parsed));
            }
        } catch (redisError) {
            logger.warn('Redis cache read failed for ads spend, continuing without cache', {
                userId: userIdStr,
                error: redisError.message
            });
        }

        // Not in cache - use the new aggregation method
        const { adsSpendByAsin, batchId, createdAt } = await ProductWiseSponsoredAdsItem.aggregateSpendByAsin(
            userObjectId,
            country,
            region
        );

        if (adsSpendByAsin.size > 0) {
            logger.debug('Aggregated ads spend by ASIN from new format', {
                userId: userIdStr,
                country,
                region,
                asinCount: adsSpendByAsin.size,
                batchId: batchId?.toString()
            });

            // Cache the result in Redis
            try {
                const redis = getRedisClient();
                const cacheData = Object.fromEntries(adsSpendByAsin);
                await redis.setEx(cacheKey, CACHE_TTL, JSON.stringify(cacheData));
                
                logger.debug('Cached ads spend by ASIN in Redis', {
                    userId: userIdStr,
                    country,
                    region,
                    asinCount: adsSpendByAsin.size
                });
            } catch (redisError) {
                logger.warn('Redis cache write failed for ads spend', {
                    userId: userIdStr,
                    error: redisError.message
                });
            }

            return adsSpendByAsin;
        }

        // No data found in new format - return empty Map
        // NOTE: Old-format fallback removed after migration script ensures all data is in new format
        // This eliminates heap memory risk from loading large embedded arrays
        logger.debug('No ads data found for spend aggregation', {
            userId: userIdStr,
            country,
            region
        });

        return new Map();

    } catch (error) {
        logger.error('Error getting ads spend by ASIN', {
            userId,
            country,
            region,
            error: error.message
        });
        throw error;
    }
}

/**
 * Invalidate the cached ads spend by ASIN for a user/country/region
 * Call this when new sponsored ads data is saved
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 */
async function invalidateAdsSpendCache(userId, country, region) {
    try {
        const userIdStr = typeof userId === 'string' ? userId : userId.toString();
        const cacheKey = adsSpendCacheKey(userIdStr, country, region);
        
        const redis = getRedisClient();
        await redis.del(cacheKey);
        
        logger.debug('Invalidated ads spend cache', {
            userId: userIdStr,
            country,
            region
        });
    } catch (error) {
        logger.warn('Failed to invalidate ads spend cache', {
            userId,
            country,
            region,
            error: error.message
        });
    }
}

/**
 * Delete stored rows for ad types whose report ran and returned nothing.
 *
 * Needed because saving moved into the async `finalize`, which only ever runs for a report that
 * produced data. An ad type that reaches NO_DATA without a finalize (its `submit` returned null
 * because the type is not enabled on the account) would otherwise keep its previously-stored rows
 * indefinitely — so an account that stops running Sponsored Display would keep showing old
 * Sponsored Display spend. Previously the combined save covered this via its adType-scoped delete.
 *
 * FAILED types must NOT be passed here: a failure means the true value is unknown, so stored rows
 * are preserved. Only NO_DATA is a measured zero.
 *
 * @param {{startDate: string, endDate: string}} window YYYY-MM-DD, inclusive
 * @returns {Promise<number>} rows deleted
 */
async function clearAdTypesForWindow(userId, country, region, adTypes, window) {
    if (!userId || !country || !region) return 0;
    if (!Array.isArray(adTypes) || adTypes.length === 0) return 0;
    if (!window?.startDate || !window?.endDate) return 0;

    let userObjectId;
    try {
        userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;
    } catch (err) {
        throw new Error(`Invalid User ID format: ${userId}`);
    }

    const res = await ProductWiseSponsoredAdsItem.deleteMany({
        userId: userObjectId,
        country,
        region,
        adType: { $in: adTypes },
        // `date` is a YYYY-MM-DD string, so a lexicographic range is a calendar range.
        date: { $gte: window.startDate, $lte: window.endDate },
    });

    const deleted = res?.deletedCount || 0;
    if (deleted > 0) {
        logger.info(
            `[ProductWiseSponsoredAds] Cleared ${deleted} row(s) for [${adTypes.join('/')}] in ` +
            `${window.startDate}..${window.endDate} (${country}-${region}): report(s) ran with no spend.`
        );
        // Those rows fed the cached per-ASIN spend rollup.
        await invalidateAdsSpendCache(userId, country, region);
    }
    return deleted;
}

module.exports = {
    saveProductWiseSponsoredAdsData,
    getProductWiseSponsoredAdsData,
    deleteProductWiseSponsoredAdsData,
    getAdsSpendByAsin,
    invalidateAdsSpendCache,
    clearAdTypesForWindow
};
