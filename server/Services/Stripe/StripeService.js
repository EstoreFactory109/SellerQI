const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const logger = require('../../utils/Logger.js');
const { ApiError } = require('../../utils/ApiError.js');
const UserModel = require('../../models/userModel.js');

class StripeService {
    constructor() {
        this.stripe = stripe;
        
        // Define your product/price IDs
        this.products = {
            LITE: {
                priceId: null, // Free tier - no Stripe price ID needed
                amount: 0,
                name: 'LITE',
                features: [
                    'Product Audit Summary'
                ]
            },
            PRO: {
                priceId: process.env.STRIPE_PRO_PRICE_ID || 'price_1RZ9XXQ2Bl5VhXOdPROPRICE', // You'll need to create this in Stripe Dashboard
                amount: 99,
                name: 'PRO',
                features: [
                    'Product Audit Summary',
                    'Download Reports',
                    'Fix Recommendations',
                    'Expert Consultation',
                    'Track Multiple Products',
                    'Issue Breakdown'
                ]
            },
            AGENCY: {
                priceId: process.env.STRIPE_AGENCY_PRICE_ID || 'price_1RZ9XXQ2Bl5VhXOdAGENCYPRICE', // You'll need to create this in Stripe Dashboard
                amount: 49,
                name: 'AGENCY',
                features: [
                    'Product Audit Summary',
                    'Download Reports',
                    'Fix Recommendations',
                    'Expert Consultation',
                    'Track Multiple Products',
                    'Issue Breakdown'
                ]
            }
        };
    }

    // Create a new customer in Stripe
    async createCustomer(user) {
        try {
            const customer = await this.stripe.customers.create({
                email: user.email,
                name: `${user.firstName} ${user.lastName}`,
                metadata: {
                    userId: user._id.toString()
                }
            });
            
            return customer;
        } catch (error) {
            logger.error(`Stripe createCustomer error: ${error.message}`);
            throw new ApiError(500, 'Failed to create customer in Stripe');
        }
    }

    // Get or create customer
    async getOrCreateCustomer(userId) {
        try {
            const user = await UserModel.findById(userId);
            if (!user) {
                throw new ApiError(404, 'User not found');
            }

            // Check if user already has a Stripe customer ID
            if (user.stripeCustomerId) {
                // Verify customer still exists in Stripe
                try {
                    const customer = await this.stripe.customers.retrieve(user.stripeCustomerId);
                    return customer;
                } catch (error) {
                    // Customer doesn't exist in Stripe, create new one
                    logger.warn(`Stripe customer ${user.stripeCustomerId} not found, creating new customer`);
                }
            }

            // Create new customer
            const customer = await this.createCustomer(user);
            
            // Save Stripe customer ID to user
            user.stripeCustomerId = customer.id;
            await user.save();

            return customer;
        } catch (error) {
            logger.error(`Stripe getOrCreateCustomer error: ${error.message}`);
            throw error;
        }
    }

    // Create checkout session for subscription
    async createCheckoutSession(userId, planType, successUrl, cancelUrl) {
        try {
            if (!this.products[planType]) {
                throw new ApiError(400, 'Invalid plan type');
            }

            const plan = this.products[planType];
            
            // Free plan doesn't need Stripe checkout
            if (planType === 'LITE') {
                return { 
                    url: successUrl,
                    isFree: true 
                };
            }

            const customer = await this.getOrCreateCustomer(userId);

            const session = await this.stripe.checkout.sessions.create({
                customer: customer.id,
                payment_method_types: ['card'],
                line_items: [
                    {
                        price: plan.priceId,
                        quantity: 1,
                    },
                ],
                mode: 'subscription',
                success_url: successUrl,
                cancel_url: cancelUrl,
                metadata: {
                    userId: userId.toString(),
                    planType: planType
                },
                subscription_data: {
                    metadata: {
                        userId: userId.toString(),
                        planType: planType
                    }
                },
                allow_promotion_codes: true,
                billing_address_collection: 'auto'
            });

            return session;
        } catch (error) {
            logger.error(`Stripe createCheckoutSession error: ${error.message}`);
            throw error;
        }
    }

    // Create portal session for managing subscription
    async createPortalSession(userId, returnUrl) {
        try {
            const customer = await this.getOrCreateCustomer(userId);

            const session = await this.stripe.billingPortal.sessions.create({
                customer: customer.id,
                return_url: returnUrl,
            });

            return session;
        } catch (error) {
            logger.error(`Stripe createPortalSession error: ${error.message}`);
            throw error;
        }
    }

    // Get customer's active subscription
    async getActiveSubscription(userId) {
        try {
            const user = await UserModel.findById(userId);
            if (!user || !user.stripeCustomerId) {
                return null;
            }

            const subscriptions = await this.stripe.subscriptions.list({
                customer: user.stripeCustomerId,
                status: 'active',
                limit: 1
            });

            return subscriptions.data[0] || null;
        } catch (error) {
            logger.error(`Stripe getActiveSubscription error: ${error.message}`);
            return null;
        }
    }

    // Cancel subscription
    async cancelSubscription(subscriptionId) {
        try {
            const subscription = await this.stripe.subscriptions.update(subscriptionId, {
                cancel_at_period_end: true
            });

            return subscription;
        } catch (error) {
            logger.error(`Stripe cancelSubscription error: ${error.message}`);
            throw error;
        }
    }

    // Reactivate subscription (remove cancellation)
    async reactivateSubscription(subscriptionId) {
        try {
            const subscription = await this.stripe.subscriptions.update(subscriptionId, {
                cancel_at_period_end: false
            });

            return subscription;
        } catch (error) {
            logger.error(`Stripe reactivateSubscription error: ${error.message}`);
            throw error;
        }
    }

    // Update subscription (upgrade/downgrade)
    async updateSubscription(subscriptionId, newPlanType) {
        try {
            if (!this.products[newPlanType] || newPlanType === 'LITE') {
                throw new ApiError(400, 'Invalid plan type for update');
            }

            const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
            
            const updatedSubscription = await this.stripe.subscriptions.update(subscriptionId, {
                items: [{
                    id: subscription.items.data[0].id,
                    price: this.products[newPlanType].priceId,
                }],
                proration_behavior: 'always_invoice',
                metadata: {
                    planType: newPlanType
                }
            });

            return updatedSubscription;
        } catch (error) {
            logger.error(`Stripe updateSubscription error: ${error.message}`);
            throw error;
        }
    }

    // Get invoice preview for subscription update
    async getInvoicePreview(subscriptionId, newPlanType) {
        try {
            if (!this.products[newPlanType] || newPlanType === 'LITE') {
                throw new ApiError(400, 'Invalid plan type');
            }

            const subscription = await this.stripe.subscriptions.retrieve(subscriptionId);
            
            const items = [{
                id: subscription.items.data[0].id,
                price: this.products[newPlanType].priceId,
            }];

            const invoice = await this.stripe.invoices.retrieveUpcoming({
                customer: subscription.customer,
                subscription: subscriptionId,
                subscription_items: items,
                subscription_proration_behavior: 'always_invoice',
            });

            return {
                amountDue: invoice.amount_due / 100, // Convert from cents
                currency: invoice.currency,
                nextPaymentDate: new Date(invoice.period_end * 1000)
            };
        } catch (error) {
            logger.error(`Stripe getInvoicePreview error: ${error.message}`);
            throw error;
        }
    }

    // Get customer's payment methods
    async getPaymentMethods(userId) {
        try {
            const user = await UserModel.findById(userId);
            if (!user || !user.stripeCustomerId) {
                return [];
            }

            const paymentMethods = await this.stripe.paymentMethods.list({
                customer: user.stripeCustomerId,
                type: 'card',
            });

            return paymentMethods.data;
        } catch (error) {
            logger.error(`Stripe getPaymentMethods error: ${error.message}`);
            return [];
        }
    }

    // Get customer's invoices
    async getInvoices(userId, limit = 10) {
        try {
            const user = await UserModel.findById(userId);
            if (!user || !user.stripeCustomerId) {
                return [];
            }

            const invoices = await this.stripe.invoices.list({
                customer: user.stripeCustomerId,
                limit: limit,
            });

            return invoices.data.map(invoice => ({
                id: invoice.id,
                amount: invoice.amount_paid / 100,
                currency: invoice.currency,
                status: invoice.status,
                date: new Date(invoice.created * 1000),
                invoicePdf: invoice.invoice_pdf,
                hostedUrl: invoice.hosted_invoice_url
            }));
        } catch (error) {
            logger.error(`Stripe getInvoices error: ${error.message}`);
            return [];
        }
    }
}

module.exports = new StripeService();