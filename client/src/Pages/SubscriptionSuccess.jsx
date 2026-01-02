import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import stripeService from '../services/stripeService';

export default function SubscriptionSuccess() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [loading, setLoading] = useState(true);
    const [status, setStatus] = useState('processing');
    const [planType, setPlanType] = useState('');

    useEffect(() => {
        const processPayment = async () => {
            try {
                const sessionId = searchParams.get('session_id');
                const gateway = searchParams.get('gateway');
                
                if (gateway === 'razorpay') {
                    // Razorpay payment was already verified in the payment flow
                    // Just show success and redirect
                    setPlanType('PRO');
                    setStatus('success');
                    
                    // Clear any intended plan/package from localStorage
                    localStorage.removeItem('intendedPlan');
                    localStorage.removeItem('intendedPackage');
                    localStorage.removeItem('intendedCountry');
                    localStorage.removeItem('previousPlan');
                    
                    // Redirect to connect-to-amazon
                    setTimeout(() => {
                        navigate('/connect-to-amazon');
                    }, 3000);
                } else if (sessionId) {
                    // Handle Stripe payment success
                    setStatus('confirming');
                    const result = await stripeService.handlePaymentSuccess(sessionId);
                    
                    if (result.data && result.data.success) {
                        setPlanType(result.data.planType);
                        setStatus('success');
                        
                        // Clear any intended plan/package from localStorage
                        localStorage.removeItem('intendedPlan');
                        localStorage.removeItem('intendedPackage');
                        localStorage.removeItem('previousPlan');
                        
                        // Redirect based on plan type
                        setTimeout(() => {
                            if (result.data.planType === 'AGENCY') {
                                // User purchased AGENCY plan, redirect to client registration
                                navigate('/agency-client-registration');
                            } else {
                                // PRO plan: Always redirect to connect-to-amazon for new users
                                // This is where they connect their Amazon account
                                navigate('/connect-to-amazon');
                            }
                        }, 3000);
                    } else {
                        setStatus('error');
                        // Redirect to payment failed page after a delay
                        setTimeout(() => {
                            navigate('/payment-failed?error=payment_processing_failed');
                        }, 2000);
                    }
                } else {
                    // No session ID, redirect to dashboard
                    setStatus('success');
                    // Clear any intended plan from localStorage
                    localStorage.removeItem('intendedPlan');
                    localStorage.removeItem('intendedPackage');
                    
                    // Redirect to connect-to-amazon
                    setTimeout(() => {
                            navigate('/connect-to-amazon');
                    }, 3000);
                }
                
            } catch (error) {
                console.error('Error processing payment:', error);
                setStatus('error');
                
                // Redirect to payment failed page with error details
                setTimeout(() => {
                    const errorMessage = error.response?.data?.message || 'payment_processing_error';
                    navigate(`/payment-failed?error=${encodeURIComponent(errorMessage)}`);
                }, 2000);
            } finally {
                setLoading(false);
            }
        };

        processPayment();
    }, [navigate, searchParams]);

    const getStatusMessage = () => {
        switch (status) {
            case 'processing':
                return 'Processing your request...';
            case 'confirming':
                return 'Confirming your payment...';
            case 'success':
                return planType ? `Payment successful! Welcome to ${planType} plan!` : 'Welcome to SellerQI!';
            case 'error':
                return 'There was an issue processing your payment. Please contact support.';
            default:
                return 'Setting up your account...';
        }
    };

    const getRedirectMessage = () => {
        if (status === 'error') {
            return 'Redirecting to error page...';
        }
        return 'Redirecting to dashboard...';
    };

    const getIconColor = () => {
        return status === 'error' ? 'bg-red-100' : 'bg-green-100';
    };

    const getIcon = () => {
        if (status === 'error') {
            return (
                <svg className="h-6 w-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path>
                </svg>
            );
        }
        return (
            <svg className="h-6 w-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path>
            </svg>
        );
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
            <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
                <div className="mb-6">
                    <div className={`mx-auto flex items-center justify-center h-12 w-12 rounded-full ${getIconColor()}`}>
                        {getIcon()}
                    </div>
                </div>
                
                <h1 className="text-2xl font-bold text-gray-900 mb-4">
                    {status === 'error' ? 'Payment Issue' : 'Welcome to SellerQI!'}
                </h1>
                
                <p className="text-gray-600 mb-6">
                    {getStatusMessage()}
                </p>
                
                {status !== 'error' && (
                    <p className="text-sm text-gray-500 mb-4">
                        {getRedirectMessage()}
                    </p>
                )}
                
                {getRedirectMessage()}
                
                {(loading || status !== 'error') && (
                    <div className="flex justify-center mt-4">
                        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                    </div>
                )}
            </div>
        </div>
    );
}