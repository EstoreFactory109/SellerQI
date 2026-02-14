/**
 * ProductHistoryService.js
 * 
 * Provides historical performance data for a single ASIN.
 * Aggregates data from BuyBoxData and EconomicsMetrics over time
 * to show trends for sessions, sales, conversion, etc.
 * 
 * Supports different granularities:
 * - daily: Raw data points (default)
 * - weekly: Aggregated by week (for WoW comparison)
 * - monthly: Aggregated by month (for MoM comparison)
 */

const BuyBoxData = require('../../models/MCP/BuyBoxDataModel.js');
const EconomicsMetrics = require('../../models/MCP/EconomicsMetricsModel.js');
const AsinWiseSalesForBigAccounts = require('../../models/MCP/AsinWiseSalesForBigAccountsModel.js');
const logger = require('../../utils/Logger.js');

/**
 * Get historical performance data for a specific ASIN
 * @param {Object} params - Parameters
 * @param {string} params.userId - User ID
 * @param {string} params.region - Region
 * @param {string} params.country - Country
 * @param {string} params.asin - The ASIN to get history for
 * @param {number} params.limit - Max number of data points (default 30)
 * @param {string} params.granularity - 'daily' | 'weekly' | 'monthly' (default: 'daily')
 * @returns {Promise<Object>} { history: [...], asin, summary: {...}, granularity }
 */
async function getProductHistory({ userId, region, country, asin, limit = 30, granularity = 'daily' }) {
    if (!asin) {
        throw new Error('ASIN is required');
    }

    const normalizedAsin = asin.trim().toUpperCase();
    const validGranularities = ['daily', 'weekly', 'monthly'];
    const effectiveGranularity = validGranularities.includes(granularity) ? granularity : 'daily';
    
    logger.info('Fetching product history', { userId, region, country, asin: normalizedAsin, limit, granularity: effectiveGranularity });

    try {
        // Fetch all BuyBoxData documents for this user, sorted by date (oldest first for charts)
        const buyBoxDocs = await BuyBoxData.find({
            User: userId,
            region: region,
            country: country
        }).sort({ createdAt: 1 }).limit(limit * 4).lean(); // Fetch more for aggregation

        // Fetch all EconomicsMetrics documents
        const economicsDocs = await EconomicsMetrics.find({
            User: userId,
            region: region,
            country: country
        }).sort({ createdAt: 1 }).limit(limit * 4).lean();

        // Build a map of date -> metrics for this ASIN
        const historyMap = new Map();

        // Process BuyBoxData - extract metrics for this specific ASIN
        buyBoxDocs.forEach(doc => {
            const dateKey = doc.dateRange?.endDate || doc.createdAt?.toISOString()?.split('T')[0] || 'unknown';
            const asinData = doc.asinBuyBoxData?.find(item => {
                const childAsin = (item.childAsin || '').trim().toUpperCase();
                const parentAsin = (item.parentAsin || '').trim().toUpperCase();
                return childAsin === normalizedAsin || parentAsin === normalizedAsin;
            });

            if (asinData) {
                const existing = historyMap.get(dateKey) || {
                    date: dateKey,
                    sessions: 0,
                    pageViews: 0,
                    conversionRate: 0,
                    buyBoxPercentage: 0,
                    sales: 0,
                    unitsSold: 0
                };

                existing.sessions = asinData.sessions || 0;
                existing.pageViews = asinData.pageViews || 0;
                existing.conversionRate = asinData.unitSessionPercentage || 0;
                existing.buyBoxPercentage = asinData.buyBoxPercentage || 0;
                existing.sales = asinData.sales?.amount || 0;
                existing.unitsSold = asinData.unitsOrdered || 0;

                historyMap.set(dateKey, existing);
            }
        });

        // Process EconomicsMetrics - add/update sales data
        // Handle both regular accounts (asinWiseSales in main doc) and big accounts (separate collection)
        for (const doc of economicsDocs) {
            const dateKey = doc.dateRange?.endDate || doc.createdAt?.toISOString()?.split('T')[0] || 'unknown';
            
            // Check if this is a big account with data in separate collection
            const isBigAccount = doc.isBig === true;
            const hasEmptyAsinData = !doc.asinWiseSales || doc.asinWiseSales.length === 0;
            
            let asinData = null;
            
            if ((isBigAccount || hasEmptyAsinData) && doc._id) {
                // Big account - fetch from separate collection
                try {
                    const bigAccountAsinDocs = await AsinWiseSalesForBigAccounts.findByMetricsId(doc._id);
                    
                    if (bigAccountAsinDocs && bigAccountAsinDocs.length > 0) {
                        // Search through all date documents for this ASIN
                        for (const asinDoc of bigAccountAsinDocs) {
                            if (asinDoc.asinSales && Array.isArray(asinDoc.asinSales)) {
                                const found = asinDoc.asinSales.find(item => {
                                    const itemAsin = (item.asin || '').trim().toUpperCase();
                                    return itemAsin === normalizedAsin;
                                });
                                if (found) {
                                    // Aggregate sales/units across all dates for this metrics document
                                    if (!asinData) {
                                        asinData = {
                                            sales: { amount: 0 },
                                            unitsSold: 0
                                        };
                                    }
                                    asinData.sales.amount += found.sales?.amount || 0;
                                    asinData.unitsSold += found.unitsSold || 0;
                                }
                            }
                        }
                    }
                } catch (error) {
                    logger.error('Error fetching ASIN data for big account in ProductHistoryService', {
                        metricsId: doc._id,
                        asin: normalizedAsin,
                        error: error.message
                    });
                }
            } else {
                // Regular account - use asinWiseSales from main document
                asinData = doc.asinWiseSales?.find(item => {
                    const itemAsin = (item.asin || '').trim().toUpperCase();
                    return itemAsin === normalizedAsin;
                });
            }

            if (asinData) {
                const existing = historyMap.get(dateKey) || {
                    date: dateKey,
                    sessions: 0,
                    pageViews: 0,
                    conversionRate: 0,
                    buyBoxPercentage: 0,
                    sales: 0,
                    unitsSold: 0
                };

                // Economics data is more accurate for sales
                if (asinData.sales?.amount) {
                    existing.sales = asinData.sales.amount;
                }
                if (asinData.unitsSold) {
                    existing.unitsSold = asinData.unitsSold;
                }

                historyMap.set(dateKey, existing);
            }
        }

        // Convert map to sorted array
        let history = Array.from(historyMap.values())
            .sort((a, b) => a.date.localeCompare(b.date));

        // Apply granularity aggregation
        if (effectiveGranularity === 'weekly') {
            history = aggregateByWeek(history);
        } else if (effectiveGranularity === 'monthly') {
            history = aggregateByMonth(history);
        } else {
            // Daily - just add display dates
            history = history.map(h => ({
                ...h,
                displayDate: formatDisplayDate(h.date)
            }));
        }

        // Limit final results
        if (history.length > limit) {
            history = history.slice(-limit);
        }

        // Calculate summary metrics (latest vs oldest for trend)
        const summary = calculateSummary(history);

        return {
            asin: normalizedAsin,
            dataPoints: history.length,
            granularity: effectiveGranularity,
            history,
            summary
        };

    } catch (error) {
        logger.error('Error fetching product history', { userId, asin, error: error.message });
        throw error;
    }
}

/**
 * Aggregate daily data into weekly buckets
 * @param {Array} dailyData - Array of daily data points
 * @returns {Array} Weekly aggregated data with "Week 1", "Week 2" labels
 */
function aggregateByWeek(dailyData) {
    if (!dailyData || dailyData.length === 0) return [];

    // Group by ISO week
    const weekMap = new Map();
    
    dailyData.forEach(data => {
        const date = new Date(data.date);
        const weekKey = getISOWeekKey(date);
        
        if (!weekMap.has(weekKey)) {
            weekMap.set(weekKey, {
                weekKey,
                startDate: data.date,
                sessions: 0,
                pageViews: 0,
                conversionRateSum: 0,
                conversionCount: 0,
                buyBoxPercentageSum: 0,
                buyBoxCount: 0,
                sales: 0,
                unitsSold: 0,
                dataPoints: 0
            });
        }
        
        const week = weekMap.get(weekKey);
        week.sessions += data.sessions || 0;
        week.pageViews += data.pageViews || 0;
        week.sales += data.sales || 0;
        week.unitsSold += data.unitsSold || 0;
        if (data.conversionRate > 0) {
            week.conversionRateSum += data.conversionRate;
            week.conversionCount++;
        }
        if (data.buyBoxPercentage > 0) {
            week.buyBoxPercentageSum += data.buyBoxPercentage;
            week.buyBoxCount++;
        }
        week.dataPoints++;
    });

    // Convert to array and sort
    const weeks = Array.from(weekMap.values())
        .sort((a, b) => a.weekKey.localeCompare(b.weekKey));

    // Format with "Week 1", "Week 2", etc.
    return weeks.map((week, index) => ({
        date: week.startDate,
        displayDate: `Week ${index + 1}`,
        sessions: week.sessions,
        pageViews: week.pageViews,
        conversionRate: week.conversionCount > 0 
            ? Math.round(week.conversionRateSum / week.conversionCount * 10) / 10 
            : 0,
        buyBoxPercentage: week.buyBoxCount > 0 
            ? Math.round(week.buyBoxPercentageSum / week.buyBoxCount * 10) / 10 
            : 0,
        sales: Math.round(week.sales * 100) / 100,
        unitsSold: week.unitsSold
    }));
}

/**
 * Aggregate daily data into monthly buckets
 * @param {Array} dailyData - Array of daily data points
 * @returns {Array} Monthly aggregated data with month names
 */
function aggregateByMonth(dailyData) {
    if (!dailyData || dailyData.length === 0) return [];

    // Group by year-month
    const monthMap = new Map();
    
    dailyData.forEach(data => {
        const date = new Date(data.date);
        const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        
        if (!monthMap.has(monthKey)) {
            monthMap.set(monthKey, {
                monthKey,
                year: date.getFullYear(),
                month: date.getMonth(),
                sessions: 0,
                pageViews: 0,
                conversionRateSum: 0,
                conversionCount: 0,
                buyBoxPercentageSum: 0,
                buyBoxCount: 0,
                sales: 0,
                unitsSold: 0,
                dataPoints: 0
            });
        }
        
        const monthData = monthMap.get(monthKey);
        monthData.sessions += data.sessions || 0;
        monthData.pageViews += data.pageViews || 0;
        monthData.sales += data.sales || 0;
        monthData.unitsSold += data.unitsSold || 0;
        if (data.conversionRate > 0) {
            monthData.conversionRateSum += data.conversionRate;
            monthData.conversionCount++;
        }
        if (data.buyBoxPercentage > 0) {
            monthData.buyBoxPercentageSum += data.buyBoxPercentage;
            monthData.buyBoxCount++;
        }
        monthData.dataPoints++;
    });

    // Convert to array and sort
    const months = Array.from(monthMap.values())
        .sort((a, b) => a.monthKey.localeCompare(b.monthKey));

    // Month names
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    // Format with month names
    return months.map((m) => ({
        date: m.monthKey,
        displayDate: `${monthNames[m.month]} ${m.year}`,
        sessions: m.sessions,
        pageViews: m.pageViews,
        conversionRate: m.conversionCount > 0 
            ? Math.round(m.conversionRateSum / m.conversionCount * 10) / 10 
            : 0,
        buyBoxPercentage: m.buyBoxCount > 0 
            ? Math.round(m.buyBoxPercentageSum / m.buyBoxCount * 10) / 10 
            : 0,
        sales: Math.round(m.sales * 100) / 100,
        unitsSold: m.unitsSold
    }));
}

/**
 * Get ISO week key (YYYY-WW format)
 */
function getISOWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Format date for display (e.g., "Jan 15")
 */
function formatDisplayDate(dateStr) {
    if (!dateStr || dateStr === 'unknown') return 'N/A';
    try {
        const date = new Date(dateStr);
        const month = date.toLocaleString('en-US', { month: 'short' });
        const day = date.getDate();
        return `${month} ${day}`;
    } catch {
        return dateStr;
    }
}

/**
 * Calculate summary statistics from history
 */
function calculateSummary(history) {
    if (!history || history.length === 0) {
        return {
            hasData: false,
            trend: null
        };
    }

    const latest = history[history.length - 1];
    const oldest = history[0];
    const total = history.reduce((acc, h) => ({
        sessions: acc.sessions + (h.sessions || 0),
        sales: acc.sales + (h.sales || 0),
        unitsSold: acc.unitsSold + (h.unitsSold || 0)
    }), { sessions: 0, sales: 0, unitsSold: 0 });

    // Calculate average conversion rate
    const avgConversion = history.length > 0 
        ? history.reduce((sum, h) => sum + (h.conversionRate || 0), 0) / history.length 
        : 0;

    // Calculate trends (latest vs oldest)
    const sessionsTrend = oldest.sessions > 0 
        ? ((latest.sessions - oldest.sessions) / oldest.sessions) * 100 
        : (latest.sessions > 0 ? 100 : 0);
    const salesTrend = oldest.sales > 0 
        ? ((latest.sales - oldest.sales) / oldest.sales) * 100 
        : (latest.sales > 0 ? 100 : 0);

    return {
        hasData: true,
        periods: history.length,
        dateRange: {
            start: oldest.displayDate || oldest.date,
            end: latest.displayDate || latest.date
        },
        totals: total,
        averages: {
            sessions: Math.round(total.sessions / history.length),
            sales: Math.round(total.sales / history.length * 100) / 100,
            conversionRate: Math.round(avgConversion * 100) / 100
        },
        trends: {
            sessions: Math.round(sessionsTrend * 10) / 10,
            sales: Math.round(salesTrend * 10) / 10
        },
        latest: {
            sessions: latest.sessions,
            sales: latest.sales,
            conversionRate: latest.conversionRate,
            buyBoxPercentage: latest.buyBoxPercentage
        }
    };
}

module.exports = {
    getProductHistory
};
