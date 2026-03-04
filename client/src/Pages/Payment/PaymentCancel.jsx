import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { X, ArrowLeft, CreditCard } from 'lucide-react';

export default function PaymentCancel() {
    const navigate = useNavigate();

    useEffect(() => {
        // Clear any intended plan from localStorage
        localStorage.removeItem('intendedPlan');
    }, []);

    return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
            <div className="max-w-md w-full bg-white shadow-lg rounded-lg p-8 text-center">
                <div className="mb-6">
                    <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-yellow-100">
                        <X className="h-8 w-8 text-yellow-600" />
                    </div>
                </div>
                
                <h1 className="text-2xl font-bold text-gray-900 mb-4">
                    Payment Cancelled
                </h1>
                
                <p className="text-gray-600 mb-6">
                    No worries! Your payment was cancelled and no charges were made to your account.
                </p>

                <p className="text-sm text-gray-500 mb-8">
                    You can try again anytime or continue with our free plan.
                </p>
                
                <div className="space-y-3">
                    <button
                        onClick={() => navigate('/pricing')}
                        className="w-full bg-blue-600 hover:bg-blue-700 text-white font-medium py-3 px-4 rounded-md transition duration-200 flex items-center justify-center gap-2"
                    >
                        <CreditCard className="w-4 h-4" />
                        Try Payment Again
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
                        Need help? Contact our support team at{' '}
                        <a href="mailto:support@sellerqi.com" className="text-blue-600 hover:text-blue-700">
                            support@sellerqi.com
                        </a>
                    </p>
                </div>
            </div>
        </div>
    );
} 