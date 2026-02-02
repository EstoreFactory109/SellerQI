// Razorpay integration for payment processing (India)
const Razorpay = require('razorpay');
const crypto = require('crypto');
const Subscription = require('../../models/user-auth/SubscriptionModel');
const User = require('../../models/user-auth/userModel');
const PaymentLogs = require('../../models/system/PaymentLogsModel');
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
            // Include trial info so we have a fallback if Razorpay API fetch fails during verification
            const subscriptionData = {
                razorpaySubscriptionId: razorpaySubscription.id,
                planType: planType,
                status: 'incomplete',
                paymentStatus: 'pending',
                paymentGateway: 'razorpay',
                currency: 'inr'
            };
            
            // Store trial info for fallback purposes
            if (hasTrial) {
                subscriptionData.hasTrial = true;
                subscriptionData.trialEndsAt = new Date(subscriptionOptions.start_at * 1000);
                logger.info(`Storing trial info in subscription: hasTrial=true, trialEndsAt=${subscriptionData.trialEndsAt.toISOString()}`);
            } else {
                subscriptionData.hasTrial = false;
                subscriptionData.trialEndsAt = null;
            }
            
            await this.updateOrCreateSubscription(userId, subscriptionData);

            // Log subscription creation event
            await PaymentLogs.logEvent({
                userId,
                eventType: 'RAZORPAY_SUBSCRIPTION_CREATED',
                paymentGateway: 'RAZORPAY',
                status: 'SUCCESS',
                subscriptionId: razorpaySubscription.id,
                planType: planType,
                isTrialPayment: hasTrial,
                trialEndsAt: hasTrial ? subscriptionData.trialEndsAt : null,
                message: `Subscription created${hasTrial ? ` with ${trialPeriodDays}-day trial` : ''}`,
                source: 'FRONTEND',
                metadata: {
                    trialDays: hasTrial ? trialPeriodDays : 0,
                    planId: this.getPlanId(planType)
                }
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
            
            // Log subscription creation failure
            await PaymentLogs.logEvent({
                userId,
                eventType: 'RAZORPAY_SUBSCRIPTION_CREATED',
                paymentGateway: 'RAZORPAY',
                status: 'FAILED',
                planType: planType,
                isTrialPayment: trialPeriodDays && trialPeriodDays > 0,
                errorMessage: error.message,
                errorDescription: error.error?.description,
                message: 'Failed to create Razorpay subscription',
                source: 'FRONTEND'
            });
            
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
                const errMsg = fetchError?.message ?? (typeof fetchError === 'string' ? fetchError : JSON.stringify(fetchError));
                logger.warn('Could not fetch Razorpay subscription details, using fallback from stored subscription data:', {
                    message: errMsg,
                    userId,
                    razorpaySubscriptionId,
                    errorName: fetchError?.name,
                    stack: fetchError?.stack ? String(fetchError.stack).slice(0, 500) : undefined,
                    storedHasTrial: subscription.hasTrial,
                    storedTrialEndsAt: subscription.trialEndsAt
                });
                
                // FALLBACK: Use stored trial info from when subscription was created
                // This prevents users from being incorrectly marked as "Pro active" when they should be in trial
                if (subscription.hasTrial === true && subscription.trialEndsAt) {
                    const trialEnd = new Date(subscription.trialEndsAt);
                    if (trialEnd > new Date()) {
                        isTrialing = true;
                        trialEndsDate = trialEnd;
                        logger.info(`Using fallback trial info: isTrialing=true, trialEndsDate=${trialEndsDate.toISOString()}`);
                    } else {
                        logger.info(`Stored trial has already ended (trialEndsAt=${trialEnd.toISOString()}), treating as active subscription`);
                    }
                }
                
                currentPeriodEnd.setMonth(currentPeriodEnd.getMonth() + 1);
            }

            logger.info(`Razorpay payment context: userId=${userId}, subscriptionId=${razorpaySubscriptionId}, wasInTrial=${wasInTrial}, previousPackageType=${previousPackageType}, isTrialUpgrade=${isTrialUpgrade}, isUpgrade=${isUpgrade}, isNewSignup=${isNewSignup}, isTrialing=${isTrialing}`);

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

            // Update subscription with explicit $set and verify the update succeeded
            const updatedSubscription = await Subscription.findOneAndUpdate(
                { userId, razorpaySubscriptionId: razorpaySubscriptionId },
                { $set: subscriptionData },
                { new: true, runValidators: true }
            );

            if (!updatedSubscription) {
                logger.error(`Failed to update subscription for user: ${userId}, razorpaySubscriptionId: ${razorpaySubscriptionId}`);
                throw new Error('Failed to update subscription - subscription not found');
            }

            logger.info(`Subscription payment status updated to: ${updatedSubscription.paymentStatus} for user: ${userId}, subscription: ${razorpaySubscriptionId}`);

            // Update user's package type
            const updateData = {
                packageType: planType,
                subscriptionStatus: isTrialing ? 'trialing' : 'active',
                isInTrialPeriod: isTrialing
            };

            // Set trial end date and mark served trial when user authorized payment method for free trial
            if (isTrialing) {
                updateData.servedTrial = true; // User authorized payment method for free trial
                if (trialEndsDate) {
                    updateData.trialEndsDate = trialEndsDate;
                }
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
                    
                    // Razorpay always returns amount in paise (smallest currency unit)
                    // For INR: ₹1,999.00 = 199900 paise, ₹100 = 10000 paise
                    if (razorpayPayment.amount) {
                        const rawAmount = razorpayPayment.amount;
                        paymentAmount = rawAmount / 100; // Always convert paise to rupees
                        logger.info(`Razorpay payment amount: ${rawAmount} paise = ₹${paymentAmount}`);
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

            // Log payment success event
            await PaymentLogs.logEvent({
                userId,
                eventType: isTrialing ? 'TRIAL_STARTED' : 'RAZORPAY_PAYMENT_SUCCESS',
                paymentGateway: 'RAZORPAY',
                status: 'SUCCESS',
                subscriptionId: razorpaySubscriptionId,
                paymentId: paymentId,
                planType: planType,
                previousPlanType: previousPackageType,
                isTrialPayment: isTrialing,
                trialEndsAt: trialEndsDate,
                previousStatus: wasInTrial ? 'trialing' : previousPackageType,
                newStatus: isTrialing ? 'trialing' : 'active',
                message: isTrialing 
                    ? `Trial started for ${planType} plan, ends ${trialEndsDate?.toISOString()}`
                    : `Payment successful for ${planType} plan`,
                source: 'FRONTEND',
                metadata: {
                    wasInTrial,
                    isTrialUpgrade,
                    isUpgrade,
                    isNewSignup
                }
            });

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
            
            // Log payment failure event
            await PaymentLogs.logEvent({
                userId,
                eventType: 'RAZORPAY_PAYMENT_FAILED',
                paymentGateway: 'RAZORPAY',
                status: 'FAILED',
                subscriptionId: razorpaySubscriptionId,
                paymentId: paymentId,
                errorMessage: error.message,
                errorCode: error.name,
                message: 'Payment verification failed',
                source: 'FRONTEND'
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
                    // Log subscription authenticated event (payment method authorized, trial started)
                    if (payload.subscription?.entity?.id) {
                        const sub = payload.subscription.entity;
                        const dbSub = await Subscription.findOne({ razorpaySubscriptionId: sub.id });
                        if (dbSub) {
                            await PaymentLogs.logEvent({
                                userId: dbSub.userId,
                                eventType: 'RAZORPAY_SUBSCRIPTION_AUTHENTICATED',
                                paymentGateway: 'RAZORPAY',
                                status: 'SUCCESS',
                                subscriptionId: sub.id,
                                planType: dbSub.planType,
                                isTrialPayment: dbSub.hasTrial,
                                trialEndsAt: dbSub.trialEndsAt,
                                message: dbSub.hasTrial 
                                    ? `Payment method authenticated, trial started until ${dbSub.trialEndsAt?.toISOString()}`
                                    : 'Payment method authenticated',
                                source: 'WEBHOOK',
                                webhookPayload: payload
                            });
                        }
                    }
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
                case 'subscription.halted':
                    await this.handleSubscriptionHalted(payload);
                    break;
                case 'subscription.pending':
                    // Subscription is pending due to payment failure, user still has access
                    // but payment is being retried. We'll handle this with payment.failed
                    logger.info(`Subscription pending: ${payload?.subscription?.entity?.id}`);
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
                
                // Update subscription with explicit $set and verify the update succeeded
                const activatedSubscription = await Subscription.findOneAndUpdate(
                    { razorpaySubscriptionId: subscriptionId },
                    {
                        $set: {
                            status: 'active',
                            paymentStatus: 'paid',
                            currentPeriodStart: subscription.current_start ? new Date(subscription.current_start * 1000) : new Date(),
                            currentPeriodEnd: subscription.current_end ? new Date(subscription.current_end * 1000) : null,
                            lastPaymentDate: new Date(),
                            nextBillingDate: subscription.current_end ? new Date(subscription.current_end * 1000) : null
                        }
                    },
                    { new: true, runValidators: true }
                );

                if (!activatedSubscription) {
                    logger.error(`Failed to update subscription via webhook for subscriptionId: ${subscriptionId}`);
                }

                logger.info(`Subscription activated via webhook, payment status updated to: ${activatedSubscription?.paymentStatus} for subscriptionId: ${subscriptionId}`);

                // Update user's package type - trial has ended, now on paid plan
                await User.findByIdAndUpdate(dbSubscription.userId, {
                    packageType: dbSubscription.planType,
                    subscriptionStatus: 'active',
                    isInTrialPeriod: false
                });

                if (wasInTrial) {
                    logger.info(`Trial ended for user: ${dbSubscription.userId}. Subscription activated and payment charged. User now on paid ${dbSubscription.planType} plan.`);
                    
                    // Log trial ended event
                    await PaymentLogs.logEvent({
                        userId: dbSubscription.userId,
                        eventType: 'TRIAL_ENDED',
                        paymentGateway: 'RAZORPAY',
                        status: 'SUCCESS',
                        subscriptionId: subscriptionId,
                        planType: dbSubscription.planType,
                        previousStatus: 'trialing',
                        newStatus: 'active',
                        message: `Trial ended, subscription activated for ${dbSubscription.planType} plan`,
                        source: 'WEBHOOK',
                        webhookPayload: payload
                    });
                } else {
                    logger.info(`Subscription activated via webhook: ${subscriptionId}`);
                    
                    // Log subscription activated event
                    await PaymentLogs.logEvent({
                        userId: dbSubscription.userId,
                        eventType: 'RAZORPAY_SUBSCRIPTION_ACTIVATED',
                        paymentGateway: 'RAZORPAY',
                        status: 'SUCCESS',
                        subscriptionId: subscriptionId,
                        planType: dbSubscription.planType,
                        previousStatus: 'incomplete',
                        newStatus: 'active',
                        message: `Subscription activated for ${dbSubscription.planType} plan`,
                        source: 'WEBHOOK',
                        webhookPayload: payload
                    });
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
                // Update subscription dates with explicit $set and verify the update succeeded
                const chargedSubscription = await Subscription.findOneAndUpdate(
                    { razorpaySubscriptionId: subscriptionId },
                    {
                        $set: {
                            razorpayPaymentId: paymentId,
                            status: 'active',
                            paymentStatus: 'paid',
                            currentPeriodStart: subscription.current_start ? new Date(subscription.current_start * 1000) : new Date(),
                            currentPeriodEnd: subscription.current_end ? new Date(subscription.current_end * 1000) : null,
                            lastPaymentDate: new Date(),
                            nextBillingDate: subscription.current_end ? new Date(subscription.current_end * 1000) : null
                        }
                    },
                    { new: true, runValidators: true }
                );

                if (!chargedSubscription) {
                    logger.error(`Failed to update subscription for recurring payment, subscriptionId: ${subscriptionId}, paymentId: ${paymentId}`);
                }

                logger.info(`Recurring payment processed, payment status updated to: ${chargedSubscription?.paymentStatus} for subscriptionId: ${subscriptionId}, paymentId: ${paymentId}`);

                // Add to payment history
                // Razorpay always returns amount in paise (smallest currency unit)
                // For INR: ₹1,999.00 = 199900 paise, ₹100 = 10000 paise
                let paymentAmountInRupees = 0;
                if (payment.amount) {
                    paymentAmountInRupees = payment.amount / 100; // Always convert paise to rupees
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
                
                // Log recurring payment event
                await PaymentLogs.logEvent({
                    userId: dbSubscription.userId,
                    eventType: 'RAZORPAY_SUBSCRIPTION_CHARGED',
                    paymentGateway: 'RAZORPAY',
                    status: 'SUCCESS',
                    subscriptionId: subscriptionId,
                    paymentId: paymentId,
                    amount: paymentAmountInRupees,
                    currency: payment.currency?.toUpperCase() || 'INR',
                    planType: dbSubscription.planType,
                    message: `Recurring payment of ${payment.currency?.toUpperCase() || 'INR'} ${paymentAmountInRupees}`,
                    source: 'WEBHOOK',
                    webhookPayload: payload,
                    metadata: {
                        method: payment.method,
                        bank: payment.bank,
                        currentPeriodEnd: subscription.current_end ? new Date(subscription.current_end * 1000) : null
                    }
                });
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
                
                // Log subscription cancelled event
                await PaymentLogs.logEvent({
                    userId: dbSubscription.userId,
                    eventType: 'RAZORPAY_SUBSCRIPTION_CANCELLED',
                    paymentGateway: 'RAZORPAY',
                    status: 'SUCCESS',
                    subscriptionId: subscriptionId,
                    planType: 'LITE',
                    previousPlanType: dbSubscription.planType,
                    previousStatus: dbSubscription.status,
                    newStatus: 'cancelled',
                    message: `Subscription cancelled, user downgraded to LITE`,
                    source: 'WEBHOOK',
                    webhookPayload: payload
                });
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
     * Updates both Subscription and User to reflect payment failure
     */
    async handlePaymentFailed(payload) {
        try {
            const payment = payload.payment.entity;
            const paymentId = payment.id;

            logger.info(`Razorpay payment failed: ${paymentId}`);

            // Find subscription to get userId for logging
            let userId = null;
            let subscription = null;
            let previousStatus = 'active';
            
            // If this is a subscription payment failure, update status
            if (payment.subscription_id) {
                // First get the current subscription to track previous status
                const currentSubscription = await Subscription.findOne({ razorpaySubscriptionId: payment.subscription_id });
                previousStatus = currentSubscription?.status || 'active';
                
                subscription = await Subscription.findOneAndUpdate(
                    { razorpaySubscriptionId: payment.subscription_id },
                    {
                        status: 'past_due',
                        paymentStatus: 'unpaid'
                    },
                    { new: true }
                );
                userId = subscription?.userId;
                
                // Also update User model to reflect payment failure
                // User keeps their packageType (PRO) but subscriptionStatus becomes past_due
                // This allows features to potentially show a "payment failed" warning
                if (userId) {
                    await User.findByIdAndUpdate(userId, {
                        subscriptionStatus: 'past_due'
                    });
                    logger.info(`Updated user ${userId} subscriptionStatus to past_due due to payment failure`);
                }
            }

            // Log payment failure from webhook
            if (userId) {
                await PaymentLogs.logEvent({
                    userId,
                    eventType: 'RAZORPAY_PAYMENT_FAILED',
                    paymentGateway: 'RAZORPAY',
                    status: 'FAILED',
                    subscriptionId: payment.subscription_id,
                    paymentId: paymentId,
                    amount: payment.amount ? payment.amount / 100 : null, // Convert from paise
                    currency: payment.currency?.toUpperCase() || 'INR',
                    errorCode: payment.error_code,
                    errorMessage: payment.error_description || payment.error_reason,
                    errorDescription: payment.error_step,
                    previousStatus: previousStatus,
                    newStatus: 'past_due',
                    message: `Payment failed: ${payment.error_description || payment.error_reason || 'Unknown error'}`,
                    source: 'WEBHOOK',
                    webhookPayload: payload,
                    metadata: {
                        method: payment.method,
                        bank: payment.bank,
                        wallet: payment.wallet,
                        vpa: payment.vpa
                    }
                });
            }

        } catch (error) {
            logger.error('Error handling payment.failed webhook:', error);
            throw error;
        }
    }

    /**
     * Handle subscription.halted webhook event
     * This is triggered when Razorpay stops retrying after multiple payment failures
     * At this point, we should downgrade the user to LITE
     */
    async handleSubscriptionHalted(payload) {
        try {
            const subscription = payload.subscription.entity;
            const subscriptionId = subscription.id;

            logger.info(`Razorpay subscription halted: ${subscriptionId}`);

            // Find subscription by Razorpay subscription ID
            const dbSubscription = await Subscription.findOne({ razorpaySubscriptionId: subscriptionId });
            
            if (dbSubscription) {
                const previousStatus = dbSubscription.status;
                const previousPlanType = dbSubscription.planType;
                
                // Update subscription to halted/cancelled
                await Subscription.findOneAndUpdate(
                    { razorpaySubscriptionId: subscriptionId },
                    {
                        status: 'cancelled',
                        paymentStatus: 'unpaid'
                    }
                );

                // Downgrade user to LITE since subscription is halted
                await User.findByIdAndUpdate(dbSubscription.userId, {
                    packageType: 'LITE',
                    subscriptionStatus: 'cancelled',
                    isInTrialPeriod: false
                });

                logger.info(`Subscription halted, user ${dbSubscription.userId} downgraded to LITE`);
                
                // Log subscription halted event
                await PaymentLogs.logEvent({
                    userId: dbSubscription.userId,
                    eventType: 'RAZORPAY_SUBSCRIPTION_HALTED',
                    paymentGateway: 'RAZORPAY',
                    status: 'FAILED',
                    subscriptionId: subscriptionId,
                    planType: 'LITE',
                    previousPlanType: previousPlanType,
                    previousStatus: previousStatus,
                    newStatus: 'cancelled',
                    message: `Subscription halted due to repeated payment failures, user downgraded to LITE`,
                    source: 'WEBHOOK',
                    webhookPayload: payload
                });
            }

        } catch (error) {
            logger.error('Error handling subscription.halted webhook:', error);
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

            // Log subscription cancellation from user action
            await PaymentLogs.logEvent({
                userId,
                eventType: 'RAZORPAY_SUBSCRIPTION_CANCELLED',
                paymentGateway: 'RAZORPAY',
                status: 'SUCCESS',
                subscriptionId: subscription.razorpaySubscriptionId,
                planType: 'LITE',
                previousPlanType: subscription.planType,
                previousStatus: subscription.status,
                newStatus: 'cancelled',
                message: 'User cancelled subscription',
                source: 'FRONTEND'
            });

            return { 
                success: true, 
                message: 'Subscription cancelled successfully' 
            };

        } catch (error) {
            logger.error('Error cancelling Razorpay subscription:', error);
            
            // Log cancellation failure
            await PaymentLogs.logEvent({
                userId,
                eventType: 'RAZORPAY_SUBSCRIPTION_CANCELLED',
                paymentGateway: 'RAZORPAY',
                status: 'FAILED',
                errorMessage: error.message,
                message: 'Failed to cancel subscription',
                source: 'FRONTEND'
            });
            
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

