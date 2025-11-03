const logger = require('../../utils/Logger.js');
const Seller = require('../../models/sellerCentralModel.js');
const getKeywordData = require('../SellerApp/integrate.js');

class MonthlyKeywordTrackingService {
    static async run() {
        try {
            logger.info('[MonthlyKeywordTracking] Starting monthly keyword tracking job');

            // Find all sellers with at least one sellerAccount having spiRefreshToken and products
            const sellers = await Seller.find({ 'sellerAccount.spiRefreshToken': { $exists: true, $ne: null } })
                .select('User sellerAccount');

            if (!sellers || sellers.length === 0) {
                logger.info('[MonthlyKeywordTracking] No sellers found with SP-API refresh tokens');
                return { processed: 0, triggered: 0 };
            }

            let triggered = 0;

            for (const seller of sellers) {
                const userId = seller.User;
                const accounts = Array.isArray(seller.sellerAccount) ? seller.sellerAccount : [];

                for (const account of accounts) {
                    if (!account || !account.spiRefreshToken) continue;

                    const country = account.country;
                    const region = account.region;
                    const products = Array.isArray(account.products) ? account.products : [];
                    const asinArray = products
                        .filter(p => p && typeof p.asin === 'string' && p.asin.trim() !== '')
                        .map(p => p.asin.trim());

                    if (!asinArray || asinArray.length === 0) {
                        logger.debug('[MonthlyKeywordTracking] Skipping account with no ASINs', { userId: String(userId), country, region });
                        continue;
                    }

                    try {
                        logger.info('[MonthlyKeywordTracking] Triggering integrate.getKeywordData', {
                            userId: String(userId),
                            country,
                            region,
                            asinCount: asinArray.length
                        });

                        await getKeywordData(asinArray, country, region, String(userId));
                        triggered += 1;
                    } catch (err) {
                        logger.error('[MonthlyKeywordTracking] Error running getKeywordData', {
                            userId: String(userId),
                            country,
                            region,
                            error: err.message
                        });
                    }
                }
            }

            logger.info('[MonthlyKeywordTracking] Completed monthly keyword tracking job', { processed: sellers.length, triggered });
            return { processed: sellers.length, triggered };
        } catch (error) {
            logger.error('[MonthlyKeywordTracking] Unexpected error', { error: error.message, stack: error.stack });
            throw error;
        }
    }
}

module.exports = { MonthlyKeywordTrackingService };


