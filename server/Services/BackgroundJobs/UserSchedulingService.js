const User = require('../../models/userModel.js');
const Seller = require('../../models/sellerCentralModel.js');
const UserUpdateSchedule = require('../../models/UserUpdateScheduleModel.js');
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
                    lastDailyUpdate: null,
                    lastWeeklyUpdate: null
                }));
            }

            // Find the hour with the least number of users (optimal distribution)
            const dailyUpdateHour = await this.findOptimalDailyHour();
            
            // Find the day with the least number of users (optimal distribution)
            const weeklyUpdateDay = await this.findOptimalWeeklyDay();

            const schedule = new UserUpdateSchedule({
                userId,
                dailyUpdateHour,
                weeklyUpdateDay,
                sellerAccounts
            });

            await schedule.save();
            logger.info(`Initialized schedule for user ${userId}: daily hour ${dailyUpdateHour}, weekly day ${weeklyUpdateDay}`);
            
            return schedule;
        } catch (error) {
            logger.error(`Error initializing user schedule for ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Get users that need daily updates (profitability and sponsored ads)
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
     * Get users that need weekly updates (all other data)
     * Only returns users whose scheduled day matches current day and haven't been updated in 7 days
     */
    static async getUsersNeedingWeeklyUpdate() {
        try {
            // Use UTC timezone for consistency across servers
            const now = new Date();
            const currentDay = now.getUTCDay();
            const currentHour = now.getUTCHours();
            const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

            // Only run weekly updates during the first hour of the day to avoid conflicts
            if (currentHour !== 0) return [];

            const users = await UserUpdateSchedule.find({
                weeklyUpdateDay: currentDay,
                $or: [
                    { lastWeeklyUpdate: null },
                    { lastWeeklyUpdate: { $lt: sevenDaysAgo } }
                ]
            }).populate('userId');

            return users.filter(user => user.userId && user.userId.isVerified);
        } catch (error) {
            logger.error('Error getting users needing weekly update:', error);
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

            logger.info(`Marked daily update complete for user ${userId}, ${country}-${region}`);
        } catch (error) {
            logger.error(`Error marking daily update complete for user ${userId}:`, error);
        }
    }

    /**
     * Update the last weekly update timestamp for a user
     */
    static async markWeeklyUpdateComplete(userId, country, region) {
        try {
            const updateData = {
                lastWeeklyUpdate: new Date(),
                'sellerAccounts.$[elem].lastWeeklyUpdate': new Date()
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

            logger.info(`Marked weekly update complete for user ${userId}, ${country}-${region}`);
        } catch (error) {
            logger.error(`Error marking weekly update complete for user ${userId}:`, error);
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
                lastDailyUpdate: null,
                lastWeeklyUpdate: null
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

            logger.info(`Initialized schedules for ${initialized} users`);
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
     * Find the optimal day (0-6) with the least number of users assigned
     */
    static async findOptimalWeeklyDay() {
        try {
            // Get user count for each day
            const dailyDistribution = await UserUpdateSchedule.aggregate([
                {
                    $group: {
                        _id: '$weeklyUpdateDay',
                        count: { $sum: 1 }
                    }
                },
                {
                    $sort: { count: 1, _id: 1 } // Sort by count ascending, then by day
                }
            ]);

            // If no users exist yet, start with day 0 (Sunday)
            if (dailyDistribution.length === 0) {
                return 0;
            }

            // Create an array to track all 7 days
            const dayCounts = new Array(7).fill(0);
            
            // Fill in actual counts
            dailyDistribution.forEach(item => {
                dayCounts[item._id] = item.count;
            });

            // Find the day with minimum users
            const minCount = Math.min(...dayCounts);
            const optimalDay = dayCounts.indexOf(minCount);

            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            logger.info(`Optimal weekly day selected: ${dayNames[optimalDay]} (Day ${optimalDay}, current count: ${minCount})`);
            return optimalDay;

        } catch (error) {
            logger.error('Error finding optimal weekly day:', error);
            // Fallback to simple modulo distribution
            const totalUsers = await UserUpdateSchedule.countDocuments();
            return totalUsers % 7;
        }
    }

    /**
     * Get detailed statistics about user distribution across time slots
     */
    static async getScheduleStats() {
        try {
            const [hourlyStats, dailyStats] = await Promise.all([
                // Get hourly distribution
                UserUpdateSchedule.aggregate([
                    {
                        $group: {
                            _id: '$dailyUpdateHour',
                            count: { $sum: 1 }
                        }
                    },
                    { $sort: { _id: 1 } }
                ]),
                // Get daily distribution
                UserUpdateSchedule.aggregate([
                    {
                        $group: {
                            _id: '$weeklyUpdateDay',
                            count: { $sum: 1 }
                        }
                    },
                    { $sort: { _id: 1 } }
                ])
            ]);

            // Create complete arrays for all hours (0-23) and days (0-6)
            const hourlyDistribution = new Array(24).fill(0).map((_, hour) => {
                const found = hourlyStats.find(item => item._id === hour);
                return {
                    hour,
                    time: `${hour.toString().padStart(2, '0')}:00`,
                    count: found ? found.count : 0
                };
            });

            const dayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
            const dailyDistribution = new Array(7).fill(0).map((_, day) => {
                const found = dailyStats.find(item => item._id === day);
                return {
                    day,
                    dayName: dayNames[day],
                    count: found ? found.count : 0
                };
            });

            // Calculate statistics
            const totalUsers = await UserUpdateSchedule.countDocuments();
            const hourCounts = hourlyDistribution.map(h => h.count);
            const dayCounts = dailyDistribution.map(d => d.count);

            return {
                totalUsers,
                hourlyDistribution,
                dailyDistribution,
                balance: {
                    hourly: {
                        min: Math.min(...hourCounts),
                        max: Math.max(...hourCounts),
                        average: totalUsers / 24,
                        variance: this.calculateVariance(hourCounts)
                    },
                    daily: {
                        min: Math.min(...dayCounts),
                        max: Math.max(...dayCounts),
                        average: totalUsers / 7,
                        variance: this.calculateVariance(dayCounts)
                    }
                }
            };
        } catch (error) {
            logger.error('Error getting schedule stats:', error);
            return { hourlyDistribution: [], dailyDistribution: [], totalUsers: 0 };
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
            logger.info('Starting user rebalancing process...');
            
            const allUsers = await UserUpdateSchedule.find().sort({ createdAt: 1 }); // Oldest first
            let rebalanced = 0;

            // Clear all assignments first to avoid race conditions
            await UserUpdateSchedule.updateMany({}, {
                $set: {
                    dailyUpdateHour: -1,  // Temporary invalid value
                    weeklyUpdateDay: -1   // Temporary invalid value
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
                    const weeklyUpdateDay = rebalanced % 7;

                    await UserUpdateSchedule.updateOne(
                        { _id: user._id },
                        {
                            $set: {
                                dailyUpdateHour,
                                weeklyUpdateDay
                            }
                        }
                    );

                    rebalanced++;
                    logger.info(`Rebalanced user ${user.userId}: Hour ${dailyUpdateHour}, Day ${weeklyUpdateDay}`);
                }

                // Add small delay between batches
                await new Promise(resolve => setTimeout(resolve, 100));
            }

            logger.info(`Rebalancing completed: ${rebalanced} users redistributed`);
            return rebalanced;

        } catch (error) {
            logger.error('Error during user rebalancing:', error);
            throw error;
        }
    }
}

module.exports = { UserSchedulingService }; 