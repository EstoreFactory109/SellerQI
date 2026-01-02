import axiosInstance from '../config/axios.config.js';

class RazorpayService {
    constructor() {
        this.keyId = null;
        this.scriptLoaded = false;
    }

    /**
     * Load Razorpay script dynamically
     */
    async loadScript() {
        if (this.scriptLoaded) {
            return true;
        }

        return new Promise((resolve) => {
            const script = document.createElement('script');
            script.src = 'https://checkout.razorpay.com/v1/checkout.js';
            script.onload = () => {
                this.scriptLoaded = true;
                resolve(true);
            };
            script.onerror = () => {
                console.error('Failed to load Razorpay SDK');
                resolve(false);
            };
            document.body.appendChild(script);
        });
    }

    /**
     * Get Razorpay configuration
     */
    async getConfig() {
        try {
            const response = await axiosInstance.get('/app/razorpay/config');
            this.keyId = response.data.data.keyId;
            return response.data.data;
        } catch (error) {
            console.error('Error getting Razorpay config:', error);
            throw error;
        }
    }

    /**
     * Create Razorpay subscription
     */
    async createSubscription(planType) {
        try {
            const response = await axiosInstance.post('/app/razorpay/create-order', {
                planType: planType
            });
            return response.data.data;
        } catch (error) {
            console.error('Error creating Razorpay subscription:', error);
            throw error;
        }
    }

    /**
     * Verify payment on backend
     */
    async verifyPayment(paymentData) {
        try {
            const response = await axiosInstance.post('/app/razorpay/verify-payment', paymentData);
            return response.data;
        } catch (error) {
            console.error('Error verifying payment:', error);
            throw error;
        }
    }

    /**
     * Open Razorpay checkout for subscription and handle payment
     * @param {string} planType - The plan type (PRO)
     * @param {function} onSuccess - Callback on successful payment
     * @param {function} onError - Callback on payment failure
     */
    async initiatePayment(planType, onSuccess, onError) {
        try {
            // Load Razorpay script
            const scriptLoaded = await this.loadScript();
            if (!scriptLoaded) {
                throw new Error('Failed to load payment SDK');
            }

            // Create subscription
            const subscriptionData = await this.createSubscription(planType);

            // Configure Razorpay options for subscription
            const options = {
                key: subscriptionData.keyId,
                subscription_id: subscriptionData.subscriptionId,
                name: 'SellerQI',
                description: subscriptionData.description,
                prefill: subscriptionData.prefill,
                theme: {
                    color: '#3B4A6B'
                },
                modal: {
                    ondismiss: () => {
                        console.log('Razorpay checkout closed');
                        if (onError) {
                            onError({ message: 'Payment cancelled by user' });
                        }
                    }
                },
                handler: async (response) => {
                    try {
                        // Verify subscription payment on backend
                        const verificationResult = await this.verifyPayment({
                            razorpay_subscription_id: response.razorpay_subscription_id,
                            razorpay_payment_id: response.razorpay_payment_id,
                            razorpay_signature: response.razorpay_signature
                        });

                        if (verificationResult.statusCode === 200) {
                            if (onSuccess) {
                                onSuccess(verificationResult.data);
                            }
                        } else {
                            throw new Error(verificationResult.message || 'Payment verification failed');
                        }
                    } catch (error) {
                        console.error('Payment verification error:', error);
                        if (onError) {
                            onError(error);
                        }
                    }
                }
            };

            // Open Razorpay checkout
            const razorpay = new window.Razorpay(options);
            
            razorpay.on('payment.failed', (response) => {
                console.error('Payment failed:', response.error);
                if (onError) {
                    onError({
                        message: response.error.description || 'Payment failed',
                        code: response.error.code,
                        reason: response.error.reason
                    });
                }
            });

            razorpay.open();

        } catch (error) {
            console.error('Error initiating Razorpay payment:', error);
            if (onError) {
                onError(error);
            }
        }
    }

    /**
     * Check if plan requires payment via Razorpay (for India)
     */
    isPaymentRequired(planType) {
        return planType === 'PRO';
    }
}

export default new RazorpayService();

