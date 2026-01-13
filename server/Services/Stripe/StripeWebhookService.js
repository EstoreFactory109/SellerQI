// Stripe integration for webhook handling
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const Subscription = require('../../models/user-auth/SubscriptionModel');
const User = require('../../models/user-auth/userModel');
const logger = require('../../utils/Logger');

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
     * Handle webhook events
     */
    async handleWebhookEvent(event) {
        try {
            logger.info(`Processing webhook event: ${event.type}, ID: ${event.id}`);

            switch (event.type) {
                case 'checkout.session.completed':
                    await this.handleCheckoutSessionCompleted(event.data.object);
                    break;

                case 'customer.subscription.created':
                    await this.handleSubscriptionCreated(event.data.object);
                    break;

                case 'customer.subscription.updated':
                    await this.handleSubscriptionUpdated(event.data.object);
                    break;

                case 'customer.subscription.deleted':
                    await this.handleSubscriptionDeleted(event.data.object);
                    break;

                case 'invoice.payment_succeeded':
                    await this.handleInvoicePaymentSucceeded(event.data.object);
                    break;

                case 'invoice.payment_failed':
                    await this.handleInvoicePaymentFailed(event.data.object);
                    break;

                case 'customer.subscription.trial_will_end':
                    await this.handleTrialWillEnd(event.data.object);
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
     */
    async handleCheckoutSessionCompleted(session) {
        try {
            const userId = session.metadata.userId;
            const planType = session.metadata.planType;

            logger.info(`Checkout completed for user: ${userId}, plan: ${planType}, session: ${session.id}`);

            // If it's a subscription checkout, the subscription will be handled in subscription.created event
            if (session.mode === 'subscription') {
                logger.info(`Subscription checkout completed, waiting for subscription.created event`);
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
     */
    async handleSubscriptionCreated(subscription) {
        try {
            const userId = subscription.metadata.userId;
            const planType = subscription.metadata.planType;
            const isTrialing = subscription.status === 'trialing';

            logger.info(`Subscription created for user: ${userId}, plan: ${planType}, subscription: ${subscription.id}, status: ${subscription.status}, isTrialing: ${isTrialing}`);

            // Update subscription in our database
            const subscriptionData = {
                stripeSubscriptionId: subscription.id,
                stripeCustomerId: subscription.customer,
                planType: planType,
                stripePriceId: subscription.items.data[0].price.id,
                status: subscription.status,
                paymentStatus: isTrialing ? 'no_payment_required' : (subscription.status === 'active' ? 'paid' : 'pending'),
                amount: subscription.items.data[0].price.unit_amount,
                currency: subscription.items.data[0].price.currency,
                currentPeriodStart: this.safeDate(subscription.current_period_start),
                currentPeriodEnd: this.safeDate(subscription.current_period_end),
                nextBillingDate: this.safeDate(subscription.trial_end || subscription.current_period_end),
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
            };

            await this.updateSubscription(userId, subscriptionData);

            // Update user's package type and subscription status
            await this.updateUserSubscription(userId, planType, subscription.status, subscription);

            logger.info(`Successfully updated subscription for user: ${userId}`);

        } catch (error) {
            logger.error('Error handling subscription created:', error);
            throw error;
        }
    }

    /**
     * Handle subscription updated
     */
    async handleSubscriptionUpdated(subscription) {
        try {
            const userId = subscription.metadata.userId;
            const planType = subscription.metadata.planType;
            const isTrialing = subscription.status === 'trialing';

            logger.info(`Subscription updated for user: ${userId}, status: ${subscription.status}, isTrialing: ${isTrialing}`);

            // Update subscription in our database
            const subscriptionData = {
                status: subscription.status,
                currentPeriodStart: this.safeDate(subscription.current_period_start),
                currentPeriodEnd: this.safeDate(subscription.current_period_end),
                nextBillingDate: this.safeDate(subscription.trial_end || subscription.current_period_end),
                cancelAtPeriodEnd: subscription.cancel_at_period_end,
            };

            // Update payment status based on subscription status
            if (subscription.status === 'active') {
                subscriptionData.paymentStatus = 'paid';
            } else if (subscription.status === 'trialing') {
                subscriptionData.paymentStatus = 'no_payment_required';
            } else if (subscription.status === 'past_due') {
                subscriptionData.paymentStatus = 'unpaid';
            }

            await this.updateSubscription(userId, subscriptionData);

            // Update user subscription status
            await this.updateUserSubscription(userId, planType, subscription.status, subscription);

            // If subscription is cancelled, downgrade user to LITE
            if (subscription.status === 'canceled') {
                await this.downgradeUserToLite(userId);
            }

            logger.info(`Successfully updated subscription for user: ${userId}, status: ${subscription.status}`);

        } catch (error) {
            logger.error('Error handling subscription updated:', error);
            throw error;
        }
    }

    /**
     * Handle subscription deleted
     */
    async handleSubscriptionDeleted(subscription) {
        try {
            const userId = subscription.metadata.userId;

            logger.info(`Subscription deleted for user: ${userId}`);

            // Update subscription status to cancelled
            await this.updateSubscription(userId, {
                status: 'cancelled',
                paymentStatus: 'unpaid'
            });

            // Downgrade user to LITE plan
            await this.downgradeUserToLite(userId);

            logger.info(`Successfully handled subscription deletion for user: ${userId}`);

        } catch (error) {
            logger.error('Error handling subscription deleted:', error);
            throw error;
        }
    }

    /**
     * Handle successful invoice payment
     * This is triggered when trial ends and payment is charged, or for regular renewals
     */
    async handleInvoicePaymentSucceeded(invoice) {
        try {
            const subscriptionId = invoice.subscription;
            
            if (!subscriptionId) {
                return; // Not a subscription invoice
            }

            // Get subscription from Stripe to get metadata
            const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
            const userId = subscription.metadata.userId;
            const planType = subscription.metadata.planType;
            
            // Check if this is a trial ending payment (billing_reason will be 'subscription_cycle' after trial)
            const isTrialEndPayment = invoice.billing_reason === 'subscription_cycle' || invoice.billing_reason === 'subscription_create';

            logger.info(`Invoice payment succeeded for user: ${userId}, amount: ${invoice.amount_paid}, billing_reason: ${invoice.billing_reason}, isTrialEndPayment: ${isTrialEndPayment}`);

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

            // Update subscription payment status
            await this.updateSubscription(userId, {
                paymentStatus: 'paid',
                lastPaymentDate: this.safeDate(invoice.status_transitions.paid_at),
                status: subscription.status
            });

            // Update user - if this was a trial that just ended, update trial status
            const user = await User.findById(userId);
            if (user && user.isInTrialPeriod) {
                await User.findByIdAndUpdate(userId, {
                    isInTrialPeriod: false,
                    subscriptionStatus: 'active'
                });
                logger.info(`Trial ended for user: ${userId}. Payment successfully charged. User now on paid ${planType} plan.`);
            }

            logger.info(`Successfully recorded payment for user: ${userId}`);

        } catch (error) {
            logger.error('Error handling invoice payment succeeded:', error);
            throw error;
        }
    }

    /**
     * Handle failed invoice payment
     */
    async handleInvoicePaymentFailed(invoice) {
        try {
            const subscriptionId = invoice.subscription;
            
            if (!subscriptionId) {
                return; // Not a subscription invoice
            }

            // Get subscription from Stripe to get metadata
            const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
            const userId = subscription.metadata.userId;

            logger.warn(`Invoice payment failed for user: ${userId}, amount: ${invoice.amount_due}`);

            // Update subscription payment status
            await this.updateSubscription(userId, {
                paymentStatus: 'unpaid'
            });

            // TODO: Send email notification about failed payment
            // TODO: Implement retry logic or grace period

            logger.info(`Updated payment status for failed payment, user: ${userId}`);

        } catch (error) {
            logger.error('Error handling invoice payment failed:', error);
            throw error;
        }
    }

    /**
     * Handle trial will end (sent 3 days before trial ends by Stripe)
     */
    async handleTrialWillEnd(subscription) {
        try {
            const userId = subscription.metadata.userId;
            const planType = subscription.metadata.planType;
            const trialEndDate = subscription.trial_end ? new Date(subscription.trial_end * 1000) : null;

            logger.info(`Trial will end for user: ${userId}, plan: ${planType}, trial ends on: ${trialEndDate}. Stripe will automatically charge the payment method on file.`);

            // TODO: Send email notification about trial ending
            // Example: await emailService.sendTrialEndingEmail(userId, trialEndDate, planType);

        } catch (error) {
            logger.error('Error handling trial will end:', error);
            throw error;
        }
    }

    /**
     * Update subscription in database
     */
    async updateSubscription(userId, updateData) {
        try {
            await Subscription.findOneAndUpdate(
                { userId },
                updateData,
                { new: true, upsert: true }
            );
        } catch (error) {
            logger.error('Error updating subscription in database:', error);
            throw error;
        }
    }

    /**
     * Update user subscription details
     */
    async updateUserSubscription(userId, planType, subscriptionStatus, subscription = null) {
        try {
            const updateData = {
                packageType: planType,
                subscriptionStatus: subscriptionStatus,
            };

            // Handle trial status
            if (subscriptionStatus === 'trialing') {
                updateData.isInTrialPeriod = true;
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
            logger.info(`Updated user ${userId}: packageType=${planType}, subscriptionStatus=${subscriptionStatus}, isInTrialPeriod=${updateData.isInTrialPeriod}`);
        } catch (error) {
            logger.error('Error updating user subscription:', error);
            throw error;
        }
    }

    /**
     * Downgrade user to LITE plan
     */
    async downgradeUserToLite(userId) {
        try {
            await User.findByIdAndUpdate(userId, {
                packageType: 'LITE',
                subscriptionStatus: 'cancelled',
                accessType: 'user' // Reset accessType to regular user when downgrading
            });

            logger.info(`Downgraded user ${userId} to LITE plan`);
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
            await Subscription.findOneAndUpdate(
                { userId },
                { 
                    $push: { 
                        paymentHistory: paymentData 
                    } 
                }
            );
        } catch (error) {
            logger.error('Error adding payment to history:', error);
            throw error;
        }
    }
}

module.exports = new StripeWebhookService(); 