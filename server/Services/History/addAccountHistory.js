const AccountHistory = require('../../models/user-auth/AccountHistory.js')
const dbConnect = require('../../config/dbConn.js')
const logger = require('../../utils/Logger.js')

/**
 * Calculate the next Sunday at 23:59:59 UTC
 * This ensures history entries expire at the end of each week (Sunday night)
 * and new entries are added when the weekly worker runs
 * 
 * @returns {Date} Next Sunday at 23:59:59 UTC
 */
const getNextSundayExpiry = () => {
    const now = new Date();
    const dayOfWeek = now.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
    
    // Calculate days until next Sunday
    // If today is Sunday (0), we want next Sunday (7 days)
    // If today is Monday (1), we want 6 days
    // If today is Saturday (6), we want 1 day
    const daysUntilSunday = dayOfWeek === 0 ? 7 : 7 - dayOfWeek;
    
    const nextSunday = new Date(now);
    nextSunday.setUTCDate(now.getUTCDate() + daysUntilSunday);
    nextSunday.setUTCHours(23, 59, 59, 999);
    
    return nextSunday;
}

const addAccountHistory = async(userId, country, region, HealthScore, TotalProducts, ProductsWithIssues, TotalNumberOfIssues) => {
    try {
        logger.info("addAccountHistory called", {
            userId,
            country,
            region,
            HealthScore,
            TotalProducts,
            ProductsWithIssues,
            TotalNumberOfIssues
        });

        // Validate required parameters
        if (!userId || !country || !region) {
            logger.error("addAccountHistory: Missing required parameters", {
                userId,
                country,
                region
            });
            throw new Error("Missing required parameters: userId, country, or region");
        }

        // Ensure values are properly formatted
        const healthScoreStr = String(HealthScore || 0);
        const totalProductsNum = Number(TotalProducts) || 0;
        const productsWithIssuesNum = Number(ProductsWithIssues) || 0;
        const totalIssuesNum = Number(TotalNumberOfIssues) || 0;

        await dbConnect();

        const getAccountHistory = await AccountHistory.findOne({ User: userId, country: country, region: region });
        const today = new Date();

        if (!getAccountHistory) {
            // Set expiry to next Sunday at 23:59:59 UTC
            const expireDate = getNextSundayExpiry();
            
            logger.info("Creating new account history record", {
                userId,
                country,
                region,
                expireDate: expireDate.toISOString()
            });

            const createAccountHistory = await AccountHistory.create({
                User: userId,
                country: country,
                region: region,
                accountHistory: [{
                    Date: today,
                    HealthScore: healthScoreStr,
                    TotalProducts: totalProductsNum,
                    ProductsWithIssues: productsWithIssuesNum,
                    TotalNumberOfIssues: totalIssuesNum,
                    expireDate: expireDate
                }]
            });
        
            if (!createAccountHistory) {
                logger.error("Failed to create account history", { userId, country, region });
                throw new Error("Error in creating account history");
            }
        
            logger.info("Account history created successfully", {
                userId,
                country,
                region,
                historyId: createAccountHistory._id
            });

            return createAccountHistory;
        }

        // Check if accountHistory array is valid
        if (!getAccountHistory.accountHistory || getAccountHistory.accountHistory.length === 0) {
            logger.warn("Account history exists but has no entries, adding first entry", {
                userId,
                country,
                region
            });

            // Set expiry to next Sunday at 23:59:59 UTC
            const expireDate = getNextSundayExpiry();

            getAccountHistory.accountHistory = [{
                Date: today,
                HealthScore: healthScoreStr,
                TotalProducts: totalProductsNum,
                ProductsWithIssues: productsWithIssuesNum,
                TotalNumberOfIssues: totalIssuesNum,
                expireDate: expireDate
            }];

            await getAccountHistory.save();
            logger.info("First history entry added to existing record", { userId, country, region });
            return getAccountHistory;
        }

        // Validate last entry exists and has required fields before accessing
        const lastEntry = getAccountHistory.accountHistory[getAccountHistory.accountHistory.length - 1];
        
        // Check if lastEntry is valid and has expireDate
        if (!lastEntry || !lastEntry.expireDate) {
            logger.warn("Account history exists but last entry is invalid, adding first entry", {
                userId,
                country,
                region,
                hasLastEntry: !!lastEntry,
                hasExpireDate: !!(lastEntry && lastEntry.expireDate),
                arrayLength: getAccountHistory.accountHistory.length
            });

            // Set expiry to next Sunday at 23:59:59 UTC
            const expireDate = getNextSundayExpiry();

            // Replace invalid entries with a new valid entry
            getAccountHistory.accountHistory = [{
                Date: today,
                HealthScore: healthScoreStr,
                TotalProducts: totalProductsNum,
                ProductsWithIssues: productsWithIssuesNum,
                TotalNumberOfIssues: totalIssuesNum,
                expireDate: expireDate
            }];

            await getAccountHistory.save();
            logger.info("First history entry added after fixing invalid entries", { userId, country, region });
            return getAccountHistory;
        }

        const getAccountHistoryExpireDate = lastEntry.expireDate;
        const ExpireDate = new Date(getAccountHistoryExpireDate);

        if (today > ExpireDate) {
            // Set expiry to next Sunday at 23:59:59 UTC
            const expireDate = getNextSundayExpiry();
            
            const newHistory = {
                Date: today,
                HealthScore: healthScoreStr,
                TotalProducts: totalProductsNum,
                ProductsWithIssues: productsWithIssuesNum,
                TotalNumberOfIssues: totalIssuesNum,
                expireDate: expireDate
            };

            getAccountHistory.accountHistory.push(newHistory);

            await getAccountHistory.save();

            logger.info("New weekly history entry added", {
                userId,
                country,
                region,
                totalEntries: getAccountHistory.accountHistory.length,
                nextExpiry: expireDate.toISOString()
            });

            return getAccountHistory;
        }

        logger.info("History already up to date, expiry not reached", {
            userId,
            country,
            region,
            expireDate: ExpireDate.toISOString(),
            today: today.toISOString()
        });

        return getAccountHistory;

    } catch (error) {
        logger.error("Error in addAccountHistory", {
            error: error.message,
            stack: error.stack,
            userId,
            country,
            region
        });
        throw error; // Re-throw so caller knows it failed
    }
}

module.exports = { addAccountHistory }
