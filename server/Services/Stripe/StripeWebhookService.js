const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const logger = require('../../utils/Logger.js');
const UserModel = require('../../models/userModel.js');
const SubscriptionModel = require('../../models/SubscriptionModel.js');
const { createAgencyOwnerToken } = require('../../utils/Tokens.js');

class StripeWebhookService {
    constructor() {
        this.stripe = stripe;
        this.endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;
    }

    // Verify webhook signature
    verifyWebhookSignature(payload, signature) {
        try {
            return this.stripe.webhooks.constructEvent(
                payload,
                signature,
                this.endpointSecret
            );
        } catch (error) {
            logger.error(`Webhook signature verification failed: ${error.message}`);
            throw error;
        }
    }

    // Handle checkout session completed
    async handleCheckoutSessionCompleted(session) {
        try {
            const userId = session.metadata.userId;
            const planType = session.metadata.planType;
            const subscriptionId = session.subscription;

            // Get the subscription details
            const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);

            // Update user with subscription info
            const user = await UserModel.findById(userId);
            if (!user) {
                throw new Error(`User ${userId} not found`);
            }

            user.stripeSubscriptionId = subscriptionId;
            user.subscriptionStatus = 'active';
            user.subscriptionPlan = planType;

            // Generate agency owner token for AGENCY plan
            if (planType === 'AGENCY') {
                const agencyOwnerToken = await createAgencyOwnerToken(userId);
                if (agencyOwnerToken) {
                    user.agencyOwnerToken = agencyOwnerToken;
                    logger.info(`Agency owner token generated for user ${userId}`);
                } else {
                    logger.error(`Failed to generate agency owner token for user ${userId}`);
                }
            }

            await user.save();

            // Create subscription record
            await SubscriptionModel.create({
                userId: userId,
                stripeSubscriptionId: subscriptionId,
                stripeCustomerId: session.customer,
                planType: planType,
                status: 'active',
                currentPeriodStart: new Date(subscription.current_period_start * 1000),
                currentPeriodEnd: new Date(subscription.current_period_end * 1000),
                cancelAtPeriodEnd: false
            });

            logger.info(`Subscription created for user ${userId} - Plan: ${planType}`);
        } catch (error) {
            logger.error(`Error handling checkout session completed: ${error.message}`);
            throw error;
        }
    }

    // Handle subscription updated
    async handleSubscriptionUpdated(subscription) {
        try {
            const subscriptionRecord = await SubscriptionModel.findOne({
                stripeSubscriptionId: subscription.id
            });

            if (!subscriptionRecord) {
                logger.warn(`Subscription record not found for ${subscription.id}`);
                return;
            }

            // Update subscription record
            subscriptionRecord.status = subscription.status;
            subscriptionRecord.currentPeriodStart = new Date(subscription.current_period_start * 1000);
            subscriptionRecord.currentPeriodEnd = new Date(subscription.current_period_end * 1000);
            subscriptionRecord.cancelAtPeriodEnd = subscription.cancel_at_period_end;
            
            if (subscription.canceled_at) {
                subscriptionRecord.canceledAt = new Date(subscription.canceled_at * 1000);
            }

            // Update plan type if changed
            if (subscription.metadata.planType) {
                subscriptionRecord.planType = subscription.metadata.planType;
            }

            await subscriptionRecord.save();

            // Update user record
            const user = await UserModel.findById(subscriptionRecord.userId);
            if (user) {
                user.subscriptionStatus = subscription.status;
                user.subscriptionPlan = subscriptionRecord.planType;
                await user.save();
            }

            logger.info(`Subscription updated for ${subscription.id}`);
        } catch (error) {
            logger.error(`Error handling subscription updated: ${error.message}`);
            throw error;
        }
    }

    // Handle subscription deleted
    async handleSubscriptionDeleted(subscription) {
        try {
            const subscriptionRecord = await SubscriptionModel.findOne({
                stripeSubscriptionId: subscription.id
            });

            if (!subscriptionRecord) {
                logger.warn(`Subscription record not found for ${subscription.id}`);
                return;
            }

            // Update subscription record
            subscriptionRecord.status = 'canceled';
            subscriptionRecord.endedAt = new Date();
            await subscriptionRecord.save();

            // Update user record
            const user = await UserModel.findById(subscriptionRecord.userId);
            if (user) {
                user.subscriptionStatus = 'canceled';
                user.subscriptionPlan = 'LITE'; // Revert to free plan
                await user.save();
            }

            logger.info(`Subscription canceled for ${subscription.id}`);
        } catch (error) {
            logger.error(`Error handling subscription deleted: ${error.message}`);
            throw error;
        }
    }

    // Handle invoice payment succeeded
    async handleInvoicePaymentSucceeded(invoice) {
        try {
            logger.info(`Invoice payment succeeded: ${invoice.id} for ${invoice.amount_paid / 100} ${invoice.currency}`);
            
            // You can add custom logic here like sending receipt emails
        } catch (error) {
            logger.error(`Error handling invoice payment succeeded: ${error.message}`);
            throw error;
        }
    }

    // Handle invoice payment failed
    async handleInvoicePaymentFailed(invoice) {
        try {
            logger.warn(`Invoice payment failed: ${invoice.id} for customer ${invoice.customer}`);
            
            // You can add custom logic here like sending payment failure emails
            // or updating user access
        } catch (error) {
            logger.error(`Error handling invoice payment failed: ${error.message}`);
            throw error;
        }
    }

    // Process webhook event
    async processWebhookEvent(event) {
        try {
            switch (event.type) {
                case 'checkout.session.completed':
                    await this.handleCheckoutSessionCompleted(event.data.object);
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
                
                default:
                    logger.info(`Unhandled webhook event type: ${event.type}`);
            }
        } catch (error) {
            logger.error(`Error processing webhook event ${event.type}: ${error.message}`);
            throw error;
        }
    }
}

module.exports = new StripeWebhookService();