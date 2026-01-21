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
     * @param {number} [trialPeriodDays] - Optional trial period in days (only for PRO plan)
     */
    async createCheckoutSession(userId, planType, successUrl, cancelUrl, couponCode = null, trialPeriodDays = null) {
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
                    hasTrial: trialPeriodDays && trialPeriodDays > 0 ? 'true' : 'false',
                },
                subscription_data: {
                    metadata: {
                        userId: userId.toString(),
                        planType: planType,
                        hasTrial: trialPeriodDays && trialPeriodDays > 0 ? 'true' : 'false',
                    },
                },
            };

            // Add trial period if specified (only for PRO plan)
            // When trial_period_days is set, Stripe will:
            // 1. Collect payment method during checkout
            // 2. Not charge immediately
            // 3. Automatically charge when trial ends
            if (trialPeriodDays && trialPeriodDays > 0 && planType === 'PRO') {
                sessionOptions.subscription_data.trial_period_days = trialPeriodDays;
                logger.info(`Adding ${trialPeriodDays}-day trial period to checkout session for user: ${userId}. Payment will be collected but not charged until trial ends.`);
            }

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

            const trialInfo = trialPeriodDays && trialPeriodDays > 0 && planType === 'PRO' ? `, trial: ${trialPeriodDays} days` : '';
            logger.info(`Created checkout session: ${session.id} for user: ${userId}, plan: ${planType}${trialInfo}`);
            
            return {
                sessionId: session.id,
                url: session.url,
                hasTrial: trialPeriodDays && trialPeriodDays > 0 && planType === 'PRO',
                trialDays: trialPeriodDays && planType === 'PRO' ? trialPeriodDays : null
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
            
            // Use $set explicitly to ensure payment status is updated correctly
            const subscription = await Subscription.findOneAndUpdate(
                { userId },
                { $set: updateData },
                { 
                    new: true, 
                    upsert: true,
                    runValidators: true 
                }
            );

            if (!subscription) {
                logger.error(`Failed to update subscription for user: ${userId}`);
                throw new Error('Failed to update subscription');
            }

            logger.info(`Successfully updated subscription for user: ${userId}, subscription ID: ${subscription._id}, paymentStatus: ${subscription.paymentStatus}`);
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

            // Check if subscription is in trial period (Stripe native trial)
            const isTrialing = stripeSubscription.status === 'trialing';
            logger.info(`Subscription details: status=${stripeSubscription.status}, isTrialing=${isTrialing}, period_start=${stripeSubscription.current_period_start}, period_end=${stripeSubscription.current_period_end}, trial_end=${stripeSubscription.trial_end || 'N/A'}`);
            
            // Update subscription in our database
            const subscriptionData = {
                stripeCustomerId: session.customer.id,
                stripeSubscriptionId: stripeSubscription.id,
                stripeSessionId: sessionId,
                planType: planType,
                stripePriceId: priceItem.price.id,
                status: stripeSubscription.status, // Will be 'trialing' if in trial
                paymentStatus: isTrialing ? 'no_payment_required' : 'paid',
                amount: priceItem.price.unit_amount,
                currency: priceItem.price.currency,
                currentPeriodStart: this.safeDate(stripeSubscription.current_period_start),
                currentPeriodEnd: this.safeDate(stripeSubscription.current_period_end),
                lastPaymentDate: isTrialing ? null : new Date(), // No payment date during trial
                nextBillingDate: this.safeDate(stripeSubscription.trial_end || stripeSubscription.current_period_end),
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
                isInTrialPeriod: isTrialing, // Set based on Stripe subscription status
            };
            
            // If subscription is in trial, set trial end date
            if (isTrialing && stripeSubscription.trial_end) {
                updateData.trialEndsDate = this.safeDate(stripeSubscription.trial_end);
                logger.info(`User ${userId} is in trial period. Trial ends on ${updateData.trialEndsDate}`);
            } else {
                updateData.isInTrialPeriod = false;
            }
            
            // If user purchased AGENCY plan, update accessType to enterpriseAdmin
            if (planType === 'AGENCY') {
                updateData.accessType = 'enterpriseAdmin';
            }
            
            await User.findByIdAndUpdate(userId, updateData);
            
            logger.info(`Updated user ${userId}: packageType=${planType}, subscriptionStatus=${stripeSubscription.status}, isInTrialPeriod=${updateData.isInTrialPeriod}`);

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

            // Get invoice URL if available (won't be available during trial)
            let invoiceUrl = null;
            let invoicePdf = null;
            let invoiceId = null;
            let invoiceNumber = null;

            if (!isTrialing) {
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

                // Add to payment history with invoice URLs (only if not in trial)
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
            }

            logger.info(`Successfully processed payment for user: ${userId}, plan: ${planType}, isTrialing: ${isTrialing}`);
            
            return { 
                success: true, 
                planType, 
                userId, 
                adminToken,
                isTrialUpgrade: isTrialUpgrade,  // Flag to indicate if user upgraded from trial
                isUpgrade: isUpgrade, // Flag to indicate if this is an upgrade (existing user)
                isNewSignup: isNewSignup, // Flag to indicate if this is a new signup
                isTrialing: isTrialing, // Flag to indicate if subscription is in trial
                trialEndsDate: isTrialing && stripeSubscription.trial_end ? this.safeDate(stripeSubscription.trial_end) : null
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
            // Check if payment already exists to prevent duplicates
            const subscription = await Subscription.findOne({ userId });
            
            if (subscription && subscription.paymentHistory) {
                // Check for duplicate by sessionId or stripePaymentIntentId
                const existingPayment = subscription.paymentHistory.find(payment => 
                    (paymentData.sessionId && payment.sessionId === paymentData.sessionId) ||
                    (paymentData.stripePaymentIntentId && payment.stripePaymentIntentId === paymentData.stripePaymentIntentId)
                );
                
                if (existingPayment) {
                    logger.info(`Payment already exists in history for user ${userId}, sessionId: ${paymentData.sessionId || 'N/A'}, paymentIntentId: ${paymentData.stripePaymentIntentId || 'N/A'}, skipping duplicate`);
                    return;
                }
            }
            
            await Subscription.findOneAndUpdate(
                { userId },
                { 
                    $push: { 
                        paymentHistory: paymentData 
                    } 
                }
            );
            
            logger.info(`Payment added to history for user ${userId}, sessionId: ${paymentData.sessionId || 'N/A'}, paymentIntentId: ${paymentData.stripePaymentIntentId || 'N/A'}`);
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
     * Auto-syncs from Stripe if subscription is incomplete but has Stripe subscription ID or session ID
     */
    async getSubscription(userId) {
        try {
            const subscription = await Subscription.findOne({ userId });
            
            // Auto-sync if subscription is incomplete and has Stripe subscription ID or session ID
            if (subscription && subscription.status === 'incomplete') {
                try {
                    let subscriptionId = subscription.stripeSubscriptionId;
                    
                    // If no subscriptionId, try to get it from checkout session
                    if (!subscriptionId && subscription.stripeSessionId) {
                        logger.info(`Auto-syncing: retrieving subscription from checkout session ${subscription.stripeSessionId} for user ${userId}`);
                        try {
                            const session = await this.stripe.checkout.sessions.retrieve(subscription.stripeSessionId, {
                                expand: ['subscription']
                            });
                            
                            if (session.subscription) {
                                subscriptionId = typeof session.subscription === 'string' 
                                    ? session.subscription 
                                    : session.subscription.id;
                                logger.info(`Found subscription ${subscriptionId} from session`);
                            }
                        } catch (sessionError) {
                            logger.warn(`Failed to retrieve session ${subscription.stripeSessionId}: ${sessionError.message}`);
                        }
                    }
                    
                    if (subscriptionId) {
                        logger.info(`Auto-syncing incomplete subscription for user ${userId} from Stripe`);
                        const stripeSub = await this.stripe.subscriptions.retrieve(subscriptionId);
                        
                        const isTrialing = stripeSub.status === 'trialing';
                        
                        // Update local subscription with actual Stripe status
                        const subscriptionData = {
                            stripeSubscriptionId: subscriptionId, // Save subscriptionId if it was missing
                            status: stripeSub.status,
                            paymentStatus: isTrialing ? 'no_payment_required' : 
                                          (stripeSub.status === 'active' ? 'paid' : 'pending'),
                            currentPeriodStart: this.safeDate(stripeSub.current_period_start),
                            currentPeriodEnd: this.safeDate(stripeSub.current_period_end),
                            nextBillingDate: this.safeDate(stripeSub.trial_end || stripeSub.current_period_end),
                            cancelAtPeriodEnd: stripeSub.cancel_at_period_end || false,
                        };
                        
                        await this.updateOrCreateSubscription(userId, subscriptionData);
                        
                        // Update user record too
                        const userUpdateData = {
                            subscriptionStatus: stripeSub.status,
                            isInTrialPeriod: isTrialing,
                        };
                        
                        if (isTrialing && stripeSub.trial_end) {
                            userUpdateData.trialEndsDate = this.safeDate(stripeSub.trial_end);
                        } else {
                            userUpdateData.isInTrialPeriod = false;
                        }
                        
                        await User.findByIdAndUpdate(userId, userUpdateData);
                        
                        logger.info(`Auto-synced subscription for user ${userId} from Stripe: ${stripeSub.status}, isTrialing: ${isTrialing}`);
                        
                        // Return updated subscription
                        return await Subscription.findOne({ userId });
                    }
                } catch (syncError) {
                    logger.warn(`Failed to auto-sync subscription from Stripe for user ${userId}: ${syncError.message}`);
                    // Return original subscription if sync fails
                }
            }
            
            return subscription;
        } catch (error) {
            logger.error('Error getting subscription:', error);
            throw error;
        }
    }

    /**
     * Repair all incomplete subscriptions by syncing from Stripe
     * One-time repair function to fix existing users with incomplete status
     * Handles both subscriptions with stripeSubscriptionId and those with only stripeSessionId
     */
    async repairAllIncompleteSubscriptions() {
        try {
            // Find subscriptions with stripeSubscriptionId
            const incompleteSubsWithSubId = await Subscription.find({ 
                status: 'incomplete',
                stripeSubscriptionId: { $exists: true, $ne: null }
            });
            
            // Find subscriptions with only stripeSessionId (no subscriptionId yet)
            const incompleteSubsWithSessionId = await Subscription.find({ 
                status: 'incomplete',
                stripeSubscriptionId: { $exists: false },
                stripeSessionId: { $exists: true, $ne: null }
            });
            
            const allIncompleteSubs = [...incompleteSubsWithSubId, ...incompleteSubsWithSessionId];
            logger.info(`Found ${allIncompleteSubs.length} incomplete subscriptions to repair (${incompleteSubsWithSubId.length} with subscriptionId, ${incompleteSubsWithSessionId.length} with sessionId only)`);
            
            const results = {
                total: allIncompleteSubs.length,
                fixed: [],
                errors: []
            };
            
            for (const sub of allIncompleteSubs) {
                try {
                    let stripeSub;
                    let subscriptionId = sub.stripeSubscriptionId;
                    
                    // If no subscriptionId, get it from the checkout session
                    if (!subscriptionId && sub.stripeSessionId) {
                        logger.info(`Retrieving subscription from checkout session ${sub.stripeSessionId} for user ${sub.userId}`);
                        const session = await this.stripe.checkout.sessions.retrieve(sub.stripeSessionId, {
                            expand: ['subscription']
                        });
                        
                        if (!session.subscription) {
                            throw new Error(`No subscription found in checkout session ${sub.stripeSessionId}`);
                        }
                        
                        subscriptionId = typeof session.subscription === 'string' 
                            ? session.subscription 
                            : session.subscription.id;
                        
                        logger.info(`Found subscription ${subscriptionId} from session ${sub.stripeSessionId}`);
                    }
                    
                    if (!subscriptionId) {
                        throw new Error('No subscription ID available');
                    }
                    
                    // Retrieve subscription from Stripe
                    stripeSub = await this.stripe.subscriptions.retrieve(subscriptionId);
                    const isTrialing = stripeSub.status === 'trialing';
                    
                    // Update subscription record
                    const subscriptionData = {
                        stripeSubscriptionId: subscriptionId, // Save subscriptionId if it was missing
                        status: stripeSub.status,
                        paymentStatus: isTrialing ? 'no_payment_required' : 
                                      (stripeSub.status === 'active' ? 'paid' : 'pending'),
                        currentPeriodStart: this.safeDate(stripeSub.current_period_start),
                        currentPeriodEnd: this.safeDate(stripeSub.current_period_end),
                        nextBillingDate: this.safeDate(stripeSub.trial_end || stripeSub.current_period_end),
                        cancelAtPeriodEnd: stripeSub.cancel_at_period_end || false,
                    };
                    
                    await this.updateOrCreateSubscription(sub.userId, subscriptionData);
                    
                    // Update user record
                    const userUpdateData = {
                        subscriptionStatus: stripeSub.status,
                        isInTrialPeriod: isTrialing,
                    };
                    
                    if (isTrialing && stripeSub.trial_end) {
                        userUpdateData.trialEndsDate = this.safeDate(stripeSub.trial_end);
                    } else {
                        userUpdateData.isInTrialPeriod = false;
                    }
                    
                    // If user purchased AGENCY plan, update accessType
                    if (sub.planType === 'AGENCY') {
                        userUpdateData.accessType = 'enterpriseAdmin';
                    }
                    
                    await User.findByIdAndUpdate(sub.userId, userUpdateData);
                    
                    results.fixed.push({ 
                        userId: sub.userId.toString(), 
                        stripeStatus: stripeSub.status,
                        isTrialing: isTrialing,
                        subscriptionId: subscriptionId
                    });
                    
                    logger.info(`Repaired subscription for user ${sub.userId}: ${stripeSub.status}, subscriptionId: ${subscriptionId}`);
                } catch (error) {
                    results.errors.push({ 
                        userId: sub.userId.toString(), 
                        error: error.message,
                        sessionId: sub.stripeSessionId || null,
                        subscriptionId: sub.stripeSubscriptionId || null
                    });
                    logger.error(`Failed to repair subscription for user ${sub.userId}:`, error);
                }
            }
            
            logger.info(`Repair completed: ${results.fixed.length} fixed, ${results.errors.length} errors`);
            return results;
        } catch (error) {
            logger.error('Error repairing incomplete subscriptions:', error);
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