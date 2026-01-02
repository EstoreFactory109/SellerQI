// Razorpay integration for payment processing (India)
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Subscription = require('../../models/user-auth/SubscriptionModel');
const User = require('../../models/user-auth/userModel');
const logger = require('../../utils/Logger');

class RazorpayService {
    constructor() {
        if (!process.env.RAZOR_PAY_ID || !process.env.RAZOR_PAY_SECRET) {
            logger.warn('Razorpay credentials not set. Razorpay functionality will not work.');
            this.razorpay = null;
        } else {
            this.razorpay = new Razorpay({
                key_id: process.env.RAZOR_PAY_ID,
                key_secret: process.env.RAZOR_PAY_SECRET
            });
        }
    }

    /**
     * Check if Razorpay is configured
     */
    isConfigured() {
        return this.razorpay !== null;
    }

    /**
     * Get Plan ID based on plan type
     */
    getPlanId(planType) {
        switch (planType) {
            case 'PRO':
                return process.env.RAZOR_PAY_PLAN_ID;
            default:
                return null;
        }
    }

    /**
     * Create Razorpay subscription using Plan ID
     */
    async createOrder(userId, planType) {
        try {
            if (!this.isConfigured()) {
                throw new Error('Razorpay is not configured');
            }

            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Get Plan ID from environment
            const planId = this.getPlanId(planType);
            if (!planId) {
                throw new Error(`Plan ID not configured for: ${planType}. Only PRO plan is available for India.`);
            }

            // Create Razorpay subscription using the Plan ID
            const subscriptionOptions = {
                plan_id: planId,
                customer_notify: 1,
                total_count: 12, // 12 billing cycles (1 year)
                notes: {
                    userId: userId.toString(),
                    planType: planType,
                    email: user.email
                }
            };

            const razorpaySubscription = await this.razorpay.subscriptions.create(subscriptionOptions);

            logger.info(`Razorpay subscription created: ${razorpaySubscription.id} for user: ${userId}, plan: ${planType}`);

            // Save subscription info (pending state)
            await this.updateOrCreateSubscription(userId, {
                razorpaySubscriptionId: razorpaySubscription.id,
                planType: planType,
                status: 'incomplete',
                paymentStatus: 'pending',
                paymentGateway: 'razorpay',
                currency: 'inr'
            });

            return {
                subscriptionId: razorpaySubscription.id,
                keyId: process.env.RAZOR_PAY_ID,
                planName: 'Pro Plan',
                description: 'SellerQI Pro Plan - Monthly Subscription',
                prefill: {
                    name: `${user.firstName} ${user.lastName}`,
                    email: user.email,
                    contact: user.phone || ''
                }
            };

        } catch (error) {
            logger.error('Error creating Razorpay subscription:', error);
            throw error;
        }
    }

    /**
     * Verify Razorpay subscription payment signature
     * For subscriptions: razorpay_payment_id + '|' + razorpay_subscription_id
     */
    verifySubscriptionSignature(paymentId, subscriptionId, signature) {
        try {
            const body = paymentId + '|' + subscriptionId;
            const expectedSignature = crypto
                .createHmac('sha256', process.env.RAZOR_PAY_SECRET)
                .update(body.toString())
                .digest('hex');

            const isValid = expectedSignature === signature;
            
            if (!isValid) {
                logger.warn(`Invalid Razorpay signature for subscription: ${subscriptionId}`);
            }

            return isValid;
        } catch (error) {
            logger.error('Error verifying Razorpay signature:', error);
            return false;
        }
    }

    /**
     * Handle successful subscription payment verification
     */
    async handlePaymentSuccess(razorpaySubscriptionId, paymentId, signature, userId) {
        try {
            // Verify signature for subscription
            const isValid = this.verifySubscriptionSignature(paymentId, razorpaySubscriptionId, signature);
            if (!isValid) {
                throw new Error('Invalid payment signature');
            }

            // Get subscription record by Razorpay subscription ID
            const subscription = await Subscription.findOne({ 
                userId, 
                razorpaySubscriptionId: razorpaySubscriptionId 
            });

            if (!subscription) {
                throw new Error('Subscription not found');
            }

            const planType = subscription.planType;

            // Fetch subscription details from Razorpay to get billing cycle dates
            let currentPeriodStart = new Date();
            let currentPeriodEnd = new Date();
            
            try {
                const razorpaySub = await this.razorpay.subscriptions.fetch(razorpaySubscriptionId);
                if (razorpaySub.current_start) {
                    currentPeriodStart = new Date(razorpaySub.current_start * 1000);
                }
                if (razorpaySub.current_end) {
                    currentPeriodEnd = new Date(razorpaySub.current_end * 1000);
                }
            } catch (fetchError) {
                logger.warn('Could not fetch Razorpay subscription details, using default dates:', fetchError.message);
                currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
            }

            // Update subscription with payment details
            const subscriptionData = {
                razorpayPaymentId: paymentId,
                razorpaySignature: signature,
                status: 'active',
                paymentStatus: 'paid',
                currentPeriodStart: currentPeriodStart,
                currentPeriodEnd: currentPeriodEnd,
                lastPaymentDate: new Date(),
                nextBillingDate: currentPeriodEnd
            };

            await Subscription.findOneAndUpdate(
                { userId, razorpaySubscriptionId: razorpaySubscriptionId },
                subscriptionData
            );

            // Update user's package type
            const updateData = {
                packageType: planType,
                subscriptionStatus: 'active',
                isInTrialPeriod: false
            };

            // If user purchased AGENCY plan, update accessType
            if (planType === 'AGENCY') {
                updateData.accessType = 'enterpriseAdmin';
            }

            await User.findByIdAndUpdate(userId, updateData);

            // Add to payment history
            await this.addPaymentHistory(userId, {
                orderId: orderId,
                paymentId: paymentId,
                amount: subscription.amount,
                currency: subscription.currency,
                status: 'paid',
                razorpayPaymentId: paymentId,
                paymentGateway: 'razorpay'
            });

            logger.info(`Razorpay payment successful for user: ${userId}, order: ${orderId}, plan: ${planType}`);

            return { 
                success: true, 
                planType, 
                userId,
                message: 'Payment verified and subscription activated successfully'
            };

        } catch (error) {
            logger.error('Error handling Razorpay payment success:', error);
            throw error;
        }
    }

    /**
     * Update or create subscription record
     */
    async updateOrCreateSubscription(userId, updateData) {
        try {
            logger.info(`Updating subscription for user: ${userId}`);
            
            const subscription = await Subscription.findOneAndUpdate(
                { userId },
                updateData,
                { 
                    new: true, 
                    upsert: true,
                    runValidators: true 
                }
            );

            logger.info(`Successfully updated subscription for user: ${userId}`);
            return subscription;

        } catch (error) {
            logger.error(`Error updating subscription for user ${userId}:`, error);
            throw error;
        }
    }

    /**
     * Add payment to history
     */
    async addPaymentHistory(userId, paymentData) {
        try {
            await Subscription.findOneAndUpdate(
                { userId },
                { 
                    $push: { 
                        paymentHistory: {
                            ...paymentData,
                            paymentDate: new Date()
                        }
                    } 
                }
            );
        } catch (error) {
            logger.error('Error adding payment history:', error);
        }
    }

    /**
     * Get Razorpay configuration for frontend
     */
    getConfig() {
        return {
            keyId: process.env.RAZOR_PAY_ID,
            plans: {
                PRO: {
                    planId: process.env.RAZOR_PAY_PLAN_ID,
                    name: 'Pro Plan',
                    displayAmount: '₹1,999'
                }
            }
        };
    }

    /**
     * Handle webhook events from Razorpay
     */
    async handleWebhook(event, payload) {
        try {
            logger.info(`Razorpay webhook received: ${event}`);

            switch (event) {
                case 'subscription.authenticated':
                    logger.info('Subscription authenticated:', payload);
                    break;
                case 'subscription.activated':
                    await this.handleSubscriptionActivated(payload);
                    break;
                case 'subscription.charged':
                    await this.handleSubscriptionCharged(payload);
                    break;
                case 'subscription.cancelled':
                    await this.handleSubscriptionCancelled(payload);
                    break;
                case 'payment.captured':
                    await this.handlePaymentCaptured(payload);
                    break;
                case 'payment.failed':
                    await this.handlePaymentFailed(payload);
                    break;
                default:
                    logger.info(`Unhandled Razorpay webhook event: ${event}`);
            }

            return { success: true };

        } catch (error) {
            logger.error('Error handling Razorpay webhook:', error);
            throw error;
        }
    }

    /**
     * Handle subscription.activated webhook event
     */
    async handleSubscriptionActivated(payload) {
        try {
            const subscription = payload.subscription.entity;
            const subscriptionId = subscription.id;

            logger.info(`Razorpay subscription activated: ${subscriptionId}`);

            // Find subscription by Razorpay subscription ID
            const dbSubscription = await Subscription.findOne({ razorpaySubscriptionId: subscriptionId });
            
            if (dbSubscription) {
                await Subscription.findOneAndUpdate(
                    { razorpaySubscriptionId: subscriptionId },
                    {
                        status: 'active',
                        paymentStatus: 'paid',
                        currentPeriodStart: subscription.current_start ? new Date(subscription.current_start * 1000) : new Date(),
                        currentPeriodEnd: subscription.current_end ? new Date(subscription.current_end * 1000) : null
                    }
                );

                // Update user's package type
                await User.findByIdAndUpdate(dbSubscription.userId, {
                    packageType: dbSubscription.planType,
                    subscriptionStatus: 'active',
                    isInTrialPeriod: false
                });

                logger.info(`Subscription activated via webhook: ${subscriptionId}`);
            }

        } catch (error) {
            logger.error('Error handling subscription.activated webhook:', error);
            throw error;
        }
    }

    /**
     * Handle subscription.charged webhook event (recurring payment)
     */
    async handleSubscriptionCharged(payload) {
        try {
            const subscription = payload.subscription.entity;
            const payment = payload.payment.entity;
            const subscriptionId = subscription.id;
            const paymentId = payment.id;

            logger.info(`Razorpay subscription charged: ${subscriptionId}, payment: ${paymentId}`);

            // Find subscription by Razorpay subscription ID
            const dbSubscription = await Subscription.findOne({ razorpaySubscriptionId: subscriptionId });
            
            if (dbSubscription) {
                // Update subscription dates
                await Subscription.findOneAndUpdate(
                    { razorpaySubscriptionId: subscriptionId },
                    {
                        razorpayPaymentId: paymentId,
                        status: 'active',
                        paymentStatus: 'paid',
                        currentPeriodStart: subscription.current_start ? new Date(subscription.current_start * 1000) : new Date(),
                        currentPeriodEnd: subscription.current_end ? new Date(subscription.current_end * 1000) : null,
                        lastPaymentDate: new Date(),
                        nextBillingDate: subscription.current_end ? new Date(subscription.current_end * 1000) : null
                    }
                );

                // Add to payment history
                await this.addPaymentHistory(dbSubscription.userId, {
                    subscriptionId: subscriptionId,
                    paymentId: paymentId,
                    amount: payment.amount,
                    currency: payment.currency,
                    status: 'paid',
                    razorpayPaymentId: paymentId,
                    paymentGateway: 'razorpay'
                });

                logger.info(`Subscription payment recorded via webhook: ${subscriptionId}`);
            }

        } catch (error) {
            logger.error('Error handling subscription.charged webhook:', error);
            throw error;
        }
    }

    /**
     * Handle subscription.cancelled webhook event
     */
    async handleSubscriptionCancelled(payload) {
        try {
            const subscription = payload.subscription.entity;
            const subscriptionId = subscription.id;

            logger.info(`Razorpay subscription cancelled: ${subscriptionId}`);

            // Find subscription by Razorpay subscription ID
            const dbSubscription = await Subscription.findOne({ razorpaySubscriptionId: subscriptionId });
            
            if (dbSubscription) {
                await Subscription.findOneAndUpdate(
                    { razorpaySubscriptionId: subscriptionId },
                    {
                        status: 'cancelled',
                        cancelAtPeriodEnd: false
                    }
                );

                // Update user's package type to LITE
                await User.findByIdAndUpdate(dbSubscription.userId, {
                    packageType: 'LITE',
                    subscriptionStatus: 'cancelled'
                });

                logger.info(`Subscription cancelled via webhook: ${subscriptionId}`);
            }

        } catch (error) {
            logger.error('Error handling subscription.cancelled webhook:', error);
            throw error;
        }
    }

    /**
     * Handle payment.captured webhook event
     */
    async handlePaymentCaptured(payload) {
        try {
            const payment = payload.payment.entity;
            const paymentId = payment.id;

            logger.info(`Razorpay payment captured: ${paymentId}`);

            // For subscription payments, the subscription.charged event handles this
            // This is a fallback for any direct payment captures

        } catch (error) {
            logger.error('Error handling payment.captured webhook:', error);
            throw error;
        }
    }

    /**
     * Handle payment.failed webhook event
     */
    async handlePaymentFailed(payload) {
        try {
            const payment = payload.payment.entity;
            const paymentId = payment.id;

            logger.info(`Razorpay payment failed: ${paymentId}`);

            // If this is a subscription payment failure, update status
            if (payment.subscription_id) {
                await Subscription.findOneAndUpdate(
                    { razorpaySubscriptionId: payment.subscription_id },
                    {
                        status: 'past_due',
                        paymentStatus: 'unpaid'
                    }
                );
            }

        } catch (error) {
            logger.error('Error handling payment.failed webhook:', error);
            throw error;
        }
    }

    /**
     * Verify webhook signature
     */
    verifyWebhookSignature(body, signature, secret) {
        try {
            const expectedSignature = crypto
                .createHmac('sha256', secret)
                .update(body)
                .digest('hex');

            return expectedSignature === signature;
        } catch (error) {
            logger.error('Error verifying webhook signature:', error);
            return false;
        }
    }
}

module.exports = new RazorpayService();

