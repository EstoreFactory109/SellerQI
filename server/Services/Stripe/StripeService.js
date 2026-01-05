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
     * @param {string} userId - User ID
     * @param {string} planType - Plan type (PRO or AGENCY)
     * @param {string} successUrl - Success redirect URL
     * @param {string} cancelUrl - Cancel redirect URL
     * @param {string} [couponCode] - Optional coupon/promo code to apply
     */
    async createCheckoutSession(userId, planType, successUrl, cancelUrl, couponCode = null) {
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

            // Prepare checkout session options
            const sessionOptions = {
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
                // Enable promotion codes - allows users to enter coupon codes in Stripe checkout
                allow_promotion_codes: true,
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
            };

            // If a coupon code is provided, apply it automatically
            if (couponCode) {
                try {
                    // Verify the coupon exists and is valid
                    const coupon = await this.stripe.coupons.retrieve(couponCode);
                    if (coupon.valid) {
                        sessionOptions.discounts = [{ coupon: couponCode }];
                        logger.info(`Applying coupon code ${couponCode} to checkout session for user: ${userId}`);
                    } else {
                        logger.warn(`Invalid or expired coupon code ${couponCode} for user: ${userId}`);
                    }
                } catch (error) {
                    logger.warn(`Error applying coupon code ${couponCode}: ${error.message}`);
                    // Continue without coupon if it's invalid
                }
            }

            // Create checkout session
            const session = await this.stripe.checkout.sessions.create(sessionOptions);

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

            // Get user's current state BEFORE updating to determine if this is a trial upgrade
            const user = await User.findById(userId);
            if (!user) {
                throw new Error('User not found');
            }

            // Capture previous state to determine payment type
            const wasInTrial = user.isInTrialPeriod === true;
            const previousPackageType = user.packageType;
            const isTrialUpgrade = wasInTrial && previousPackageType === 'PRO';
            
            // Check if this is an upgrade (existing user) vs new signup
            // If user had LITE or PRO (trial), it's an upgrade → redirect to dashboard
            // If user had no package or this is first payment, it's new signup → redirect to connect-to-amazon
            const isUpgrade = previousPackageType === 'LITE' || previousPackageType === 'PRO' || wasInTrial;
            const isNewSignup = !previousPackageType || previousPackageType === null || (!isUpgrade && planType === 'PRO');

            logger.info(`User payment context: wasInTrial=${wasInTrial}, previousPackageType=${previousPackageType}, isTrialUpgrade=${isTrialUpgrade}, isUpgrade=${isUpgrade}, isNewSignup=${isNewSignup}`);

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

            // Get invoice URL if available
            let invoiceUrl = null;
            let invoicePdf = null;
            let invoiceId = null;
            let invoiceNumber = null;

            try {
                // Try to get invoice from subscription
                const invoices = await this.stripe.invoices.list({
                    subscription: stripeSubscription.id,
                    limit: 1
                });
                if (invoices.data.length > 0) {
                    const invoice = invoices.data[0];
                    invoiceUrl = invoice.hosted_invoice_url || null;
                    invoicePdf = invoice.invoice_pdf || null;
                    invoiceId = invoice.id;
                    invoiceNumber = invoice.number || null;
                }
            } catch (invoiceError) {
                logger.warn(`Could not fetch invoice for subscription: ${stripeSubscription.id}`);
            }

            // Add to payment history with invoice URLs
            await this.addPaymentHistory(userId, {
                sessionId: sessionId,
                amount: priceItem.price.unit_amount,
                currency: priceItem.price.currency,
                status: 'paid',
                stripePaymentIntentId: session.payment_intent,
                stripeInvoiceId: invoiceId,
                invoiceUrl: invoiceUrl,
                invoicePdf: invoicePdf,
                invoiceNumber: invoiceNumber,
                paymentGateway: 'stripe'
            });

            logger.info(`Successfully processed payment for user: ${userId}, plan: ${planType}`);
            
            return { 
                success: true, 
                planType, 
                userId, 
                adminToken,
                isTrialUpgrade: isTrialUpgrade,  // Flag to indicate if user upgraded from trial
                isUpgrade: isUpgrade, // Flag to indicate if this is an upgrade (existing user)
                isNewSignup: isNewSignup // Flag to indicate if this is a new signup
            };

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
     * Get invoice download URL for a payment
     * @param {string} userId - User ID
     * @param {string} paymentIntentId - Stripe payment intent ID or invoice ID
     * @returns {Promise<{invoiceUrl: string, invoicePdf: string}>}
     */
    async getInvoiceDownloadUrl(userId, paymentIntentId) {
        try {
            // Find subscription to verify user ownership
            const subscription = await Subscription.findOne({ userId });
            if (!subscription) {
                throw new Error('Subscription not found');
            }

            let actualPaymentIntentId = paymentIntentId;
            
            // Check if the ID is a checkout session ID (starts with cs_)
            // If so, retrieve the checkout session to get the payment intent
            if (paymentIntentId && paymentIntentId.startsWith('cs_')) {
                try {
                    logger.info(`Detected checkout session ID, retrieving session: ${paymentIntentId}`);
                    const session = await this.stripe.checkout.sessions.retrieve(paymentIntentId, {
                        expand: ['payment_intent']
                    });
                    
                    // Get payment intent from session
                    if (session.payment_intent) {
                        if (typeof session.payment_intent === 'string') {
                            actualPaymentIntentId = session.payment_intent;
                        } else {
                            actualPaymentIntentId = session.payment_intent.id;
                        }
                        logger.info(`Retrieved payment intent from checkout session: ${actualPaymentIntentId}`);
                    } else {
                        // Try to get from subscription if available
                        if (session.subscription) {
                            const subId = typeof session.subscription === 'string' ? session.subscription : session.subscription.id;
                            logger.info(`Checkout session has subscription, will search invoices by subscription: ${subId}`);
                            // We'll search by subscription ID instead
                            actualPaymentIntentId = null;
                        } else {
                            throw new Error('No payment intent found in checkout session');
                        }
                    }
                } catch (sessionError) {
                    logger.error(`Error retrieving checkout session: ${sessionError.message}`);
                    throw new Error(`Invalid checkout session ID: ${paymentIntentId}`);
                }
            }

            // Try to find invoice by payment intent ID first
            let invoice = null;
            
            if (actualPaymentIntentId) {
                try {
                    const invoices = await this.stripe.invoices.list({
                        payment_intent: actualPaymentIntentId,
                        limit: 1
                    });
                    if (invoices.data.length > 0) {
                        invoice = invoices.data[0];
                        logger.info(`Found invoice via payment_intent lookup: ${invoice.id}`);
                    }
                } catch (error) {
                    logger.warn(`Payment intent lookup failed for ${actualPaymentIntentId}, trying direct invoice ID:`, error.message);
                    // If payment intent lookup fails, try direct invoice ID
                    try {
                        invoice = await this.stripe.invoices.retrieve(actualPaymentIntentId);
                        logger.info(`Found invoice via direct retrieve: ${invoice.id}`);
                    } catch (retrieveError) {
                        logger.warn(`Could not find invoice for paymentIntentId: ${actualPaymentIntentId}`, retrieveError.message);
                    }
                }
            }
            
            // If no invoice found and we have a subscription, try searching by subscription
            if (!invoice && subscription.stripeSubscriptionId) {
                try {
                    logger.info(`Searching for invoices by subscription ID: ${subscription.stripeSubscriptionId}`);
                    const invoices = await this.stripe.invoices.list({
                        subscription: subscription.stripeSubscriptionId,
                        limit: 10
                    });
                    // Get the most recent paid invoice
                    const paidInvoices = invoices.data.filter(inv => inv.status === 'paid');
                    if (paidInvoices.length > 0) {
                        // Sort by created date, most recent first
                        paidInvoices.sort((a, b) => b.created - a.created);
                        invoice = paidInvoices[0];
                        logger.info(`Found invoice via subscription lookup: ${invoice.id}`);
                    }
                } catch (subError) {
                    logger.warn(`Could not find invoice by subscription: ${subError.message}`);
                }
            }

            if (!invoice) {
                throw new Error(`Invoice not found for paymentIntentId: ${paymentIntentId}`);
            }

            // Verify invoice belongs to user's subscription
            if (subscription.stripeSubscriptionId && invoice.subscription !== subscription.stripeSubscriptionId) {
                logger.warn(`Invoice ${invoice.id} does not match user's subscription ${subscription.stripeSubscriptionId}`);
                throw new Error('Invoice does not belong to user');
            }

            // Check if invoice PDF is available
            // Note: invoice_pdf is only available after invoice is finalized and paid
            if (!invoice.invoice_pdf && invoice.status !== 'paid') {
                logger.warn(`Invoice ${invoice.id} PDF not available yet. Status: ${invoice.status}`);
            }

            const result = {
                invoiceUrl: invoice.hosted_invoice_url || null,
                invoicePdf: invoice.invoice_pdf || null,
                invoiceNumber: invoice.number || null,
                invoiceId: invoice.id
            };

            logger.info(`Invoice download URL retrieved for user ${userId}: invoice ${invoice.id}, PDF available: ${!!invoice.invoice_pdf}`);

            return result;

        } catch (error) {
            logger.error('Error getting invoice download URL:', {
                error: error.message,
                userId: userId,
                paymentIntentId: paymentIntentId,
                stack: error.stack
            });
            throw error;
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