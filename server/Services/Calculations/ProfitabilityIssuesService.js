/**
 * ProfitabilityIssuesService - Detailed Profitability Issues
 * 
 * This service provides detailed profitability issues for products with:
 * - Negative profit (netProfit < 0)
 * - Low margin (profitMargin < 10%)
 * 
 * Uses the SAME calculation logic as DashboardCalculation.calculateProfitabilityErrors
 * but returns more detailed information for the Profitability Dashboard issues section.
 */

const logger = require('../../utils/Logger.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const { getProductWiseSponsoredAdsData } = require('../amazon-ads/ProductWiseSponsoredAdsService.js');

/**
 * Get ASIN-wise PPC sales from EconomicsMetrics (handles big accounts)
 */
const getAsinPpcSalesFromEconomics = async (economicsMetrics) => {
    if (!economicsMetrics) {
        return { asinPpcSales: {}, totalSales: 0, totalGrossProfit: 0 };
    }

    let totalSales = 0;
    let totalGrossProfit = 0;
    
    if (Array.isArray(economicsMetrics.datewiseSales) && economicsMetrics.datewiseSales.length > 0) {
        economicsMetrics.datewiseSales.forEach(item => {
            totalSales += item.sales?.amount || 0;
            totalGrossProfit += item.grossProfit?.amount || 0;
        });
        totalSales = parseFloat(totalSales.toFixed(2));
        totalGrossProfit = parseFloat(totalGrossProfit.toFixed(2));
    } else {
        totalSales = economicsMetrics.totalSales?.amount || 0;
        totalGrossProfit = economicsMetrics.grossProfit?.amount || 0;
    }

    const asinPpcSales = {};

    const isBigAccount = economicsMetrics.isBig === true;
    const hasEmptyAsinData = !economicsMetrics.asinWiseSales || economicsMetrics.asinWiseSales.length === 0;
    const isLegacyBigAccount = hasEmptyAsinData && (economicsMetrics.totalSales?.amount > 5000);

    if ((isBigAccount || isLegacyBigAccount) && hasEmptyAsinData) {
        try {
            const bigAccountAsinDocs = await AsinWiseSalesForBigAccounts.findByMetricsId(economicsMetrics._id);
            
            if (bigAccountAsinDocs && bigAccountAsinDocs.length > 0) {
                bigAccountAsinDocs.forEach(doc => {
                    if (doc.asinSales && Array.isArray(doc.asinSales)) {
                        doc.asinSales.forEach(item => {
                            if (item.asin) {
                                const asin = item.asin;
                                const fbaFees = item.fbaFees?.amount || 0;
                                const storageFees = item.storageFees?.amount || 0;
                                const totalFees = item.totalFees?.amount || 0;
                                const amazonFees = item.amazonFees?.amount || totalFees;
                                
                                if (asinPpcSales[asin]) {
                                    asinPpcSales[asin].sales += item.sales?.amount || 0;
                                    asinPpcSales[asin].ppcSpent += item.ppcSpent?.amount || 0;
                                    asinPpcSales[asin].grossProfit += item.grossProfit?.amount || 0;
                                    asinPpcSales[asin].fbaFees += fbaFees;
                                    asinPpcSales[asin].storageFees += storageFees;
                                    asinPpcSales[asin].totalFees += totalFees;
                                    asinPpcSales[asin].amazonFees += amazonFees;
                                    asinPpcSales[asin].unitsSold += item.unitsSold || 0;
                                } else {
                                    asinPpcSales[asin] = {
                                        sales: item.sales?.amount || 0,
                                        ppcSpent: item.ppcSpent?.amount || 0,
                                        grossProfit: item.grossProfit?.amount || 0,
                                        fbaFees: fbaFees,
                                        storageFees: storageFees,
                                        totalFees: totalFees,
                                        amazonFees: amazonFees,
                                        unitsSold: item.unitsSold || 0
                                    };
                                }
                            }
                        });
                    }
                });
            }
        } catch (error) {
            logger.error('Error fetching ASIN data for big account', { error: error.message });
        }
    } else if (Array.isArray(economicsMetrics.asinWiseSales)) {
        economicsMetrics.asinWiseSales.forEach(item => {
            if (item.asin) {
                const asin = item.asin;
                const fbaFees = item.fbaFees?.amount || 0;
                const storageFees = item.storageFees?.amount || 0;
                const totalFees = item.totalFees?.amount || 0;
                const amazonFees = item.amazonFees?.amount || totalFees;
                
                if (asinPpcSales[asin]) {
                    asinPpcSales[asin].sales += item.sales?.amount || 0;
                    asinPpcSales[asin].ppcSpent += item.ppcSpent?.amount || 0;
                    asinPpcSales[asin].grossProfit += item.grossProfit?.amount || 0;
                    asinPpcSales[asin].fbaFees += fbaFees;
                    asinPpcSales[asin].storageFees += storageFees;
                    asinPpcSales[asin].totalFees += totalFees;
                    asinPpcSales[asin].amazonFees += amazonFees;
                    asinPpcSales[asin].unitsSold += item.unitsSold || 0;
                } else {
                    asinPpcSales[asin] = {
                        sales: item.sales?.amount || 0,
                        ppcSpent: item.ppcSpent?.amount || 0,
                        grossProfit: item.grossProfit?.amount || 0,
                        fbaFees: fbaFees,
                        storageFees: storageFees,
                        totalFees: totalFees,
                        amazonFees: amazonFees,
                        unitsSold: item.unitsSold || 0
                    };
                }
            }
        });
    }

    return { asinPpcSales, totalSales, totalGrossProfit };
};

/**
 * Calculate profitability issues (SAME LOGIC as DashboardCalculation.calculateProfitabilityErrors)
 * 
 * Issue criteria:
 * - Negative profit: netProfit < 0
 * - Low margin: profitMargin < 10% but netProfit >= 0
 * 
 * @param {Array} profitabilityData - Array of profitability data with full details
 * @returns {Object} { totalErrors, issues: [] }
 */
const calculateProfitabilityIssues = (profitabilityData) => {
    let totalErrors = 0;
    const issues = [];
    
    profitabilityData.forEach((item) => {
        // Calculate net profit: Sales - Ads Spend - Amazon Fees
        // This is the SAME calculation as DashboardCalculation.calculateProfitabilityErrors
        const sales = item.sales || 0;
        const adsSpend = item.ads || 0;
        const amazonFees = item.amzFee || item.totalFees || 0;
        const netProfit = sales - adsSpend - amazonFees;
        
        // Calculate profit margin
        const profitMargin = sales > 0 ? (netProfit / sales) * 100 : 0;
        
        // Count as error if profit margin is below 10% or negative (SAME criteria as DashboardCalculation)
        if (profitMargin < 10 || netProfit < 0) {
            totalErrors++;
            
            // Determine issue type and severity
            let issueType, severity, recommendation;
            
            if (netProfit < 0) {
                issueType = 'negative_profit';
                severity = 'critical';
                recommendation = getRecommendationForNegativeProfit(item, profitMargin, adsSpend, amazonFees);
            } else {
                issueType = 'low_margin';
                severity = profitMargin < 5 ? 'high' : 'medium';
                recommendation = getRecommendationForLowMargin(item, profitMargin, adsSpend, amazonFees);
            }
            
            issues.push({
                asin: item.asin,
                sku: item.sku || null,
                productName: item.itemName || item.productName || null,
                sales: parseFloat(sales.toFixed(2)),
                adsSpend: parseFloat(adsSpend.toFixed(2)),
                amazonFees: parseFloat(amazonFees.toFixed(2)),
                fbaFees: parseFloat((item.fbaFees || 0).toFixed(2)),
                storageFees: parseFloat((item.storageFees || 0).toFixed(2)),
                netProfit: parseFloat(netProfit.toFixed(2)),
                profitMargin: parseFloat(profitMargin.toFixed(2)),
                unitsSold: item.quantity || item.unitsSold || 0,
                issueType,
                severity,
                recommendation
            });
        }
    });
    
    // Sort by severity (critical > high > medium) then by absolute profit margin
    issues.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2 };
        const severityDiff = severityOrder[a.severity] - severityOrder[b.severity];
        if (severityDiff !== 0) return severityDiff;
        
        // Then by profit margin (most negative first)
        return a.profitMargin - b.profitMargin;
    });
    
    return { totalErrors, issues };
};

/**
 * Generate recommendation for negative profit products
 */
const getRecommendationForNegativeProfit = (item, profitMargin, adsSpend, amazonFees) => {
    const sales = item.sales || 0;
    
    // Calculate which cost is the biggest contributor
    const adsRatio = sales > 0 ? (adsSpend / sales) * 100 : 0;
    const feesRatio = sales > 0 ? (amazonFees / sales) * 100 : 0;
    
    if (adsRatio > 50) {
        return {
            type: 'reduce_ads',
            title: 'High Ad Spend Relative to Sales',
            description: `Ad spend is ${adsRatio.toFixed(0)}% of sales. Consider reducing PPC spend or improving ad targeting to increase conversion rate.`,
            action: 'Review PPC campaigns for this ASIN and reduce bids on low-performing keywords.'
        };
    } else if (feesRatio > 40) {
        return {
            type: 'optimize_fees',
            title: 'High Amazon Fees',
            description: `Amazon fees are ${feesRatio.toFixed(0)}% of sales. Consider optimizing fulfillment or pricing strategy.`,
            action: 'Review product dimensions/weight for FBA fee accuracy. Consider price increase if market allows.'
        };
    } else if (sales === 0) {
        return {
            type: 'no_sales',
            title: 'No Sales with Expenses',
            description: 'Product has no sales but is incurring fees/ad costs.',
            action: 'Pause ads for this product and review listing quality, pricing, and inventory status.'
        };
    } else {
        return {
            type: 'price_review',
            title: 'Price Review Needed',
            description: `Product is operating at a ${Math.abs(profitMargin).toFixed(1)}% loss. Combined costs exceed revenue.`,
            action: 'Increase product price, reduce costs, or consider discontinuing if margins cannot be improved.'
        };
    }
};

/**
 * Generate recommendation for low margin products
 */
const getRecommendationForLowMargin = (item, profitMargin, adsSpend, amazonFees) => {
    const sales = item.sales || 0;
    const adsRatio = sales > 0 ? (adsSpend / sales) * 100 : 0;
    
    if (adsRatio > 20) {
        return {
            type: 'optimize_ppc',
            title: 'PPC Optimization Opportunity',
            description: `Ad spend is ${adsRatio.toFixed(0)}% of sales with a ${profitMargin.toFixed(1)}% margin. Small PPC improvements can significantly boost profit.`,
            action: 'Target high-converting keywords and add negative keywords to reduce wasted spend.'
        };
    } else if (profitMargin < 5) {
        return {
            type: 'margin_critical',
            title: 'Critically Low Margin',
            description: `Only ${profitMargin.toFixed(1)}% profit margin. Any cost increase could result in losses.`,
            action: 'Review pricing strategy. Consider small price increase or cost reduction to improve margins.'
        };
    } else {
        return {
            type: 'margin_watch',
            title: 'Low Profit Margin',
            description: `${profitMargin.toFixed(1)}% profit margin is below the 10% threshold for healthy products.`,
            action: 'Monitor costs and consider pricing adjustments to achieve at least 10% margin.'
        };
    }
};

/**
 * Get detailed profitability issues for a user
 * 
 * @param {string} userId - User ID
 * @param {string} country - Country code
 * @param {string} region - Region code
 * @param {number} page - Page number (1-indexed)
 * @param {number} limit - Items per page
 * @returns {Promise<Object>} Paginated profitability issues
 */
const getProfitabilityIssues = async (userId, country, region, page = 1, limit = 10) => {
    const startTime = Date.now();
    logger.info(`[PERF] ProfitabilityIssuesService.getProfitabilityIssues starting for user ${userId}, page ${page}`);

    // Fetch required data in parallel
    const [economicsMetricsData, sellerData, productWiseSponsoredAds] = await Promise.all([
        EconomicsMetrics.findLatest(userId, region, country),
        Seller.findOne(
            { User: userId },
            { 
                'sellerAccount': {
                    $elemMatch: { region, country }
                }
            }
        ).lean(),
        getProductWiseSponsoredAdsData(userId, country, region)
    ]);

    let processedEconomicsMetrics = economicsMetricsData;
    if (economicsMetricsData && economicsMetricsData.toObject) {
        processedEconomicsMetrics = economicsMetricsData.toObject();
    }

    // Get ASIN-wise data from economics (handles big accounts)
    const economicsData = await getAsinPpcSalesFromEconomics(processedEconomicsMetrics);

    // Extract products from seller data
    const products = sellerData?.sellerAccount?.[0]?.products || [];
    
    // Create product info map
    const productInfoMap = new Map();
    products.forEach(p => {
        if (p.asin) {
            productInfoMap.set(p.asin, {
                itemName: p.itemName,
                sku: p.sku,
                status: p.status,
                price: p.price
            });
        }
    });

    // Get active products only
    const activeProductSet = new Set();
    products.forEach(p => {
        if (p.status === 'Active') {
            activeProductSet.add(p.asin);
        }
    });

    // Build ads spend map from sponsored ads data
    const adsSpendByAsin = new Map();
    if (productWiseSponsoredAds && productWiseSponsoredAds.sponsoredAds) {
        productWiseSponsoredAds.sponsoredAds.forEach(item => {
            if (item && item.asin) {
                const spend = parseFloat(item.spend) || 0;
                adsSpendByAsin.set(item.asin, (adsSpendByAsin.get(item.asin) || 0) + spend);
            }
        });
    }

    // Build profitability data for active products (same structure as DashboardCalculation)
    const allProfitabilityData = [];
    
    Object.entries(economicsData.asinPpcSales).forEach(([asin, data]) => {
        if (!activeProductSet.has(asin)) return;
        
        const productInfo = productInfoMap.get(asin) || {};
        const adsSpend = adsSpendByAsin.get(asin) || 0;
        
        allProfitabilityData.push({
            asin,
            itemName: productInfo.itemName || null,
            sku: productInfo.sku || null,
            quantity: data.unitsSold || 0,
            sales: data.sales || 0,
            ads: adsSpend,
            amzFee: data.totalFees || 0,
            totalFees: data.totalFees || 0,
            amazonFees: data.amazonFees || data.totalFees || 0,
            fbaFees: data.fbaFees || 0,
            storageFees: data.storageFees || 0
        });
    });

    // Calculate profitability issues (SAME logic as DashboardCalculation.calculateProfitabilityErrors)
    const issuesData = calculateProfitabilityIssues(allProfitabilityData);

    // Apply pagination to issues only (not all products)
    const totalItems = issuesData.totalErrors;
    const totalPages = Math.ceil(totalItems / limit);
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + limit;
    const paginatedIssues = issuesData.issues.slice(startIndex, endIndex);

    // Group issues by type for summary
    const issuesSummary = {
        negative_profit: 0,
        low_margin: 0,
        critical: 0,
        high: 0,
        medium: 0
    };
    
    issuesData.issues.forEach(issue => {
        if (issue.issueType === 'negative_profit') issuesSummary.negative_profit++;
        if (issue.issueType === 'low_margin') issuesSummary.low_margin++;
        if (issue.severity === 'critical') issuesSummary.critical++;
        if (issue.severity === 'high') issuesSummary.high++;
        if (issue.severity === 'medium') issuesSummary.medium++;
    });

    const fetchTime = Date.now() - startTime;
    logger.info(`[PERF] ProfitabilityIssuesService.getProfitabilityIssues completed in ${fetchTime}ms, found ${totalItems} issues`);

    return {
        issues: paginatedIssues,
        summary: {
            totalIssues: totalItems,
            byType: {
                negativeProfitProducts: issuesSummary.negative_profit,
                lowMarginProducts: issuesSummary.low_margin
            },
            bySeverity: {
                critical: issuesSummary.critical,
                high: issuesSummary.high,
                medium: issuesSummary.medium
            }
        },
        pagination: {
            page,
            limit,
            totalItems,
            totalPages,
            hasMore: page < totalPages
        },
        dateRange: processedEconomicsMetrics?.dateRange || null,
        Country: country
    };
};

/**
 * Get profitability issues summary (no pagination, just counts)
 * Fast endpoint for dashboard overview
 */
const getProfitabilityIssuesSummary = async (userId, country, region) => {
    const startTime = Date.now();
    logger.info(`[PERF] ProfitabilityIssuesService.getProfitabilityIssuesSummary starting for user ${userId}`);

    // Fetch required data in parallel
    const [economicsMetricsData, sellerData, productWiseSponsoredAds] = await Promise.all([
        EconomicsMetrics.findLatest(userId, region, country),
        Seller.findOne(
            { User: userId },
            { 
                'sellerAccount': {
                    $elemMatch: { region, country }
                }
            }
        ).lean(),
        getProductWiseSponsoredAdsData(userId, country, region)
    ]);

    let processedEconomicsMetrics = economicsMetricsData;
    if (economicsMetricsData && economicsMetricsData.toObject) {
        processedEconomicsMetrics = economicsMetricsData.toObject();
    }

    const economicsData = await getAsinPpcSalesFromEconomics(processedEconomicsMetrics);

    const products = sellerData?.sellerAccount?.[0]?.products || [];
    
    // Get active products only
    const activeProductSet = new Set();
    products.forEach(p => {
        if (p.status === 'Active') {
            activeProductSet.add(p.asin);
        }
    });

    // Build ads spend map
    const adsSpendByAsin = new Map();
    if (productWiseSponsoredAds && productWiseSponsoredAds.sponsoredAds) {
        productWiseSponsoredAds.sponsoredAds.forEach(item => {
            if (item && item.asin) {
                const spend = parseFloat(item.spend) || 0;
                adsSpendByAsin.set(item.asin, (adsSpendByAsin.get(item.asin) || 0) + spend);
            }
        });
    }

    // Count issues (SAME logic as DashboardCalculation.calculateProfitabilityErrors)
    let totalErrors = 0;
    let negativeProfitCount = 0;
    let lowMarginCount = 0;
    
    Object.entries(economicsData.asinPpcSales).forEach(([asin, data]) => {
        if (!activeProductSet.has(asin)) return;
        
        const sales = data.sales || 0;
        const adsSpend = adsSpendByAsin.get(asin) || 0;
        const totalFees = data.totalFees || 0;
        const netProfit = sales - adsSpend - totalFees;
        const profitMargin = sales > 0 ? (netProfit / sales) * 100 : 0;
        
        // SAME criteria as DashboardCalculation
        if (profitMargin < 10 || netProfit < 0) {
            totalErrors++;
            if (netProfit < 0) {
                negativeProfitCount++;
            } else {
                lowMarginCount++;
            }
        }
    });

    const fetchTime = Date.now() - startTime;
    logger.info(`[PERF] ProfitabilityIssuesService.getProfitabilityIssuesSummary completed in ${fetchTime}ms`);

    return {
        totalIssues: totalErrors,
        byType: {
            negativeProfitProducts: negativeProfitCount,
            lowMarginProducts: lowMarginCount
        },
        activeProducts: activeProductSet.size,
        dateRange: processedEconomicsMetrics?.dateRange || null
    };
};

module.exports = {
    getProfitabilityIssues,
    getProfitabilityIssuesSummary,
    calculateProfitabilityIssues
};
