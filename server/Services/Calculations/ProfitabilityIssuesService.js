/**
 * ProfitabilityIssuesService - Detailed Profitability Issues
 * 
 * Sources data from the new finance flow (DailySkuFinance) via
 * FinanceDashboardReadService.getAsinWisePL so that issues are
 * consistent with what the profitability dashboard displays.
 *
 * Accepts optional startDate / endDate to match the calendar range.
 * Falls back to pre-computed IssuesDataChunks when available (legacy).
 */

const logger = require('../../utils/Logger.js');
const IssuesDataChunks = require('../../models/system/IssuesDataChunksModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const { getAsinWisePL } = require('../Finance/FinanceDashboardReadService.js');
const { getProductWiseSponsoredAdsData } = require('../amazon-ads/ProductWiseSponsoredAdsService.js');

// ── Issue calculation (unchanged logic) ──

const calculateProfitabilityIssues = (profitabilityData) => {
    let totalErrors = 0;
    const issues = [];
    
    profitabilityData.forEach((item) => {
        const sales = item.sales || 0;
        const adsSpend = item.ads || 0;
        const amazonFees = item.amzFee || item.totalFees || 0;
        const netProfit = sales - adsSpend - amazonFees;
        const profitMargin = sales > 0 ? (netProfit / sales) * 100 : 0;
        
        if (profitMargin < 10 || netProfit < 0) {
            totalErrors++;
            
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
    
    issues.sort((a, b) => {
        const severityOrder = { critical: 0, high: 1, medium: 2 };
        const diff = severityOrder[a.severity] - severityOrder[b.severity];
        return diff !== 0 ? diff : a.profitMargin - b.profitMargin;
    });
    
    return { totalErrors, issues };
};

// ── Recommendation helpers (unchanged) ──

const getRecommendationForNegativeProfit = (item, profitMargin, adsSpend, amazonFees) => {
    const sales = item.sales || 0;
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

// ── Data fetching from new finance flow ──

async function buildProfitabilityFromFinanceFlow(userId, country, region, startDate, endDate) {
    const [asinWiseRows, sellerData, productWiseSponsoredAds] = await Promise.all([
        getAsinWisePL({ userId, country, region, startDate, endDate }),
        Seller.findOne(
            { User: userId },
            { 'sellerAccount': { $elemMatch: { region, country } } }
        ).lean(),
        getProductWiseSponsoredAdsData(userId, country, region),
    ]);

    const products = sellerData?.sellerAccount?.[0]?.products || [];
    const productInfoMap = new Map();
    const activeProductSet = new Set();
    products.forEach(p => {
        if (p.asin) {
            productInfoMap.set(p.asin, { itemName: p.itemName, sku: p.sku, status: p.status, price: p.price });
            if (p.status === 'Active') activeProductSet.add(p.asin);
        }
    });

    const adsSpendByAsin = new Map();
    if (productWiseSponsoredAds?.sponsoredAds) {
        productWiseSponsoredAds.sponsoredAds.forEach(item => {
            if (item?.asin) {
                const spend = parseFloat(item.spend) || 0;
                adsSpendByAsin.set(item.asin, (adsSpendByAsin.get(item.asin) || 0) + spend);
            }
        });
    }

    const allProfitabilityData = [];
    asinWiseRows.forEach(row => {
        if (!activeProductSet.has(row.asin)) return;
        const productInfo = productInfoMap.get(row.asin) || {};
        const adsSpend = adsSpendByAsin.get(row.asin) || 0;
        const totalExpenses = Math.abs(row.totalExpenses || 0);
        allProfitabilityData.push({
            asin: row.asin,
            itemName: productInfo.itemName || null,
            sku: row.sku || productInfo.sku || null,
            quantity: row.units || 0,
            sales: row.productSales || 0,
            ads: adsSpend,
            amzFee: totalExpenses,
            totalFees: totalExpenses,
            amazonFees: totalExpenses,
            fbaFees: Math.abs(row.fbaFulfillmentFee || 0),
            storageFees: 0,
        });
    });

    return { allProfitabilityData, activeProductCount: activeProductSet.size };
}

// ── Public API ──

const getProfitabilityIssues = async (userId, country, region, page = 1, limit = 10, startDate = null, endDate = null) => {
    const startTime = Date.now();
    logger.info(`[PERF] ProfitabilityIssuesService.getProfitabilityIssues starting`, { userId, page, startDate, endDate });

    // If date range is provided, always compute real-time from DailySkuFinance
    if (startDate && endDate) {
        const { allProfitabilityData } = await buildProfitabilityFromFinanceFlow(userId, country, region, startDate, endDate);
        const issuesData = calculateProfitabilityIssues(allProfitabilityData);

        const totalItems = issuesData.totalErrors;
        const totalPages = Math.ceil(totalItems / limit);
        const startIndex = (page - 1) * limit;
        const paginatedIssues = issuesData.issues.slice(startIndex, startIndex + limit);

        const issuesSummary = { negative_profit: 0, low_margin: 0, critical: 0, high: 0, medium: 0 };
        issuesData.issues.forEach(issue => {
            if (issue.issueType === 'negative_profit') issuesSummary.negative_profit++;
            if (issue.issueType === 'low_margin') issuesSummary.low_margin++;
            if (issue.severity === 'critical') issuesSummary.critical++;
            if (issue.severity === 'high') issuesSummary.high++;
            if (issue.severity === 'medium') issuesSummary.medium++;
        });

        const fetchTime = Date.now() - startTime;
        logger.info(`[PERF] ProfitabilityIssuesService.getProfitabilityIssues (finance-flow) completed in ${fetchTime}ms, found ${totalItems} issues`);

        return {
            issues: paginatedIssues,
            summary: {
                totalIssues: totalItems,
                byType: { negativeProfitProducts: issuesSummary.negative_profit, lowMarginProducts: issuesSummary.low_margin },
                bySeverity: { critical: issuesSummary.critical, high: issuesSummary.high, medium: issuesSummary.medium },
            },
            pagination: { page, limit, totalItems, totalPages, hasMore: page < totalPages },
            source: 'finance-flow',
            dateRange: { startDate, endDate },
            Country: country,
        };
    }

    // No date range: try pre-computed data (legacy fast path)
    const preComputedIssues = await IssuesDataChunks.getFieldData(userId, country, region, 'profitabilityErrorDetails');
    
    if (preComputedIssues && preComputedIssues.length > 0) {
        const totalItems = preComputedIssues.length;
        const totalPages = Math.ceil(totalItems / limit);
        const startIndex = (page - 1) * limit;
        const paginatedIssues = preComputedIssues.slice(startIndex, startIndex + limit);
        
        const issuesSummary = { negative_profit: 0, low_margin: 0, critical: 0, high: 0, medium: 0 };
        preComputedIssues.forEach(issue => {
            if (issue.issueType === 'negative_profit') issuesSummary.negative_profit++;
            if (issue.issueType === 'low_margin') issuesSummary.low_margin++;
            if (issue.severity === 'critical') issuesSummary.critical++;
            if (issue.severity === 'high') issuesSummary.high++;
            if (issue.severity === 'medium') issuesSummary.medium++;
        });
        
        const fetchTime = Date.now() - startTime;
        logger.info(`[PERF] ProfitabilityIssuesService.getProfitabilityIssues (pre-computed) completed in ${fetchTime}ms, found ${totalItems} issues`);
        
        return {
            issues: paginatedIssues,
            summary: {
                totalIssues: totalItems,
                byType: { negativeProfitProducts: issuesSummary.negative_profit, lowMarginProducts: issuesSummary.low_margin },
                bySeverity: { critical: issuesSummary.critical, high: issuesSummary.high, medium: issuesSummary.medium },
            },
            pagination: { page, limit, totalItems, totalPages, hasMore: page < totalPages },
            source: 'precomputed',
            Country: country,
        };
    }

    // No pre-computed data and no dates: real-time from DailySkuFinance using a 30-day window
    logger.info('[PERF] No pre-computed data, computing from DailySkuFinance with 30-day window');
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const fallbackEnd = yesterday.toISOString().slice(0, 10);
    const fallbackStart = new Date(yesterday);
    fallbackStart.setDate(yesterday.getDate() - 29);
    const fallbackStartStr = fallbackStart.toISOString().slice(0, 10);

    const { allProfitabilityData } = await buildProfitabilityFromFinanceFlow(userId, country, region, fallbackStartStr, fallbackEnd);
    const issuesData = calculateProfitabilityIssues(allProfitabilityData);

    const totalItems = issuesData.totalErrors;
    const totalPages = Math.ceil(totalItems / limit);
    const startIndex = (page - 1) * limit;
    const paginatedIssues = issuesData.issues.slice(startIndex, startIndex + limit);

    const issuesSummary = { negative_profit: 0, low_margin: 0, critical: 0, high: 0, medium: 0 };
    issuesData.issues.forEach(issue => {
        if (issue.issueType === 'negative_profit') issuesSummary.negative_profit++;
        if (issue.issueType === 'low_margin') issuesSummary.low_margin++;
        if (issue.severity === 'critical') issuesSummary.critical++;
        if (issue.severity === 'high') issuesSummary.high++;
        if (issue.severity === 'medium') issuesSummary.medium++;
    });

    const fetchTime = Date.now() - startTime;
    logger.info(`[PERF] ProfitabilityIssuesService.getProfitabilityIssues (realtime-fallback) completed in ${fetchTime}ms, found ${totalItems} issues`);

    return {
        issues: paginatedIssues,
        summary: {
            totalIssues: totalItems,
            byType: { negativeProfitProducts: issuesSummary.negative_profit, lowMarginProducts: issuesSummary.low_margin },
            bySeverity: { critical: issuesSummary.critical, high: issuesSummary.high, medium: issuesSummary.medium },
        },
        pagination: { page, limit, totalItems, totalPages, hasMore: page < totalPages },
        source: 'realtime',
        dateRange: { startDate: fallbackStartStr, endDate: fallbackEnd },
        Country: country,
    };
};

const getProfitabilityIssuesSummary = async (userId, country, region, startDate = null, endDate = null) => {
    const startTime = Date.now();
    logger.info(`[PERF] ProfitabilityIssuesService.getProfitabilityIssuesSummary starting`, { userId, startDate, endDate });

    if (startDate && endDate) {
        const { allProfitabilityData, activeProductCount } = await buildProfitabilityFromFinanceFlow(userId, country, region, startDate, endDate);
        const issuesData = calculateProfitabilityIssues(allProfitabilityData);

        const fetchTime = Date.now() - startTime;
        logger.info(`[PERF] ProfitabilityIssuesSummary (finance-flow) completed in ${fetchTime}ms`);

        return {
            totalIssues: issuesData.totalErrors,
            byType: {
                negativeProfitProducts: issuesData.issues.filter(i => i.issueType === 'negative_profit').length,
                lowMarginProducts: issuesData.issues.filter(i => i.issueType === 'low_margin').length,
            },
            activeProducts: activeProductCount,
            source: 'finance-flow',
            dateRange: { startDate, endDate },
        };
    }

    // Legacy pre-computed fast path
    const metadata = await IssuesDataChunks.getMetadata(userId, country, region);
    if (metadata && metadata.totalProfitabilityErrors !== undefined) {
        const activeProductStats = await IssuesDataChunks.getChunkStats(userId, country, region, 'ActiveProducts');
        const fetchTime = Date.now() - startTime;
        logger.info(`[PERF] ProfitabilityIssuesSummary (pre-computed) completed in ${fetchTime}ms`);
        return {
            totalIssues: metadata.totalProfitabilityErrors || 0,
            byType: { negativeProfitProducts: 0, lowMarginProducts: 0 },
            activeProducts: activeProductStats.totalItems || 0,
            source: 'precomputed',
            lastCalculatedAt: metadata.lastCalculatedAt,
        };
    }

    // Fallback 30-day window
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const fallbackEnd = yesterday.toISOString().slice(0, 10);
    const fallbackStart = new Date(yesterday);
    fallbackStart.setDate(yesterday.getDate() - 29);
    const fallbackStartStr = fallbackStart.toISOString().slice(0, 10);

    const { allProfitabilityData, activeProductCount } = await buildProfitabilityFromFinanceFlow(userId, country, region, fallbackStartStr, fallbackEnd);
    const issuesData = calculateProfitabilityIssues(allProfitabilityData);
    const fetchTime = Date.now() - startTime;
    logger.info(`[PERF] ProfitabilityIssuesSummary (realtime-fallback) completed in ${fetchTime}ms`);

    return {
        totalIssues: issuesData.totalErrors,
        byType: {
            negativeProfitProducts: issuesData.issues.filter(i => i.issueType === 'negative_profit').length,
            lowMarginProducts: issuesData.issues.filter(i => i.issueType === 'low_margin').length,
        },
        activeProducts: activeProductCount,
        source: 'realtime',
        dateRange: { startDate: fallbackStartStr, endDate: fallbackEnd },
    };
};

module.exports = {
    getProfitabilityIssues,
    getProfitabilityIssuesSummary,
    calculateProfitabilityIssues
};
