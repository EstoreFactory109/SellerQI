import React, { useState, useEffect } from 'react';
import { Check, X, Loader2, Zap, Users, Crown, Sparkles } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useSelector } from 'react-redux';
import axiosInstance from '../config/axios.config.js';
import stripeService from '../services/stripeService.js';

export default function PricingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState({});
  const [showCancelledMessage, setShowCancelledMessage] = useState(false);
  
  // Get user auth status from Redux and localStorage fallback
  const isAuthenticatedRedux = useSelector(state => state.auth?.isAuthenticated || false);
  const isAuthenticatedLocal = localStorage.getItem('isAuth') === 'true';
  const isAuthenticated = isAuthenticatedRedux || isAuthenticatedLocal;
  
  // Get user data to access current plan
  const user = useSelector((state) => state.Auth?.user);
  const currentPlan = user?.packageType || null;
  
  useEffect(() => {
    // Check if user came here from cancelled payment
    if (searchParams.get('cancelled') === 'true') {
      setShowCancelledMessage(true);
      setTimeout(() => {
        setShowCancelledMessage(false);
      }, 5000);
    }

    // Check if user intended to activate free trial after signup
    const intendedAction = localStorage.getItem('intendedAction');
    if (intendedAction === 'free-trial' && isAuthenticated) {
      setTimeout(() => {
        handleFreeTrial();
      }, 1000);
    }
  }, [searchParams, isAuthenticated]);

  const handleSubscribe = async (planType) => {
    if (!isAuthenticated) {
      localStorage.setItem('intendedPlan', planType);
      navigate('/sign-up');
      return;
    }

    setLoading(prev => ({ ...prev, [planType]: true }));

    try {
      if (['PRO', 'AGENCY'].includes(planType)) {
        if (isAuthenticated && currentPlan) {
          localStorage.setItem('previousPlan', currentPlan);
        }
        await stripeService.createCheckoutSession(planType);
      } else {
        throw new Error('Invalid plan type');
      }
    } catch (error) {
      console.error('Error handling subscription:', error);
      alert(error.response?.data?.message || 'Failed to process subscription. Please try again.');
    } finally {
      setTimeout(() => {
        setLoading(prev => ({ ...prev, [planType]: false }));
      }, 500);
    }
  };

  const handleFreeTrial = async () => {
    if (!isAuthenticated) {
      localStorage.setItem('intendedAction', 'free-trial');
      navigate('/sign-up');
      return;
    }

    setLoading(prev => ({ ...prev, freeTrial: true }));

    try {
      const response = await axiosInstance.post('/app/activate-free-trial');
      
      if (response.status === 200) {
        localStorage.removeItem('intendedAction');
        setTimeout(() => {
          navigate('/connect-to-amazon');
        }, 500);
      }
    } catch (error) {
      console.error('Error activating free trial:', error);
      alert(error.response?.data?.message || 'Failed to activate free trial. Please try again.');
    } finally {
      setTimeout(() => {
        setLoading(prev => ({ ...prev, freeTrial: false }));
      }, 500);
    }
  };

  return (
    <div className="h-screen w-screen bg-gradient-to-br from-slate-50 via-white to-slate-100 flex flex-col overflow-hidden">
      {/* Decorative Background Elements */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-40 -right-40 w-80 h-80 bg-gradient-to-br from-[#3B4A6B]/10 to-emerald-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-40 -left-40 w-80 h-80 bg-gradient-to-br from-emerald-500/10 to-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-gradient-to-br from-[#3B4A6B]/5 to-transparent rounded-full blur-3xl" />
      </div>

      {/* Cancelled Payment Notification */}
      <AnimatePresence>
        {showCancelledMessage && (
          <motion.div
            initial={{ opacity: 0, y: -50 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -50 }}
            className="absolute top-4 left-1/2 -translate-x-1/2 z-50 bg-amber-50 border border-amber-200 text-amber-800 px-6 py-3 rounded-xl shadow-lg flex items-center gap-3"
          >
            <X className="w-5 h-5" />
            <span className="text-sm font-medium">Payment was cancelled. You can try again anytime!</span>
            <button onClick={() => setShowCancelledMessage(false)} className="ml-2 hover:bg-amber-100 rounded-full p-1">
              <X className="w-4 h-4" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Content */}
      <div className="relative flex-1 flex flex-col items-center justify-center px-4 py-6">
        {/* Header Section */}
        <motion.div
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="text-center mb-8"
        >
          {/* Logo */}
          <img 
            src="https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png" 
            alt="SellerQI Logo" 
            className="h-10 mx-auto mb-6"
          />
          
          <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-3">
            Choose Your Plan
          </h1>
          <p className="text-gray-600 text-base max-w-lg mx-auto">
            Select the plan that best fits your business needs
          </p>
        </motion.div>

        {/* Pricing Cards */}
        <div className="w-full max-w-5xl mx-auto">
          <div className="grid lg:grid-cols-3 gap-5 items-stretch">
            
            {/* Free Trial Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="relative bg-white rounded-2xl border border-gray-200 p-6 shadow-lg hover:shadow-xl transition-all duration-300 flex flex-col"
            >
              {/* Icon */}
              <div className="w-12 h-12 bg-gradient-to-br from-emerald-400 to-emerald-600 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-emerald-500/20">
                <Zap className="w-6 h-6 text-white" />
              </div>

              <h3 className="text-xl font-bold text-gray-900 mb-1">Free Trial</h3>
              <div className="mb-4">
                <span className="text-3xl font-bold text-gray-900">$0</span>
                <span className="text-gray-500 text-sm ml-1">for 7 days</span>
              </div>
              <p className="text-gray-600 text-sm mb-5">Try all Pro features free for 7 days. No credit card required.</p>
              
              <ul className="space-y-2.5 mb-6 flex-1">
                {[
                  'Full Pro access for 7 days',
                  'Unlimited product analyses',
                  'Download detailed reports',
                  'AI-powered recommendations',
                  'Priority support'
                ].map((feature, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700 text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
              
              <button 
                onClick={handleFreeTrial}
                disabled={loading.freeTrial}
                className={`w-full py-3 px-4 rounded-xl font-semibold transition-all duration-300 ${
                  loading.freeTrial
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-emerald-500 text-white hover:bg-emerald-600 shadow-lg shadow-emerald-500/20 hover:shadow-emerald-500/30'
                }`}
              >
                {loading.freeTrial ? (
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                ) : (
                  'Start Free Trial'
                )}
              </button>
            </motion.div>

            {/* Pro Plan - Featured */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="relative bg-gradient-to-br from-[#3B4A6B] to-[#2d3a52] rounded-2xl p-6 shadow-2xl flex flex-col lg:scale-105 z-10"
            >
              {/* Popular Badge */}
              <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                <div className="bg-gradient-to-r from-amber-400 to-orange-500 text-white px-4 py-1 rounded-full text-xs font-bold shadow-lg flex items-center gap-1.5">
                  <Sparkles className="w-3 h-3" />
                  MOST POPULAR
                </div>
              </div>

              {/* Icon */}
              <div className="w-12 h-12 bg-white/20 backdrop-blur-sm rounded-xl flex items-center justify-center mb-4 mt-2">
                <Crown className="w-6 h-6 text-white" />
              </div>

              <h3 className="text-xl font-bold text-white mb-1">Pro Plan</h3>
              <div className="mb-4">
                <span className="text-3xl font-bold text-white">$99</span>
                <span className="text-white/70 text-sm ml-1">/month</span>
              </div>
              <p className="text-white/80 text-sm mb-5">Everything you need to scale your Amazon business.</p>
              
              <ul className="space-y-2.5 mb-6 flex-1">
                {[
                  'Unlimited product analyses',
                  'Download detailed reports',
                  'AI-powered fix recommendations',
                  'Track unlimited products',
                  'Priority support',
                  'Advanced analytics'
                ].map((feature, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                    <span className="text-white/90 text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
              
              <button 
                onClick={() => handleSubscribe('PRO')}
                disabled={loading.PRO}
                className={`w-full py-3 px-4 rounded-xl font-semibold transition-all duration-300 ${
                  loading.PRO
                    ? 'bg-white/20 text-white/50 cursor-not-allowed'
                    : 'bg-white text-[#3B4A6B] hover:bg-gray-100 shadow-lg'
                }`}
              >
                {loading.PRO ? (
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                ) : (
                  'Subscribe to Pro'
                )}
              </button>
            </motion.div>

            {/* Agency Plan */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="relative bg-white rounded-2xl border border-gray-200 p-6 shadow-lg hover:shadow-xl transition-all duration-300 flex flex-col"
            >
              {/* Icon */}
              <div className="w-12 h-12 bg-gradient-to-br from-purple-500 to-indigo-600 rounded-xl flex items-center justify-center mb-4 shadow-lg shadow-purple-500/20">
                <Users className="w-6 h-6 text-white" />
              </div>

              <h3 className="text-xl font-bold text-gray-900 mb-1">Agency</h3>
              <div className="mb-4">
                <span className="text-3xl font-bold text-gray-900">$49</span>
                <span className="text-gray-500 text-sm ml-1">/user/month</span>
              </div>
              <p className="text-gray-600 text-sm mb-5">For agencies and consultants managing multiple clients.</p>
              
              <ul className="space-y-2.5 mb-6 flex-1">
                {[
                  'Everything in Pro',
                  'Client management dashboard',
                  'White-label reports',
                  'Bulk operations',
                  'Dedicated support',
                  'Custom integrations'
                ].map((feature, i) => (
                  <li key={i} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-purple-500 flex-shrink-0 mt-0.5" />
                    <span className="text-gray-700 text-sm">{feature}</span>
                  </li>
                ))}
              </ul>
              
              <button 
                onClick={() => handleSubscribe('AGENCY')}
                disabled={loading.AGENCY}
                className={`w-full py-3 px-4 rounded-xl font-semibold transition-all duration-300 ${
                  loading.AGENCY
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white hover:from-purple-600 hover:to-indigo-700 shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30'
                }`}
              >
                {loading.AGENCY ? (
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                ) : (
                  'Subscribe to Agency'
                )}
              </button>
            </motion.div>
          </div>
        </div>

        {/* Trust Indicators */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.5 }}
          className="mt-8 flex flex-wrap justify-center gap-6 text-sm text-gray-500"
        >
          <span className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500" />
            No setup fees
          </span>
          <span className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500" />
            Cancel anytime
          </span>
          <span className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500" />
            Secure payment
          </span>
          <span className="flex items-center gap-2">
            <Check className="w-4 h-4 text-emerald-500" />
            30-day money back
          </span>
        </motion.div>

        {/* Help Link */}
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5, delay: 0.6 }}
          className="mt-4 text-sm text-gray-500"
        >
          Questions? <a href="/contact-us" className="text-[#3B4A6B] hover:underline font-medium">Contact our sales team</a>
        </motion.p>
      </div>
    </div>
  );
}
