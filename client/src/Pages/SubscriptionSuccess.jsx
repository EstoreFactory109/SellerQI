import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';
import stripeService from '../services/stripeService';

export default function SubscriptionSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    // Clear any stored intended plan
    localStorage.removeItem('intendedPlan');
    
    // Verify subscription status
    verifySubscription();
  }, []);

  const verifySubscription = async () => {
    try {
      const status = await stripeService.getSubscriptionStatus();
      setLoading(false);
      
      // Clear intended plan since subscription is complete
      localStorage.removeItem('intendedPlan');
      
      // Redirect based on subscription plan after 3 seconds
      setTimeout(() => {
        if (status.plan === 'PRO' || status.plan === 'AGENCY') {
          // For paid plans, redirect to connect amazon page
          navigate('/connect-to-amazon');
        } else {
          // For LITE plan, redirect to dashboard
          navigate('/seller-central-checker/dashboard');
        }
      }, 3000);
    } catch (error) {
      console.error('Error verifying subscription:', error);
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        <CheckCircle className="w-20 h-20 text-green-500 mx-auto mb-6" />
        <h1 className="text-3xl font-bold text-gray-900 mb-4">
          Subscription Successful!
        </h1>
        <p className="text-gray-600 mb-8">
          Thank you for subscribing. Your account has been upgraded and you now have access to all premium features.
        </p>
        <div className="text-sm text-gray-500 mb-4">
          {loading ? (
            <p>Verifying your subscription...</p>
          ) : (
            <p>You will be redirected to complete your account setup...</p>
          )}
        </div>
      </div>
    </div>
  );
}