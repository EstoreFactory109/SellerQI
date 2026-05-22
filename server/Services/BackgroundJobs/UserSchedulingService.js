const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const UserUpdateSchedule = require('../../models/user-auth/UserUpdateScheduleModel.js');
const logger = require('../../utils/Logger.js');

// Per-account, per-UTC-day cap on how many times the daily pipeline will be
// enqueued. Prevents an account with bad SP-API tokens (or any other persistent
// fetch failure) from burning API quota with 23 retries in a day. Tuned so that
// transient failures (a single missed hour) still recover within the day, but
// a permanently broken account is paused until tomorrow.
const MAX_DAILY_ATTEMPTS = 4;

class UserSchedulingService {

    /**
     * UTC midnight of the given Date. Used as the "day key" for retry counters.
     */
    static _startOfUtcDay(d = new Date()) {
        return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), 0, 0, 0, 0));
    }

    /**
     * Decide whether the daily pipeline should be enqueued for this specific
     * (user, country, region) account right now. Returns:
     *   { eligible: true }                      — enqueue it
     *   { eligible: false, reason: 'done' }     — already succeeded today
     *   { eligible: false, reason: 'capped' }   — too many failed attempts today
     *   { eligible: false, reason: 'missing' }  — schedule row not found
     *
     * Lazily resets `dailyAttempts` when the UTC day rolls over.
     */
    static async shouldAttemptAccountUpdate(userId, country, region) {
        const schedule = await UserUpdateSchedule.findOne({ userId });
        if (!schedule || !Array.isArray(schedule.sellerAccounts)) {
            return { eligible: false, reason: 'missing' };
        }
        const acct = schedule.sellerAccounts.find(
            (a) => a.country === country && a.region === region
        );
        if (!acct) return { eligible: false, reason: 'missing' };

        const startOfToday = this._startOfUtcDay();

        // Already succeeded today — caller should skip.
        if (acct.lastDailyUpdate && acct.lastDailyUpdate >= startOfToday) {
            return { eligible: false, reason: 'done' };
        }

        // Lazy reset: if the counter is from a previous UTC day, treat it as 0.
        const counterStale = !acct.dailyAttemptsResetAt || acct.dailyAttemptsResetAt < startOfToday;
        const attempts = counterStale ? 0 : (acct.dailyAttempts || 0);

        if (attempts >= MAX_DAILY_ATTEMPTS) {
            return { eligible: false, reason: 'capped', attempts };
        }
        return { eligible: true, attempts };
    }

    /**
     * Atomically increment `dailyAttempts` for a (user, country, region).
     * Resets the counter to 1 if the stored resetAt is older than today UTC.
     * Returns the new attempt count.
     */
    static async recordAccountAttempt(userId, country, region) {
        const now = new Date();
        const startOfToday = this._startOfUtcDay(now);

        // First try: increment if resetAt is current.
        const incRes = await UserUpdateSchedule.updateOne(
            { userId },
            { $inc: { 'sellerAccounts.$[elem].dailyAttempts': 1 } },
            {
                arrayFilters: [{
                    'elem.country': country,
                    'elem.region': region,
                    'elem.dailyAttemptsResetAt': { $gte: startOfToday }
                }]
            }
        );

        // If the increment didn't match (counter is from yesterday or null),
        // reset it to 1 and stamp today.
        if (incRes.modifiedCount === 0) {
            await UserUpdateSchedule.updateOne(
                { userId },
                {
                    $set: {
                        'sellerAccounts.$[elem].dailyAttempts': 1,
                        'sellerAccounts.$[elem].dailyAttemptsResetAt': startOfToday
                    }
                },
                { arrayFilters: [{ 'elem.country': country, 'elem.region': region }] }
            );
        }
    }

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
            
            // Calculate start of today (00:00:00 UTC) to check if user was updated today
            // Since different services run on different days, users should be processed EVERY day
            const startOfToday = new Date(Date.UTC(
                now.getUTCFullYear(),
                now.getUTCMonth(),
                now.getUTCDate(),
                0, 0, 0, 0
            ));

            // dailyUpdateHour is the user's assigned slot for the FIRST attempt of
            // the day (load-spreading). We use $lte so that if the first attempt
            // fails (e.g. transient 429 / token blip / partial phase failure),
            // subsequent hourly ticks within the same UTC day will pick the user
            // up again — bounded by MAX_DAILY_ATTEMPTS per account in
            // shouldAttemptAccountUpdate(). Healthy users still run only once;
            // the per-account "done" gate skips them on every later tick.
            const users = await UserUpdateSchedule.find({
                dailyUpdateHour: { $lte: currentHour },
                $or: [
                    { lastDailyUpdate: null },
                    { lastDailyUpdate: { $lt: startOfToday } } // Not updated today
                ]
            }).populate('userId');

            // Eligibility filter for the DAILY pipeline only:
            //   - PRO and PRO-trial users (packageType === 'PRO', including those
            //     whose isInTrialPeriod is true)
            //   - Agency clients (managed by an agency under a single billing entity)
            //
            // Excluded by this filter: LITE, AGENCY-owner accounts without a Pro
            // entitlement, expired/cancelled users still in the schedule table.
            //
            // NOTE: This filter applies ONLY to the daily scheduled pipeline.
            // Integration worker (first-time onboarding) uses a separate path
            // (`Integration.executeBatch3And4Phase` via integrationWorker.js)
            // and is NOT affected — new sign-ups still get their initial 30-day
            // fetch regardless of plan.
            return users.filter(user => {
                if (!user.userId || !user.userId.isVerified) return false;
                const isPro = user.userId.packageType === 'PRO'; // covers both active Pro and Pro-trial
                const isAgencyClient = user.userId.isAgencyClient === true;
                return isPro || isAgencyClient;
            });
        } catch (error) {
            logger.error('Error getting users needing daily update:', error);
            return [];
        }
    }

    /**
     * Update the last daily update timestamp for a specific account.
     * Only sets the user-level lastDailyUpdate when ALL accounts have
     * been updated today. This prevents the cron from skipping remaining
     * accounts when the first account finishes (which would happen if we
     * set the user-level timestamp immediately).
     */
    static async markDailyUpdateComplete(userId, country, region) {
        try {
            const now = new Date();

            // Step 1: Update only the per-account lastDailyUpdate.
            // Also zero out the per-account retry counter so tomorrow starts fresh.
            await UserUpdateSchedule.updateOne(
                { userId },
                {
                    $set: {
                        'sellerAccounts.$[elem].lastDailyUpdate': now,
                        'sellerAccounts.$[elem].dailyAttempts': 0,
                        'sellerAccounts.$[elem].dailyAttemptsResetAt': UserSchedulingService._startOfUtcDay(now)
                    }
                },
                { arrayFilters: [{ 'elem.country': country, 'elem.region': region }] }
            );

            logger.info(`Marked account update complete for user ${userId}, ${country}-${region}`);

            // Step 2: Check if ALL accounts for this user are now done today
            const schedule = await UserUpdateSchedule.findOne({ userId });
            if (schedule && schedule.sellerAccounts && schedule.sellerAccounts.length > 0) {
                const startOfToday = new Date(Date.UTC(
                    now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0, 0
                ));

                const allDone = schedule.sellerAccounts.every(acct => {
                    if (!acct.country || !acct.region) return true;
                    return acct.lastDailyUpdate && acct.lastDailyUpdate >= startOfToday;
                });

                if (allDone) {
                    await UserUpdateSchedule.updateOne(
                        { userId },
                        { $set: { lastDailyUpdate: now } }
                    );
                    logger.info(`All accounts updated today for user ${userId} - marked user-level lastDailyUpdate`);
                }
            }
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