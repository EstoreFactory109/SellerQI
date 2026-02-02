/**
 * SubscriptionVerificationService
 * 
 * This service verifies subscription status directly with Stripe/Razorpay APIs
 * before making any downgrade decisions. This prevents incorrect downgrades
 * when webhooks fail or are delayed.
 * 
 * The key principle: Don't downgrade a user to LITE if their subscription
 * is actually active with the payment gateway, even if the trial period
 * has technically ended according to our database.
 */

const Stripe = require('stripe');
const Razorpay = require('razorpay');
const Subscription = require('../../models/user-auth/SubscriptionModel');
const logger = require('../../utils/Logger');

class SubscriptionVerificationService {
    constructor() {
        // Initialize Stripe if configured
        if (process.env.STRIPE_SECRET_KEY) {
            this.stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
        } else {
            this.stripe = null;
            logger.warn('SubscriptionVerificationService: STRIPE_SECRET_KEY not set');
        }

        // Initialize Razorpay if configured
        if (process.env.RAZOR_PAY_ID && process.env.RAZOR_PAY_SECRET) {
            this.razorpay = new Razorpay({
                key_id: process.env.RAZOR_PAY_ID,
                key_secret: process.env.RAZOR_PAY_SECRET
            });
        } else {
            this.razorpay = null;
            logger.warn('SubscriptionVerificationService: Razorpay credentials not set');
        }
    }

    /**
     * Check if a user has an active paid subscription with the payment gateway.
     * This should be called BEFORE downgrading a user to LITE when their trial ends.
     * 
     * @param {string} userId - The user's MongoDB ID
     * @returns {Promise<Object>} - Verification result
     *   - hasActiveSubscription: boolean - Whether the user has an active paid subscription
     *   - gateway: string|null - 'stripe' or 'razorpay' or null
     *   - gatewayStatus: string|null - The raw status from the gateway
     *   - shouldDowngrade: boolean - Whether it's safe to downgrade the user
     *   - message: string - Human-readable explanation
     *   - subscriptionDetails: Object|null - Additional details from the gateway
     */
    async verifySubscriptionBeforeDowngrade(userId) {
        const result = {
            hasActiveSubscription: false,
            gateway: null,
            gatewayStatus: null,
            shouldDowngrade: true,
            message: 'No subscription found - safe to downgrade',
            subscriptionDetails: null
        };

        try {
            // Find the user's subscription in our database
            const subscription = await Subscription.findOne({ userId });

            if (!subscription) {
                logger.info(`SubscriptionVerification: No subscription record for user ${userId}`);
                return result;
            }

            // Determine which gateway to check
            const hasStripe = subscription.stripeSubscriptionId && this.stripe;
            const hasRazorpay = subscription.razorpaySubscriptionId && this.razorpay;

            if (!hasStripe && !hasRazorpay) {
                logger.info(`SubscriptionVerification: User ${userId} has subscription record but no gateway subscription ID`);
                return result;
            }

            // Check Stripe first if available
            if (hasStripe) {
                const stripeResult = await this.verifyStripeSubscription(subscription.stripeSubscriptionId, userId);
                if (stripeResult.hasActiveSubscription) {
                    return stripeResult;
                }
                // If Stripe subscription is not active, continue to check Razorpay if available
            }

            // Check Razorpay if available
            if (hasRazorpay) {
                const razorpayResult = await this.verifyRazorpaySubscription(subscription.razorpaySubscriptionId, userId);
                if (razorpayResult.hasActiveSubscription) {
                    return razorpayResult;
                }
                return razorpayResult;
            }

            // If we reach here, Stripe was checked and subscription is not active
            if (hasStripe) {
                return await this.verifyStripeSubscription(subscription.stripeSubscriptionId, userId);
            }

            return result;

        } catch (error) {
            logger.error(`SubscriptionVerification error for user ${userId}:`, error);
            // On error, we should NOT downgrade to be safe
            return {
                hasActiveSubscription: false,
                gateway: null,
                gatewayStatus: null,
                shouldDowngrade: false, // Don't downgrade on error - be safe
                message: `Verification failed: ${error.message}. Not downgrading to be safe.`,
                subscriptionDetails: null,
                error: error.message
            };
        }
    }

    /**
     * Verify subscription status with Stripe
     */
    async verifyStripeSubscription(stripeSubscriptionId, userId) {
        try {
            const stripeSubscription = await this.stripe.subscriptions.retrieve(stripeSubscriptionId);

            logger.info(`SubscriptionVerification: Stripe status for user ${userId}: ${stripeSubscription.status}`);

            // Active statuses where user should NOT be downgraded
            const activeStatuses = ['active', 'trialing', 'past_due'];
            const isActive = activeStatuses.includes(stripeSubscription.status);

            return {
                hasActiveSubscription: isActive,
                gateway: 'stripe',
                gatewayStatus: stripeSubscription.status,
                shouldDowngrade: !isActive,
                message: isActive 
                    ? `Stripe subscription is ${stripeSubscription.status} - DO NOT downgrade`
                    : `Stripe subscription is ${stripeSubscription.status} - safe to downgrade`,
                subscriptionDetails: {
                    id: stripeSubscription.id,
                    status: stripeSubscription.status,
                    currentPeriodEnd: stripeSubscription.current_period_end 
                        ? new Date(stripeSubscription.current_period_end * 1000) 
                        : null,
                    cancelAtPeriodEnd: stripeSubscription.cancel_at_period_end,
                    canceledAt: stripeSubscription.canceled_at 
                        ? new Date(stripeSubscription.canceled_at * 1000) 
                        : null
                }
            };

        } catch (error) {
            // Handle specific Stripe errors
            if (error.code === 'resource_missing') {
                logger.warn(`SubscriptionVerification: Stripe subscription ${stripeSubscriptionId} not found for user ${userId}`);
                return {
                    hasActiveSubscription: false,
                    gateway: 'stripe',
                    gatewayStatus: 'not_found',
                    shouldDowngrade: true,
                    message: 'Stripe subscription not found - safe to downgrade',
                    subscriptionDetails: null
                };
            }

            logger.error(`SubscriptionVerification: Stripe API error for user ${userId}:`, error);
            // On API error, don't downgrade to be safe
            return {
                hasActiveSubscription: false,
                gateway: 'stripe',
                gatewayStatus: 'error',
                shouldDowngrade: false, // Don't downgrade on error
                message: `Stripe API error: ${error.message}. Not downgrading to be safe.`,
                subscriptionDetails: null,
                error: error.message
            };
        }
    }

    /**
     * Verify subscription status with Razorpay
     */
    async verifyRazorpaySubscription(razorpaySubscriptionId, userId) {
        try {
            const razorpaySubscription = await this.razorpay.subscriptions.fetch(razorpaySubscriptionId);

            logger.info(`SubscriptionVerification: Razorpay status for user ${userId}: ${razorpaySubscription.status}`);

            // Active statuses where user should NOT be downgraded
            // Razorpay statuses: created, authenticated, active, pending, halted, cancelled, completed, expired
            const activeStatuses = ['active', 'authenticated', 'pending'];
            const isActive = activeStatuses.includes(razorpaySubscription.status);

            return {
                hasActiveSubscription: isActive,
                gateway: 'razorpay',
                gatewayStatus: razorpaySubscription.status,
                shouldDowngrade: !isActive,
                message: isActive 
                    ? `Razorpay subscription is ${razorpaySubscription.status} - DO NOT downgrade`
                    : `Razorpay subscription is ${razorpaySubscription.status} - safe to downgrade`,
                subscriptionDetails: {
                    id: razorpaySubscription.id,
                    status: razorpaySubscription.status,
                    currentStart: razorpaySubscription.current_start 
                        ? new Date(razorpaySubscription.current_start * 1000) 
                        : null,
                    currentEnd: razorpaySubscription.current_end 
                        ? new Date(razorpaySubscription.current_end * 1000) 
                        : null,
                    endedAt: razorpaySubscription.ended_at 
                        ? new Date(razorpaySubscription.ended_at * 1000) 
                        : null,
                    chargeAt: razorpaySubscription.charge_at 
                        ? new Date(razorpaySubscription.charge_at * 1000) 
                        : null
                }
            };

        } catch (error) {
            // Handle specific Razorpay errors
            const errorMessage = error.error?.description || error.message || 'Unknown error';
            
            if (errorMessage.includes('not found') || error.statusCode === 400) {
                logger.warn(`SubscriptionVerification: Razorpay subscription ${razorpaySubscriptionId} not found for user ${userId}`);
                return {
                    hasActiveSubscription: false,
                    gateway: 'razorpay',
                    gatewayStatus: 'not_found',
                    shouldDowngrade: true,
                    message: 'Razorpay subscription not found - safe to downgrade',
                    subscriptionDetails: null
                };
            }

            logger.error(`SubscriptionVerification: Razorpay API error for user ${userId}:`, error);
            // On API error, don't downgrade to be safe
            return {
                hasActiveSubscription: false,
                gateway: 'razorpay',
                gatewayStatus: 'error',
                shouldDowngrade: false, // Don't downgrade on error
                message: `Razorpay API error: ${errorMessage}. Not downgrading to be safe.`,
                subscriptionDetails: null,
                error: errorMessage
            };
        }
    }

    /**
     * Sync the local subscription record with the gateway's actual status.
     * Call this when the gateway confirms an active subscription but our DB says otherwise.
     * 
     * @param {string} userId - The user's MongoDB ID
     * @param {Object} verificationResult - Result from verifySubscriptionBeforeDowngrade
     * @param {Object} User - The User model (passed to avoid circular dependencies)
     * @returns {Promise<Object>} - Sync result
     */
    async syncSubscriptionFromGateway(userId, verificationResult, User) {
        if (!verificationResult.hasActiveSubscription) {
            return { synced: false, message: 'No active subscription to sync' };
        }

        try {
            const subscription = await Subscription.findOne({ userId });
            if (!subscription) {
                return { synced: false, message: 'No subscription record to update' };
            }

            // Determine status mapping from gateway status
            let status = 'active';
            let paymentStatus = 'paid';
            
            if (verificationResult.gateway === 'stripe') {
                if (verificationResult.gatewayStatus === 'trialing') {
                    status = 'trialing';
                    paymentStatus = 'no_payment_required';
                } else if (verificationResult.gatewayStatus === 'past_due') {
                    status = 'past_due';
                    paymentStatus = 'unpaid';
                }
            } else if (verificationResult.gateway === 'razorpay') {
                if (verificationResult.gatewayStatus === 'authenticated') {
                    status = 'trialing';
                    paymentStatus = 'no_payment_required';
                } else if (verificationResult.gatewayStatus === 'pending') {
                    status = 'past_due';
                    paymentStatus = 'pending';
                }
            }

            // Update subscription record
            const updateData = {
                status,
                paymentStatus
            };

            if (verificationResult.subscriptionDetails?.currentPeriodEnd) {
                updateData.currentPeriodEnd = verificationResult.subscriptionDetails.currentPeriodEnd;
                updateData.nextBillingDate = verificationResult.subscriptionDetails.currentPeriodEnd;
            }

            await Subscription.findOneAndUpdate({ userId }, { $set: updateData });

            // Update user record - keep their paid plan active
            const userUpdateData = {
                subscriptionStatus: status === 'trialing' ? 'trialing' : 'active',
                isInTrialPeriod: status === 'trialing'
            };

            // Only update trialEndsDate if we have reliable data
            if (status === 'trialing' && verificationResult.subscriptionDetails?.currentPeriodEnd) {
                userUpdateData.trialEndsDate = verificationResult.subscriptionDetails.currentPeriodEnd;
            }

            await User.findByIdAndUpdate(userId, userUpdateData);

            logger.info(`SubscriptionVerification: Synced subscription for user ${userId} - status: ${status}, gateway: ${verificationResult.gateway}`);

            return { 
                synced: true, 
                message: `Subscription synced from ${verificationResult.gateway}`,
                newStatus: status,
                newPaymentStatus: paymentStatus
            };

        } catch (error) {
            logger.error(`SubscriptionVerification: Sync error for user ${userId}:`, error);
            return { synced: false, message: `Sync failed: ${error.message}` };
        }
    }
}

// Export singleton instance
const subscriptionVerificationService = new SubscriptionVerificationService();

module.exports = subscriptionVerificationService;
