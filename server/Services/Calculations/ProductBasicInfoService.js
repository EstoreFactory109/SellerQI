/**
 * ProductBasicInfoService.js
 * 
 * Fetches basic product information for a single ASIN.
 * This is a lightweight service that provides catalog info, profitability summary,
 * and ratings for the Product Details page when the ASIN is not in the cached issues data.
 */

const mongoose = require('mongoose');
const NumberOfProductReviews = require('../../models/seller-performance/NumberOfProductReviewsModel.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
const ProfitabilityService = require('./ProfitabilityService.js');
const logger = require('../../utils/Logger.js');

/**
 * Get basic product info for a single ASIN
 * @param {Object} params - Parameters
 * @param {string} params.userId - User ID
 * @param {string} params.region - Region (NA, EU, FE)
 * @param {string} params.country - Country code
 * @param {string} params.asin - ASIN to fetch info for
 * @returns {Promise<Object>} Product basic info
 */
async function getProductBasicInfo({ userId, region, country, asin }) {
    if (!asin) {
        throw new Error('ASIN is required');
    }

    const normalizedAsin = asin.trim().toUpperCase();
    const userObjectId = typeof userId === 'string' ? new mongoose.Types.ObjectId(userId) : userId;

    logger.info('[ProductBasicInfoService] Fetching product info', { userId, region, country, asin: normalizedAsin });

    try {
        // Fetch data in parallel
        const [catalogData, economicsData, ppcSpendData] = await Promise.all([
            fetchCatalogData(userObjectId, country, region, normalizedAsin),
            fetchEconomicsData(userObjectId, country, region, normalizedAsin),
            fetchPPCSpendData(userObjectId, country, region, normalizedAsin)
        ]);

        // Combine all data
        const result = {
            asin: normalizedAsin,
            sku: catalogData.sku || null,
            name: catalogData.name || `Product ${normalizedAsin}`,
            mainImage: catalogData.mainImage || null,
            price: economicsData.price || 0,
            sales: economicsData.sales || 0,
            unitsSold: economicsData.unitsSold || 0,
            grossProfit: economicsData.grossProfit || 0,
            amzFee: economicsData.amzFee || 0,
            fbaFees: economicsData.fbaFees || 0,
            storageFees: economicsData.storageFees || 0,
            totalFees: economicsData.totalFees || 0,
            refunds: economicsData.refunds || 0,
            adsSpend: ppcSpendData.totalSpend || 0,
            hasAPlus: catalogData.hasAPlus || false,
            hasBrandStory: catalogData.hasBrandStory || false,
            starRating: catalogData.starRating || 0,
            numRatings: catalogData.numRatings || 0,
            bulletPoints: catalogData.bulletPoints || [],
            description: catalogData.description || [],
            photos: catalogData.photos || [],
            videoUrl: catalogData.videoUrl || []
        };

        logger.info('[ProductBasicInfoService] Product info fetched successfully', { 
            asin: normalizedAsin, 
            hasCatalogData: !!catalogData.name,
            hasEconomicsData: economicsData.sales > 0,
            hasPPCData: ppcSpendData.totalSpend > 0
        });

        return {
            success: true,
            data: result
        };

    } catch (error) {
        logger.error('[ProductBasicInfoService] Error fetching product info', {
            error: error.message,
            userId,
            asin: normalizedAsin
        });
        throw error;
    }
}

/**
 * Fetch catalog data (name, images, ratings) from NumberOfProductReviews
 */
async function fetchCatalogData(userId, country, region, asin) {
    try {
        const doc = await NumberOfProductReviews.findOne({
            User: userId,
            country: country,
            region: region
        }).sort({ createdAt: -1 }).lean();

        if (!doc || !doc.Products) {
            return {};
        }

        const product = doc.Products.find(p => 
            (p.asin || '').trim().toUpperCase() === asin
        );

        if (!product) {
            return {};
        }

        return {
            name: product.product_title || null,
            mainImage: product.product_photos?.[0] || null,
            photos: product.product_photos || [],
            videoUrl: product.video_url || [],
            bulletPoints: product.about_product || [],
            description: product.product_description || [],
            starRating: parseFloat(product.product_star_ratings) || 0,
            numRatings: parseInt(product.product_num_ratings?.replace(/,/g, '')) || 0,
            hasBrandStory: product.has_brandstory || false,
            hasAPlus: (product.product_description?.length > 0) || false
        };
    } catch (error) {
        logger.error('[ProductBasicInfoService] Error fetching catalog data', { error: error.message, asin });
        return {};
    }
}

/**
 * Fetch economics data (sales, profit, fees) using the same ASIN aggregation as the profitability table
 * (ProfitabilityService.getAsinPpcSalesFromEconomics — normal + big accounts + duplicate ASIN rows).
 */
async function fetchEconomicsData(userId, country, region, asin) {
    try {
        const doc = await EconomicsMetrics.findLatest(userId, region, country);

        if (!doc) {
            return {};
        }

        const { asinPpcSales } = await ProfitabilityService.getAsinPpcSalesFromEconomics(doc);
        const normalized = (asin || '').trim().toUpperCase();
        let row = null;
        if (asinPpcSales && typeof asinPpcSales === 'object') {
            for (const [k, v] of Object.entries(asinPpcSales)) {
                if ((k || '').trim().toUpperCase() === normalized) {
                    row = v;
                    break;
                }
            }
        }

        if (!row) {
            return {};
        }

        const sales = typeof row.sales === 'number' ? row.sales : (row.sales?.amount || 0);
        const grossProfit = typeof row.grossProfit === 'number' ? row.grossProfit : (row.grossProfit?.amount || 0);
        const unitsSold = row.unitsSold || 0;
        const totalFees = row.totalFees !== undefined ? row.totalFees : ((row.fbaFees || 0) + (row.storageFees || 0));
        const amazonFees = row.amazonFees != null ? row.amazonFees : totalFees;
        const refundsVal = typeof row.refunds === 'number' ? row.refunds : (row.refunds?.amount || 0);

        return {
            sales,
            grossProfit,
            unitsSold,
            amzFee: amazonFees,
            fbaFees: row.fbaFees || 0,
            storageFees: row.storageFees || 0,
            totalFees,
            refunds: refundsVal,
            price: unitsSold > 0 ? (sales / unitsSold) : 0
        };
    } catch (error) {
        logger.error('[ProductBasicInfoService] Error fetching economics data', { error: error.message, asin });
        return {};
    }
}

/**
 * Fetch PPC spend data from ProductWiseSponsoredAdsItem
 */
async function fetchPPCSpendData(userId, country, region, asin) {
    try {
        // Get total spend for this ASIN from the latest batch
        const result = await ProductWiseSponsoredAdsItem.aggregate([
            { $match: { userId: userId, country: country, region: region } },
            { $sort: { createdAt: -1 } },
            // Get latest batchId
            { $group: { _id: null, latestBatchId: { $first: '$batchId' }, items: { $push: '$$ROOT' } } },
            { $unwind: '$items' },
            { $match: { $expr: { $eq: ['$items.batchId', '$latestBatchId'] } } },
            { $match: { 'items.asin': asin } },
            {
                $group: {
                    _id: '$items.asin',
                    totalSpend: { $sum: '$items.spend' },
                    totalSales: { $sum: { $ifNull: ['$items.sales', { $ifNull: ['$items.salesIn30Days', 0] }] } },
                    totalImpressions: { $sum: '$items.impressions' },
                    totalClicks: { $sum: '$items.clicks' }
                }
            }
        ]);

        if (result.length > 0) {
            const ppcData = result[0];
            return {
                totalSpend: ppcData.totalSpend || 0,
                totalSales: ppcData.totalSales || 0,
                totalImpressions: ppcData.totalImpressions || 0,
                totalClicks: ppcData.totalClicks || 0,
                acos: ppcData.totalSales > 0 ? (ppcData.totalSpend / ppcData.totalSales) * 100 : null
            };
        }

        return { totalSpend: 0 };
    } catch (error) {
        logger.error('[ProductBasicInfoService] Error fetching PPC spend data', { error: error.message, asin });
        return { totalSpend: 0 };
    }
}

module.exports = {
    getProductBasicInfo
};
