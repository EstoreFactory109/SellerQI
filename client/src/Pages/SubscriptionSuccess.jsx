import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { CheckCircle } from 'lucide-react';
import stripeService from '../services/stripeService';
import AgencyClientRegistrationForm from '../Components/Agency/AgencyClientRegistrationForm';
import agencyService from '../services/agencyService';

export default function SubscriptionSuccess() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState(true);
  const [subscriptionData, setSubscriptionData] = useState(null);
  const [showAgencyForm, setShowAgencyForm] = useState(false);
  const sessionId = searchParams.get('session_id');

  useEffect(() => {
    // Clear any stored intended plan
    localStorage.removeItem('intendedPlan');
    
    // Verify subscription status and check for agency owner cookie
    verifySubscriptionAndAgencyStatus();
  }, []);

  const verifySubscriptionAndAgencyStatus = async () => {
    try {
      const status = await stripeService.getSubscriptionStatus();
      setSubscriptionData(status);
      
      // Check if user has agency plan
      if (status.plan === 'AGENCY') {
        // Call the backend to set agency owner cookie if needed
        try {
          await agencyService.checkAgencyOwnerStatus();
          setShowAgencyForm(true);
        } catch (error) {
          console.error('Error setting agency owner cookie:', error);
        }
      }
      
      setLoading(false);
      
      // Clear intended plan since subscription is complete
      localStorage.removeItem('intendedPlan');
      
      // If not agency plan, redirect after 3 seconds to connect-to-amazon
      if (status.plan !== 'AGENCY') {
        setTimeout(() => {
          navigate('/connect-to-amazon');
        }, 3000);
      }
    } catch (error) {
      console.error('Error verifying subscription:', error);
      setLoading(false);
    }
  };

  const handleClientRegistrationSuccess = (clientData) => {
    setShowAgencyForm(false);
    // Redirect to connect amazon page after successful client registration
    setTimeout(() => {
      navigate('/connect-to-amazon');
    }, 1000);
  };

  const handleSkipClientRegistration = () => {
    setShowAgencyForm(false);
    // If they skip, redirect to dashboard
    setTimeout(() => {
      navigate('/seller-central-checker/dashboard');
    }, 1000);
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-32 w-32 border-b-2 border-green-500 mx-auto"></div>
          <p className="mt-4 text-gray-600">Verifying your subscription...</p>
        </div>
      </div>
    );
  }

  if (showAgencyForm) {
    return (
      <div className="min-h-screen bg-gray-50 py-12 px-4 sm:px-6 lg:px-8">
        <div className="max-w-4xl mx-auto">
          {/* Success Header */}
          <div className="text-center mb-8">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-4" />
            <h1 className="text-3xl font-bold text-gray-900 mb-2">
              Welcome to Agency Plan!
            </h1>
            <p className="text-lg text-gray-600">
              Your subscription is now active. Let's register your first client to get started.
            </p>
          </div>

          {/* Agency Client Registration Form */}
          <AgencyClientRegistrationForm
            onSuccess={handleClientRegistrationSuccess}
            onCancel={handleSkipClientRegistration}
          />

          <div className="text-center mt-6">
            <p className="text-sm text-gray-500">
              You can always add more clients later from your dashboard
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
        <CheckCircle className="w-16 h-16 text-green-500 mx-auto mb-6" />
        
        <h1 className="text-2xl font-bold text-gray-900 mb-4">
          Subscription Successful!
        </h1>
        
        <p className="text-gray-600 mb-6">
          Thank you for subscribing to {subscriptionData?.plan || 'our service'}! 
          You now have access to all the features included in your plan.
        </p>
        
        <div className="bg-gray-50 rounded-lg p-4 mb-6">
          <h3 className="font-semibold text-gray-900 mb-2">What's Next?</h3>
          <p className="text-sm text-gray-600">
            You'll be redirected to connect your Amazon account to start analyzing your products.
          </p>
        </div>
        
        <div className="text-sm text-gray-500">
          Redirecting in a few seconds...
        </div>
      </div>
    </div>
  );
};