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
            // Log which key type is being used (for debugging)
            const keyType = process.env.RAZOR_PAY_ID.startsWith('rzp_test_') ? 'TEST' : 
                           process.env.RAZOR_PAY_ID.startsWith('rzp_live_') ? 'LIVE' : 'UNKNOWN';
            logger.info(`Razorpay initialized with ${keyType} mode. Key ID: ${process.env.RAZOR_PAY_ID.substring(0, 15)}...`);
            
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
     * @param {string} userId - User ID
     * @param {string} planType - Plan type (PRO)
     * @param {number} [trialPeriodDays] - Optional trial period in days
     */
    async createOrder(userId, planType, trialPeriodDays = null) {
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
                logger.error(`RAZOR_PAY_PLAN_ID is not set in environment variables for plan: ${planType}`);
                throw new Error(`Plan ID not configured for: ${planType}. Please set RAZOR_PAY_PLAN_ID in environment variables.`);
            }

            const hasTrial = trialPeriodDays && trialPeriodDays > 0 && planType === 'PRO';
            logger.info(`Creating Razorpay subscription for user ${userId} with plan ID: ${planId}${hasTrial ? `, trial: ${trialPeriodDays} days` : ''}`);

            // Create Razorpay subscription using the Plan ID
            const subscriptionOptions = {
                plan_id: planId,
                customer_notify: 1,
                total_count: 60, // 60 billing cycles (5 years - until 2030)
                notes: {
                    userId: userId.toString(),
                    planType: planType,
                    email: user.email,
                    hasTrial: hasTrial ? 'true' : 'false',
                    trialDays: hasTrial ? trialPeriodDays.toString() : '0'
                }
            };

            // Add trial period using start_at parameter
            // When start_at is set to a future date, Razorpay:
            // 1. Collects payment method during authentication
            // 2. Does not charge immediately
            // 3. Automatically charges when start_at date arrives
            if (hasTrial) {
                const trialEndDate = Math.floor((Date.now() + (trialPeriodDays * 24 * 60 * 60 * 1000)) / 1000);
                subscriptionOptions.start_at = trialEndDate;
                logger.info(`Adding ${trialPeriodDays}-day trial period. Subscription will start charging on: ${new Date(trialEndDate * 1000).toISOString()}`);
            }

            let razorpaySubscription;
            try {
                razorpaySubscription = await this.razorpay.subscriptions.create(subscriptionOptions);
            } catch (razorpayError) {
                logger.error('Razorpay API error creating subscription:', {
                    error: razorpayError.message,
                    statusCode: razorpayError.statusCode,
                    errorDescription: razorpayError.error?.description,
                    planId: planId
                });
                throw new Error(`Failed to create Razorpay subscription: ${razorpayError.error?.description || razorpayError.message}`);
            }

            logger.info(`Razorpay subscription created: ${razorpaySubscription.id} for user: ${userId}, plan: ${planType}${hasTrial ? ', with trial' : ''}`);

            // Save subscription info (pending state)
            await this.updateOrCreateSubscription(userId, {
                razorpaySubscriptionId: razorpaySubscription.id,
                planType: planType,
                status: 'incomplete',
                paymentStatus: 'pending',
                paymentGateway: 'razorpay',
                currency: 'inr'
            });

            const keyId = process.env.RAZOR_PAY_ID;
            // Log which key is being sent to frontend
            const keyType = keyId?.startsWith('rzp_test_') ? 'TEST' : 
                           keyId?.startsWith('rzp_live_') ? 'LIVE' : 'UNKNOWN';
            logger.info(`Sending Razorpay ${keyType} key to frontend in createOrder: ${keyId?.substring(0, 15)}...`);
            
            return {
                subscriptionId: razorpaySubscription.id,
                keyId: keyId,
                planName: 'Pro Plan',
                description: hasTrial ? `SellerQI Pro Plan - ${trialPeriodDays}-Day Free Trial` : 'SellerQI Pro Plan - Monthly Subscription',
                prefill: {
                    name: `${user.firstName} ${user.lastName}`,
                    email: user.email,
                    contact: user.phone || ''
                },
                hasTrial: hasTrial,
                trialDays: hasTrial ? trialPeriodDays : null,
                trialEndsAt: hasTrial ? new Date(Date.now() + (trialPeriodDays * 24 * 60 * 60 * 1000)).toISOString() : null
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

            // Fetch subscription details from Razorpay to check trial status and billing dates
            let currentPeriodStart = new Date();
            let currentPeriodEnd = new Date();
            let isTrialing = false;
            let trialEndsDate = null;
            
            try {
                const razorpaySub = await this.razorpay.subscriptions.fetch(razorpaySubscriptionId);
                
                // Check if subscription is in trial (authenticated but start_at is in the future)
                // When start_at is set to future, status is 'authenticated' until that date
                if (razorpaySub.status === 'authenticated' && razorpaySub.start_at && razorpaySub.start_at * 1000 > Date.now()) {
                    isTrialing = true;
                    trialEndsDate = new Date(razorpaySub.start_at * 1000);
                    logger.info(`Razorpay subscription is in trial period until: ${trialEndsDate.toISOString()}`);
                }
                
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

            logger.info(`Razorpay payment context: wasInTrial=${wasInTrial}, previousPackageType=${previousPackageType}, isTrialUpgrade=${isTrialUpgrade}, isUpgrade=${isUpgrade}, isNewSignup=${isNewSignup}, isTrialing=${isTrialing}`);

            // Update subscription with payment details
            const subscriptionData = {
                razorpayPaymentId: paymentId,
                razorpaySignature: signature,
                status: isTrialing ? 'trialing' : 'active',
                paymentStatus: isTrialing ? 'no_payment_required' : 'paid',
                currentPeriodStart: currentPeriodStart,
                currentPeriodEnd: isTrialing ? trialEndsDate : currentPeriodEnd,
                lastPaymentDate: isTrialing ? null : new Date(),
                nextBillingDate: isTrialing ? trialEndsDate : currentPeriodEnd
            };

            await Subscription.findOneAndUpdate(
                { userId, razorpaySubscriptionId: razorpaySubscriptionId },
                subscriptionData
            );

            // Update user's package type
            const updateData = {
                packageType: planType,
                subscriptionStatus: isTrialing ? 'trialing' : 'active',
                isInTrialPeriod: isTrialing
            };

            // Set trial end date if in trial
            if (isTrialing && trialEndsDate) {
                updateData.trialEndsDate = trialEndsDate;
            }

            // If user purchased AGENCY plan, update accessType
            if (planType === 'AGENCY') {
                updateData.accessType = 'enterpriseAdmin';
            }

            await User.findByIdAndUpdate(userId, updateData);

            // Only add payment history and fetch invoice if not in trial (no actual payment yet)
            if (!isTrialing) {
                // Try to get invoice URL and payment amount from Razorpay
                let invoiceUrl = null;
                let invoiceNumber = null;
                let paymentAmount = subscription.amount || 0; // Fallback to subscription amount

                try {
                    const razorpayPayment = await this.razorpay.payments.fetch(paymentId);
                    
                    // Razorpay returns amount in paise (smallest currency unit)
                    // For INR: ₹1,999.00 = 199900 paise
                    // Convert paise to rupees by dividing by 100
                    if (razorpayPayment.amount) {
                        const rawAmount = razorpayPayment.amount;
                        
                        // If the amount is very large (like 199900), it's in paise - divide by 100
                        if (rawAmount > 10000) {
                            paymentAmount = rawAmount / 100; // Convert paise to rupees
                            logger.info(`Razorpay payment amount: ${rawAmount} paise = ₹${paymentAmount}`);
                        } else {
                            // Amount is already in rupees (for test mode or certain cases)
                            paymentAmount = rawAmount;
                            logger.info(`Razorpay payment amount: ${rawAmount} (already in rupees) = ₹${paymentAmount}`);
                        }
                    }
                    
                    if (razorpayPayment.invoice_id) {
                        const invoice = await this.razorpay.invoices.fetch(razorpayPayment.invoice_id);
                        invoiceUrl = invoice.short_url || null;
                        invoiceNumber = invoice.id || null;
                    }
                } catch (invoiceError) {
                    logger.warn(`Could not fetch Razorpay payment details: ${invoiceError.message}`);
                }

                // Add to payment history with invoice URLs
                await this.addPaymentHistory(userId, {
                    orderId: paymentId,
                    paymentId: paymentId,
                    amount: paymentAmount,
                    currency: subscription.currency || 'inr',
                    status: 'paid',
                    razorpayPaymentId: paymentId,
                    invoiceUrl: invoiceUrl,
                    invoiceNumber: invoiceNumber,
                    paymentGateway: 'razorpay'
                });
            }

            const statusMessage = isTrialing 
                ? `Razorpay trial started for user: ${userId}, trial ends: ${trialEndsDate?.toISOString()}`
                : `Razorpay payment successful for user: ${userId}, payment: ${paymentId}, plan: ${planType}`;
            logger.info(statusMessage);

            return { 
                success: true, 
                planType, 
                userId,
                isTrialUpgrade: isTrialUpgrade,  // Flag to indicate if user upgraded from trial
                isUpgrade: isUpgrade, // Flag to indicate if this is an upgrade (existing user)
                isNewSignup: isNewSignup || isTrialing, // Trial users are treated as new signups
                isTrialing: isTrialing, // Flag to indicate if user is in trial
                trialEndsDate: trialEndsDate, // Trial end date if applicable
                message: isTrialing 
                    ? 'Trial started successfully. Payment will be charged when trial ends.'
                    : 'Payment verified and subscription activated successfully'
            };

        } catch (error) {
            logger.error('Error handling Razorpay payment success:', {
                message: error.message,
                stack: error.stack,
                userId: userId,
                subscriptionId: razorpaySubscriptionId,
                paymentId: paymentId,
                errorName: error.name
            });
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
            // Check if payment already exists to prevent duplicates
            const subscription = await Subscription.findOne({ userId });
            
            if (subscription && subscription.paymentHistory) {
                // Check for duplicate by paymentId or razorpayPaymentId
                const existingPayment = subscription.paymentHistory.find(payment => 
                    (paymentData.paymentId && payment.paymentId === paymentData.paymentId) ||
                    (paymentData.razorpayPaymentId && payment.razorpayPaymentId === paymentData.razorpayPaymentId) ||
                    (paymentData.orderId && payment.orderId === paymentData.orderId)
                );
                
                if (existingPayment) {
                    logger.info(`Payment already exists in history for user ${userId}, paymentId: ${paymentData.paymentId || paymentData.razorpayPaymentId || paymentData.orderId}, skipping duplicate`);
                    return;
                }
            }
            
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
            
            logger.info(`Payment added to history for user ${userId}, paymentId: ${paymentData.paymentId || paymentData.razorpayPaymentId || paymentData.orderId}`);
        } catch (error) {
            logger.error('Error adding payment history:', error);
        }
    }

    /**
     * Get Razorpay configuration for frontend
     */
    getConfig() {
        const keyId = process.env.RAZOR_PAY_ID;
        // Log which key is being sent to frontend (for debugging)
        if (keyId) {
            const keyType = keyId.startsWith('rzp_test_') ? 'TEST' : 
                           keyId.startsWith('rzp_live_') ? 'LIVE' : 'UNKNOWN';
            logger.info(`Sending Razorpay ${keyType} key to frontend: ${keyId.substring(0, 15)}...`);
        }
        
        return {
            keyId: keyId,
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
     * This is triggered when:
     * 1. A trial subscription's start_at date arrives (trial ends, subscription starts)
     * 2. A subscription is created without trial and payment succeeds
     */
    async handleSubscriptionActivated(payload) {
        try {
            const subscription = payload.subscription.entity;
            const subscriptionId = subscription.id;

            logger.info(`Razorpay subscription activated: ${subscriptionId}`);

            // Find subscription by Razorpay subscription ID
            const dbSubscription = await Subscription.findOne({ razorpaySubscriptionId: subscriptionId });
            
            if (dbSubscription) {
                // Check if user was in trial before
                const user = await User.findById(dbSubscription.userId);
                const wasInTrial = user?.isInTrialPeriod === true;
                
                await Subscription.findOneAndUpdate(
                    { razorpaySubscriptionId: subscriptionId },
                    {
                        status: 'active',
                        paymentStatus: 'paid',
                        currentPeriodStart: subscription.current_start ? new Date(subscription.current_start * 1000) : new Date(),
                        currentPeriodEnd: subscription.current_end ? new Date(subscription.current_end * 1000) : null,
                        lastPaymentDate: new Date(),
                        nextBillingDate: subscription.current_end ? new Date(subscription.current_end * 1000) : null
                    }
                );

                // Update user's package type - trial has ended, now on paid plan
                await User.findByIdAndUpdate(dbSubscription.userId, {
                    packageType: dbSubscription.planType,
                    subscriptionStatus: 'active',
                    isInTrialPeriod: false
                });

                if (wasInTrial) {
                    logger.info(`Trial ended for user: ${dbSubscription.userId}. Subscription activated and payment charged. User now on paid ${dbSubscription.planType} plan.`);
                } else {
                    logger.info(`Subscription activated via webhook: ${subscriptionId}`);
                }
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
                // Razorpay returns amount in paise (smallest currency unit)
                // For INR: ₹1,999.00 = 199900 paise
                // Convert paise to rupees by dividing by 100
                // But check if it's already in rupees (amount <= 10000)
                let paymentAmountInRupees = 0;
                if (payment.amount) {
                    if (payment.amount > 10000) {
                        paymentAmountInRupees = payment.amount / 100; // Convert paise to rupees
                    } else {
                        paymentAmountInRupees = payment.amount; // Already in rupees
                    }
                }
                
                await this.addPaymentHistory(dbSubscription.userId, {
                    subscriptionId: subscriptionId,
                    paymentId: paymentId,
                    amount: paymentAmountInRupees, // Convert paise to rupees
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

    /**
     * Cancel Razorpay subscription
     */
    async cancelSubscription(userId) {
        try {
            if (!this.isConfigured()) {
                throw new Error('Razorpay is not configured');
            }

            // Find user's active subscription
            const subscription = await Subscription.findOne({ 
                userId, 
                paymentGateway: 'razorpay',
                status: { $in: ['active', 'authenticated'] }
            });

            if (!subscription) {
                throw new Error('No active Razorpay subscription found');
            }

            if (!subscription.razorpaySubscriptionId) {
                throw new Error('No Razorpay subscription ID found');
            }

            // Cancel subscription in Razorpay
            await this.razorpay.subscriptions.cancel(subscription.razorpaySubscriptionId);

            // Update subscription in database
            await Subscription.findOneAndUpdate(
                { userId, razorpaySubscriptionId: subscription.razorpaySubscriptionId },
                {
                    status: 'cancelled',
                    cancelAtPeriodEnd: false
                }
            );

            // Update user's package type to LITE
            await User.findByIdAndUpdate(userId, {
                packageType: 'LITE',
                subscriptionStatus: 'cancelled'
            });

            logger.info(`Razorpay subscription cancelled for user: ${userId}, subscription: ${subscription.razorpaySubscriptionId}`);

            return { 
                success: true, 
                message: 'Subscription cancelled successfully' 
            };

        } catch (error) {
            logger.error('Error cancelling Razorpay subscription:', error);
            throw error;
        }
    }

    /**
     * Get user's subscription details
     */
    async getSubscription(userId) {
        try {
            const subscription = await Subscription.findOne({ 
                userId,
                paymentGateway: 'razorpay'
            });

            if (!subscription) {
                return null;
            }

            // Fetch latest details from Razorpay if subscription exists
            let razorpayDetails = null;
            if (subscription.razorpaySubscriptionId && this.isConfigured()) {
                try {
                    razorpayDetails = await this.razorpay.subscriptions.fetch(subscription.razorpaySubscriptionId);
                } catch (fetchError) {
                    logger.warn('Could not fetch Razorpay subscription details:', fetchError.message);
                }
            }

            return {
                planType: subscription.planType,
                status: subscription.status,
                paymentStatus: subscription.paymentStatus,
                currency: subscription.currency || 'inr',
                currentPeriodStart: subscription.currentPeriodStart,
                currentPeriodEnd: subscription.currentPeriodEnd,
                nextBillingDate: subscription.nextBillingDate || subscription.currentPeriodEnd,
                paymentGateway: 'razorpay',
                razorpaySubscriptionId: subscription.razorpaySubscriptionId,
                razorpayDetails: razorpayDetails
            };

        } catch (error) {
            logger.error('Error getting Razorpay subscription:', error);
            throw error;
        }
    }

    /**
     * Get payment history for user
     */
    async getPaymentHistory(userId) {
        try {
            const subscription = await Subscription.findOne({ userId });

            if (!subscription || !subscription.paymentHistory) {
                return [];
            }

            // Filter to only show Razorpay payments
            return subscription.paymentHistory.filter(
                payment => payment.paymentGateway === 'razorpay'
            );

        } catch (error) {
            logger.error('Error getting Razorpay payment history:', error);
            throw error;
        }
    }

    /**
     * Get invoice download URL for a payment
     * @param {string} userId - User ID
     * @param {string} paymentId - Razorpay payment ID
     * @returns {Promise<{invoiceUrl: string, invoicePdf: string}>}
     */
    async getInvoiceDownloadUrl(userId, paymentId) {
        try {
            // Check if Razorpay is configured
            if (!this.isConfigured()) {
                throw new Error('Razorpay is not configured');
            }

            // Find subscription to verify user ownership
            const subscription = await Subscription.findOne({ userId });
            if (!subscription) {
                throw new Error('Subscription not found');
            }

            // Verify payment belongs to user
            const paymentInHistory = subscription.paymentHistory?.find(
                p => p.razorpayPaymentId === paymentId && p.paymentGateway === 'razorpay'
            );

            if (!paymentInHistory) {
                throw new Error('Payment not found in user history');
            }

            // Fetch payment details from Razorpay
            const razorpayPayment = await this.razorpay.payments.fetch(paymentId);

            // Razorpay provides invoice details in payment object
            // For subscriptions, invoice is usually available
            let invoiceUrl = null;
            let invoicePdf = null;
            let invoiceNumber = null;

            // Check if payment has invoice_id
            if (razorpayPayment.invoice_id) {
                try {
                    const invoice = await this.razorpay.invoices.fetch(razorpayPayment.invoice_id);
                    invoiceUrl = invoice.short_url || null;
                    invoicePdf = invoice.short_url || null; // Razorpay uses same URL for PDF
                    invoiceNumber = invoice.id || null;
                } catch (invoiceError) {
                    logger.warn(`Could not fetch Razorpay invoice: ${invoiceError.message}`);
                }
            }

            // If no invoice, generate receipt URL (Razorpay provides receipt URLs)
            if (!invoiceUrl && razorpayPayment.receipt) {
                // Razorpay receipt can be used as invoice reference
                invoiceNumber = razorpayPayment.receipt;
            }

            return {
                invoiceUrl: invoiceUrl,
                invoicePdf: invoicePdf,
                invoiceNumber: invoiceNumber || paymentId,
                paymentId: paymentId,
                receiptUrl: razorpayPayment.receipt ? `https://dashboard.razorpay.com/app/payments/${paymentId}` : null
            };

        } catch (error) {
            logger.error('Error getting Razorpay invoice download URL:', error);
            throw error;
        }
    }
}

module.exports = new RazorpayService();

