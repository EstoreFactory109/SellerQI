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
const APlusContent = require('../../models/seller-performance/APlusContentModel.js');
const ProductWiseSponsoredAdsItem = require('../../models/amazon-ads/ProductWiseSponsoredAdsItemModel.js');
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
 * Get FULL detailed issues for a specific ASIN - for ProductDetails page
 * Returns the complete issue structure needed for the Product Details page:
 * - rankingErrors (with TitleResult, BulletPoints, Description, charLim)
 * - conversionErrors (imageResultErrorData, videoResultErrorData, etc.)
 * - inventoryErrors (inventoryPlanningErrorData, strandedInventoryErrorData, etc.)
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {string} asin - ASIN to get issues for
 * @returns {Promise<Object>} Full ASIN issues with complete structure
 */
async function getFullAsinIssues(userId, country, region, asin) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Fetch productWiseError and rankingProductWiseErrors in parallel
        const [productWiseErrors, rankingProductWiseErrors] = await Promise.all([
            IssuesDataChunks.getFieldData(userObjectId, country, region, 'productWiseError'),
            IssuesDataChunks.getFieldData(userObjectId, country, region, 'rankingProductWiseErrors')
        ]);
        
        // Find the specific ASIN in productWiseError
        const asinData = productWiseErrors?.find(p => 
            (p.asin || '').trim().toUpperCase() === asin.trim().toUpperCase()
        );
        
        // Find ranking errors for this ASIN
        const rankingData = rankingProductWiseErrors?.find(p => 
            (p.asin || '').trim().toUpperCase() === asin.trim().toUpperCase()
        );
        
        // Build the full response structure that ProductDetails.jsx expects
        const result = {
            asin: asin.trim().toUpperCase(),
            sku: asinData?.sku || null,
            name: asinData?.name || asinData?.productName || rankingData?.name || null,
            MainImage: asinData?.MainImage || asinData?.image || null,
            price: asinData?.price || 0,
            quantity: asinData?.quantity || 0,
            sales: asinData?.sales || 0,
            totalErrors: asinData?.totalErrors || 0,
            
            // Ranking errors structure (from rankingProductWiseErrors)
            rankingErrors: rankingData ? {
                asin: rankingData.asin,
                data: rankingData.data || {
                    TitleResult: rankingData.TitleResult || null,
                    BulletPoints: rankingData.BulletPoints || null,
                    Description: rankingData.Description || null,
                    charLim: rankingData.charLim || null,
                    dublicateWords: rankingData.dublicateWords || null
                }
            } : null,
            
            // Conversion errors structure
            conversionErrors: asinData?.conversionErrors || {
                imageResultErrorData: null,
                videoResultErrorData: null,
                productStarRatingResultErrorData: null,
                productsWithOutBuyboxErrorData: null,
                aplusErrorData: null,
                brandStoryErrorData: null
            },
            
            // Inventory errors structure
            inventoryErrors: asinData?.inventoryErrors || {
                inventoryPlanningErrorData: null,
                strandedInventoryErrorData: null,
                inboundNonComplianceErrorData: null,
                replenishmentErrorData: null
            },
            
            // Performance data if available
            performance: asinData?.performance || null,
            
            // Comparison data if available
            comparison: asinData?.comparison || null,
            
            // Error counts for summary
            errorCounts: {
                ranking: rankingData?.data?.TotalErrors || 0,
                conversion: countConversionErrors(asinData?.conversionErrors),
                inventory: countInventoryErrors(asinData?.inventoryErrors)
            }
        };
        
        logger.info('[QMateProductsService] Got full ASIN issues', {
            userId, country, region, asin,
            duration: Date.now() - startTime,
            hasRankingErrors: !!result.rankingErrors,
            hasConversionErrors: result.errorCounts.conversion > 0,
            hasInventoryErrors: result.errorCounts.inventory > 0
        });
        
        return {
            success: true,
            source: 'issues_data_chunks',
            data: result
        };
        
    } catch (error) {
        logger.error('[QMateProductsService] Error getting full ASIN issues', {
            error: error.message, userId, country, region, asin
        });
        return { success: false, error: error.message, data: null };
    }
}

/**
 * Count conversion errors from the structure
 */
function countConversionErrors(conversionErrors) {
    if (!conversionErrors) return 0;
    let count = 0;
    if (conversionErrors.imageResultErrorData?.status === 'Error') count++;
    if (conversionErrors.videoResultErrorData?.status === 'Error') count++;
    if (conversionErrors.productStarRatingResultErrorData?.status === 'Error') count++;
    if (conversionErrors.productsWithOutBuyboxErrorData?.status === 'Error') count++;
    if (conversionErrors.aplusErrorData?.status === 'Error') count++;
    if (conversionErrors.brandStoryErrorData?.status === 'Error') count++;
    return count;
}

/**
 * Count inventory errors from the structure
 */
function countInventoryErrors(inventoryErrors) {
    if (!inventoryErrors) return 0;
    let count = 0;
    if (inventoryErrors.inventoryPlanningErrorData) count++;
    if (inventoryErrors.strandedInventoryErrorData) count++;
    if (inventoryErrors.inboundNonComplianceErrorData) count++;
    if (inventoryErrors.replenishmentErrorData) count++;
    return count;
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
 * Get product categorization data (Sellable, Non-Sellable, A+, B2B, Ads targeting)
 * This matches the "Your Products" page categories exactly.
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region
 * @param {number} limit - Max products per category to return
 * @returns {Promise<Object>} Product categorization data
 */
async function getProductCategorization(userId, country, region, limit = 20) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Fetch all required data in parallel
        const [
            sellerData,
            aPlusData,
            reviewsData,
            latestAdsItem
        ] = await Promise.all([
            // Get all products from Seller model
            Seller.findOne({ User: userObjectId })
                .select('sellerAccount')
                .lean(),
            
            // Get A+ content data
            APlusContent.findOne({
                User: userObjectId,
                country: country,
                region: region
            }).sort({ createdAt: -1 }).select('ApiContentDetails').lean(),
            
            // Get reviews/brand story data
            NumberOfProductReviews.findOne({
                User: userObjectId,
                country: country,
                region: region
            }).sort({ createdAt: -1 }).select('Products').lean(),
            
            // Get latest ads batch
            ProductWiseSponsoredAdsItem.findOne({
                userId: userObjectId,
                country: country,
                region: region
            }).sort({ createdAt: -1 }).select('batchId').lean()
        ]);
        
        if (!sellerData?.sellerAccount) {
            return {
                success: true,
                source: 'product_categorization',
                data: {
                    hasProducts: false,
                    summary: { totalProducts: 0 }
                }
            };
        }
        
        // Find matching account
        const account = sellerData.sellerAccount.find(
            acc => acc.country === country && acc.region === region
        );
        
        if (!account?.products || account.products.length === 0) {
            return {
                success: true,
                source: 'product_categorization',
                data: {
                    hasProducts: false,
                    summary: { totalProducts: 0 }
                }
            };
        }
        
        const allProducts = account.products;
        
        // Build A+ content map (ASIN -> has A+)
        const aPlusAsins = new Set();
        if (aPlusData?.ApiContentDetails) {
            aPlusData.ApiContentDetails.forEach(item => {
                if (item.status === 'APPROVED' || item.status === 'PUBLISHED') {
                    // A+ content is linked to ASINs in the item
                    if (item.asin) aPlusAsins.add(item.asin.toUpperCase());
                    if (item.contentReferenceKey) {
                        // Some structures have ASINs in different fields
                        const asins = item.includedDataTypes?.ASIN || [];
                        asins.forEach(a => aPlusAsins.add(a.toUpperCase()));
                    }
                }
            });
        }
        
        // Build reviews/brand story map
        const reviewsMap = {};
        if (reviewsData?.Products) {
            reviewsData.Products.forEach(p => {
                if (p.asin) {
                    reviewsMap[p.asin.toUpperCase()] = {
                        hasVideo: (p.video_url?.length || 0) > 0,
                        hasBrandStory: p.has_brandstory || false,
                        photoCount: p.product_photos?.length || 0,
                        rating: parseFloat(p.product_star_ratings) || 0,
                        numRatings: parseInt(p.product_num_ratings) || 0
                    };
                }
            });
        }
        
        // Build ads targeting map
        let targetedAsins = new Set();
        if (latestAdsItem?.batchId) {
            const adsItems = await ProductWiseSponsoredAdsItem.find({
                batchId: latestAdsItem.batchId
            }).select('asin').lean();
            
            adsItems.forEach(item => {
                if (item.asin) targetedAsins.add(item.asin.toUpperCase());
            });
        }
        
        // Categorize products
        const sellableProducts = [];
        const nonSellableProducts = [];
        const withAPlusProducts = [];
        const withoutAPlusProducts = [];
        const withB2BPricing = [];
        const withoutB2BPricing = [];
        const targetedInAds = [];
        const notTargetedInAds = [];
        const withVideo = [];
        const withoutVideo = [];
        const withBrandStory = [];
        const withoutBrandStory = [];
        
        allProducts.forEach(p => {
            const asinUpper = (p.asin || '').toUpperCase();
            const status = (p.status || '').toLowerCase();
            const reviewInfo = reviewsMap[asinUpper] || {};
            
            const productInfo = {
                asin: p.asin,
                sku: p.sku,
                itemName: p.itemName || 'Unknown Product',
                status: p.status,
                price: p.price,
                quantity: p.quantity,
                hasAPlus: aPlusAsins.has(asinUpper),
                hasB2BPricing: p.has_b2b_pricing || false,
                isTargetedInAds: targetedAsins.has(asinUpper),
                hasVideo: reviewInfo.hasVideo || false,
                hasBrandStory: reviewInfo.hasBrandStory || false,
                rating: reviewInfo.rating || 0,
                numRatings: reviewInfo.numRatings || 0
            };
            
            // Categorize by sellability
            if (status === 'active') {
                sellableProducts.push(productInfo);
            } else {
                // For non-sellable products, include the issues array (reasons why inactive/incomplete)
                // This comes directly from Amazon and explains exactly why the product is not sellable
                const nonSellableProductInfo = {
                    ...productInfo,
                    issues: Array.isArray(p.issues) ? p.issues : []
                };
                nonSellableProducts.push(nonSellableProductInfo);
            }
            
            // Categorize by A+ content
            if (productInfo.hasAPlus) {
                withAPlusProducts.push(productInfo);
            } else {
                withoutAPlusProducts.push(productInfo);
            }
            
            // Categorize by B2B pricing
            if (productInfo.hasB2BPricing) {
                withB2BPricing.push(productInfo);
            } else {
                withoutB2BPricing.push(productInfo);
            }
            
            // Categorize by ads targeting (only for active products)
            if (status === 'active') {
                if (productInfo.isTargetedInAds) {
                    targetedInAds.push(productInfo);
                } else {
                    notTargetedInAds.push(productInfo);
                }
            }
            
            // Categorize by video
            if (productInfo.hasVideo) {
                withVideo.push(productInfo);
            } else {
                withoutVideo.push(productInfo);
            }
            
            // Categorize by brand story
            if (productInfo.hasBrandStory) {
                withBrandStory.push(productInfo);
            } else {
                withoutBrandStory.push(productInfo);
            }
        });
        
        logger.info('[QMateProductsService] Got product categorization', {
            userId, country, region,
            duration: Date.now() - startTime,
            totalProducts: allProducts.length
        });
        
        return {
            success: true,
            source: 'product_categorization',
            data: {
                hasProducts: true,
                summary: {
                    totalProducts: allProducts.length,
                    sellableCount: sellableProducts.length,
                    nonSellableCount: nonSellableProducts.length,
                    withAPlusCount: withAPlusProducts.length,
                    withoutAPlusCount: withoutAPlusProducts.length,
                    withB2BPricingCount: withB2BPricing.length,
                    withoutB2BPricingCount: withoutB2BPricing.length,
                    targetedInAdsCount: targetedInAds.length,
                    notTargetedInAdsCount: notTargetedInAds.length,
                    withVideoCount: withVideo.length,
                    withoutVideoCount: withoutVideo.length,
                    withBrandStoryCount: withBrandStory.length,
                    withoutBrandStoryCount: withoutBrandStory.length
                },
                // Return sliced lists for context (full lists could be too large)
                sellableProducts: sellableProducts.slice(0, limit),
                nonSellableProducts: nonSellableProducts.slice(0, limit),
                withAPlusProducts: withAPlusProducts.slice(0, limit),
                withoutAPlusProducts: withoutAPlusProducts.slice(0, limit),
                withB2BPricing: withB2BPricing.slice(0, limit),
                withoutB2BPricing: withoutB2BPricing.slice(0, limit),
                targetedInAds: targetedInAds.slice(0, limit),
                notTargetedInAds: notTargetedInAds.slice(0, limit),
                withVideo: withVideo.slice(0, limit),
                withoutVideo: withoutVideo.slice(0, limit),
                withBrandStory: withBrandStory.slice(0, limit),
                withoutBrandStory: withoutBrandStory.slice(0, limit)
            }
        };
        
    } catch (error) {
        logger.error('[QMateProductsService] Error getting product categorization', {
            error: error.message, userId, country, region
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
            listingQualityResult,
            categorizationResult
        ] = await Promise.all([
            getProductReviewsData(userId, country, region),
            getProductSalesData(userId, country, region, 20),
            getListingQualityAnalysis(userId, country, region),
            getProductCategorization(userId, country, region, 20)
        ]);
        
        const context = {
            reviews: null,
            sales: null,
            listingQuality: null,
            categorization: null
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
        
        if (categorizationResult?.success) {
            context.categorization = categorizationResult.data;
        }
        
        // Generate product health summary
        const lowRatedCount = context.reviews?.summary?.lowRatedCount || 0;
        const noReviewsCount = context.reviews?.summary?.noReviewsCount || 0;
        const zeroSalesCount = context.sales?.zeroSalesProducts?.length || 0;
        const categorizationSummary = context.categorization?.summary || {};
        
        context.productHealthSummary = {
            totalProducts: categorizationSummary.totalProducts || context.listingQuality?.summary?.totalProducts || context.sales?.summary?.totalProducts || 0,
            activeProducts: categorizationSummary.sellableCount || context.listingQuality?.summary?.activeProducts || 0,
            nonSellableProducts: categorizationSummary.nonSellableCount || 0,
            averageRating: context.reviews?.summary?.averageRating || 0,
            productsNeedingAttention: lowRatedCount + noReviewsCount + zeroSalesCount,
            // Categorization counts
            withAPlus: categorizationSummary.withAPlusCount || 0,
            withoutAPlus: categorizationSummary.withoutAPlusCount || 0,
            withB2BPricing: categorizationSummary.withB2BPricingCount || 0,
            withoutB2BPricing: categorizationSummary.withoutB2BPricingCount || 0,
            targetedInAds: categorizationSummary.targetedInAdsCount || 0,
            notTargetedInAds: categorizationSummary.notTargetedInAdsCount || 0,
            withVideo: categorizationSummary.withVideoCount || 0,
            withoutVideo: categorizationSummary.withoutVideoCount || 0,
            withBrandStory: categorizationSummary.withBrandStoryCount || 0,
            withoutBrandStory: categorizationSummary.withoutBrandStoryCount || 0,
            recommendations: [
                ...(lowRatedCount > 0 ? [`${lowRatedCount} products have low ratings - consider quality improvements`] : []),
                ...(noReviewsCount > 5 ? [`${noReviewsCount} products have no reviews - consider review campaigns`] : []),
                ...(zeroSalesCount > 0 ? [`${zeroSalesCount} products have zero sales - review pricing/visibility`] : []),
                ...(categorizationSummary.withoutAPlusCount > 0 ? [`${categorizationSummary.withoutAPlusCount} products without A+ Content`] : []),
                ...(categorizationSummary.notTargetedInAdsCount > 0 ? [`${categorizationSummary.notTargetedInAdsCount} active products not targeted in ads`] : [])
            ].slice(0, 5)
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
    getFullAsinIssues,
    getListingQualityAnalysis,
    getProductsByIssueCategory,
    getProductCategorization,
    getQMateProductsContext
};
