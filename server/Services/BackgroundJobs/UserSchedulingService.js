const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const UserUpdateSchedule = require('../../models/user-auth/UserUpdateScheduleModel.js');
const logger = require('../../utils/Logger.js');

class UserSchedulingService {
    
    /**
     * Initialize scheduling for a new user
     * Assigns them a time slot to distribute load across 24 hours
     */
    static async initializeUserSchedule(userId) {
        try {
            // Check if user already has a schedule
            const existingSchedule = await UserUpdateSchedule.findOne({ userId });
            if (existingSchedule) {
                return existingSchedule;
            }

            // Get user's seller accounts to know their countries/regions
            const seller = await Seller.findOne({ User: userId });
            let sellerAccounts = [];
            
            if (seller && seller.sellerAccount) {
                sellerAccounts = seller.sellerAccount.map(account => ({
                    country: account.country,
                    region: account.region,
                    lastDailyUpdate: null
                }));
            }

            // Find the hour with the least number of users (optimal distribution)
            const dailyUpdateHour = await this.findOptimalDailyHour();

            const schedule = new UserUpdateSchedule({
                userId,
                dailyUpdateHour,
                sellerAccounts
            });

            await schedule.save();
            logger.info(`Initialized daily schedule for user ${userId}: daily hour ${dailyUpdateHour}`);
            
            return schedule;
        } catch (error) {
            logger.error(`Error initializing user schedule for ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Get users that need daily updates (comprehensive data including profitability, sponsored ads, and all API data)
     * Only returns users whose scheduled hour matches current hour and haven't been updated in 24h
     */
    static async getUsersNeedingDailyUpdate() {
        try {
            // Use UTC timezone for consistency across servers
            const now = new Date();
            const currentHour = now.getUTCHours();
            const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

            const users = await UserUpdateSchedule.find({
                dailyUpdateHour: currentHour,
                $or: [
                    { lastDailyUpdate: null },
                    { lastDailyUpdate: { $lt: twentyFourHoursAgo } }
                ]
            }).populate('userId');

            return users.filter(user => user.userId && user.userId.isVerified);
        } catch (error) {
            logger.error('Error getting users needing daily update:', error);
            return [];
        }
    }

    /**
     * Update the last daily update timestamp for a user
     */
    static async markDailyUpdateComplete(userId, country, region) {
        try {
            const updateData = {
                lastDailyUpdate: new Date(),
                'sellerAccounts.$[elem].lastDailyUpdate': new Date()
            };

            await UserUpdateSchedule.updateOne(
                { userId },
                { $set: updateData },
                { 
                    arrayFilters: [{ 
                        'elem.country': country, 
                        'elem.region': region 
                    }]
                }
            );

            logger.info(`Marked daily comprehensive update complete for user ${userId}, ${country}-${region}`);
        } catch (error) {
            logger.error(`Error marking daily update complete for user ${userId}:`, error);
        }
    }

    /**
     * Update seller accounts for a user when they add/remove accounts
     */
    static async updateUserSellerAccounts(userId) {
        try {
            const seller = await Seller.findOne({ User: userId });
            if (!seller || !seller.sellerAccount) {
                return;
            }

            const sellerAccounts = seller.sellerAccount.map(account => ({
                country: account.country,
                region: account.region,
                lastDailyUpdate: null
            }));

            await UserUpdateSchedule.updateOne(
                { userId },
                { $set: { sellerAccounts } },
                { upsert: true }
            );

            logger.info(`Updated seller accounts for user ${userId}`);
        } catch (error) {
            logger.error(`Error updating seller accounts for user ${userId}:`, error);
        }
    }

    /**
     * Get all users and initialize schedules for any missing ones
     */
    static async initializeAllUserSchedules() {
        try {
            const users = await User.find({ isVerified: true });
            let initialized = 0;

            for (const user of users) {
                const existingSchedule = await UserUpdateSchedule.findOne({ userId: user._id });
                if (!existingSchedule) {
                    await this.initializeUserSchedule(user._id);
                    initialized++;
                }
            }

            logger.info(`Initialized daily schedules for ${initialized} users`);
            return initialized;
        } catch (error) {
            logger.error('Error initializing all user schedules:', error);
            throw error;
        }
    }

    /**
     * Find the optimal hour (0-23) with the least number of users assigned
     */
    static async findOptimalDailyHour() {
        try {
            // Get user count for each hour
            const hourlyDistribution = await UserUpdateSchedule.aggregate([
                {
                    $group: {
                        _id: '$dailyUpdateHour',
                        count: { $sum: 1 }
                    }
                },
                {
                    $sort: { count: 1, _id: 1 } // Sort by count ascending, then by hour
                }
            ]);

            // If no users exist yet, start with hour 0
            if (hourlyDistribution.length === 0) {
                return 0;
            }

            // Create an array to track all 24 hours
            const hourCounts = new Array(24).fill(0);
            
            // Fill in actual counts
            hourlyDistribution.forEach(item => {
                hourCounts[item._id] = item.count;
            });

            // Find the hour with minimum users
            const minCount = Math.min(...hourCounts);
            const optimalHour = hourCounts.indexOf(minCount);

            logger.info(`Optimal daily hour selected: ${optimalHour} (current count: ${minCount})`);
            return optimalHour;

        } catch (error) {
            logger.error('Error finding optimal daily hour:', error);
            // Fallback to simple modulo distribution
            const totalUsers = await UserUpdateSchedule.countDocuments();
            return totalUsers % 24;
        }
    }

    /**
     * Get detailed statistics about user distribution across time slots
     */
    static async getScheduleStats() {
        try {
            // Get hourly distribution only (no more weekly)
            const hourlyStats = await UserUpdateSchedule.aggregate([
                {
                    $group: {
                        _id: '$dailyUpdateHour',
                        count: { $sum: 1 }
                    }
                },
                { $sort: { _id: 1 } }
            ]);

            // Create complete array for all hours (0-23)
            const hourlyDistribution = new Array(24).fill(0).map((_, hour) => {
                const found = hourlyStats.find(item => item._id === hour);
                return {
                    hour,
                    time: `${hour.toString().padStart(2, '0')}:00`,
                    count: found ? found.count : 0
                };
            });

            // Calculate statistics
            const totalUsers = await UserUpdateSchedule.countDocuments();
            const hourCounts = hourlyDistribution.map(h => h.count);

            return {
                totalUsers,
                hourlyDistribution,
                updateType: 'daily_comprehensive_only',
                balance: {
                    hourly: {
                        min: Math.min(...hourCounts),
                        max: Math.max(...hourCounts),
                        average: totalUsers / 24,
                        variance: this.calculateVariance(hourCounts)
                    }
                }
            };
        } catch (error) {
            logger.error('Error getting schedule stats:', error);
            return { hourlyDistribution: [], totalUsers: 0, updateType: 'daily_comprehensive_only' };
        }
    }

    /**
     * Calculate variance for load balancing statistics
     */
    static calculateVariance(numbers) {
        if (numbers.length === 0) return 0;
        const mean = numbers.reduce((sum, num) => sum + num, 0) / numbers.length;
        const variance = numbers.reduce((sum, num) => sum + Math.pow(num - mean, 2), 0) / numbers.length;
        return Math.round(variance * 100) / 100; // Round to 2 decimal places
    }

    /**
     * Rebalance all existing users to optimize distribution (Admin function)
     * WARNING: This will reassign all users to new time slots
     */
    static async rebalanceAllUsers() {
        try {
            logger.info('Starting user rebalancing process for daily comprehensive updates...');
            
            const allUsers = await UserUpdateSchedule.find().sort({ createdAt: 1 }); // Oldest first
            let rebalanced = 0;

            // Clear all assignments first to avoid race conditions
            await UserUpdateSchedule.updateMany({}, {
                $set: {
                    dailyUpdateHour: -1  // Temporary invalid value
                }
            });

            // Redistribute users in a balanced way
            const totalUsers = allUsers.length;
            const batchSize = 10; // Process in smaller batches

            for (let i = 0; i < allUsers.length; i += batchSize) {
                const batch = allUsers.slice(i, i + batchSize);
                
                for (const user of batch) {
                    // Calculate optimal slots without querying database (to avoid race conditions)
                    const dailyUpdateHour = rebalanced % 24;

                    await UserUpdateSchedule.updateOne(
                        { _id: user._id },
                        {
                            $set: {
                                dailyUpdateHour
                            }
                        }
                    );

                    rebalanced++;
                    logger.info(`Rebalanced user ${user.userId}: Hour ${dailyUpdateHour}`);
                }

                // Add small delay between batches
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            logger.info(`Rebalancing completed: ${rebalanced} users redistributed for daily comprehensive updates`);
            return rebalanced;

        } catch (error) {
            logger.error('Error during user rebalancing:', error);
            throw error;
        }
    }
}

module.exports = { UserSchedulingService }; 