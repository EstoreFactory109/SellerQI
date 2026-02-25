/**
 * IssuesPaginationService
 * 
 * Service for paginated access to issues data for the Issues pages.
 * This service provides server-side pagination, sorting, and filtering
 * to reduce data transfer and improve initial page load times.
 * 
 * Used by:
 * - Issues by Category page (separate endpoints per category)
 * - Issues by Product page (paginated product list)
 * 
 * Fallback behavior:
 * - If pre-computed data doesn't exist in IssuesDataChunks, it falls back
 *   to IssuesDataService which will calculate and store data on-the-fly
 * 
 * UNIFIED MODEL: All data is stored in IssuesDataChunks collection only.
 * - _metadata chunk contains counts, account health, etc.
 * - Array chunks contain paginated array data
 */

const logger = require('../../utils/Logger.js');
const IssuesDataChunks = require('../../models/system/IssuesDataChunksModel.js');
const IssueSummary = require('../../models/system/IssueSummaryModel.js');
const IssuesDataService = require('./IssuesDataService.js');

// Default pagination settings
const DEFAULT_PAGE_SIZE = 10;
const PRODUCTS_PAGE_SIZE = 6;

/**
 * Helper function to ensure issues data exists
 * Falls back to IssuesDataService if data is missing
 * 
 * UNIFIED MODEL: Reads from IssuesDataChunks only
 * - Metadata from _metadata chunk
 * - Arrays from respective field chunks
 * 
 * @param {string} userId 
 * @param {string} country 
 * @param {string} region 
 * @param {Object} projection - Fields to retrieve (1 = include)
 * @returns {Promise<Object|null>} Issues data or null
 */
async function ensureIssuesData(userId, country, region, projection = {}) {
    // Check if data exists in unified model
    const hasData = await IssuesDataChunks.hasIssuesData(userId, country, region);
    
    if (hasData) {
        // Build result object from chunks
        const requestedFields = Object.keys(projection).filter(k => projection[k] === 1);
        const result = {};
        
        // Get metadata if any non-array fields requested
        const { ARRAY_FIELD_NAMES } = IssuesDataChunks;
        const needsMetadata = requestedFields.some(f => !ARRAY_FIELD_NAMES.includes(f));
        
        if (needsMetadata) {
            const metadata = await IssuesDataChunks.getMetadata(userId, country, region);
            if (metadata) {
                Object.assign(result, metadata);
            }
        }
        
        // Get requested array fields from chunks
        for (const field of requestedFields) {
            if (ARRAY_FIELD_NAMES.includes(field)) {
                result[field] = await IssuesDataChunks.getFieldData(userId, country, region, field);
            }
        }
        
        return result;
    }
    
    // Data missing - calculate and store using IssuesDataService
    logger.info('[IssuesPaginationService] No pre-computed data found, calculating on-the-fly', {
        userId, country, region
    });
    
    const calcResult = await IssuesDataService.calculateAndStoreIssuesData(userId, country, region, 'pagination_fallback');
    
    if (!calcResult.success) {
        logger.error('[IssuesPaginationService] Failed to calculate issues data', {
            userId, country, region,
            error: calcResult.error
        });
        return null;
    }
    
    // Re-fetch from chunks after storing
    const requestedFields = Object.keys(projection).filter(k => projection[k] === 1);
    const result = {};
    
    const { ARRAY_FIELD_NAMES } = IssuesDataChunks;
    const needsMetadata = requestedFields.some(f => !ARRAY_FIELD_NAMES.includes(f));
    
    if (needsMetadata) {
        const metadata = await IssuesDataChunks.getMetadata(userId, country, region);
        if (metadata) {
            Object.assign(result, metadata);
        }
    }
    
    for (const field of requestedFields) {
        if (ARRAY_FIELD_NAMES.includes(field)) {
            result[field] = await IssuesDataChunks.getFieldData(userId, country, region, field);
        }
    }
    
    return Object.keys(result).length > 0 ? result : null;
}

/**
 * Get issues summary (counts only) for the dashboard header
 * Uses pre-computed IssueSummary or IssuesDataChunks metadata for instant response
 * Falls back to IssuesDataService if data is missing
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Summary counts
 */
async function getIssuesSummary(userId, country, region) {
    const startTime = Date.now();
    
    try {
        // Get pre-computed summary counts from IssueSummary
        let summary = await IssueSummary.getIssueSummary(userId, country, region);
        
        // Get metadata from unified IssuesDataChunks model
        let metadata = await IssuesDataChunks.getMetadata(userId, country, region);
        
        // If no data exists, fall back to calculating it
        if (!summary && !metadata) {
            logger.info('[IssuesPaginationService] No summary data, calculating on-the-fly', {
                userId, country, region
            });
            
            const calcResult = await IssuesDataService.calculateAndStoreIssuesData(userId, country, region, 'summary_fallback');
            
            if (!calcResult.success) {
                const duration = Date.now() - startTime;
                return {
                    success: false,
                    error: 'No issues data found and calculation failed',
                    duration
                };
            }
            
            // Re-fetch after storing
            summary = await IssueSummary.getIssueSummary(userId, country, region);
            metadata = await IssuesDataChunks.getMetadata(userId, country, region);
        }
        
        // Get counts from chunk stats for array fields
        const [totalProductStats, activeProductStats] = await Promise.all([
            IssuesDataChunks.getChunkStats(userId, country, region, 'TotalProduct'),
            IssuesDataChunks.getChunkStats(userId, country, region, 'ActiveProducts')
        ]);
        const totalProductCount = totalProductStats.totalItems || 0;
        const activeProductCount = activeProductStats.totalItems || 0;
        
        const duration = Date.now() - startTime;
        
        // Use IssueSummary if available, else fall back to metadata counts
        const result = {
            totalRankingErrors: summary?.totalRankingErrors || metadata?.totalRankingErrors || 0,
            totalConversionErrors: summary?.totalConversionErrors || metadata?.totalConversionErrors || 0,
            totalInventoryErrors: summary?.totalInventoryErrors || metadata?.totalInventoryErrors || 0,
            totalAccountErrors: summary?.totalAccountErrors || metadata?.totalAccountErrors || 0,
            totalProfitabilityErrors: summary?.totalProfitabilityErrors || metadata?.totalProfitabilityErrors || 0,
            totalSponsoredAdsErrors: summary?.totalSponsoredAdsErrors || metadata?.totalSponsoredAdsErrors || 0,
            totalIssues: summary?.totalIssues || (
                (metadata?.totalRankingErrors || 0) + 
                (metadata?.totalConversionErrors || 0) + 
                (metadata?.totalInventoryErrors || 0)
            ),
            totalActiveProducts: summary?.totalActiveProducts || activeProductCount,
            numberOfProductsWithIssues: summary?.numberOfProductsWithIssues || metadata?.numberOfProductsWithIssues || 0,
            accountHealthPercentage: metadata?.accountHealthPercentage || { Percentage: 0, status: 'Unknown' },
            TotalProduct: totalProductCount,
            lastCalculatedAt: summary?.lastCalculatedAt || metadata?.lastCalculatedAt
        };
        
        logger.info('[IssuesPaginationService] Summary retrieved', {
            userId,
            country,
            region,
            duration,
            source: summary ? 'IssueSummary' : 'IssuesDataChunks'
        });
        
        return {
            success: true,
            data: result,
            duration
        };
        
    } catch (error) {
        logger.error('[IssuesPaginationService] Error getting summary', {
            error: error.message,
            userId,
            country,
            region
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get paginated ranking issues
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} Paginated ranking issues
 */
async function getRankingIssues(userId, country, region, page = 1, limit = DEFAULT_PAGE_SIZE) {
    const startTime = Date.now();
    
    try {
        const issuesData = await ensureIssuesData(
            userId, country, region,
            { rankingProductWiseErrors: 1, TotalProduct: 1 }
        );
        
        if (!issuesData) {
            return {
                success: false,
                error: 'No issues data found and calculation failed'
            };
        }
        
        const allErrors = issuesData.rankingProductWiseErrors || [];
        const totalProducts = issuesData.TotalProduct || [];
        
        // Create a lookup map for product details
        const productMap = new Map();
        totalProducts.forEach(product => {
            if (product.asin) {
                productMap.set(product.asin, product);
            }
        });
        
        // Flatten ranking errors into individual issue rows (matching frontend logic and summary count)
        // Each product can have multiple error checks: Title (charLim, RestrictedWords, SpecialChars),
        // BulletPoints (same 3), Description (same 3), BackendKeywords (charLim)
        const flattenedRankingIssues = [];
        
        const sectionConfig = [
            { key: 'TitleResult', label: 'Title' },
            { key: 'BulletPoints', label: 'Bullet Points' },
            { key: 'Description', label: 'Description' }
        ];
        
        const checkConfig = [
            { key: 'charLim', label: 'Character Limit' },
            { key: 'RestictedWords', label: 'Restricted Words' },
            { key: 'checkSpecialCharacters', label: 'Special Characters' }
        ];
        
        allErrors.forEach(productError => {
            const asin = productError.asin;
            const product = productMap.get(asin);
            const title = productError.data?.Title || product?.itemName || product?.title || product?.name || 'Unknown Product';
            const sku = product?.sku || productError.sku || '';
            const data = productError.data || {};
            
            // Check each section (Title, BulletPoints, Description)
            sectionConfig.forEach(({ key: sectionKey, label: sectionLabel }) => {
                const section = data[sectionKey];
                if (!section) return;
                
                // For backend keywords (charLim section at root level)
                if (sectionKey === 'charLim') {
                    if (section.status === 'Error') {
                        flattenedRankingIssues.push({
                            asin,
                            sku,
                            Title: title,
                            sectionKey,
                            checkKey: 'charLim',
                            sectionLabel: 'Backend Keywords',
                            checkLabel: 'Character Limit',
                            errorData: section
                        });
                    }
                    return;
                }
                
                // Check each error type within the section
                checkConfig.forEach(({ key: checkKey, label: checkLabel }) => {
                    const check = section[checkKey];
                    if (check?.status === 'Error') {
                        flattenedRankingIssues.push({
                            asin,
                            sku,
                            Title: title,
                            sectionKey,
                            checkKey,
                            sectionLabel,
                            checkLabel,
                            errorData: check
                        });
                    }
                });
            });
            
            // Also check backend keywords (charLim at data root level)
            if (data.charLim?.status === 'Error') {
                flattenedRankingIssues.push({
                    asin,
                    sku,
                    Title: title,
                    sectionKey: 'charLim',
                    checkKey: 'charLim',
                    sectionLabel: 'Backend Keywords',
                    checkLabel: 'Character Limit',
                    errorData: data.charLim
                });
            }
        });
        
        // Apply pagination to flattened issues
        const total = flattenedRankingIssues.length;
        const startIndex = (page - 1) * limit;
        const paginatedIssues = flattenedRankingIssues.slice(startIndex, startIndex + limit);
        
        // Group back by product for frontend compatibility
        // Frontend expects: { asin, sku, Title, data: { TitleResult, BulletPoints, Description, charLim } }
        const productIssuesMap = new Map();
        paginatedIssues.forEach(issue => {
            if (!productIssuesMap.has(issue.asin)) {
                productIssuesMap.set(issue.asin, {
                    asin: issue.asin,
                    sku: issue.sku,
                    Title: issue.Title,
                    data: { Title: issue.Title }
                });
            }
            const productEntry = productIssuesMap.get(issue.asin);
            
            if (issue.sectionKey === 'charLim') {
                // Backend keywords error
                productEntry.data.charLim = issue.errorData;
            } else {
                // Ensure section exists
                if (!productEntry.data[issue.sectionKey]) {
                    productEntry.data[issue.sectionKey] = {};
                }
                productEntry.data[issue.sectionKey][issue.checkKey] = issue.errorData;
            }
        });
        
        const paginatedData = Array.from(productIssuesMap.values());
        
        const duration = Date.now() - startTime;
        
        logger.info('[IssuesPaginationService] Ranking issues retrieved', {
            userId, country, region,
            page, limit, total,
            flattenedCount: flattenedRankingIssues.length,
            paginatedCount: paginatedIssues.length,
            productsReturned: paginatedData.length,
            duration
        });
        
        return {
            success: true,
            data: paginatedData,
            pagination: {
                page,
                limit,
                total,
                hasMore: startIndex + limit < total,
                totalPages: Math.ceil(total / limit)
            },
            duration
        };
        
    } catch (error) {
        logger.error('[IssuesPaginationService] Error getting ranking issues', {
            error: error.message,
            userId, country, region
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get paginated conversion issues (includes buy box data)
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} Paginated conversion issues
 */
async function getConversionIssues(userId, country, region, page = 1, limit = DEFAULT_PAGE_SIZE) {
    const startTime = Date.now();
    
    try {
        const issuesData = await ensureIssuesData(
            userId, country, region,
            { conversionProductWiseErrors: 1, buyBoxData: 1, TotalProduct: 1 }
        );
        
        if (!issuesData) {
            return {
                success: false,
                error: 'No issues data found and calculation failed'
            };
        }
        
        const conversionErrors = issuesData.conversionProductWiseErrors || [];
        const buyBoxData = issuesData.buyBoxData?.asinBuyBoxData || [];
        const totalProducts = issuesData.TotalProduct || [];
        
        // Create a lookup map for product details
        const productMap = new Map();
        totalProducts.forEach(product => {
            if (product.asin) {
                productMap.set(product.asin, product);
            }
        });
        
        // Flatten conversion errors into individual issue rows (matching dashboard count logic)
        // Each product can have multiple error types: images, video, rating, A+, brand story, buybox
        // NOTE: Buybox is counted via productsWithOutBuyboxErrorData inside conversionProductWiseErrors,
        // NOT separately from buyBoxData. This matches how DashboardCalculation.getConversionErrors counts.
        const flattenedConversionIssues = [];
        
        const errorTypeMapping = [
            { key: 'imageResultErrorData', label: 'Images' },
            { key: 'videoResultErrorData', label: 'Videos' },
            { key: 'productStarRatingResultErrorData', label: 'Rating' },
            { key: 'aplusErrorData', label: 'A Plus' },
            { key: 'brandStoryErrorData', label: 'Brand Story' },
            { key: 'productsWithOutBuyboxErrorData', label: 'No Buy Box' }
        ];
        
        conversionErrors.forEach(productError => {
            const asin = productError.asin;
            const product = productMap.get(asin);
            const title = productError.Title || product?.itemName || product?.title || product?.name || 'Unknown Product';
            const sku = product?.sku || productError.sku || '';
            
            errorTypeMapping.forEach(({ key, label }) => {
                const errorData = productError[key];
                if (errorData) {
                    flattenedConversionIssues.push({
                        asin,
                        sku,
                        Title: title,
                        issueType: label,
                        errorData,
                        _type: 'conversion'
                    });
                }
            });
        });
        
        // NOTE: We don't separately add buybox from buyBoxData because it's already counted
        // via productsWithOutBuyboxErrorData in conversionProductWiseErrors above.
        // The separate buyBoxData fetch is kept for backwards compatibility with frontend
        // display but not used for pagination counting.
        const flattenedBuyboxIssues = [];
        
        // Combine all flattened issues for pagination
        // This ensures the count matches the issue summary (which counts individual errors)
        const allFlattenedIssues = [...flattenedConversionIssues, ...flattenedBuyboxIssues];
        
        // Apply pagination to the flattened array
        const total = allFlattenedIssues.length;
        const startIndex = (page - 1) * limit;
        const paginatedIssues = allFlattenedIssues.slice(startIndex, startIndex + limit);
        
        // Separate the paginated results back into conversion and buybox for frontend compatibility
        const paginatedConversionIssues = paginatedIssues.filter(item => item._type === 'conversion');
        const paginatedBuyboxIssues = paginatedIssues.filter(item => item._type === 'buybox');
        
        // Group conversion issues back by product for frontend compatibility
        // Frontend expects: { asin, sku, Title, imageResultErrorData, videoResultErrorData, ... }
        const productIssuesMap = new Map();
        paginatedConversionIssues.forEach(issue => {
            if (!productIssuesMap.has(issue.asin)) {
                productIssuesMap.set(issue.asin, {
                    asin: issue.asin,
                    sku: issue.sku,
                    Title: issue.Title
                });
            }
            const productEntry = productIssuesMap.get(issue.asin);
            // Map issueType back to the original error data key
            const keyMapping = {
                'Images': 'imageResultErrorData',
                'Videos': 'videoResultErrorData',
                'Rating': 'productStarRatingResultErrorData',
                'A Plus': 'aplusErrorData',
                'Brand Story': 'brandStoryErrorData',
                'No Buy Box': 'productsWithOutBuyboxErrorData'
            };
            const errorKey = keyMapping[issue.issueType];
            if (errorKey) {
                productEntry[errorKey] = issue.errorData;
            }
        });
        
        const paginatedConversionData = Array.from(productIssuesMap.values());
        
        const duration = Date.now() - startTime;
        
        logger.info('[IssuesPaginationService] Conversion issues retrieved', {
            userId, country, region,
            page, limit, total,
            flattenedConversionCount: flattenedConversionIssues.length,
            flattenedBuyboxCount: flattenedBuyboxIssues.length,
            paginatedCount: paginatedIssues.length,
            duration
        });
        
        return {
            success: true,
            data: paginatedConversionData,
            buyBoxData: paginatedBuyboxIssues,
            pagination: {
                page,
                limit,
                total,
                hasMore: startIndex + limit < total,
                totalPages: Math.ceil(total / limit)
            },
            duration
        };
        
    } catch (error) {
        logger.error('[IssuesPaginationService] Error getting conversion issues', {
            error: error.message,
            userId, country, region
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get paginated inventory issues
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} Paginated inventory issues
 */
async function getInventoryIssues(userId, country, region, page = 1, limit = DEFAULT_PAGE_SIZE) {
    const startTime = Date.now();
    
    try {
        const issuesData = await ensureIssuesData(
            userId, country, region,
            { inventoryProductWiseErrors: 1, TotalProduct: 1 }
        );
        
        if (!issuesData) {
            return {
                success: false,
                error: 'No issues data found and calculation failed'
            };
        }
        
        const allErrors = issuesData.inventoryProductWiseErrors || [];
        const totalProducts = issuesData.TotalProduct || [];
        
        // Create a lookup map for product details
        const productMap = new Map();
        totalProducts.forEach(product => {
            if (product.asin) {
                productMap.set(product.asin, product);
            }
        });
        
        // Flatten inventory errors into individual issue rows (matching frontend logic and summary count)
        // Each product can have multiple error checks: longTermStorageFees, unfulfillable, stranded, compliance, replenishment(s)
        const flattenedInventoryIssues = [];
        
        allErrors.forEach(productError => {
            const asin = productError.asin;
            const product = productMap.get(asin);
            const title = productError.Title || product?.itemName || product?.title || product?.name || 'Unknown Product';
            const defaultSku = product?.sku || productError.sku || '';
            
            // Check inventory planning errors
            if (productError.inventoryPlanningErrorData) {
                const planning = productError.inventoryPlanningErrorData;
                if (planning.longTermStorageFees?.status === 'Error') {
                    flattenedInventoryIssues.push({
                        asin,
                        sku: defaultSku,
                        Title: title,
                        issueType: 'inventoryPlanning',
                        issueSubType: 'longTermStorageFees',
                        errorData: planning.longTermStorageFees
                    });
                }
                if (planning.unfulfillable?.status === 'Error') {
                    flattenedInventoryIssues.push({
                        asin,
                        sku: defaultSku,
                        Title: title,
                        issueType: 'inventoryPlanning',
                        issueSubType: 'unfulfillable',
                        errorData: planning.unfulfillable
                    });
                }
            }
            
            // Check stranded inventory errors
            if (productError.strandedInventoryErrorData) {
                flattenedInventoryIssues.push({
                    asin,
                    sku: defaultSku,
                    Title: title,
                    issueType: 'stranded',
                    issueSubType: 'stranded',
                    errorData: productError.strandedInventoryErrorData
                });
            }
            
            // Check inbound non-compliance errors
            if (productError.inboundNonComplianceErrorData) {
                flattenedInventoryIssues.push({
                    asin,
                    sku: defaultSku,
                    Title: title,
                    issueType: 'compliance',
                    issueSubType: 'inboundNonCompliance',
                    errorData: productError.inboundNonComplianceErrorData
                });
            }
            
            // Check replenishment errors (can be array or single)
            if (productError.replenishmentErrorData) {
                const replenishmentData = productError.replenishmentErrorData;
                if (Array.isArray(replenishmentData)) {
                    replenishmentData.forEach(error => {
                        flattenedInventoryIssues.push({
                            asin,
                            sku: error.sku || defaultSku,
                            Title: title,
                            issueType: 'replenishment',
                            issueSubType: 'lowInventory',
                            errorData: error
                        });
                    });
                } else {
                    flattenedInventoryIssues.push({
                        asin,
                        sku: replenishmentData.sku || defaultSku,
                        Title: title,
                        issueType: 'replenishment',
                        issueSubType: 'lowInventory',
                        errorData: replenishmentData
                    });
                }
            }
        });
        
        // Apply pagination to flattened issues
        const total = flattenedInventoryIssues.length;
        const startIndex = (page - 1) * limit;
        const paginatedIssues = flattenedInventoryIssues.slice(startIndex, startIndex + limit);
        
        // Group back by product for frontend compatibility
        // Frontend expects: { asin, sku, Title, inventoryPlanningErrorData, strandedInventoryErrorData, ... }
        const productIssuesMap = new Map();
        paginatedIssues.forEach(issue => {
            if (!productIssuesMap.has(issue.asin)) {
                productIssuesMap.set(issue.asin, {
                    asin: issue.asin,
                    sku: issue.sku,
                    Title: issue.Title
                });
            }
            const productEntry = productIssuesMap.get(issue.asin);
            
            if (issue.issueType === 'inventoryPlanning') {
                if (!productEntry.inventoryPlanningErrorData) {
                    productEntry.inventoryPlanningErrorData = {};
                }
                productEntry.inventoryPlanningErrorData[issue.issueSubType] = issue.errorData;
            } else if (issue.issueType === 'stranded') {
                productEntry.strandedInventoryErrorData = issue.errorData;
            } else if (issue.issueType === 'compliance') {
                productEntry.inboundNonComplianceErrorData = issue.errorData;
            } else if (issue.issueType === 'replenishment') {
                if (!productEntry.replenishmentErrorData) {
                    productEntry.replenishmentErrorData = [];
                }
                if (Array.isArray(productEntry.replenishmentErrorData)) {
                    productEntry.replenishmentErrorData.push(issue.errorData);
                }
            }
        });
        
        const paginatedData = Array.from(productIssuesMap.values());
        
        const duration = Date.now() - startTime;
        
        logger.info('[IssuesPaginationService] Inventory issues retrieved', {
            userId, country, region,
            page, limit, total,
            flattenedCount: flattenedInventoryIssues.length,
            paginatedCount: paginatedIssues.length,
            productsReturned: paginatedData.length,
            duration
        });
        
        return {
            success: true,
            data: paginatedData,
            pagination: {
                page,
                limit,
                total,
                hasMore: startIndex + limit < total,
                totalPages: Math.ceil(total / limit)
            },
            duration
        };
        
    } catch (error) {
        logger.error('[IssuesPaginationService] Error getting inventory issues', {
            error: error.message,
            userId, country, region
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get account issues (typically small, no pagination needed)
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @returns {Promise<Object>} Account issues
 */
async function getAccountIssues(userId, country, region) {
    const startTime = Date.now();
    
    try {
        const issuesData = await ensureIssuesData(
            userId, country, region,
            { AccountErrors: 1, accountHealthPercentage: 1, totalAccountErrors: 1 }
        );
        
        if (!issuesData) {
            return {
                success: false,
                error: 'No issues data found and calculation failed'
            };
        }
        
        const duration = Date.now() - startTime;
        
        logger.info('[IssuesPaginationService] Account issues retrieved', {
            userId, country, region,
            duration
        });
        
        return {
            success: true,
            data: {
                AccountErrors: issuesData.AccountErrors || {},
                accountHealthPercentage: issuesData.accountHealthPercentage || { Percentage: 0, status: 'Unknown' },
                totalAccountErrors: issuesData.totalAccountErrors || 0
            },
            duration
        };
        
    } catch (error) {
        logger.error('[IssuesPaginationService] Error getting account issues', {
            error: error.message,
            userId, country, region
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Get paginated products with issues for Issues by Product page
 * Supports sorting, filtering by priority, and search
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region (NA, EU, FE)
 * @param {Object} options - Pagination and filter options
 * @returns {Promise<Object>} Paginated products with issues
 */
async function getProductsWithIssues(userId, country, region, options = {}) {
    const startTime = Date.now();
    
    const {
        page = 1,
        limit = PRODUCTS_PAGE_SIZE,
        sort = 'issues',
        sortOrder = 'desc',
        priority = null,
        search = null
    } = options;
    
    try {
        const issuesData = await ensureIssuesData(
            userId, country, region,
            {
                productWiseError: 1,
                rankingProductWiseErrors: 1,
                conversionProductWiseErrors: 1,
                inventoryProductWiseErrors: 1,
                buyBoxData: 1
            }
        );
        
        if (!issuesData) {
            return {
                success: false,
                error: 'No issues data found and calculation failed'
            };
        }
        
        let products = issuesData.productWiseError || [];
        
        // Create lookup maps for detailed errors
        const rankingErrorsMap = new Map();
        (issuesData.rankingProductWiseErrors || []).forEach(error => {
            rankingErrorsMap.set(error.asin, error);
        });
        
        const conversionErrorsMap = new Map();
        (issuesData.conversionProductWiseErrors || []).forEach(error => {
            conversionErrorsMap.set(error.asin, error);
        });
        
        const inventoryErrorsMap = new Map();
        (issuesData.inventoryProductWiseErrors || []).forEach(error => {
            inventoryErrorsMap.set(error.asin, error);
        });
        
        const buyBoxMap = new Map();
        (issuesData.buyBoxData?.asinBuyBoxData || []).forEach(item => {
            buyBoxMap.set(item.asin, item);
        });
        
        // Enrich products with detailed error information
        products = products.map(product => {
            const rankingDetails = rankingErrorsMap.get(product.asin);
            const conversionDetails = conversionErrorsMap.get(product.asin);
            const inventoryDetails = inventoryErrorsMap.get(product.asin);
            const buyBoxDetails = buyBoxMap.get(product.asin);
            
            // Count ranking errors
            let rankingErrorCount = 0;
            if (product.rankingErrors) {
                rankingErrorCount = Object.values(product.rankingErrors).filter(v => v?.status === 'Error').length;
            }
            
            // Count conversion errors
            let conversionErrorCount = 0;
            if (product.conversionErrors) {
                conversionErrorCount = Object.values(product.conversionErrors).filter(v => v?.status === 'Error').length;
            }
            
            // Count inventory errors
            let inventoryErrorCount = 0;
            if (product.inventoryErrors) {
                inventoryErrorCount = Object.values(product.inventoryErrors).filter(v => v?.status === 'Error').length;
            }
            
            return {
                ...product,
                rankingErrorCount,
                conversionErrorCount,
                inventoryErrorCount,
                rankingDetails,
                conversionDetails,
                inventoryDetails,
                buyBoxDetails
            };
        });
        
        // Apply search filter
        if (search) {
            const searchLower = search.toLowerCase();
            products = products.filter(product => {
                const name = (product.name || '').toLowerCase();
                const asin = (product.asin || '').toLowerCase();
                const sku = (product.sku || '').toLowerCase();
                return name.includes(searchLower) || asin.includes(searchLower) || sku.includes(searchLower);
            });
        }
        
        // Apply priority filter
        if (priority) {
            products = products.filter(product => {
                const totalErrors = product.errors || 0;
                switch (priority) {
                    case 'high':
                        return totalErrors >= 5;
                    case 'medium':
                        return totalErrors >= 2 && totalErrors < 5;
                    case 'low':
                        return totalErrors === 1;
                    default:
                        return true;
                }
            });
        }
        
        // Apply sorting
        products = sortProducts(products, sort, sortOrder);
        
        // Apply pagination
        const total = products.length;
        const startIndex = (page - 1) * limit;
        const paginatedData = products.slice(startIndex, startIndex + limit);
        
        const duration = Date.now() - startTime;
        
        logger.info('[IssuesPaginationService] Products with issues retrieved', {
            userId, country, region,
            page, limit, sort, sortOrder, priority, search,
            total,
            returned: paginatedData.length,
            duration
        });
        
        return {
            success: true,
            data: paginatedData,
            pagination: {
                page,
                limit,
                total,
                hasMore: startIndex + limit < total,
                totalPages: Math.ceil(total / limit)
            },
            filters: {
                sort,
                sortOrder,
                priority,
                search
            },
            duration
        };
        
    } catch (error) {
        logger.error('[IssuesPaginationService] Error getting products with issues', {
            error: error.message,
            userId, country, region
        });
        
        return {
            success: false,
            error: error.message
        };
    }
}

/**
 * Sort products based on specified field and order
 */
function sortProducts(products, sortField, sortOrder) {
    const order = sortOrder === 'asc' ? 1 : -1;
    
    return [...products].sort((a, b) => {
        let valueA, valueB;
        
        switch (sortField) {
            case 'issues':
                valueA = a.errors || 0;
                valueB = b.errors || 0;
                break;
            case 'sessions':
                valueA = a.sessions || 0;
                valueB = b.sessions || 0;
                break;
            case 'conversion':
                valueA = a.conversionRate || 0;
                valueB = b.conversionRate || 0;
                break;
            case 'sales':
                valueA = a.sales || 0;
                valueB = b.sales || 0;
                break;
            case 'acos':
                valueA = a.acos || 0;
                valueB = b.acos || 0;
                break;
            case 'name':
                valueA = (a.name || '').toLowerCase();
                valueB = (b.name || '').toLowerCase();
                return order * valueA.localeCompare(valueB);
            case 'asin':
                valueA = (a.asin || '').toLowerCase();
                valueB = (b.asin || '').toLowerCase();
                return order * valueA.localeCompare(valueB);
            case 'price':
                valueA = a.price || 0;
                valueB = b.price || 0;
                break;
            default:
                valueA = a.errors || 0;
                valueB = b.errors || 0;
        }
        
        if (valueA < valueB) return -1 * order;
        if (valueA > valueB) return 1 * order;
        return 0;
    });
}

module.exports = {
    getIssuesSummary,
    getRankingIssues,
    getConversionIssues,
    getInventoryIssues,
    getAccountIssues,
    getProductsWithIssues,
    DEFAULT_PAGE_SIZE,
    PRODUCTS_PAGE_SIZE
};
