const logger = require('../../utils/Logger.js');
const User = require('../../models/user-auth/userModel.js');
const Seller = require('../../models/user-auth/sellerCentralModel.js');
const Subscription = require('../../models/user-auth/SubscriptionModel.js');
const { sendSixMonthAccountWarning } = require('../Email/SendSixMonthAccountWarning.js');
const { sendAccountSuspendedEmail } = require('../Email/SendAccountSuspendedEmail.js');
const { resolveRecipientEmail } = require('../Email/resolveRecipientEmail.js');
const { deleteUserById } = require('../User/deleteUserService.js');
const { enqueueFullUserDataPurge } = require('./deleteUserQueue.js');

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Add months to a date, preserving day-of-month when possible.
 * @param {Date} date
 * @param {number} months
 * @returns {Date}
 */
function addMonths(date, months) {
    const d = new Date(date.getTime());
    const day = d.getDate();
    d.setMonth(d.getMonth() + months);
    // Handle month overflow (e.g. Feb 30 -> Mar 2)
    if (d.getDate() < day) {
        d.setDate(0);
    }
    return d;
}

/**
 * Check if a user has any connected SP-API or Ads account.
 * Considers a user connected if ANY sellerAccount entry has a non-empty
 * spiRefreshToken or adsRefreshToken.
 * 
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function isUserConnectedToSpApiOrAds(userId) {
    const seller = await Seller.findOne({ User: userId }).lean();
    if (!seller || !Array.isArray(seller.sellerAccount) || seller.sellerAccount.length === 0) {
        return false;
    }

    return seller.sellerAccount.some((account) => {
        const spi = typeof account.spiRefreshToken === 'string' ? account.spiRefreshToken.trim() : '';
        const ads = typeof account.adsRefreshToken === 'string' ? account.adsRefreshToken.trim() : '';
        return !!spi || !!ads;
    });
}

/**
 * Check if a user has any active subscription (any plan) that is currently active or trialing.
 * 
 * @param {string} userId
 * @returns {Promise<boolean>}
 */
async function hasActiveSubscription(userId) {
    const sub = await Subscription.findOne({
        userId,
        status: { $in: ['active', 'trialing'] },
    }).lean();
    return !!sub;
}

/**
 * Find users whose 6‑month anniversary is exactly 2 days from "today".
 * The filter is:
 *   ceil((createdAt + 6 months - today) / 1 day) === 2
 * 
 * Date math is performed in Node to avoid MongoDB version dependencies.
 * 
 * @returns {Promise<Array>}
 */
async function findUsersWithSixMonthInTwoDays() {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // To limit scan, only consider users older than ~5 months
    const approxFiveMonthsAgo = addMonths(today, -5);

    const candidates = await User.find({
        isVerified: true,
        createdAt: { $lte: approxFiveMonthsAgo },
    }).select('firstName lastName email createdAt packageType subscriptionStatus').lean();

    return candidates.filter((user) => {
        if (!user.createdAt) return false;
        const createdAt = new Date(user.createdAt);
        const sixMonthsFromCreated = addMonths(createdAt, 6);
        sixMonthsFromCreated.setHours(0, 0, 0, 0);

        const diffDays = Math.ceil((sixMonthsFromCreated.getTime() - today.getTime()) / MS_PER_DAY);
        return diffDays === 2;
    });
}

/**
 * Service 1:
 * Send warning emails to users who are 2 days away from completing 6 months
 * since registration AND who either:
 *  - have not connected their SP-API/Ads accounts, OR
 *  - do not have any active subscription (any plan, including LITE)
 * 
 * This function only sends emails; it does not modify user state beyond EmailLogs.
 * 
 * @returns {Promise<{ processed: number, emailed: number, skippedConnectedAndSubscribed: number }>}
 */
async function sendSixMonthAccountWarnings() {
    logger.info('[SixMonthUserMaintenanceService] Starting six-month warning email process');

    const users = await findUsersWithSixMonthInTwoDays();
    logger.info(`[SixMonthUserMaintenanceService] Found ${users.length} users approaching 6 months (2 days left)`);

    let emailed = 0;
    let skippedConnectedAndSubscribed = 0;

    for (const user of users) {
        try {
            const [isConnected, hasSub] = await Promise.all([
                isUserConnectedToSpApiOrAds(user._id),
                hasActiveSubscription(user._id),
            ]);

            // Only target users who either haven't connected OR don't have an active subscription
            if (isConnected && hasSub) {
                skippedConnectedAndSubscribed++;
                continue;
            }

            const result = await sendSixMonthAccountWarning({
                email: user.email,
                firstName: user.firstName,
                lastName: user.lastName,
                userId: user._id,
                registeredAt: user.createdAt,
            });

            if (result?.success) {
                emailed++;
            } else if (result?.error) {
                logger.warn(`[SixMonthUserMaintenanceService] Warning email failed for ${user.email}: ${result.error}`);
            }
        } catch (err) {
            logger.error(
                `[SixMonthUserMaintenanceService] Error processing six-month warning for user ${user.email} (${user._id}):`,
                err
            );
        }
    }

    const summary = {
        processed: users.length,
        emailed,
        skippedConnectedAndSubscribed,
    };

    logger.info('[SixMonthUserMaintenanceService] Six-month warning email process completed', summary);
    return summary;
}

/**
 * Service 2:
 * Find users who:
 *  - Have completed 6 months or more since registration
 *  - Are currently in LITE package
 *  - Have NOT connected SP-API and Ads (no spiRefreshToken/adsRefreshToken on any sellerAccount)
 * 
 * For these users we:
 *  - Delete the User and Seller documents using deleteUserById (immediate)
 *  - Enqueue full data purge job to remove all remaining data (including ads data)
 * 
 * This uses the same hybrid delete + purge flow as the admin delete route.
 * 
 * @returns {Promise<{ eligible: number, deleted: number, purgeEnqueued: number }>}
 */
async function deleteStaleLiteUsersWithoutIntegration() {
    logger.info('[SixMonthUserMaintenanceService] Starting cleanup of 6+ month LITE users without SP-API/Ads');

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const sixMonthsAgo = addMonths(today, -6);

    // Only LITE users who registered 6+ months ago
    const candidates = await User.find({
        isVerified: true,
        packageType: 'LITE',
        createdAt: { $lte: sixMonthsAgo },
    }).select('firstName lastName email createdAt packageType subscriptionStatus').lean();

    logger.info(
        `[SixMonthUserMaintenanceService] Found ${candidates.length} candidate LITE users with 6+ months age`
    );

    let eligible = 0;
    let deleted = 0;
    let purgeEnqueued = 0;

    for (const user of candidates) {
        try {
            const isConnected = await isUserConnectedToSpApiOrAds(user._id);

            // Only users without any SP-API or Ads connection
            if (isConnected) {
                continue;
            }

            eligible++;

            // Capture email/name before deletion (for suspension email after)
            const userFirstName = user.firstName;
            const userLastName = user.lastName;
            const userIdStr = user._id.toString();
            // Resolve agency email before deletion (user must still exist in DB)
            const userEmail = await resolveRecipientEmail(user.email, user._id);

            // Suspend: delete User + Seller immediately (no waiting)
            await deleteUserById(user._id);
            deleted++;

            // Enqueue full data purge in background to remove all remaining documents (including ads)
            try {
                await enqueueFullUserDataPurge(userIdStr);
                purgeEnqueued++;
            } catch (enqueueErr) {
                logger.error(
                    `[SixMonthUserMaintenanceService] Failed to enqueue full user data purge for user ${userIdStr}:`,
                    enqueueErr
                );
            }

            // Send suspension email after account is suspended (using captured data)
            try {
                await sendAccountSuspendedEmail({
                    email: userEmail,
                    firstName: userFirstName,
                    lastName: userLastName,
                });
            } catch (emailErr) {
                logger.warn(`[SixMonthUserMaintenanceService] Failed to send suspension email to ${userEmail} (already suspended):`, emailErr?.message);
            }
        } catch (err) {
            logger.error(
                `[SixMonthUserMaintenanceService] Error deleting stale LITE user ${user.email} (${user._id}):`,
                err
            );
        }
    }

    const summary = {
        eligible,
        deleted,
        purgeEnqueued,
    };

    logger.info(
        '[SixMonthUserMaintenanceService] Cleanup of 6+ month LITE users without SP-API/Ads completed',
        summary
    );

    return summary;
}

module.exports = {
    sendSixMonthAccountWarnings,
    deleteStaleLiteUsersWithoutIntegration,
    // Export helpers for potential reuse/testing
    isUserConnectedToSpApiOrAds,
    hasActiveSubscription,
    addMonths,
};

