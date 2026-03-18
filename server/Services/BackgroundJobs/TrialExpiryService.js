const logger = require('../../utils/Logger.js');
const User = require('../../models/user-auth/userModel.js');
const Subscription = require('../../models/user-auth/SubscriptionModel.js');

/**
 * TrialExpiryService
 *
 * Runs daily to downgrade "manual trial" users whose trial has expired
 * and who never authorised a payment method (no Subscription record).
 *
 * SAFE for paying users:
 *   If a Subscription document exists for the user it means they went through
 *   the Stripe/Razorpay checkout flow.  Those users are governed entirely by
 *   the payment-gateway webhooks and are NEVER touched by this service.
 *
 * Who IS affected:
 *   Users whose trial was granted manually (admin toggle, DB edit, etc.)
 *   without going through checkout.  They will have User-level trial flags
 *   set but NO row in the Subscription collection.
 */

async function downgradeExpiredManualTrials() {
    const TAG = '[TrialExpiryService]';
    logger.info(`${TAG} Starting expired manual-trial cleanup`);

    const now = new Date();

    try {
        // ──────────────────────────────────────────────
        // Step 1 – Find users whose trial period has ended
        // ──────────────────────────────────────────────
        // Conditions:
        //   • packageType is PRO or AGENCY  (still on a paid plan)
        //   • isInTrialPeriod is true       (flagged as trial user)
        //   • trialEndsDate exists and is in the past
        const expiredTrialUsers = await User.find({
            packageType: { $in: ['PRO', 'AGENCY'] },
            isInTrialPeriod: true,
            trialEndsDate: { $exists: true, $lt: now },
        })
            .select('_id email firstName lastName packageType subscriptionStatus trialEndsDate')
            .lean();

        if (expiredTrialUsers.length === 0) {
            logger.info(`${TAG} No expired trial users found. Nothing to do.`);
            return { processed: 0, downgraded: 0, skippedWithSubscription: 0 };
        }

        logger.info(`${TAG} Found ${expiredTrialUsers.length} user(s) with expired trial flags`);

        let downgraded = 0;
        let skippedWithSubscription = 0;

        for (const user of expiredTrialUsers) {
            try {
                // ──────────────────────────────────────────────
                // Step 2 – Check if a Subscription record exists
                // ──────────────────────────────────────────────
                // ANY Subscription row (regardless of status/gateway) means the
                // user went through a checkout flow at some point.  Their lifecycle
                // is managed by the payment gateway – skip them.
                const subscription = await Subscription.findOne({ userId: user._id }).lean();

                if (subscription) {
                    skippedWithSubscription++;
                    logger.info(
                        `${TAG} Skipping user ${user.email} (${user._id}) – ` +
                        `Subscription record exists (gateway=${subscription.paymentGateway}, status=${subscription.status}). ` +
                        `Payment flow controls this user.`
                    );
                    continue;
                }

                // ──────────────────────────────────────────────
                // Step 3 – Downgrade to LITE / inactive
                // ──────────────────────────────────────────────
                await User.findByIdAndUpdate(user._id, {
                    packageType: 'LITE',
                    subscriptionStatus: 'inactive',
                    isInTrialPeriod: false,
                    reviewRequestAuthStatus: false,
                    // Keep servedTrial = true so they can't get another free trial
                    // Keep trialEndsDate for historical reference
                });

                downgraded++;
                logger.info(
                    `${TAG} Downgraded user ${user.email} (${user._id}) from ${user.packageType} to LITE/inactive. ` +
                    `Trial ended: ${user.trialEndsDate?.toISOString()}`
                );
            } catch (userError) {
                logger.error(`${TAG} Error processing user ${user.email} (${user._id}):`, userError);
            }
        }

        const summary = {
            processed: expiredTrialUsers.length,
            downgraded,
            skippedWithSubscription,
        };

        logger.info(`${TAG} Expired manual-trial cleanup completed`, summary);
        return summary;
    } catch (error) {
        logger.error(`${TAG} Fatal error during expired manual-trial cleanup:`, error);
        throw error;
    }
}

module.exports = { downgradeExpiredManualTrials };
