/**
 * QMateProductsService
 * 
 * Specialized service for product-level data for QMate AI.
 * Provides detailed product information, reviews, issues per ASIN, and sales data.
 * 
 * Data Sources:
 * - NumberOfProductReviews: Product reviews and ratings
 * - ProductWiseSales: Product-level sales data
 * - IssuesDataChunks: Product-wise errors and issues
 * - sellerCentralModel: Product listings from seller account
 * - GetListingItemsModel: Generic keyword data
 * 
 * This service is INDEPENDENT and does not affect any existing flows.
 */

const logger = require('../../utils/Logger.js');
const NumberOfProductReviews = require('../../models/seller-performance/NumberOfProductReviewsModel.js');
const ProductWiseSales = require('../../models/products/ProductWiseSalesModel.js');
const IssuesDataChunks = require('../../models/system/IssuesDataChunksModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const mongoose = require('mongoose');

/**
 * Get product reviews and ratings summary
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Reviews and ratings data
 */
async function getProductReviewsData(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const reviewsData = await NumberOfProductReviews.findOne({ User: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!reviewsData || !reviewsData.Products?.length) {
            return {
                success: true,
                source: 'product_reviews',
                data: {
                    hasReviews: false,
                    products: [],
                    summary: { averageRating: 0, totalProducts: 0 }
                }
            };
        }
        
        let totalRating = 0;
        let productsWithRatings = 0;
        let totalReviews = 0;
        
        const products = reviewsData.Products.map(p => {
            const rating = parseFloat(p.product_star_ratings) || 0;
            const numRatings = parseInt(p.product_num_ratings) || 0;
            
            if (rating > 0) {
                totalRating += rating;
                productsWithRatings++;
            }
            totalReviews += numRatings;
            
            return {
                asin: p.asin,
                title: p.product_title || '',
                rating,
                numRatings,
                hasPhotos: (p.product_photos?.length || 0) > 0,
                photoCount: p.product_photos?.length || 0,
                hasVideo: (p.video_url?.length || 0) > 0,
                hasBrandStory: p.has_brandstory || false,
                bulletPoints: p.about_product?.length || 0
            };
        });
        
        // Categorize by rating
        const lowRatedProducts = products
            .filter(p => p.rating > 0 && p.rating < 4)
            .sort((a, b) => a.rating - b.rating)
            .slice(0, 10);
        
        const topRatedProducts = products
            .filter(p => p.rating >= 4.5)
            .sort((a, b) => b.numRatings - a.numRatings)
            .slice(0, 10);
        
        const noReviewsProducts = products
            .filter(p => p.numRatings === 0)
            .slice(0, 10);
        
        const averageRating = productsWithRatings > 0 
            ? parseFloat((totalRating / productsWithRatings).toFixed(2))
            : 0;
        
        logger.info('[QMateProductsService] Got product reviews data', {
            userId, country, region,
            duration: Date.now() - startTime,
            productsCount: products.length
        });
        
        return {
            success: true,
            source: 'product_reviews',
            data: {
                hasReviews: true,
                summary: {
                    totalProducts: products.length,
                    productsWithRatings,
                    averageRating,
                    totalReviews,
                    lowRatedCount: lowRatedProducts.length,
                    noReviewsCount: noReviewsProducts.length
                },
                lowRatedProducts,
                topRatedProducts,
                noReviewsProducts
            }
        };
        
    } catch (error) {
        logger.error('[QMateProductsService] Error getting product reviews', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get product-wise sales data
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {number} limit - Max products to return
 * @returns {Promise<Object>} Product sales data
 */
async function getProductSalesData(userId, country, region, limit = 30) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const salesData = await ProductWiseSales.findOne({ User: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        if (!salesData || !salesData.productWiseSales?.length) {
            return {
                success: true,
                source: 'product_wise_sales',
                data: {
                    hasSales: false,
                    products: [],
                    summary: { totalSales: 0, totalUnits: 0 }
                }
            };
        }
        
        let totalSales = 0;
        let totalUnits = 0;
        
        const products = salesData.productWiseSales
            .map(p => {
                const amount = parseFloat(p.amount) || 0;
                const quantity = parseInt(p.quantity) || 0;
                totalSales += amount;
                totalUnits += quantity;
                
                return {
                    asin: p.asin,
                    sales: parseFloat(amount.toFixed(2)),
                    unitsSold: quantity,
                    averagePrice: quantity > 0 ? parseFloat((amount / quantity).toFixed(2)) : 0
                };
            })
            .sort((a, b) => b.sales - a.sales);
        
        // Get top and bottom performers
        const topSellers = products.slice(0, limit);
        const zeroSalesProducts = products.filter(p => p.sales === 0).slice(0, 15);
        
        // Calculate Pareto distribution (80/20 rule)
        const top20PercentCount = Math.ceil(products.length * 0.2);
        const top20PercentSales = products.slice(0, top20PercentCount).reduce((sum, p) => sum + p.sales, 0);
        const top20PercentShare = totalSales > 0 ? parseFloat(((top20PercentSales / totalSales) * 100).toFixed(2)) : 0;
        
        logger.info('[QMateProductsService] Got product sales data', {
            userId, country, region,
            duration: Date.now() - startTime,
            productsCount: products.length
        });
        
        return {
            success: true,
            source: 'product_wise_sales',
            data: {
                hasSales: true,
                topSellers,
                zeroSalesProducts,
                summary: {
                    totalProducts: products.length,
                    totalSales: parseFloat(totalSales.toFixed(2)),
                    totalUnits,
                    productsWithSales: products.filter(p => p.sales > 0).length,
                    top20PercentSalesShare: top20PercentShare
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateProductsService] Error getting product sales', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get detailed issues for a specific ASIN
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {string} asin - ASIN to get issues for
 * @returns {Promise<Object>} ASIN-specific issues
 */
async function getAsinIssues(userId, country, region, asin) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Get product-wise errors
        const productWiseErrors = await IssuesDataChunks.getFieldData(
            userObjectId, country, region, 'productWiseError'
        );
        
        // Find the specific ASIN
        const asinData = productWiseErrors?.find(p => p.asin === asin);
        
        if (!asinData) {
            return {
                success: true,
                source: 'issues_data_chunks',
                data: {
                    asin,
                    hasIssues: false,
                    issues: [],
                    summary: { totalIssues: 0 }
                }
            };
        }
        
        const issues = asinData.errors || [];
        
        logger.info('[QMateProductsService] Got ASIN issues', {
            userId, country, region, asin,
            duration: Date.now() - startTime,
            issuesCount: issues.length
        });
        
        return {
            success: true,
            source: 'issues_data_chunks',
            data: {
                asin,
                productName: asinData.name || asinData.productName || 'Unknown',
                hasIssues: issues.length > 0,
                totalErrors: asinData.totalErrors || issues.length,
                categoryBreakdown: {
                    ranking: asinData.rankingErrors || 0,
                    conversion: asinData.conversionErrors || 0,
                    inventory: asinData.inventoryErrors || 0,
                    profitability: asinData.profitabilityErrors || 0,
                    sponsoredAds: asinData.sponsoredAdsErrors || 0
                },
                issues: issues.slice(0, 20)
            }
        };
        
    } catch (error) {
        logger.error('[QMateProductsService] Error getting ASIN issues', {
            error: error.message, userId, country, region, asin
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get product listing quality analysis
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Listing quality data
 */
async function getListingQualityAnalysis(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Get seller data with products
        const sellerData = await Seller.findOne({ User: userObjectId })
            .select('sellerAccount')
            .lean();
        
        if (!sellerData?.sellerAccount) {
            return {
                success: false,
                source: 'none',
                error: 'No seller data found',
                data: null
            };
        }
        
        // Find matching account
        const account = sellerData.sellerAccount.find(
            acc => acc.country === country && acc.region === region
        );
        
        if (!account?.products) {
            return {
                success: true,
                source: 'seller_central',
                data: {
                    hasProducts: false,
                    summary: { totalProducts: 0 }
                }
            };
        }
        
        // Get review data for additional insights
        const reviewsData = await NumberOfProductReviews.findOne({ User: userObjectId, country, region })
            .sort({ createdAt: -1 }).lean();
        
        const reviewsMap = {};
        if (reviewsData?.Products) {
            reviewsData.Products.forEach(p => {
                reviewsMap[p.asin] = {
                    photoCount: p.product_photos?.length || 0,
                    hasVideo: (p.video_url?.length || 0) > 0,
                    hasBrandStory: p.has_brandstory || false,
                    bulletCount: p.about_product?.length || 0
                };
            });
        }
        
        const products = account.products;
        
        let withImages = 0;
        let withVideo = 0;
        let withBrandStory = 0;
        let activeCount = 0;
        
        products.forEach(p => {
            if (p.status === 'Active') activeCount++;
            const reviewInfo = reviewsMap[p.asin];
            if (reviewInfo) {
                if (reviewInfo.photoCount > 0) withImages++;
                if (reviewInfo.hasVideo) withVideo++;
                if (reviewInfo.hasBrandStory) withBrandStory++;
            }
        });
        
        logger.info('[QMateProductsService] Got listing quality analysis', {
            userId, country, region,
            duration: Date.now() - startTime,
            productsCount: products.length
        });
        
        return {
            success: true,
            source: 'seller_central',
            data: {
                hasProducts: true,
                summary: {
                    totalProducts: products.length,
                    activeProducts: activeCount,
                    inactiveProducts: products.length - activeCount,
                    productsWithImages: withImages,
                    productsWithVideo: withVideo,
                    productsWithBrandStory: withBrandStory
                },
                qualityMetrics: {
                    imageCompliance: products.length > 0 
                        ? parseFloat(((withImages / products.length) * 100).toFixed(2))
                        : 0,
                    videoAdoption: products.length > 0
                        ? parseFloat(((withVideo / products.length) * 100).toFixed(2))
                        : 0,
                    brandStoryAdoption: products.length > 0
                        ? parseFloat(((withBrandStory / products.length) * 100).toFixed(2))
                        : 0
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateProductsService] Error getting listing quality', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get products by issue category
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {string} category - Issue category (ranking, conversion, inventory, profitability, sponsoredAds)
 * @returns {Promise<Object>} Products with specific issue category
 */
async function getProductsByIssueCategory(userId, country, region, category) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Map category to field name
        const fieldMap = {
            ranking: 'rankingError',
            conversion: 'conversionError',
            inventory: 'inventoryError',
            profitability: 'profitabilityError',
            sponsoredAds: 'sponsoredAdsError'
        };
        
        const fieldName = fieldMap[category];
        if (!fieldName) {
            return {
                success: false,
                error: `Invalid category: ${category}`,
                data: null
            };
        }
        
        const categoryErrors = await IssuesDataChunks.getFieldData(
            userObjectId, country, region, fieldName
        );
        
        if (!categoryErrors || categoryErrors.length === 0) {
            return {
                success: true,
                source: 'issues_data_chunks',
                data: {
                    category,
                    hasIssues: false,
                    products: [],
                    summary: { totalProducts: 0, totalIssues: 0 }
                }
            };
        }
        
        const products = categoryErrors.slice(0, 25).map(item => ({
            asin: item.asin,
            productName: item.name || item.productName || 'Unknown',
            issueType: item.type || item.errorType,
            message: item.message || item.description,
            suggestion: item.suggestion || item.solution,
            severity: item.severity || item.impact || 'medium'
        }));
        
        logger.info('[QMateProductsService] Got products by issue category', {
            userId, country, region, category,
            duration: Date.now() - startTime,
            productsCount: products.length
        });
        
        return {
            success: true,
            source: 'issues_data_chunks',
            data: {
                category,
                hasIssues: true,
                products,
                summary: {
                    totalProducts: products.length,
                    totalIssues: categoryErrors.length
                }
            }
        };
        
    } catch (error) {
        logger.error('[QMateProductsService] Error getting products by category', {
            error: error.message, userId, country, region, category
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Get complete products context for QMate AI
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @returns {Promise<Object>} Complete products context
 */
async function getQMateProductsContext(userId, country, region) {
    const startTime = Date.now();
    
    try {
        // Fetch all product data in parallel
        const [
            reviewsResult,
            salesResult,
            listingQualityResult
        ] = await Promise.all([
            getProductReviewsData(userId, country, region),
            getProductSalesData(userId, country, region, 20),
            getListingQualityAnalysis(userId, country, region)
        ]);
        
        const context = {
            reviews: null,
            sales: null,
            listingQuality: null
        };
        
        if (reviewsResult?.success) {
            context.reviews = reviewsResult.data;
        }
        
        if (salesResult?.success) {
            context.sales = salesResult.data;
        }
        
        if (listingQualityResult?.success) {
            context.listingQuality = listingQualityResult.data;
        }
        
        // Generate product health summary
        const lowRatedCount = context.reviews?.summary?.lowRatedCount || 0;
        const noReviewsCount = context.reviews?.summary?.noReviewsCount || 0;
        const zeroSalesCount = context.sales?.zeroSalesProducts?.length || 0;
        
        context.productHealthSummary = {
            totalProducts: context.listingQuality?.summary?.totalProducts || context.sales?.summary?.totalProducts || 0,
            activeProducts: context.listingQuality?.summary?.activeProducts || 0,
            averageRating: context.reviews?.summary?.averageRating || 0,
            productsNeedingAttention: lowRatedCount + noReviewsCount + zeroSalesCount,
            recommendations: [
                ...(lowRatedCount > 0 ? [`${lowRatedCount} products have low ratings - consider quality improvements`] : []),
                ...(noReviewsCount > 5 ? [`${noReviewsCount} products have no reviews - consider review campaigns`] : []),
                ...(zeroSalesCount > 0 ? [`${zeroSalesCount} products have zero sales - review pricing/visibility`] : [])
            ].slice(0, 3)
        };
        
        logger.info('[QMateProductsService] Got complete products context', {
            userId, country, region,
            duration: Date.now() - startTime
        });
        
        return {
            success: true,
            source: 'combined_products_sources',
            data: context
        };
        
    } catch (error) {
        logger.error('[QMateProductsService] Error getting products context', {
            error: error.message, userId, country, region
        });
        return { success: false, error: error.message, data: null };
    }
}

module.exports = {
    getProductReviewsData,
    getProductSalesData,
    getAsinIssues,
    getListingQualityAnalysis,
    getProductsByIssueCategory,
    getQMateProductsContext
};
