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
            
            // Log the key being received from backend
            const keyId = response.data.data?.keyId;
            if (keyId) {
                const keyType = keyId.startsWith('rzp_test_') ? 'TEST' : 
                               keyId.startsWith('rzp_live_') ? 'LIVE' : 'UNKNOWN';
                console.log(`Received Razorpay ${keyType} key from backend: ${keyId.substring(0, 15)}...`);
            }
            
            return response.data.data;
        } catch (error) {
            console.error('Error creating Razorpay subscription:', error);
            // Extract and log the actual error message from server
            const errorMessage = error.response?.data?.message || error.message || 'Failed to create subscription';
            console.error('Server error message:', errorMessage);
            // Throw a more descriptive error
            const enhancedError = new Error(errorMessage);
            enhancedError.originalError = error;
            throw enhancedError;
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

            // Verify the key before using it
            const keyId = subscriptionData.keyId;
            if (!keyId) {
                throw new Error('Razorpay key ID not received from server');
            }
            
            // Log warning if live key is detected in what appears to be a development environment
            if (keyId.startsWith('rzp_live_') && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')) {
                console.warn('⚠️ WARNING: Using LIVE Razorpay key in localhost! This should be a TEST key.');
            }

            // Configure Razorpay options for subscription
            const options = {
                key: keyId,
                subscription_id: subscriptionData.subscriptionId,
                name: 'SellerQI',
                description: subscriptionData.description || 'Pro Plan - Monthly Subscription',
                image: 'https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png',
                prefill: subscriptionData.prefill,
                theme: {
                    color: '#4f46e5'
                },
                notes: {
                    plan: 'Pro Plan',
                    billing_cycle: 'Monthly'
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
                    const error = response.error || {};
                    let errorMessage = error.description || 'Payment failed';
                    
                    // Provide more specific error messages based on error type
                    if (error.reason === 'card_mandate_card_not_supported' || 
                        (error.description && error.description.includes('Card not supported for recurring payments'))) {
                        errorMessage = 'This card does not support recurring payments. Please use a different card that supports automatic payments, or use UPI/Netbanking for subscription payments.';
                    } else if (error.description && error.description.includes('bank or wallet gateway')) {
                        errorMessage = 'Payment failed at the bank or wallet gateway. Please try a different payment method or contact your bank.';
                    } else if (error.code === 'BAD_REQUEST_ERROR') {
                        if (error.reason && error.reason !== 'NA') {
                            errorMessage = `${error.description || 'Payment failed'}. Reason: ${error.reason}. Please try a different payment method.`;
                        } else {
                            errorMessage = 'Payment request was invalid. Please try again or use a different payment method.';
                        }
                    } else if (error.code === 'GATEWAY_ERROR') {
                        errorMessage = 'Payment gateway error. Please try again in a few moments or use a different payment method.';
                    } else if (error.reason && error.reason !== 'NA') {
                        errorMessage = `${error.description || 'Payment failed'}. Reason: ${error.reason}`;
                    }
                    
                    onError({
                        message: errorMessage,
                        code: error.code,
                        reason: error.reason,
                        source: error.source,
                        step: error.step,
                        metadata: error.metadata || {}
                    });
                }
            });

            razorpay.open();

        } catch (error) {
            console.error('Error initiating Razorpay payment:', error);
            // Extract the actual error message
            const errorMessage = error.message || error.response?.data?.message || 'Failed to initiate payment';
            if (onError) {
                onError({
                    message: errorMessage,
                    originalError: error
                });
            }
        }
    }

    /**
     * Check if plan requires payment via Razorpay (for India)
     */
    isPaymentRequired(planType) {
        return planType === 'PRO';
    }

    /**
     * Get user's Razorpay subscription details
     */
    async getSubscription() {
        try {
            const response = await axiosInstance.get('/app/razorpay/subscription');
            return response.data.data;
        } catch (error) {
            console.error('Error getting Razorpay subscription:', error);
            throw error;
        }
    }

    /**
     * Cancel Razorpay subscription
     */
    async cancelSubscription() {
        try {
            const response = await axiosInstance.post('/app/razorpay/cancel-subscription');
            return response.data;
        } catch (error) {
            console.error('Error cancelling Razorpay subscription:', error);
            throw error;
        }
    }

    /**
     * Get payment history from Razorpay
     */
    async getPaymentHistory() {
        try {
            const response = await axiosInstance.get('/app/razorpay/payment-history');
            return response.data.data.paymentHistory;
        } catch (error) {
            console.error('Error getting Razorpay payment history:', error);
            throw error;
        }
    }

    /**
     * Get invoice download URL
     * @param {string} paymentId - Razorpay payment ID
     * @returns {Promise<{invoiceUrl: string, invoicePdf: string}>}
     */
    async getInvoiceDownloadUrl(paymentId) {
        try {
            const response = await axiosInstance.get(`/app/razorpay/invoice-download?paymentId=${paymentId}`);
            return response.data.data;
        } catch (error) {
            console.error('Error getting Razorpay invoice download URL:', error);
            throw error;
        }
    }

    /**
     * Download invoice
     * @param {string} paymentId - Razorpay payment ID
     */
    async downloadInvoice(paymentId) {
        try {
            const invoiceData = await this.getInvoiceDownloadUrl(paymentId);
            
            // Prefer PDF URL, fallback to invoice URL, then receipt URL
            const downloadUrl = invoiceData.invoicePdf || invoiceData.invoiceUrl || invoiceData.receiptUrl;
            
            if (downloadUrl) {
                // Open in new tab for download
                window.open(downloadUrl, '_blank');
                return { success: true, url: downloadUrl };
            } else {
                throw new Error('Invoice URL not available');
            }
        } catch (error) {
            console.error('Error downloading Razorpay invoice:', error);
            throw error;
        }
    }
}

export default new RazorpayService();

