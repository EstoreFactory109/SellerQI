// Stripe integration for payment processing
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Subscription = require('../../models/user-auth/SubscriptionModel');
const User = require('../../models/user-auth/userModel');
const logger = require('../../utils/Logger');
const { createAccessToken } = require('../../utils/Tokens');

class StripeService {
    constructor() {
        this.stripe = stripe;
        if (!process.env.STRIPE_SECRET_KEY) {
            logger.warn('STRIPE_SECRET_KEY is not set. Stripe functionality will not work.');
        }
    }

    /**
     * Safe date conversion from Unix timestamp
     */
    safeDate(timestamp) {
        if (!timestamp || typeof timestamp !== 'number' || isNaN(timestamp)) {
            return null;
        }
        
        const date = new Date(timestamp * 1000);
        const isValidDate = !isNaN(date.getTime());
        
        return isValidDate ? date : null;
    }

    /**
     * Create or get existing Stripe customer
     */
    async createOrGetCustomer(userId, email, name) {
        try {
            // Check if user already has a subscription with Stripe customer ID
            const existingSubscription = await Subscription.findOne({ userId });
            
            if (existingSubscription && existingSubscription.stripeCustomerId) {
                // Verify customer exists in Stripe
                try {
                    const customer = await this.stripe.customers.retrieve(existingSubscription.stripeCustomerId);
                    return customer;
                } catch (error) {
                    logger.warn(`Stripe customer not found: ${existingSubscription.stripeCustomerId}`);
                }
            }

            // Create new customer
            const customer = await this.stripe.customers.create({
                email: email,
                name: name,
                metadata: {
                    userId: userId.toString()
                }
            });

            logger.info(`Created Stripe customer: ${customer.id} for user: ${userId}`);
            return customer;

        } catch (error) {
            logger.error('Error creating/getting Stripe customer:', error);
            throw new Error('Failed to create customer');
        }
    }

    /**
     * Create checkout session for subscription
     */
    async createCheckoutSession(userId, planType, successUrl, cancelUrl) {
        try {
            // Check if Stripe is configured
            if (!process.env.STRIPE_SECRET_KEY) {
                throw new Error('STRIPE_SECRET_KEY is not configured. Please set it in environment variables.');
            }

            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Get price ID based on plan type
            let priceId;
            switch (planType) {
                case 'PRO':
                    priceId = process.env.STRIPE_PRO_PRICE_ID;
                    break;
                case 'AGENCY':
                    priceId = process.env.STRIPE_AGENCY_PRICE_ID;
                    break;
                default:
                    throw new Error('Invalid plan type for Stripe checkout');
            }

            if (!priceId) {
                throw new Error(`STRIPE_${planType}_PRICE_ID is not configured. Please set it in environment variables.`);
            }

            // Create or get customer
            const customer = await this.createOrGetCustomer(
                userId, 
                user.email, 
                `${user.firstName} ${user.lastName}`
            );

            // Create checkout session
            const session = await this.stripe.checkout.sessions.create({
                customer: customer.id,
                payment_method_types: ['card'],
                line_items: [
                    {
                        price: priceId,
                        quantity: 1,
                    },
                ],
                mode: 'subscription',
                success_url: successUrl,
                cancel_url: cancelUrl,
                metadata: {
                    userId: userId.toString(),
                    planType: planType,
                },
                subscription_data: {
                    metadata: {
                        userId: userId.toString(),
                        planType: planType,
                    },
                },
            });

            // Save session info to subscription
            await this.updateOrCreateSubscription(userId, {
                stripeCustomerId: customer.id,
                stripeSessionId: session.id,
                planType: planType,
                stripePriceId: priceId,
                status: 'incomplete',
                paymentStatus: 'pending'
            });

            logger.info(`Created checkout session: ${session.id} for user: ${userId}, plan: ${planType}`);
            
            return {
                sessionId: session.id,
                url: session.url
            };

        } catch (error) {
            logger.error('Error creating checkout session:', error);
            throw error;
        }
    }

    /**
     * Update or create subscription record
     */
    async updateOrCreateSubscription(userId, updateData) {
        try {
            logger.info(`Updating subscription for user: ${userId}`);
            logger.debug(`Update data:`, JSON.stringify(updateData, null, 2));
            
            const subscription = await Subscription.findOneAndUpdate(
                { userId },
                updateData,
                { 
                    new: true, 
                    upsert: true,
                    runValidators: true 
                }
            );

            logger.info(`Successfully updated subscription for user: ${userId}, subscription ID: ${subscription._id}`);
            return subscription;

        } catch (error) {
            logger.error(`Error updating subscription for user ${userId}:`, error);
            
            // Log specific validation errors
            if (error.name === 'ValidationError') {
                logger.error('Validation errors:', error.errors);
                for (const field in error.errors) {
                    logger.error(`Field ${field}: ${error.errors[field].message}`);
                }
            }
            
            throw error;
        }
    }

    /**
     * Handle successful payment
     */
    async handleSuccessfulPayment(sessionId) {
        try {
            logger.info(`Processing payment success for session: ${sessionId}`);
            
            // Retrieve the session from Stripe
            const session = await this.stripe.checkout.sessions.retrieve(sessionId, {
                expand: ['subscription', 'customer']
            });

            logger.info(`Retrieved session: ${session.id}, payment_status: ${session.payment_status}`);

            if (!session.subscription) {
                throw new Error('No subscription found in session');
            }

            const userId = session.metadata.userId;
            const planType = session.metadata.planType;

            if (!userId || !planType) {
                throw new Error('Missing userId or planType in session metadata');
            }

            logger.info(`Processing for user: ${userId}, plan: ${planType}`);

            // Get subscription details from Stripe
            const stripeSubscription = session.subscription;
            
            // Validate subscription data
            if (!stripeSubscription.items || !stripeSubscription.items.data || stripeSubscription.items.data.length === 0) {
                throw new Error('No subscription items found');
            }

            const priceItem = stripeSubscription.items.data[0];
            if (!priceItem.price) {
                throw new Error('No price information found in subscription');
            }

            logger.info(`Subscription details: status=${stripeSubscription.status}, period_start=${stripeSubscription.current_period_start}, period_end=${stripeSubscription.current_period_end}`);
            
            // Update subscription in our database
            const subscriptionData = {
                stripeCustomerId: session.customer.id,
                stripeSubscriptionId: stripeSubscription.id,
                stripeSessionId: sessionId,
                planType: planType,
                stripePriceId: priceItem.price.id,
                status: stripeSubscription.status,
                paymentStatus: 'paid',
                amount: priceItem.price.unit_amount,
                currency: priceItem.price.currency,
                currentPeriodStart: this.safeDate(stripeSubscription.current_period_start),
                currentPeriodEnd: this.safeDate(stripeSubscription.current_period_end),
                lastPaymentDate: new Date(),
                nextBillingDate: this.safeDate(stripeSubscription.current_period_end),
            };

            // Validate subscription data before saving
            for (const [key, value] of Object.entries(subscriptionData)) {
                if (value instanceof Date && isNaN(value.getTime())) {
                    logger.error(`Invalid date found in ${key}: ${value}`);
                    throw new Error(`Invalid date in field ${key}: ${value}`);
                }
            }

            logger.info(`Subscription data prepared for user: ${userId}`);

            await this.updateOrCreateSubscription(userId, subscriptionData);

            // Update user's package type, subscription status, and access type
            const updateData = {
                packageType: planType,
                subscriptionStatus: stripeSubscription.status,
                isInTrialPeriod: false // User has now paid, no longer in trial
            };
            
            // If user purchased AGENCY plan, update accessType to enterpriseAdmin
            if (planType === 'AGENCY') {
                updateData.accessType = 'enterpriseAdmin';
            }
            
            await User.findByIdAndUpdate(userId, updateData);
            
            logger.info(`Updated user ${userId}: packageType=${planType}, subscriptionStatus=${stripeSubscription.status}, isInTrialPeriod=false`);

            // Create admin token for AGENCY users
            let adminToken = null;
            if (planType === 'AGENCY') {
                try {
                    adminToken = await createAccessToken(userId);
                    logger.info(`Admin token created for AGENCY user: ${userId}`);
                } catch (error) {
                    logger.error(`Error creating admin token for user ${userId}:`, error);
                    // Don't fail the payment if token creation fails
                }
            }

            // Add to payment history
            await this.addPaymentHistory(userId, {
                sessionId: sessionId,
                amount: priceItem.price.unit_amount,
                currency: priceItem.price.currency,
                status: 'paid',
                stripePaymentIntentId: session.payment_intent
            });

            logger.info(`Successfully processed payment for user: ${userId}, plan: ${planType}`);
            
            return { success: true, planType, userId, adminToken };

        } catch (error) {
            logger.error('Error handling successful payment:', error);
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
                        paymentHistory: paymentData 
                    } 
                }
            );
        } catch (error) {
            logger.error('Error adding payment history:', error);
        }
    }

    /**
     * Cancel subscription
     */
    async cancelSubscription(userId, cancelAtPeriodEnd = true) {
        try {
            const subscription = await Subscription.findOne({ userId });
            
            if (!subscription || !subscription.stripeSubscriptionId) {
                throw new Error('No active subscription found');
            }

            // Cancel in Stripe
            let updatedSubscription;
            if (cancelAtPeriodEnd) {
                // Schedule cancellation at period end
                updatedSubscription = await this.stripe.subscriptions.update(
                    subscription.stripeSubscriptionId,
                    {
                        cancel_at_period_end: true
                    }
                );
            } else {
                // Cancel immediately
                updatedSubscription = await this.stripe.subscriptions.cancel(
                    subscription.stripeSubscriptionId
                );
            }

            // Update our database
            await Subscription.findOneAndUpdate(
                { userId },
                {
                    cancelAtPeriodEnd: cancelAtPeriodEnd,
                    status: cancelAtPeriodEnd ? 'active' : 'cancelled'
                }
            );

            // Update user status if immediately cancelled
            if (!cancelAtPeriodEnd) {
                await User.findByIdAndUpdate(userId, {
                    packageType: 'LITE',
                    subscriptionStatus: 'cancelled'
                });
            }

            logger.info(`Subscription ${cancelAtPeriodEnd ? 'scheduled for cancellation' : 'cancelled'} for user: ${userId}`);
            
            return { success: true, cancelAtPeriodEnd };

        } catch (error) {
            logger.error('Error cancelling subscription:', error);
            throw error;
        }
    }

    /**
     * Get subscription details
     */
    async getSubscription(userId) {
        try {
            const subscription = await Subscription.findOne({ userId });
            return subscription;
        } catch (error) {
            logger.error('Error getting subscription:', error);
            throw error;
        }
    }

    /**
     * Reactivate cancelled subscription
     */
    async reactivateSubscription(userId) {
        try {
            const subscription = await Subscription.findOne({ userId });
            
            if (!subscription || !subscription.stripeSubscriptionId) {
                throw new Error('No subscription found');
            }

            // Reactivate in Stripe
            const updatedSubscription = await this.stripe.subscriptions.update(
                subscription.stripeSubscriptionId,
                {
                    cancel_at_period_end: false
                }
            );

            // Update our database
            await Subscription.findOneAndUpdate(
                { userId },
                {
                    cancelAtPeriodEnd: false,
                    status: updatedSubscription.status
                }
            );

            logger.info(`Subscription reactivated for user: ${userId}`);
            
            return { success: true };

        } catch (error) {
            logger.error('Error reactivating subscription:', error);
            throw error;
        }
    }
}

module.exports = new StripeService(); 