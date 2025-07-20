import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { AlertCircle, ArrowLeft, CreditCard, RefreshCcw } from 'lucide-react';

export default function PaymentFailed() {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        // Clear any intended plan from localStorage
        localStorage.removeItem('intendedPlan');

        // Get error details from URL params if available
        const error = searchParams.get('error');
        const errorDescription = searchParams.get('error_description');
        
        if (errorDescription) {
            setErrorMessage(errorDescription);
        } else if (error) {
            setErrorMessage(error);
        } else {
            setErrorMessage('Your payment could not be processed at this time.');
        }
    }, [searchParams]);

    const commonErrors = {
        'card_declined': 'Your card was declined. Please try a different payment method.',
        'insufficient_funds': 'Insufficient funds. Please check your account balance.',
        'expired_card': 'Your card has expired. Please use a different card.',
        'incorrect_cvc': 'The CVC code is incorrect. Please check and try again.',
        'processing_error': 'A processing error occurred. Please try again.',
        'authentication_required': 'Additional authentication is required. Please try again.'
    };

    const getErrorMessage = () => {
        const error = searchParams.get('error');
        return commonErrors[error] || errorMessage || 'Your payment could not be processed at this time.';
    };

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
            <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
                <div className="mb-6">
                    <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-red-100">
                        <AlertCircle className="h-8 w-8 text-red-600" />
                    </div>
                </div>
                
                <h1 className="text-2xl font-bold text-gray-900 mb-4">
                    Payment Failed
                </h1>
                
                <p className="text-gray-600 mb-6">
                    {getErrorMessage()}
                </p>

                <div className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6">
                    <h3 className="text-sm font-medium text-red-800 mb-2">Common solutions:</h3>
                    <ul className="text-xs text-red-700 space-y-1 text-left">
                        <li>• Check your card details and billing address</li>
                        <li>• Ensure you have sufficient funds</li>
                        <li>• Try a different payment method</li>
                        <li>• Contact your bank if the issue persists</li>
                    </ul>
                </div>
                
                <div className="space-y-3">
                    <button
                        onClick={() => navigate('/pricing')}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-md transition duration-200 flex items-center justify-center gap-2"
                    >
                        <RefreshCcw className="w-4 h-4" />
                        Try Again
                    </button>
                    
                    <button
                        onClick={() => navigate('/seller-central-checker/dashboard')}
                        className="w-full bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium py-3 px-4 rounded-md transition duration-200 flex items-center justify-center gap-2"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Continue with Free Plan
                    </button>
                </div>

                <div className="mt-6 pt-6 border-t border-gray-200">
                    <p className="text-xs text-gray-400">
                        Still having trouble? Contact our support team at{' '}
                        <a href="mailto:support@sellerqi.com" className="text-blue-600 hover:text-blue-700">
                            support@sellerqi.com
                        </a>
                    </p>
                </div>
            </div>
        </div>
    );
} 