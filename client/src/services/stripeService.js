import axiosInstance from '../config/axios.config.js';

class StripeService {
    constructor() {
        this.publishableKey = null;
    }

    /**
     * Get Stripe configuration including publishable key
     */
    async getConfig() {
        try {
            const response = await axiosInstance.get('/app/stripe/config');
            this.publishableKey = response.data.data.publishableKey;
            return response.data.data;
        } catch (error) {
            console.error('Error getting Stripe config:', error);
            throw error;
        }
    }

    /**
     * Create checkout session and redirect to Stripe
     * @param {string} planType - Plan type (PRO or AGENCY)
     * @param {string} [couponCode] - Optional coupon/promo code to apply automatically
     */
    async createCheckoutSession(planType, couponCode = null) {
        try {
            const requestBody = { planType };
            if (couponCode) {
                requestBody.couponCode = couponCode;
            }
            
            const response = await axiosInstance.post('/app/stripe/create-checkout-session', requestBody);

            const { url } = response.data.data;
            
            // Redirect to Stripe checkout
            window.location.href = url;
            
            return response.data;
        } catch (error) {
            console.error('Error creating checkout session:', error);
            throw error;
        }
    }

    /**
     * Handle payment success
     */
    async handlePaymentSuccess(sessionId) {
        try {
            const response = await axiosInstance.get(`/app/stripe/payment-success?session_id=${sessionId}`);
            return response.data;
        } catch (error) {
            console.error('Error handling payment success:', error);
            throw error;
        }
    }

    /**
     * Get user subscription details
     */
    async getSubscription() {
        try {
            const response = await axiosInstance.get('/app/stripe/subscription');
            return response.data.data;
        } catch (error) {
            console.error('Error getting subscription:', error);
            throw error;
        }
    }

    /**
     * Cancel subscription
     */
    async cancelSubscription(cancelAtPeriodEnd = true) {
        try {
            const response = await axiosInstance.post('/app/stripe/cancel-subscription', {
                cancelAtPeriodEnd
            });
            return response.data;
        } catch (error) {
            console.error('Error cancelling subscription:', error);
            throw error;
        }
    }

    /**
     * Reactivate subscription
     */
    async reactivateSubscription() {
        try {
            const response = await axiosInstance.post('/app/stripe/reactivate-subscription');
            return response.data;
        } catch (error) {
            console.error('Error reactivating subscription:', error);
            throw error;
        }
    }

    /**
     * Get payment history
     */
    async getPaymentHistory() {
        try {
            const response = await axiosInstance.get('/app/stripe/payment-history');
            return response.data.data.paymentHistory;
        } catch (error) {
            console.error('Error getting payment history:', error);
            throw error;
        }
    }

    /**
     * Check if plan requires payment
     */
    isPaymentRequired(planType) {
        return ['PRO', 'AGENCY'].includes(planType);
    }
}

export default new StripeService(); 