/**
 * QMateIssuesService
 * 
 * Optimized service for fetching pre-calculated issues data for QMate AI.
 * This service reads directly from pre-computed MongoDB collections:
 * - IssueSummary: Quick counts per category
 * - IssuesDataChunks: Detailed issues with suggested solutions
 * 
 * Benefits:
 * - No real-time calculations - data is pre-computed during integration/schedules
 * - Fast database reads instead of full analysis pipeline
 * - Includes suggested solutions stored with issues
 * 
 * This service is INDEPENDENT and does not affect any existing flows.
 */

const logger = require('../../utils/Logger.js');
const IssueSummary = require('../../models/system/IssueSummaryModel.js');
const IssuesDataChunks = require('../../models/system/IssuesDataChunksModel.js');
const mongoose = require('mongoose');

/**
 * Get issue counts summary for QMate context
 * Fast query that returns only counts without detailed data
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Issue counts summary
 */
async function getIssueCounts(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Try IssueSummary first (fastest - single document with counts)
        const summary = await IssueSummary.getIssueSummary(userObjectId, country, region);
        
        if (summary) {
            logger.info('[QMateIssuesService] Got issue counts from IssueSummary', {
                userId,
                country,
                region,
                duration: Date.now() - startTime,
                totalIssues: summary.totalIssues
            });
            
            return {
                success: true,
                source: 'issue_summary',
                data: {
                    totalIssues: summary.totalIssues || 0,
                    profitabilityErrors: summary.totalProfitabilityErrors || 0,
                    sponsoredAdsErrors: summary.totalSponsoredAdsErrors || 0,
                    inventoryErrors: summary.totalInventoryErrors || 0,
                    rankingErrors: summary.totalRankingErrors || 0,
                    conversionErrors: summary.totalConversionErrors || 0,
                    accountErrors: summary.totalAccountErrors || 0,
                    numberOfProductsWithIssues: summary.numberOfProductsWithIssues || 0,
                    totalActiveProducts: summary.totalActiveProducts || 0,
                    lastCalculatedAt: summary.lastCalculatedAt,
                    isStale: summary.isStale || false
                }
            };
        }
        
        // Fallback: Try metadata from IssuesDataChunks
        const metadata = await IssuesDataChunks.getMetadata(userObjectId, country, region);
        
        if (metadata) {
            logger.info('[QMateIssuesService] Got issue counts from IssuesDataChunks metadata', {
                userId,
                country,
                region,
                duration: Date.now() - startTime
            });
            
            return {
                success: true,
                source: 'issues_data_chunks',
                data: {
                    totalIssues: metadata.totalIssues || 
                        ((metadata.totalRankingErrors || 0) +
                         (metadata.totalConversionErrors || 0) +
                         (metadata.totalInventoryErrors || 0) +
                         (metadata.totalAccountErrors || 0) +
                         (metadata.totalProfitabilityErrors || 0) +
                         (metadata.totalSponsoredAdsErrors || 0)),
                    profitabilityErrors: metadata.totalProfitabilityErrors || 0,
                    sponsoredAdsErrors: metadata.totalSponsoredAdsErrors || 0,
                    inventoryErrors: metadata.totalInventoryErrors || 0,
                    rankingErrors: metadata.totalRankingErrors || 0,
                    conversionErrors: metadata.totalConversionErrors || 0,
                    accountErrors: metadata.totalAccountErrors || 0,
                    numberOfProductsWithIssues: metadata.numberOfProductsWithIssues || 0,
                    lastCalculatedAt: metadata.lastCalculatedAt
                }
            };
        }
        
        // No data found
        logger.warn('[QMateIssuesService] No issue counts found', {
            userId,
            country,
            region,
            duration: Date.now() - startTime
        });
        
        return {
            success: false,
            source: 'none',
            error: 'No issue data found for this account',
            data: null
        };
        
    } catch (error) {
        logger.error('[QMateIssuesService] Error getting issue counts', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });
        
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

/**
 * Get detailed issues by category for QMate context
 * Returns issues with suggested solutions for AI to provide recommendations
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Object} options - Options for filtering
 * @param {string} options.category - Filter by category: 'ranking', 'conversion', 'inventory', 'profitability', 'sponsoredAds', 'all'
 * @param {number} options.limit - Max number of issues to return per category (default 30)
 * @returns {Promise<Object>} Detailed issues with suggestions
 */
async function getDetailedIssues(userId, country, region, options = {}) {
    const startTime = Date.now();
    const { category = 'all', limit = 30 } = options;
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        const result = {
            success: true,
            source: 'issues_data_chunks',
            data: {},
            counts: {}
        };
        
        // Get metadata first for counts
        const metadata = await IssuesDataChunks.getMetadata(userObjectId, country, region);
        
        if (metadata) {
            result.counts = {
                totalIssues: metadata.totalIssues || 0,
                profitabilityErrors: metadata.totalProfitabilityErrors || 0,
                sponsoredAdsErrors: metadata.totalSponsoredAdsErrors || 0,
                inventoryErrors: metadata.totalInventoryErrors || 0,
                rankingErrors: metadata.totalRankingErrors || 0,
                conversionErrors: metadata.totalConversionErrors || 0,
                accountErrors: metadata.totalAccountErrors || 0,
                accountHealthPercentage: metadata.accountHealthPercentage,
                topErrorProducts: metadata.topErrorProducts
            };
        }
        
        // Fetch detailed data based on category
        const categoriesToFetch = category === 'all' 
            ? ['ranking', 'conversion', 'inventory', 'profitability', 'sponsoredAds', 'productWise']
            : [category];
        
        for (const cat of categoriesToFetch) {
            const fieldName = getCategoryFieldName(cat);
            if (!fieldName) continue;
            
            // Get paginated data for this category
            const { data, total } = await IssuesDataChunks.getPaginatedFieldData(
                userObjectId, 
                country, 
                region, 
                fieldName, 
                0, 
                limit
            );
            
            // Transform data to include suggestions based on issue type
            const transformedData = transformIssuesWithSuggestions(data, cat);
            
            result.data[cat] = {
                items: transformedData,
                total,
                returned: transformedData.length
            };
        }
        
        logger.info('[QMateIssuesService] Got detailed issues', {
            userId,
            country,
            region,
            category,
            duration: Date.now() - startTime,
            categoriesFetched: categoriesToFetch
        });
        
        return result;
        
    } catch (error) {
        logger.error('[QMateIssuesService] Error getting detailed issues', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region,
            category
        });
        
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

/**
 * Get top error products for QMate context
 * Returns products sorted by error count with all their issues
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {number} limit - Max number of products to return (default 30)
 * @returns {Promise<Object>} Top error products with details
 */
async function getTopErrorProducts(userId, country, region, limit = 30) {
    const startTime = Date.now();
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Get productWiseError data
        const { data, total } = await IssuesDataChunks.getPaginatedFieldData(
            userObjectId,
            country,
            region,
            'productWiseError',
            0,
            limit
        );
        
        // Sort by error count and transform
        const sortedProducts = (data || [])
            .sort((a, b) => (b.errors || 0) - (a.errors || 0))
            .map(product => ({
                asin: product.asin,
                sku: product.sku || 'N/A',
                name: product.name || 'Unknown Product',
                price: product.price || 0,
                mainImage: product.MainImage || null,
                totalErrors: product.errors || 0,
                sales: product.sales || 0,
                quantity: product.quantity || 0,
                issues: {
                    ranking: transformRankingIssues(product.rankingErrors),
                    conversion: transformConversionIssues(product.conversionErrors),
                    inventory: transformInventoryIssues(product.inventoryErrors)
                }
            }));
        
        logger.info('[QMateIssuesService] Got top error products', {
            userId,
            country,
            region,
            duration: Date.now() - startTime,
            productsReturned: sortedProducts.length,
            totalProducts: total
        });
        
        return {
            success: true,
            source: 'issues_data_chunks',
            data: {
                products: sortedProducts,
                total,
                returned: sortedProducts.length
            }
        };
        
    } catch (error) {
        logger.error('[QMateIssuesService] Error getting top error products', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });
        
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

/**
 * Get complete issues context for QMate AI
 * Combines counts, top products, and detailed issues in a single call
 * Optimized for providing full context to AI in one request
 * 
 * IMPORTANT: This function retrieves ALL issues data for comprehensive AI responses.
 * The limits are set high to ensure the AI can provide complete answers for queries like
 * "list all ASINs with ranking issues" without truncating data.
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Object} options - Options
 * @param {number} options.topProductsLimit - Max products to include (default 500 - high to capture all)
 * @param {number} options.issuesPerCategoryLimit - Max issues per category (default 500 - high to capture all)
 * @returns {Promise<Object>} Complete issues context
 */
async function getQMateIssuesContext(userId, country, region, options = {}) {
    const startTime = Date.now();
    // Increased limits significantly to provide complete data for issue-related queries
    // AI needs access to ALL issues to answer questions like "list all ASINs with ranking issues"
    const { topProductsLimit = 500, issuesPerCategoryLimit = 500 } = options;
    
    try {
        const userObjectId = typeof userId === 'string' 
            ? new mongoose.Types.ObjectId(userId) 
            : userId;
        
        // Fetch all data in parallel for performance
        // Using high limits to ensure we get complete issue data
        const [counts, metadata, productWiseData, rankingData, conversionData, inventoryData, profitabilityData, sponsoredAdsData] = await Promise.all([
            IssueSummary.getIssueSummary(userObjectId, country, region),
            IssuesDataChunks.getMetadata(userObjectId, country, region),
            IssuesDataChunks.getPaginatedFieldData(userObjectId, country, region, 'productWiseError', 0, topProductsLimit),
            IssuesDataChunks.getPaginatedFieldData(userObjectId, country, region, 'rankingProductWiseErrors', 0, issuesPerCategoryLimit),
            IssuesDataChunks.getPaginatedFieldData(userObjectId, country, region, 'conversionProductWiseErrors', 0, issuesPerCategoryLimit),
            IssuesDataChunks.getPaginatedFieldData(userObjectId, country, region, 'inventoryProductWiseErrors', 0, issuesPerCategoryLimit),
            IssuesDataChunks.getPaginatedFieldData(userObjectId, country, region, 'profitabilityErrorDetails', 0, issuesPerCategoryLimit),
            IssuesDataChunks.getPaginatedFieldData(userObjectId, country, region, 'sponsoredAdsErrorDetails', 0, issuesPerCategoryLimit)
        ]);
        
        // Transform ranking data - ensure we capture ALL ASINs with ANY ranking issue
        const transformedRankingIssues = [];
        const rankingDataArray = rankingData.data || [];
        
        rankingDataArray.forEach(item => {
            const asin = item.asin;
            const sku = item.sku || item.SKU || null;
            const title = item.Title || item.name || 'Unknown Product';
            const data = item.data || item;
            
            // Extract ALL issue types from the ranking data structure
            const issueDetails = [];
            
            // Title issues
            const titleResult = data.TitleResult || data.titleResult;
            if (titleResult) {
                if (titleResult.charLim?.status === 'Error') {
                    issueDetails.push({
                        section: 'Title',
                        type: 'character_limit',
                        message: titleResult.charLim.Message,
                        howToSolve: titleResult.charLim.HowTOSolve
                    });
                }
                if (titleResult.RestictedWords?.status === 'Error') {
                    issueDetails.push({
                        section: 'Title',
                        type: 'restricted_words',
                        message: titleResult.RestictedWords.Message,
                        restrictedWords: titleResult.RestictedWords.RestrictedWordsFound,
                        howToSolve: titleResult.RestictedWords.HowTOSolve
                    });
                }
                if (titleResult.checkSpecialCharacters?.status === 'Error') {
                    issueDetails.push({
                        section: 'Title',
                        type: 'special_characters',
                        message: titleResult.checkSpecialCharacters.Message,
                        howToSolve: titleResult.checkSpecialCharacters.HowTOSolve
                    });
                }
            }
            
            // Bullet points issues
            const bulletPoints = data.BulletPoints || data.bulletPoints;
            if (bulletPoints) {
                if (bulletPoints.charLim?.status === 'Error') {
                    issueDetails.push({
                        section: 'Bullet Points',
                        type: 'character_limit',
                        message: bulletPoints.charLim.Message,
                        howToSolve: bulletPoints.charLim.HowTOSolve
                    });
                }
                if (bulletPoints.RestictedWords?.status === 'Error') {
                    issueDetails.push({
                        section: 'Bullet Points',
                        type: 'restricted_words',
                        message: bulletPoints.RestictedWords.Message,
                        restrictedWords: bulletPoints.RestictedWords.RestrictedWordsFound,
                        howToSolve: bulletPoints.RestictedWords.HowTOSolve
                    });
                }
                if (bulletPoints.checkSpecialCharacters?.status === 'Error') {
                    issueDetails.push({
                        section: 'Bullet Points',
                        type: 'special_characters',
                        message: bulletPoints.checkSpecialCharacters.Message,
                        howToSolve: bulletPoints.checkSpecialCharacters.HowTOSolve
                    });
                }
            }
            
            // Description issues
            const description = data.Description || data.description;
            if (description) {
                if (description.charLim?.status === 'Error') {
                    issueDetails.push({
                        section: 'Description',
                        type: 'character_limit',
                        message: description.charLim.Message,
                        howToSolve: description.charLim.HowTOSolve
                    });
                }
                if (description.RestictedWords?.status === 'Error') {
                    issueDetails.push({
                        section: 'Description',
                        type: 'restricted_words',
                        message: description.RestictedWords.Message,
                        restrictedWords: description.RestictedWords.RestrictedWordsFound,
                        howToSolve: description.RestictedWords.HowTOSolve
                    });
                }
                if (description.checkSpecialCharacters?.status === 'Error') {
                    issueDetails.push({
                        section: 'Description',
                        type: 'special_characters',
                        message: description.checkSpecialCharacters.Message,
                        howToSolve: description.checkSpecialCharacters.HowTOSolve
                    });
                }
            }
            
            // Backend keywords issues (charLim at root level - Amazon's 250-byte limit)
            if (data.charLim?.status === 'Error' || data.charLim?.status === 'Warning') {
                issueDetails.push({
                    section: 'Backend Keywords',
                    type: 'byte_limit',
                    message: data.charLim.Message,
                    howToSolve: data.charLim.HowTOSolve,
                    severity: data.charLim.status === 'Error' ? 'high' : 'medium'
                });
            }
            
            // Backend keywords duplicate words
            if (data.dublicateWords === 'Error' || data.dublicateWords?.status === 'Error') {
                const dupeData = typeof data.dublicateWords === 'object' ? data.dublicateWords : null;
                issueDetails.push({
                    section: 'Backend Keywords',
                    type: 'duplicate_words',
                    message: dupeData?.Message || 'Backend keywords contain duplicate words',
                    howToSolve: dupeData?.HowTOSolve || 'Remove duplicate words to maximize keyword variety'
                });
            }
            
            // Only add products that have at least one issue
            if (issueDetails.length > 0) {
                transformedRankingIssues.push({
                    asin,
                    sku,
                    title,
                    totalIssueCount: issueDetails.length,
                    issues: issueDetails
                });
            }
        });
        
        // Build context object
        const context = {
            // Summary counts
            summary: {
                totalIssues: counts?.totalIssues || metadata?.totalIssues || 0,
                profitabilityErrors: counts?.totalProfitabilityErrors || metadata?.totalProfitabilityErrors || 0,
                sponsoredAdsErrors: counts?.totalSponsoredAdsErrors || metadata?.totalSponsoredAdsErrors || 0,
                inventoryErrors: counts?.totalInventoryErrors || metadata?.totalInventoryErrors || 0,
                rankingErrors: counts?.totalRankingErrors || metadata?.totalRankingErrors || 0,
                conversionErrors: counts?.totalConversionErrors || metadata?.totalConversionErrors || 0,
                accountErrors: counts?.totalAccountErrors || metadata?.totalAccountErrors || 0,
                numberOfProductsWithIssues: counts?.numberOfProductsWithIssues || metadata?.numberOfProductsWithIssues || 0,
                accountHealthPercentage: metadata?.accountHealthPercentage || null,
                lastCalculatedAt: counts?.lastCalculatedAt || metadata?.lastCalculatedAt
            },
            
            // Actual counts from the data we retrieved (for AI awareness)
            dataCounts: {
                rankingIssuesProductCount: transformedRankingIssues.length,
                rankingIssuesRetrieved: rankingData.total || 0,
                conversionIssuesRetrieved: conversionData.total || 0,
                inventoryIssuesRetrieved: inventoryData.total || 0,
                profitabilityIssuesRetrieved: profitabilityData.total || 0,
                sponsoredAdsIssuesRetrieved: sponsoredAdsData.total || 0,
                productsWithIssuesRetrieved: productWiseData.total || 0
            },
            
            // Top error products with all their issues
            topErrorAsins: (productWiseData.data || [])
                .sort((a, b) => (b.errors || 0) - (a.errors || 0))
                .slice(0, Math.min(topProductsLimit, 100)) // Cap at 100 for context size
                .map(p => ({
                    asin: p.asin,
                    name: p.name || 'Unknown',
                    sku: p.sku || null,
                    errors: p.errors || 0,
                    sales: p.sales || 0,
                    rankingIssues: transformRankingIssues(p.rankingErrors),
                    conversionIssues: transformConversionIssues(p.conversionErrors),
                    inventoryIssues: transformInventoryIssues(p.inventoryErrors)
                })),
            
            // Detailed ranking issues - COMPLETE list of all products with ranking issues
            // This is the primary source for queries like "list all ASINs with ranking issues"
            rankingIssues: transformedRankingIssues,
            
            // Other category issues with suggestions
            conversionIssues: transformIssuesWithSuggestions(conversionData.data || [], 'conversion'),
            inventoryIssues: transformIssuesWithSuggestions(inventoryData.data || [], 'inventory'),
            profitabilityIssues: transformIssuesWithSuggestions(profitabilityData.data || [], 'profitability'),
            sponsoredAdsIssues: transformIssuesWithSuggestions(sponsoredAdsData.data || [], 'sponsoredAds'),
            
            // Top priority products (from metadata)
            topPriorityProducts: metadata?.topErrorProducts || null
        };
        
        logger.info('[QMateIssuesService] Got complete QMate issues context', {
            userId,
            country,
            region,
            duration: Date.now() - startTime,
            totalIssues: context.summary.totalIssues,
            rankingIssuesCount: context.rankingIssues.length,
            conversionIssuesCount: context.conversionIssues.length,
            inventoryIssuesCount: context.inventoryIssues.length,
            topAsinsCount: context.topErrorAsins.length
        });
        
        return {
            success: true,
            source: 'pre_computed',
            data: context
        };
        
    } catch (error) {
        logger.error('[QMateIssuesService] Error getting QMate issues context', {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });
        
        return {
            success: false,
            error: error.message,
            data: null
        };
    }
}

// ============================================
// HELPER FUNCTIONS
// ============================================

/**
 * Map category name to IssuesDataChunks field name
 */
function getCategoryFieldName(category) {
    const mapping = {
        'ranking': 'rankingProductWiseErrors',
        'conversion': 'conversionProductWiseErrors',
        'inventory': 'inventoryProductWiseErrors',
        'profitability': 'profitabilityErrorDetails',
        'sponsoredAds': 'sponsoredAdsErrorDetails',
        'productWise': 'productWiseError'
    };
    return mapping[category] || null;
}

/**
 * Transform ranking issues to include suggestions
 * Handles all ranking error structures:
 * - TitleResult: Title issues (charLim, RestictedWords, checkSpecialCharacters)
 * - BulletPoints: Bullet point issues (charLim, RestictedWords, checkSpecialCharacters)
 * - Description/descriptionResult: Description issues
 * - charLim at root level: Backend keywords byte limit (Amazon's 250-byte limit)
 * - dublicateWords: Backend keywords duplicate words
 */
function transformRankingIssues(rankingErrors) {
    if (!rankingErrors) return null;
    
    // Handle both direct data object and nested data property
    const data = rankingErrors.data || rankingErrors;
    if (!data || typeof data !== 'object') return null;
    
    const issues = [];
    
    // ============================================
    // TITLE ISSUES (TitleResult section)
    // ============================================
    const titleResult = data.TitleResult || data.titleResult;
    if (titleResult) {
        if (titleResult.charLim?.status === 'Error') {
            issues.push({
                type: 'title_length',
                section: 'Title',
                message: titleResult.charLim.Message || 'Title length is outside optimal range (80-200 characters)',
                howToSolve: titleResult.charLim.HowTOSolve || 'Adjust title to be between 80-200 characters for optimal visibility',
                severity: 'high'
            });
        }
        if (titleResult.RestictedWords?.status === 'Error') {
            issues.push({
                type: 'title_restricted_words',
                section: 'Title',
                message: titleResult.RestictedWords.Message || 'Title contains restricted words',
                restrictedWords: titleResult.RestictedWords.RestrictedWordsFound || [],
                howToSolve: titleResult.RestictedWords.HowTOSolve || 'Remove restricted words from title',
                severity: 'high'
            });
        }
        if (titleResult.checkSpecialCharacters?.status === 'Error') {
            issues.push({
                type: 'title_special_characters',
                section: 'Title',
                message: titleResult.checkSpecialCharacters.Message || 'Title contains prohibited special characters',
                howToSolve: titleResult.checkSpecialCharacters.HowTOSolve || 'Remove special characters: ! $ ? _ { } ^ ¬ ¦ ~ # < > *',
                severity: 'medium'
            });
        }
    }
    
    // ============================================
    // BULLET POINTS ISSUES (BulletPoints section)
    // ============================================
    const bulletPoints = data.BulletPoints || data.bulletPoints || data.bulletPointsResult;
    if (bulletPoints) {
        if (bulletPoints.charLim?.status === 'Error') {
            issues.push({
                type: 'bullet_length',
                section: 'Bullet Points',
                message: bulletPoints.charLim.Message || 'One or more bullet points are too short (min 150 characters each)',
                howToSolve: bulletPoints.charLim.HowTOSolve || 'Expand bullet points to at least 150 characters each with relevant keywords',
                severity: 'medium'
            });
        }
        if (bulletPoints.RestictedWords?.status === 'Error') {
            issues.push({
                type: 'bullet_restricted_words',
                section: 'Bullet Points',
                message: bulletPoints.RestictedWords.Message || 'Bullet points contain restricted words',
                restrictedWords: bulletPoints.RestictedWords.RestrictedWordsFound || [],
                howToSolve: bulletPoints.RestictedWords.HowTOSolve || 'Remove restricted words from bullet points',
                severity: 'high'
            });
        }
        if (bulletPoints.checkSpecialCharacters?.status === 'Error') {
            issues.push({
                type: 'bullet_special_characters',
                section: 'Bullet Points',
                message: bulletPoints.checkSpecialCharacters.Message || 'Bullet points contain prohibited special characters',
                howToSolve: bulletPoints.checkSpecialCharacters.HowTOSolve || 'Remove special characters from bullet points',
                severity: 'medium'
            });
        }
    }
    
    // ============================================
    // DESCRIPTION ISSUES (Description section)
    // ============================================
    const description = data.Description || data.description || data.descriptionResult;
    if (description) {
        if (description.charLim?.status === 'Error') {
            issues.push({
                type: 'description_length',
                section: 'Description',
                message: description.charLim.Message || 'Description is too short (min 1700 characters)',
                howToSolve: description.charLim.HowTOSolve || 'Expand description to at least 1700 characters with detailed product information',
                severity: 'medium'
            });
        }
        if (description.RestictedWords?.status === 'Error') {
            issues.push({
                type: 'description_restricted_words',
                section: 'Description',
                message: description.RestictedWords.Message || 'Description contains restricted words',
                restrictedWords: description.RestictedWords.RestrictedWordsFound || [],
                howToSolve: description.RestictedWords.HowTOSolve || 'Remove restricted words from description',
                severity: 'high'
            });
        }
        if (description.checkSpecialCharacters?.status === 'Error') {
            issues.push({
                type: 'description_special_characters',
                section: 'Description',
                message: description.checkSpecialCharacters.Message || 'Description contains prohibited special characters',
                howToSolve: description.checkSpecialCharacters.HowTOSolve || 'Remove special characters from description',
                severity: 'medium'
            });
        }
    }
    
    // ============================================
    // BACKEND KEYWORDS ISSUES (charLim at root level - Amazon's 250-byte limit)
    // This is the CRITICAL one for ranking queries!
    // ============================================
    // Check charLim at root level (backend keywords byte limit)
    if (data.charLim?.status === 'Error' || data.charLim?.status === 'Warning') {
        issues.push({
            type: 'backend_keywords_byte_limit',
            section: 'Backend Keywords',
            message: data.charLim.Message || 'Backend keywords exceed Amazon\'s 250-byte limit',
            howToSolve: data.charLim.HowTOSolve || 'Reduce backend keywords to 249 bytes or less. Remove unnecessary words, avoid repetition, and prioritize high-value search terms.',
            severity: data.charLim.status === 'Error' ? 'high' : 'medium'
        });
    }
    
    // Check for duplicate words in backend keywords
    const dublicateWords = data.dublicateWords;
    if (dublicateWords === 'Error' || dublicateWords?.status === 'Error') {
        const dupeData = typeof dublicateWords === 'object' ? dublicateWords : null;
        issues.push({
            type: 'backend_keywords_duplicates',
            section: 'Backend Keywords',
            message: dupeData?.Message || 'Backend keywords contain duplicate words, wasting space and reducing effectiveness',
            howToSolve: dupeData?.HowTOSolve || 'Remove duplicate words from backend keywords to maximize keyword variety',
            severity: 'medium'
        });
    }
    
    // Also check backendKeywords nested structure (alternative data format)
    if (data.backendKeywords) {
        const bk = data.backendKeywords;
        if (bk.charLim?.status === 'Error' || bk.charLim?.status === 'Warning') {
            // Only add if not already captured from root level
            if (!issues.some(i => i.type === 'backend_keywords_byte_limit')) {
                issues.push({
                    type: 'backend_keywords_byte_limit',
                    section: 'Backend Keywords',
                    message: bk.charLim.Message || 'Backend keywords issue detected',
                    howToSolve: bk.charLim.HowTOSolve || 'Optimize backend keywords length',
                    severity: bk.charLim.status === 'Error' ? 'high' : 'medium'
                });
            }
        }
        if (bk.dublicateWords === 'Error' || bk.dublicateWords?.status === 'Error') {
            if (!issues.some(i => i.type === 'backend_keywords_duplicates')) {
                const dupeData = typeof bk.dublicateWords === 'object' ? bk.dublicateWords : null;
                issues.push({
                    type: 'backend_keywords_duplicates',
                    section: 'Backend Keywords',
                    message: dupeData?.Message || 'Backend keywords contain duplicate words',
                    howToSolve: dupeData?.HowTOSolve || 'Remove duplicate words from backend keywords',
                    severity: 'medium'
                });
            }
        }
    }
    
    return issues.length > 0 ? issues : null;
}

/**
 * Transform conversion issues to include suggestions
 */
function transformConversionIssues(conversionErrors) {
    if (!conversionErrors) return null;
    
    const issues = [];
    
    // Image count
    if (conversionErrors.imageCount !== undefined && conversionErrors.imageCount < 7) {
        issues.push({
            type: 'low_image_count',
            currentValue: conversionErrors.imageCount,
            requiredValue: 7,
            message: `Product has only ${conversionErrors.imageCount} images (minimum 7 recommended)`,
            suggestion: 'Add more high-quality product images showing different angles, lifestyle, and infographics'
        });
    }
    
    // Video
    if (conversionErrors.hasVideo === false) {
        issues.push({
            type: 'no_video',
            message: 'Product listing has no video',
            suggestion: 'Add a product video to increase engagement and conversion rate'
        });
    }
    
    // A+ Content
    if (conversionErrors.hasAPlus === false) {
        issues.push({
            type: 'no_aplus',
            message: 'Product does not have A+ Content',
            suggestion: 'Create A+ Content to showcase brand story and product features visually'
        });
    }
    
    // Star Rating
    if (conversionErrors.starRating !== undefined && conversionErrors.starRating < 4.3) {
        issues.push({
            type: 'low_rating',
            currentValue: conversionErrors.starRating,
            requiredValue: 4.3,
            message: `Product rating is ${conversionErrors.starRating} (below 4.3 threshold)`,
            suggestion: 'Focus on product quality and customer service to improve ratings'
        });
    }
    
    // Buy Box
    if (conversionErrors.hasBuyBox === false || conversionErrors.buyBoxPercentage === 0) {
        issues.push({
            type: 'no_buybox',
            buyBoxPercentage: conversionErrors.buyBoxPercentage || 0,
            message: 'Seller does not have the Buy Box',
            suggestion: 'Review pricing, fulfillment method (FBA), and seller metrics to win Buy Box'
        });
    }
    
    // Brand Story
    if (conversionErrors.hasBrandStory === false) {
        issues.push({
            type: 'no_brand_story',
            message: 'Product does not have Brand Story',
            suggestion: 'Add Brand Story to build brand awareness and customer trust'
        });
    }
    
    return issues.length > 0 ? issues : null;
}

/**
 * Transform inventory issues to include suggestions
 */
function transformInventoryIssues(inventoryErrors) {
    if (!inventoryErrors) return null;
    
    const issues = [];
    
    // Inventory Planning issues
    if (inventoryErrors.inventoryPlanning) {
        const ip = inventoryErrors.inventoryPlanning;
        if (ip.hasLongTermStorageFee) {
            issues.push({
                type: 'long_term_storage',
                message: 'Product incurring long-term storage fees',
                suggestion: 'Remove slow-moving inventory or create promotions to increase sales velocity'
            });
        }
        if (ip.hasUnfulfillableInventory) {
            issues.push({
                type: 'unfulfillable_inventory',
                message: 'Product has unfulfillable inventory',
                suggestion: 'Request removal or disposal of unfulfillable units, or investigate root cause'
            });
        }
    }
    
    // Stranded Inventory
    if (inventoryErrors.strandedInventory) {
        issues.push({
            type: 'stranded_inventory',
            quantity: inventoryErrors.strandedInventory.quantity || 0,
            message: 'Product has stranded inventory',
            suggestion: 'Fix listing issues to make stranded inventory sellable again'
        });
    }
    
    // Inbound Non-Compliance
    if (inventoryErrors.inboundNonCompliance) {
        issues.push({
            type: 'inbound_non_compliance',
            message: 'Inbound shipment non-compliance issues',
            suggestion: 'Review and resolve inbound shipment problems in Seller Central'
        });
    }
    
    // Replenishment
    if (inventoryErrors.replenishment) {
        const rep = inventoryErrors.replenishment;
        if (rep.status === 'Error' || rep.recommendedAction) {
            issues.push({
                type: 'replenishment_needed',
                daysOfSupply: rep.daysOfSupply || 0,
                recommendedQuantity: rep.recommendedQuantity || 0,
                message: rep.recommendedAction || 'Product needs replenishment',
                suggestion: `Send ${rep.recommendedQuantity || 'more'} units to avoid stockout`
            });
        }
    }
    
    return issues.length > 0 ? issues : null;
}

/**
 * Transform issues with suggestions based on category
 */
function transformIssuesWithSuggestions(issues, category) {
    if (!Array.isArray(issues) || issues.length === 0) return [];
    
    return issues.map(issue => {
        const transformed = {
            asin: issue.asin,
            title: issue.Title || issue.name || 'Unknown Product'
        };
        
        switch (category) {
            case 'ranking':
                transformed.issues = transformRankingIssues(issue);
                break;
                
            case 'conversion':
                transformed.issues = transformConversionIssues(issue);
                break;
                
            case 'inventory':
                transformed.issues = transformInventoryIssues(issue);
                break;
                
            case 'profitability':
                transformed.issues = [{
                    type: issue.netProfit < 0 ? 'negative_profit' : 'low_margin',
                    sales: issue.sales || 0,
                    adsSpend: issue.ads || issue.adsSpend || 0,
                    amazonFees: issue.amzFee || issue.amazonFees || 0,
                    netProfit: issue.netProfit || 0,
                    profitMargin: issue.profitMargin || 0,
                    message: issue.netProfit < 0 
                        ? 'Product is losing money' 
                        : 'Product has low profit margin (below 10%)',
                    suggestion: issue.netProfit < 0
                        ? 'Review pricing, reduce ad spend, or optimize costs to turn profitable'
                        : 'Increase prices or reduce costs to achieve 10%+ margin'
                }];
                break;
                
            case 'sponsoredAds':
                transformed.issues = [{
                    type: issue.errorType || 'high_acos',
                    campaignName: issue.campaignName || 'Unknown Campaign',
                    keyword: issue.keyword || null,
                    spend: issue.spend || issue.cost || 0,
                    sales: issue.sales || 0,
                    acos: issue.acos || (issue.sales > 0 ? (issue.spend / issue.sales * 100) : 0),
                    clicks: issue.clicks || 0,
                    message: issue.errorType === 'wasted_spend' 
                        ? 'Keyword has spend but no sales (wasted spend)'
                        : 'Campaign ACOS exceeds 40% threshold',
                    suggestion: issue.errorType === 'wasted_spend'
                        ? 'Add as negative keyword or pause the keyword'
                        : 'Reduce bids, pause underperforming keywords, or improve targeting'
                }];
                break;
                
            default:
                transformed.rawData = issue;
        }
        
        return transformed;
    }).filter(t => t.issues && t.issues.length > 0);
}

module.exports = {
    getIssueCounts,
    getDetailedIssues,
    getTopErrorProducts,
    getQMateIssuesContext
};
