const AccountHistory = require('../../models/user-auth/AccountHistory.js')
const dbConnect = require('../../config/dbConn.js')
const logger = require('../../utils/Logger.js')

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
            // Create expiry date without mutating today
            const expireDate = new Date();
            expireDate.setDate(expireDate.getDate() + 7);
            
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

            return createAccountHistory.accountHistory;
        }

        // Check if accountHistory array is valid
        if (!getAccountHistory.accountHistory || getAccountHistory.accountHistory.length === 0) {
            logger.warn("Account history exists but has no entries, adding first entry", {
                userId,
                country,
                region
            });

            const expireDate = new Date();
            expireDate.setDate(expireDate.getDate() + 7);

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

        const lastEntry = getAccountHistory.accountHistory[getAccountHistory.accountHistory.length - 1];
        const getAccountHistoryExpireDate = lastEntry.expireDate;
        const ExpireDate = new Date(getAccountHistoryExpireDate);

        if (today > ExpireDate) {
            // Create expiry date without mutating today
            const expireDate = new Date();
            expireDate.setDate(expireDate.getDate() + 7);
            
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
                totalEntries: getAccountHistory.accountHistory.length
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



module.exports = {addAccountHistory}