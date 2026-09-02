// Stripe integration for webhook handling
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Subscription = require('../../models/user-auth/SubscriptionModel');
const User = require('../../models/user-auth/userModel');
const PaymentLogs = require('../../models/system/PaymentLogsModel');
const logger = require('../../utils/Logger');
const { sendTrialToProSupportEmail } = require('../Email/SendTrialToProSupportEmail');

class StripeWebhookService {
    constructor() {
        this.stripe = stripe;
        this.webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
        if (!process.env.STRIPE_SECRET_KEY) {
            logger.warn('STRIPE_SECRET_KEY is not set. Stripe webhook functionality will not work.');
        }
        if (!process.env.STRIPE_WEBHOOK_SECRET) {
            logger.warn('STRIPE_WEBHOOK_SECRET is not set. Stripe webhook signature verification will fail.');
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
        return isNaN(date.getTime()) ? null : date;
    }

    /**
     * Read the current billing period off a Stripe Subscription, across API versions.
     *
     * IMPORTANT: as of API version 2025-03-31.basil, `current_period_start`/`current_period_end`
     * were REMOVED from the Subscription object and now live on each subscription item
     * (`subscription.items.data[].current_period_*`). This installation is mixed:
     *   - webhook payloads render at the account default (2022-11-15) -> fields present on the subscription
     *   - stripe-node 18.x pins 2025-08-27.basil, so anything fetched via
     *     `stripe.subscriptions.retrieve()` has them ONLY on the items
     * Reading just one location silently yields undefined on the other, which is how the
     * renewal date ended up depending on incidental fallbacks. Always go through this helper.
     *
     * Returns Unix timestamps (seconds), or nulls when genuinely unavailable.
     */
    getSubscriptionPeriod(subscription) {
        if (!subscription) return { start: null, end: null };

        // Newer (Basil+): period lives on the items. Take the furthest-out item period -
        // multi-item subscriptions share one billing cycle, but be defensive.
        const itemPeriods = (subscription.items?.data || [])
            .map((item) => ({ start: item.current_period_start, end: item.current_period_end }))
            .filter((p) => typeof p.end === 'number');

        if (itemPeriods.length) {
            const furthest = itemPeriods.reduce((a, b) => (b.end > a.end ? b : a));
            return { start: furthest.start ?? null, end: furthest.end ?? null };
        }

        // Older (<= 2025-02-24.acacia): period lives on the subscription itself.
        return {
            start: typeof subscription.current_period_start === 'number' ? subscription.current_period_start : null,
            end: typeof subscription.current_period_end === 'number' ? subscription.current_period_end : null,
        };
    }

    /**
     * Resolve the subscription id off an Invoice, across API versions.
     * `invoice.subscription` was removed in 2025-03-31.basil in favour of
     * `invoice.parent.subscription_details.subscription`.
     */
    getInvoiceSubscriptionId(invoice) {
        if (!invoice) return null;
        const direct = typeof invoice.subscription === 'string'
            ? invoice.subscription
            : invoice.subscription?.id || null;
        return direct || invoice.parent?.subscription_details?.subscription || null;
    }

    /**
     * Verify webhook signature
     */
    verifyWebhookSignature(payload, signature) {
        try {
            const event = this.stripe.webhooks.constructEvent(
                payload,
                signature,
                this.webhookSecret
            );
            return event;
        } catch (error) {
            logger.error('Webhook signature verification failed:', error.message);
            throw new Error('Invalid signature');
        }
    }

    /**
     * Handle webhook events with idempotency check
     * Prevents duplicate processing of the same webhook event
     */
    async handleWebhookEvent(event) {
        try {
            logger.info(`Processing webhook event: ${event.type}, ID: ${event.id}`);

            // IDEMPOTENCY CHECK: Check if this event was already processed
            const isAlreadyProcessed = await PaymentLogs.isWebhookProcessed(event.id);
            if (isAlreadyProcessed) {
                logger.info(`Webhook event ${event.id} already processed, skipping (idempotency)`);
                return { success: true, eventType: event.type, skipped: true, reason: 'duplicate' };
            }

            switch (event.type) {
                case 'checkout.session.completed':
                    await this.handleCheckoutSessionCompleted(event.data.object, event.id);
                    break;

                case 'customer.subscription.created':
                    await this.handleSubscriptionCreated(event.data.object, event.id);
                    break;

                case 'customer.subscription.updated':
                    await this.handleSubscriptionUpdated(event.data.object, event.id);
                    break;

                case 'customer.subscription.deleted':
                    await this.handleSubscriptionDeleted(event.data.object, event.id);
                    break;

                case 'invoice.payment_succeeded':
                    await this.handleInvoicePaymentSucceeded(event.data.object, event.id);
                    break;

                case 'invoice.payment_failed':
                    await this.handleInvoicePaymentFailed(event.data.object, event.id);
                    break;

                case 'customer.subscription.trial_will_end':
                    await this.handleTrialWillEnd(event.data.object, event.id);
                    break;

                case 'checkout.session.expired':
                    await this.handleCheckoutSessionExpired(event.data.object, event.id);
                    break;

                case 'charge.refunded':
                    await this.handleChargeRefunded(event.data.object, event.id);
                    break;

                default:
                    logger.info(`Unhandled webhook event type: ${event.type}`);
            }

            return { success: true, eventType: event.type };

        } catch (error) {
            logger.error(`Error handling webhook event ${event.type}:`, error);
            throw error;
        }
    }

    /**
     * Handle checkout session completed
     * This is the ONLY place where we should activate the user's subscription/trial
     * because this event only fires when the user completes checkout (not when they cancel)
     */
    async handleCheckoutSessionCompleted(session, webhookEventId = null) {
        try {
            const userId = session.metadata?.userId;
            const planType = session.metadata?.planType;

            // Validate required metadata
            if (!userId || !planType) {
                logger.warn(`Checkout session ${session.id} missing required metadata (userId or planType)`);
                return;
            }

            logger.info(`Checkout completed for user: ${userId}, plan: ${planType}, session: ${session.id}, payment_status: ${session.payment_status}`);

            // If it's a subscription checkout, activate the subscription now
            // This is called ONLY when checkout is completed (user didn't cancel)
            if (session.mode === 'subscription') {
                logger.info(`Subscription checkout completed for user: ${userId}, activating subscription...`);
                
                // Mark checkout as completed in subscription record
                // This flag is checked by handleSubscriptionCreated to avoid duplicate activation
                await Subscription.findOneAndUpdate(
                    { userId },
                    { 
                        $set: { 
                            checkoutCompleted: true,
                            stripeSessionId: session.id
                        } 
                    }
                );

                // Get the subscription from Stripe to get trial info
                if (session.subscription) {
                    try {
                        const stripeSubscription = await this.stripe.subscriptions.retrieve(session.subscription);
                        const isTrialing = stripeSubscription.status === 'trialing';
                        
                        // Now activate the user's subscription
                        await this.updateUserSubscription(userId, planType, stripeSubscription.status, stripeSubscription);
                        
                        logger.info(`User ${userId} subscription activated via checkout.session.completed: plan=${planType}, status=${stripeSubscription.status}, isTrialing=${isTrialing}`);

                        // Record payment history for paid (non-trial) checkouts
                        // Trial subscriptions have no charge yet, so skip them
                        if (!isTrialing && session.payment_status === 'paid') {
                            try {
                                let invoiceUrl = null;
                                let invoicePdf = null;
                                let invoiceId = null;
                                let invoiceNumber = null;
                                let amount = 0;
                                let currency = 'usd';

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
                                    amount = invoice.amount_paid || 0;
                                    currency = invoice.currency || 'usd';
                                } else if (stripeSubscription.items?.data?.[0]?.price) {
                                    amount = stripeSubscription.items.data[0].price.unit_amount || 0;
                                    currency = stripeSubscription.items.data[0].price.currency || 'usd';
                                }

                                await this.addPaymentToHistory(userId, {
                                    sessionId: session.id,
                                    amount: amount,
                                    currency: currency,
                                    status: 'paid',
                                    paymentDate: new Date(),
                                    stripePaymentIntentId: session.payment_intent || null,
                                    stripeInvoiceId: invoiceId,
                                    invoiceUrl: invoiceUrl,
                                    invoicePdf: invoicePdf,
                                    invoiceNumber: invoiceNumber,
                                    paymentGateway: 'stripe'
                                });
                                logger.info(`Payment history recorded via checkout.session.completed for user ${userId}`);
                            } catch (historyError) {
                                logger.error(`Error recording payment history in checkout.session.completed for user ${userId}:`, historyError);
                            }
                        }
                        
                        // Log checkout completed event with webhookEventId for idempotency
                        await PaymentLogs.logWebhookEvent({
                            userId,
                            eventType: 'STRIPE_CHECKOUT_COMPLETED',
                            paymentGateway: 'STRIPE',
                            status: 'SUCCESS',
                            subscriptionId: session.subscription,
                            planType: planType,
                            isTrialPayment: isTrialing,
                            trialEndsAt: isTrialing && stripeSubscription.trial_end ? this.safeDate(stripeSubscription.trial_end) : null,
                            newStatus: stripeSubscription.status,
                            message: isTrialing 
                                ? `Checkout completed, trial started for ${planType} plan`
                                : `Checkout completed for ${planType} plan`,
                            source: 'WEBHOOK',
                            webhookEventId
                        });
                    } catch (subError) {
                        logger.error(`Error retrieving subscription ${session.subscription}:`, subError);
                    }
                }
                
                return;
            }

            // Handle one-time payments if needed
            if (session.mode === 'payment') {
                // Handle one-time payment logic here if needed
                logger.info(`One-time payment completed for user: ${userId}`);
            }

        } catch (error) {
            logger.error('Error handling checkout session completed:', error);
            throw error;
        }
    }

    /**
     * Handle subscription created
     * NOTE: This event fires when Stripe creates a subscription, which can happen
     * when payment method is collected (before checkout is completed).
     * We should NOT activate the user's trial here - that should only happen
     * in handleCheckoutSessionCompleted to prevent cancelled checkouts from starting trials.
     */
    async handleSubscriptionCreated(subscription, webhookEventId = null) {
        try {
            const userId = subscription.metadata?.userId;
            const planType = subscription.metadata?.planType;

            // Validate required metadata
            if (!userId || !planType) {
                logger.warn(`Subscription ${subscription.id} missing required metadata (userId or planType)`);
                return;
            }
            const isTrialing = subscription.status === 'trialing';

            logger.info(`Subscription created for user: ${userId}, plan: ${planType}, subscription: ${subscription.id}, status: ${subscription.status}, isTrialing: ${isTrialing}`);

            // Check if checkout was already completed (handled by checkout.session.completed)
            const existingSubscription = await Subscription.findOne({ userId });
            const checkoutAlreadyCompleted = existingSubscription?.checkoutCompleted === true;

            // Read period across API versions (see getSubscriptionPeriod)
            const createdPeriod = this.getSubscriptionPeriod(subscription);

            // Update subscription in our database with Stripe details
            const subscriptionData = {
                stripeSubscriptionId: subscription.id,
                stripeCustomerId: subscription.customer,
                planType: planType,
                stripePriceId: subscription.items.data[0].price.id,
                status: subscription.status,
                paymentStatus: isTrialing ? 'no_payment_required' : (subscription.status === 'active' ? 'paid' : 'pending'),
                amount: subscription.items.data[0].price.unit_amount,
                currency: subscription.items.data[0].price.currency,
                currentPeriodStart: this.safeDate(createdPeriod.start),
                currentPeriodEnd: this.safeDate(createdPeriod.end),
                // Stripe sets current_period_end == trial_end while trialing, so
                // current_period_end alone is correct in both the trial and paid case -
                // see the note on handleSubscriptionUpdated for why trial_end must not be
                // used here (it never clears back to null once a trial has occurred).
                nextBillingDate: this.safeDate(createdPeriod.end),
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
            };

            await this.updateSubscription(userId, subscriptionData);

            // IMPORTANT: Only update user's package type if checkout was already completed
            // OR if this is a non-trial subscription (direct payment completed)
            // This prevents cancelled checkouts from activating trials
            if (checkoutAlreadyCompleted) {
                logger.info(`Checkout already completed for user ${userId}, skipping user update in subscription.created (already handled)`);
            } else if (!isTrialing && subscription.status === 'active') {
                // Non-trial subscription with active status means payment succeeded
                // Safe to activate (this shouldn't normally happen as checkout.session.completed should fire first)
                await this.updateUserSubscription(userId, planType, subscription.status, subscription);
                logger.info(`Non-trial subscription activated for user: ${userId} (active status)`);
            } else {
                // For trial subscriptions, DO NOT activate user here
                // Wait for checkout.session.completed to confirm user didn't cancel
                logger.info(`Subscription created for user ${userId} but waiting for checkout.session.completed before activating trial`);
            }

            logger.info(`Successfully updated subscription record for user: ${userId}`);

            // Log subscription created event with webhookEventId for idempotency
            await PaymentLogs.logWebhookEvent({
                userId,
                eventType: 'STRIPE_SUBSCRIPTION_CREATED',
                paymentGateway: 'STRIPE',
                status: 'SUCCESS',
                subscriptionId: subscription.id,
                planType: planType,
                isTrialPayment: isTrialing,
                trialEndsAt: isTrialing && subscription.trial_end ? this.safeDate(subscription.trial_end) : null,
                newStatus: subscription.status,
                amount: subscription.items.data[0]?.price.unit_amount / 100,
                currency: subscription.items.data[0]?.price.currency?.toUpperCase() || 'USD',
                message: isTrialing 
                    ? `Subscription created with trial for ${planType} plan (pending checkout completion)`
                    : `Subscription created for ${planType} plan`,
                source: 'WEBHOOK',
                webhookEventId,
                metadata: {
                    checkoutCompleted: checkoutAlreadyCompleted,
                    waitingForCheckout: isTrialing && !checkoutAlreadyCompleted
                }
            });

        } catch (error) {
            logger.error('Error handling subscription created:', error);
            throw error;
        }
    }

    /**
     * Normalize subscription status from Stripe to our database format.
     * Stripe uses American spelling 'canceled', we use British spelling 'cancelled'.
     * 'unpaid' and 'incomplete_expired' are Stripe-only terminal states with no matching
     * enum value here - both mean the subscription stopped collecting payment, so they
     * fold into 'cancelled' rather than falling through and failing schema validation.
     * The original Stripe string is preserved separately via `gatewayStatus`.
     */
    normalizeStatus(stripeStatus) {
        if (stripeStatus === 'canceled' || stripeStatus === 'unpaid' || stripeStatus === 'incomplete_expired') {
            return 'cancelled';
        }
        return stripeStatus;
    }

    /**
     * Handle subscription updated
     */
    async handleSubscriptionUpdated(subscription, webhookEventId = null) {
        try {
            const userId = subscription.metadata?.userId;
            const planType = subscription.metadata?.planType;

            // Validate required metadata
            if (!userId) {
                logger.warn(`Subscription ${subscription.id} missing userId in metadata`);
                return;
            }

            const isTrialing = subscription.status === 'trialing';
            // Normalize status from Stripe (canceled -> cancelled)
            const normalizedStatus = this.normalizeStatus(subscription.status);

            logger.info(`Subscription updated for user: ${userId}, status: ${normalizedStatus}, isTrialing: ${isTrialing}`);

            // Read period across API versions (see getSubscriptionPeriod)
            const updatedPeriod = this.getSubscriptionPeriod(subscription);

            // Update subscription in our database
            const subscriptionData = {
                status: normalizedStatus,
                gatewayStatus: subscription.status,
                currentPeriodStart: this.safeDate(updatedPeriod.start),
                currentPeriodEnd: this.safeDate(updatedPeriod.end),
                // BUG FIXED: subscription.trial_end never clears back to null once a trial
                // has occurred - it keeps reporting the original trial-end date forever, even
                // after the subscription has renewed many times as a paid plan. Falling back
                // to it here permanently froze nextBillingDate at the trial date for every
                // user who ever had a trial. Stripe already sets current_period_end == trial_end
                // while actually trialing, so current_period_end alone is correct in both cases.
                nextBillingDate: this.safeDate(updatedPeriod.end),
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
            };

            // Update payment status based on subscription status
            if (normalizedStatus === 'active') {
                subscriptionData.paymentStatus = 'paid';
            } else if (normalizedStatus === 'trialing') {
                subscriptionData.paymentStatus = 'no_payment_required';
            } else if (normalizedStatus === 'past_due') {
                subscriptionData.paymentStatus = 'unpaid';
            }

            await this.updateSubscription(userId, subscriptionData);

            // Update user subscription status.
            //
            // BUG FIXED: a payment-failure status must NEVER restore the user's paid plan.
            // Stripe emits customer.subscription.updated (past_due) within a second of
            // invoice.payment_failed, so this call was overwriting the LITE downgrade that
            // handleInvoicePaymentFailed had just applied - leaving accounts permanently
            // stuck as PRO + past_due, which Manage Accounts renders as "Expired".
            // During the retry window the plan is simply left as-is (a paying customer
            // keeps PRO while Stripe retries); once retries are exhausted the downgrade
            // written by the failure/deleted handlers now survives.
            if (planType) {
                const isPaymentFailureStatus = ['past_due', 'unpaid', 'incomplete', 'incomplete_expired', 'cancelled']
                    .includes(normalizedStatus);
                await this.updateUserSubscription(userId, planType, normalizedStatus, subscription, {
                    preservePackageType: isPaymentFailureStatus
                });
            }

            // If subscription is cancelled, downgrade user to LITE
            if (normalizedStatus === 'cancelled') {
                await this.downgradeUserToLite(userId);
            }

            logger.info(`Successfully updated subscription for user: ${userId}, status: ${normalizedStatus}`);

            // Log subscription status change with webhookEventId for idempotency
            await PaymentLogs.logWebhookEvent({
                userId,
                eventType: 'STRIPE_SUBSCRIPTION_UPDATED',
                paymentGateway: 'STRIPE',
                status: 'SUCCESS',
                subscriptionId: subscription.id,
                planType: planType,
                newStatus: normalizedStatus,
                message: `Subscription status updated to ${normalizedStatus}`,
                source: 'WEBHOOK',
                webhookEventId,
                metadata: {
                    cancelAtPeriodEnd: subscription.cancel_at_period_end,
                    originalStripeStatus: subscription.status
                }
            });

        } catch (error) {
            logger.error('Error handling subscription updated:', error);
            throw error;
        }
    }

    /**
     * Handle subscription deleted
     */
    async handleSubscriptionDeleted(subscription, webhookEventId = null) {
        try {
            const userId = subscription.metadata?.userId;

            // Validate required metadata
            if (!userId) {
                logger.warn(`Subscription ${subscription.id} missing userId in metadata`);
                return;
            }

            logger.info(`Subscription deleted for user: ${userId}`);

            // Update subscription status to cancelled
            await this.updateSubscription(userId, {
                status: 'cancelled',
                paymentStatus: 'unpaid',
                gatewayStatus: subscription.status
            });

            // Downgrade user to LITE plan
            await this.downgradeUserToLite(userId);

            logger.info(`Successfully handled subscription deletion for user: ${userId}`);

            // Log subscription cancelled event with webhookEventId for idempotency
            await PaymentLogs.logWebhookEvent({
                userId,
                eventType: 'STRIPE_SUBSCRIPTION_CANCELLED',
                paymentGateway: 'STRIPE',
                status: 'SUCCESS',
                subscriptionId: subscription.id,
                planType: 'LITE',
                previousPlanType: subscription.metadata?.planType,
                previousStatus: 'active',
                newStatus: 'cancelled',
                message: 'Subscription cancelled, user downgraded to LITE',
                source: 'WEBHOOK',
                webhookEventId
            });

        } catch (error) {
            logger.error('Error handling subscription deleted:', error);
            throw error;
        }
    }

    /**
     * Handle successful invoice payment
     * This is triggered when trial ends and payment is charged, or for regular renewals
     */
    async handleInvoicePaymentSucceeded(invoice, webhookEventId = null) {
        try {
            const subscriptionId = this.getInvoiceSubscriptionId(invoice);

            if (!subscriptionId) {
                return; // Not a subscription invoice
            }

            // Get subscription from Stripe to get metadata
            const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
            let userId = subscription.metadata?.userId;
            let planType = subscription.metadata?.planType;

            // Fallback: if metadata is missing, resolve user from local DB
            if (!userId) {
                logger.warn(`Invoice ${invoice.id} has subscription ${subscriptionId} without userId in metadata, attempting DB fallback`);
                const dbSub = await Subscription.findOne({ stripeSubscriptionId: subscriptionId })
                    || await Subscription.findOne({ stripeCustomerId: subscription.customer });
                if (dbSub) {
                    userId = dbSub.userId?.toString();
                    planType = planType || dbSub.planType;
                    logger.info(`Resolved userId ${userId} via DB fallback for subscription ${subscriptionId}`);
                } else {
                    logger.warn(`Invoice ${invoice.id}: could not resolve user for subscription ${subscriptionId} even with DB fallback`);
                    return;
                }
            }
            
            // Check if this is a trial ending payment (billing_reason will be 'subscription_cycle' after trial)
            const isTrialEndPayment = invoice.billing_reason === 'subscription_cycle' || invoice.billing_reason === 'subscription_create';

            logger.info(`Invoice payment succeeded for user: ${userId}, amount: ${invoice.amount_paid}, billing_reason: ${invoice.billing_reason}, isTrialEndPayment: ${isTrialEndPayment}`);

            // subscription.current_period_end is Stripe's authoritative "next renewal" date
            // (Stripe docs: "End of the current period... At the end of this period, a new
            // invoice will be created"). The invoice's own line-item period is used only as
            // a secondary confirmation - never to override it - because an invoice can carry
            // proration line items (e.g. a mid-cycle plan change) whose period ends around
            // *today*, not at the next renewal. Blindly trusting "the invoice line" here would
            // write the renewal-just-happened date instead of the actual next renewal date.
            const { start: subscriptionPeriodStart, end: subscriptionPeriodEnd } =
                this.getSubscriptionPeriod(subscription);

            const matchingLines = (invoice.lines?.data || []).filter(
                (line) => line.subscription === subscriptionId || line.parent?.subscription_item_details?.subscription === subscriptionId
            );
            // Among this subscription's lines on the invoice, the true renewal period is the
            // one furthest out - proration lines cover short past-to-now spans.
            const invoicePeriodEnd = matchingLines.length
                ? Math.max(...matchingLines.map((line) => line.period?.end || 0)) || null
                : null;

            if (invoicePeriodEnd && subscriptionPeriodEnd && invoicePeriodEnd !== subscriptionPeriodEnd) {
                logger.warn(`Renewal date check: invoice ${invoice.id} line period.end=${invoicePeriodEnd} differs from subscription.current_period_end=${subscriptionPeriodEnd} for subscription ${subscriptionId}. Using subscription.current_period_end (authoritative next-renewal date).`);
            }

            const confirmedPeriodEnd = subscriptionPeriodEnd || invoicePeriodEnd;
            if (!confirmedPeriodEnd) {
                logger.error(`Could not confirm renewal date from Stripe for subscription ${subscriptionId} (invoice ${invoice.id}); leaving currentPeriodEnd/nextBillingDate untouched`);
            }

            // Add payment to history with invoice URLs
            await this.addPaymentToHistory(userId, {
                amount: invoice.amount_paid,
                currency: invoice.currency,
                status: 'paid',
                paymentDate: this.safeDate(invoice.status_transitions.paid_at),
                stripePaymentIntentId: invoice.payment_intent,
                stripeInvoiceId: invoice.id,
                invoiceUrl: invoice.hosted_invoice_url || null,
                invoicePdf: invoice.invoice_pdf || null,
                invoiceNumber: invoice.number || null,
                paymentGateway: 'stripe'
            });

            // Update subscription payment status and renewal dates.
            // current_period_end/nextBillingDate are refreshed here directly (not just
            // via customer.subscription.updated) so renewal date advances even if that
            // separate event is delayed, dropped, or missing metadata.userId.
            const subscriptionUpdate = {
                paymentStatus: 'paid',
                lastPaymentDate: this.safeDate(invoice.status_transitions.paid_at),
                // normalizeStatus() maps Stripe's raw wording (e.g. 'canceled') to this
                // model's enum (e.g. 'cancelled'); writing subscription.status directly
                // throws a validator error and drops the whole update whenever Stripe
                // reports a status this enum doesn't spell the same way.
                status: this.normalizeStatus(subscription.status)
            };
            if (confirmedPeriodEnd) {
                subscriptionUpdate.currentPeriodEnd = this.safeDate(confirmedPeriodEnd);
                // current_period_end == trial_end while actually trialing, so it alone is
                // correct here - trial_end must not be used as a fallback since it never
                // clears back to null once a trial has occurred (see handleSubscriptionUpdated).
                subscriptionUpdate.nextBillingDate = this.safeDate(confirmedPeriodEnd);

                // Only write the period start when we actually resolved one. Assigning an
                // unresolved value here would blank out a previously-correct stored date.
                const confirmedPeriodStart = subscriptionPeriodStart
                    || (matchingLines.length
                        ? Math.min(...matchingLines.map((line) => line.period?.start || Infinity))
                        : null);
                const periodStartDate = this.safeDate(
                    Number.isFinite(confirmedPeriodStart) ? confirmedPeriodStart : null
                );
                if (periodStartDate) {
                    subscriptionUpdate.currentPeriodStart = periodStartDate;
                }
            }
            await this.updateSubscription(userId, subscriptionUpdate);

            // Detect trial-to-paid conversion.
            // Skip $0 trial-start invoices (subscription still trialing).
            // Use PaymentLogs as race-safe check: subscription.updated may flip
            // isInTrialPeriod before this handler runs, so the DB flag alone is unreliable.
            const user = await User.findById(userId);
            let wasInTrial = false;

            if (subscription.status !== 'trialing' && invoice.amount_paid > 0 && subscription.trial_end != null) {
                const alreadyConverted = await PaymentLogs.findOne({ userId, eventType: 'TRIAL_ENDED' });
                wasInTrial = !alreadyConverted;
            }

            if (wasInTrial && user) {
                if (user.isInTrialPeriod) {
                    await User.findByIdAndUpdate(userId, {
                        isInTrialPeriod: false,
                        subscriptionStatus: 'active'
                    });
                }
                logger.info(`Trial ended for user: ${userId}. Payment successfully charged. User now on paid ${planType} plan.`);

                // Send support notification for trial -> paid conversion.
                // Non-blocking for webhook stability.
                try {
                    const formattedAmount = `${(invoice.currency || 'usd').toUpperCase()} ${(invoice.amount_paid || 0) / 100}`;
                    const conversionDate = this.safeDate(invoice.status_transitions?.paid_at)?.toLocaleString() || new Date().toLocaleString();
                    await sendTrialToProSupportEmail({
                        userId: user._id,
                        firstName: user.firstName,
                        lastName: user.lastName,
                        userEmail: user.email,
                        userPhone: user.phone,
                        planType: planType || user.packageType || 'PRO',
                        amountPaid: formattedAmount,
                        invoiceNumber: invoice.number || null,
                        invoiceId: invoice.id || null,
                        conversionDate
                    });
                } catch (supportEmailError) {
                    logger.error(`Non-critical: failed to send trial-to-pro support email for user ${userId}: ${supportEmailError.message}`);
                }
            }

            logger.info(`Successfully recorded payment for user: ${userId}`);

            // Log payment success event with webhookEventId for idempotency
            await PaymentLogs.logWebhookEvent({
                userId,
                eventType: wasInTrial ? 'TRIAL_ENDED' : 'STRIPE_INVOICE_PAID',
                paymentGateway: 'STRIPE',
                status: 'SUCCESS',
                subscriptionId: subscriptionId,
                paymentId: invoice.payment_intent,
                amount: invoice.amount_paid / 100, // Convert from cents
                currency: invoice.currency?.toUpperCase() || 'USD',
                planType: planType,
                previousStatus: wasInTrial ? 'trialing' : 'active',
                newStatus: 'active',
                message: wasInTrial 
                    ? `Trial ended, payment of ${invoice.currency?.toUpperCase() || 'USD'} ${invoice.amount_paid / 100} charged`
                    : `Recurring payment of ${invoice.currency?.toUpperCase() || 'USD'} ${invoice.amount_paid / 100}`,
                source: 'WEBHOOK',
                webhookEventId,
                metadata: {
                    billingReason: invoice.billing_reason,
                    invoiceNumber: invoice.number
                }
            });

        } catch (error) {
            logger.error('Error handling invoice payment succeeded:', error);
            throw error;
        }
    }

    /**
     * Handle failed invoice payment
     * Updates both Subscription and User to reflect payment failure
     * If Stripe has exhausted all retries, downgrade user to LITE
     */
    async handleInvoicePaymentFailed(invoice, webhookEventId = null) {
        try {
            const subscriptionId = this.getInvoiceSubscriptionId(invoice);

            if (!subscriptionId) {
                return; // Not a subscription invoice
            }

            // Get subscription from Stripe to get metadata and status
            const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
            let userId = subscription.metadata?.userId;
            let planType = subscription.metadata?.planType;

            // Fallback: if metadata is missing, resolve user from local DB
            if (!userId) {
                logger.warn(`Invoice ${invoice.id} has subscription ${subscriptionId} without userId in metadata, attempting DB fallback`);
                const dbSub = await Subscription.findOne({ stripeSubscriptionId: subscriptionId })
                    || await Subscription.findOne({ stripeCustomerId: subscription.customer });
                if (dbSub) {
                    userId = dbSub.userId?.toString();
                    planType = planType || dbSub.planType;
                    logger.info(`Resolved userId ${userId} via DB fallback for subscription ${subscriptionId}`);
                } else {
                    logger.warn(`Invoice ${invoice.id}: could not resolve user for subscription ${subscriptionId} even with DB fallback`);
                    return;
                }
            }

            logger.warn(`Invoice payment failed for user: ${userId}, amount: ${invoice.amount_due}, attempt: ${invoice.attempt_count}, next attempt: ${invoice.next_payment_attempt ? 'scheduled' : 'none'}`);

            // Check if this is the final failure (no more retries scheduled)
            // Stripe typically retries 3-4 times over ~3 weeks before giving up
            const isFinalFailure = !invoice.next_payment_attempt || subscription.status === 'canceled' || subscription.status === 'unpaid';

            if (isFinalFailure) {
                // No more retries - downgrade user to LITE
                logger.warn(`Final payment failure for user ${userId}. No more retries. Downgrading to LITE.`);
                
                // Update subscription to cancelled
                await this.updateSubscription(userId, {
                    status: 'cancelled',
                    paymentStatus: 'unpaid',
                    gatewayStatus: subscription.status
                });

                // Downgrade user to LITE
                await User.findByIdAndUpdate(userId, {
                    packageType: 'LITE',
                    subscriptionStatus: 'cancelled',
                    isInTrialPeriod: false
                });

                logger.info(`User ${userId} downgraded to LITE after final payment failure`);

                // Log the downgrade event with webhookEventId for idempotency
                await PaymentLogs.logWebhookEvent({
                    userId,
                    eventType: 'STRIPE_INVOICE_PAYMENT_FAILED',
                    paymentGateway: 'STRIPE',
                    status: 'FAILED',
                    subscriptionId: subscriptionId,
                    paymentId: invoice.payment_intent,
                    amount: invoice.amount_due / 100, // Convert from cents
                    currency: invoice.currency?.toUpperCase() || 'USD',
                    planType: 'LITE',
                    previousPlanType: planType,
                    previousStatus: 'active',
                    newStatus: 'cancelled',
                    errorMessage: invoice.last_finalization_error?.message || 'All payment retries exhausted',
                    errorCode: invoice.last_finalization_error?.code || 'FINAL_FAILURE',
                    message: `Final payment failure. User downgraded to LITE after ${invoice.attempt_count} attempts.`,
                    source: 'WEBHOOK',
                    webhookEventId,
                    metadata: {
                        attemptCount: invoice.attempt_count,
                        nextPaymentAttempt: null,
                        stripeSubscriptionStatus: subscription.status
                    }
                });
            } else {
                // More retries scheduled - mark as past_due but keep PRO access
                await this.updateSubscription(userId, {
                    status: 'past_due',
                    paymentStatus: 'unpaid',
                    gatewayStatus: subscription.status
                });

                // Update User subscriptionStatus to past_due (but keep packageType as PRO)
                await User.findByIdAndUpdate(userId, {
                    subscriptionStatus: 'past_due'
                });

                logger.info(`User ${userId} marked as past_due. Payment retry scheduled.`);

                // Log payment failure event with webhookEventId for idempotency
                await PaymentLogs.logWebhookEvent({
                    userId,
                    eventType: 'STRIPE_INVOICE_PAYMENT_FAILED',
                    paymentGateway: 'STRIPE',
                    status: 'FAILED',
                    subscriptionId: subscriptionId,
                    paymentId: invoice.payment_intent,
                    amount: invoice.amount_due / 100, // Convert from cents
                    currency: invoice.currency?.toUpperCase() || 'USD',
                    planType: planType,
                    previousStatus: 'active',
                    newStatus: 'past_due',
                    errorMessage: invoice.last_finalization_error?.message,
                    errorCode: invoice.last_finalization_error?.code,
                    message: `Payment failed (attempt ${invoice.attempt_count}). Retry scheduled.`,
                    source: 'WEBHOOK',
                    webhookEventId,
                    metadata: {
                        attemptCount: invoice.attempt_count,
                        nextPaymentAttempt: invoice.next_payment_attempt ? new Date(invoice.next_payment_attempt * 1000) : null
                    }
                });
            }

        } catch (error) {
            logger.error('Error handling invoice payment failed:', error);
            throw error;
        }
    }

    /**
     * Handle trial will end (sent 3 days before trial ends by Stripe)
     */
    async handleTrialWillEnd(subscription, webhookEventId = null) {
        try {
            const userId = subscription.metadata?.userId;
            const planType = subscription.metadata?.planType;

            // Validate required metadata
            if (!userId) {
                logger.warn(`Subscription ${subscription.id} missing userId in metadata for trial_will_end`);
                return;
            }

            const trialEndDate = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;

            logger.info(`Trial will end for user: ${userId}, plan: ${planType}, trial ends on: ${trialEndDate}. Stripe will automatically charge the payment method on file.`);

            // Log trial will end event with webhookEventId for idempotency
            await PaymentLogs.logWebhookEvent({
                userId,
                eventType: 'TRIAL_WILL_END',
                paymentGateway: 'STRIPE',
                status: 'SUCCESS',
                subscriptionId: subscription.id,
                planType: planType,
                trialEndsAt: trialEndDate,
                message: `Trial will end on ${trialEndDate?.toISOString() || 'unknown date'}`,
                source: 'WEBHOOK',
                webhookEventId
            });

            // TODO: Send email notification about trial ending
            // Example: await emailService.sendTrialEndingEmail(userId, trialEndDate, planType);

        } catch (error) {
            logger.error('Error handling trial will end:', error);
            throw error;
        }
    }

    /**
     * Handle checkout session expired
     * This is called when a checkout session expires (user didn't complete checkout)
     * We should clean up any subscriptions that were created but never completed
     */
    async handleCheckoutSessionExpired(session, webhookEventId = null) {
        try {
            const userId = session.metadata?.userId;
            const planType = session.metadata?.planType;

            logger.info(`Checkout session expired for user: ${userId}, plan: ${planType}, session: ${session.id}`);

            if (!userId) {
                logger.warn('Checkout session expired without userId in metadata');
                return;
            }

            // Check if there's an incomplete subscription for this user
            const dbSubscription = await Subscription.findOne({ 
                userId,
                stripeSessionId: session.id,
                checkoutCompleted: { $ne: true }
            });

            if (dbSubscription) {
                // If a subscription was created in Stripe, cancel it
                if (dbSubscription.stripeSubscriptionId) {
                    try {
                        await this.stripe.subscriptions.cancel(dbSubscription.stripeSubscriptionId);
                        logger.info(`Cancelled incomplete Stripe subscription ${dbSubscription.stripeSubscriptionId} for user ${userId}`);
                    } catch (cancelError) {
                        // Subscription might already be cancelled or not exist
                        logger.warn(`Could not cancel subscription ${dbSubscription.stripeSubscriptionId}: ${cancelError.message}`);
                    }
                }

                // Update subscription status to indicate checkout was cancelled
                await Subscription.findOneAndUpdate(
                    { userId, stripeSessionId: session.id },
                    { 
                        $set: { 
                            status: 'cancelled',
                            paymentStatus: 'unpaid',
                            checkoutCompleted: false
                        } 
                    }
                );

                logger.info(`Marked subscription as cancelled for user ${userId} after checkout expiry`);

                // Log checkout expired event with webhookEventId for idempotency
                await PaymentLogs.logWebhookEvent({
                    userId,
                    eventType: 'STRIPE_CHECKOUT_EXPIRED',
                    paymentGateway: 'STRIPE',
                    status: 'CANCELLED',
                    subscriptionId: dbSubscription.stripeSubscriptionId,
                    planType: planType,
                    message: 'Checkout session expired, subscription cancelled',
                    source: 'WEBHOOK',
                    webhookEventId
                });
            }

        } catch (error) {
            logger.error('Error handling checkout session expired:', error);
            throw error;
        }
    }

    /**
     * Handle charge refunded
     * This is called when a payment is refunded
     * For full refunds on subscriptions, we may need to downgrade the user
     */
    async handleChargeRefunded(charge, webhookEventId = null) {
        try {
            const chargeId = charge.id;
            const customerId = charge.customer;
            const amountRefunded = charge.amount_refunded;
            const amountTotal = charge.amount;
            const isFullRefund = amountRefunded >= amountTotal;

            logger.info(`Charge refunded: ${chargeId}, customer: ${customerId}, refunded: ${amountRefunded}, total: ${amountTotal}, fullRefund: ${isFullRefund}`);

            // Find subscription by customer ID
            const dbSubscription = await Subscription.findOne({ stripeCustomerId: customerId });
            
            if (!dbSubscription) {
                logger.info(`No subscription found for Stripe customer: ${customerId}`);
                return;
            }

            const userId = dbSubscription.userId;
            const previousStatus = dbSubscription.status;
            const previousPlanType = dbSubscription.planType;

            // Log the refund event with webhookEventId for idempotency
            await PaymentLogs.logWebhookEvent({
                userId,
                eventType: 'STRIPE_CHARGE_REFUNDED',
                paymentGateway: 'STRIPE',
                status: 'SUCCESS',
                subscriptionId: dbSubscription.stripeSubscriptionId,
                paymentId: chargeId,
                amount: amountRefunded / 100, // Convert from cents
                currency: (charge.currency || 'usd').toUpperCase(),
                planType: previousPlanType,
                previousStatus: previousStatus,
                message: isFullRefund 
                    ? `Full refund processed: ${(charge.currency || 'USD').toUpperCase()} ${amountRefunded / 100}`
                    : `Partial refund processed: ${(charge.currency || 'USD').toUpperCase()} ${amountRefunded / 100}`,
                source: 'WEBHOOK',
                webhookEventId,
                metadata: {
                    chargeId,
                    amountTotal: amountTotal / 100,
                    amountRefunded: amountRefunded / 100,
                    isFullRefund
                }
            });

            // For full refunds, consider downgrading the user
            // This depends on business logic - some may want to downgrade immediately,
            // others may wait for subscription cancellation webhook
            if (isFullRefund) {
                logger.info(`Full refund processed for user ${userId}, charge ${chargeId}`);
                
                // Update subscription status to indicate refund
                await Subscription.findOneAndUpdate(
                    { userId, stripeCustomerId: customerId },
                    { 
                        $set: { 
                            paymentStatus: 'refunded',
                            // Don't change subscription status here - let the cancellation webhook handle it
                            // or the admin can manually cancel
                        } 
                    }
                );

                // Note: We don't automatically downgrade on refund because:
                // 1. Partial refunds shouldn't affect access
                // 2. Full refunds may be accompanied by subscription cancellation
                // 3. Business may want to handle this case-by-case
                // The subscription.deleted webhook will handle actual cancellation
            }

        } catch (error) {
            logger.error('Error handling charge refunded:', error);
            throw error;
        }
    }

    /**
     * Update subscription in database
     */
    async updateSubscription(userId, updateData) {
        try {
            // Use $set explicitly to ensure payment status is updated correctly
            const subscription = await Subscription.findOneAndUpdate(
                { userId },
                { $set: updateData },
                { new: true, upsert: true, runValidators: true }
            );

            if (!subscription) {
                logger.error(`Failed to update subscription via webhook for user: ${userId}`);
            }

            logger.info(`Subscription updated via webhook for user: ${userId}, paymentStatus: ${subscription?.paymentStatus}`);
        } catch (error) {
            logger.error('Error updating subscription in database:', error);
            throw error;
        }
    }

    /**
     * Update user subscription details
     */
    async updateUserSubscription(userId, planType, subscriptionStatus, subscription = null, options = {}) {
        try {
            const updateData = {
                subscriptionStatus: subscriptionStatus,
                reviewRequestAuthStatus: true,
            };

            // `preservePackageType` leaves the user's current plan untouched. Used for
            // payment-failure statuses so this handler cannot re-grant a paid plan that
            // handleInvoicePaymentFailed / handleSubscriptionDeleted just took away.
            if (!options.preservePackageType) {
                updateData.packageType = planType;
            }

            // Handle trial status
            if (subscriptionStatus === 'trialing') {
                updateData.isInTrialPeriod = true;
                updateData.servedTrial = true; // User authorized payment method for free trial
                if (subscription && subscription.trial_end) {
                    updateData.trialEndsDate = this.safeDate(subscription.trial_end);
                }
            } else {
                updateData.isInTrialPeriod = false;
            }
            
            // If user purchased AGENCY plan, update accessType to enterpriseAdmin
            if (planType === 'AGENCY') {
                updateData.accessType = 'enterpriseAdmin';
            }
            
            await User.findByIdAndUpdate(userId, updateData);
            logger.info(`Updated user ${userId}: packageType=${options.preservePackageType ? '(preserved)' : planType}, subscriptionStatus=${subscriptionStatus}, isInTrialPeriod=${updateData.isInTrialPeriod}`);
        } catch (error) {
            logger.error('Error updating user subscription:', error);
            throw error;
        }
    }

    /**
     * Downgrade user to LITE plan
     * Resets all subscription-related fields including trial status
     */
    async downgradeUserToLite(userId) {
        try {
            await User.findByIdAndUpdate(userId, {
                packageType: 'LITE',
                subscriptionStatus: 'cancelled',
                accessType: 'user', // Reset accessType to regular user when downgrading
                isInTrialPeriod: false, // Reset trial status
                reviewRequestAuthStatus: false,
                // Note: We keep servedTrial=true so user can't get another trial
                // trialEndsDate is left as-is for historical reference
            });

            logger.info(`Downgraded user ${userId} to LITE plan (trial status reset)`);
        } catch (error) {
            logger.error('Error downgrading user to LITE:', error);
            throw error;
        }
    }

    /**
     * Add payment to history
     */
    async addPaymentToHistory(userId, paymentData) {
        try {
            // Check if payment already exists to prevent duplicates
            const subscription = await Subscription.findOne({ userId });
            
            if (subscription && subscription.paymentHistory) {
                // Check for duplicate by stripePaymentIntentId or stripeInvoiceId
                const existingPayment = subscription.paymentHistory.find(payment => 
                    (paymentData.stripePaymentIntentId && payment.stripePaymentIntentId === paymentData.stripePaymentIntentId) ||
                    (paymentData.stripeInvoiceId && payment.stripeInvoiceId === paymentData.stripeInvoiceId)
                );
                
                if (existingPayment) {
                    logger.info(`Payment already exists in history for user ${userId}, paymentIntentId: ${paymentData.stripePaymentIntentId || 'N/A'}, invoiceId: ${paymentData.stripeInvoiceId || 'N/A'}, skipping duplicate`);
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
            
            logger.info(`Payment added to history via webhook for user ${userId}, paymentIntentId: ${paymentData.stripePaymentIntentId || 'N/A'}, invoiceId: ${paymentData.stripeInvoiceId || 'N/A'}`);
        } catch (error) {
            logger.error('Error adding payment to history:', error);
            throw error;
        }
    }
}

module.exports = new StripeWebhookService(); 