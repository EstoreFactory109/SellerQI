import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { updatePackageType } from '../../../redux/slices/authSlice';
import { motion } from 'framer-motion';
import { 
  Check, 
  Crown, 
  Zap, 
  Users, 
  BarChart3, 
  Shield, 
  Star,
  CreditCard,
  Calendar,
  ArrowRight,
  Loader2,
  Sparkles,
  TrendingUp,
  Award,
  MessageCircle,
  X,
  Receipt,
  Download,
  ChevronDown,
  History
} from 'lucide-react';
import stripeService from '../../../services/stripeService';
import axiosInstance from '../../../config/axios.config';
import { detectCountry } from '../../../utils/countryDetection';
import IndiaBilling from './IndiaBilling';

export default function PlansAndBilling() {
  // Country detection state
  const [country, setCountry] = useState(null);
  const [isDetectingCountry, setIsDetectingCountry] = useState(true);
  const [currentPlan, setCurrentPlan] = useState('LITE');
  const [subscriptionStatus, setSubscriptionStatus] = useState('active');
  const [loading, setLoading] = useState({});
  const [userSubscription, setUserSubscription] = useState(null);
  const [isTrialPeriod, setIsTrialPeriod] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMessage, setCancelMessage] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [visiblePayments, setVisiblePayments] = useState(5);
  const [freeTrialLoading, setFreeTrialLoading] = useState(false);
  const user = useSelector((state) => state.Auth.user);

  // Show "Try 7 days for Free" card only for LITE users who have not been served a trial (hide for PRO and for LITE users whose servedTrial is true)
  const showFreeTrialCard = currentPlan === 'LITE' && user?.servedTrial !== true;
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // Plan configurations with enhanced styling
  const plans = {
    LITE: {
      name: 'LITE',
      displayName: 'Free Plan',
      price: 0,
      currency: 'USD',
      icon: Star,
      color: 'emerald',
      gradient: 'from-emerald-400 via-emerald-500 to-emerald-600',
      bgGradient: 'from-emerald-50 to-emerald-100',
      description: 'Perfect for getting started',
      tagline: 'Start your journey',
      features: [
        'Basic product analysis'
      ],
      limitations: [
        'No download reports',
        'No fix recommendations',
        'Cannot track multiple products',
        'No priority support'
      ]
    },
    PRO: {
      name: 'PRO',
      displayName: 'Pro',
      price: 99,
      currency: 'USD',
      icon: Crown,
      color: 'blue',
      gradient: 'from-blue-500 via-indigo-500 to-purple-600',
      bgGradient: 'from-blue-50 to-indigo-100',
      description: 'Everything you need to scale',
      tagline: 'Most Popular Choice',
      popular: true,
      features: [
        'Unlimited product analyses',
        'Download detailed reports',
        'AI-powered fix recommendations',
        'Track unlimited products',
        'Priority support',
        'Advanced analytics'
      ],
      limitations: []
    },
    AGENCY: {
      name: 'AGENCY',
      displayName: 'Agency',
      price: 49,
      currency: 'USD',
      icon: Users,
      color: 'purple',
      gradient: 'from-purple-500 via-violet-500 to-indigo-600',
      bgGradient: 'from-purple-50 to-violet-100',
      description: 'For agencies and enterprises',
      tagline: 'Scale without limits',
      features: [
        'Everything in Pro',
        'Client management',
        'White-label reports',
        'Bulk operations',
        'Dedicated support'
      ],
      limitations: []
    }
  };

  // Detect country on mount
  useEffect(() => {
    const getCountry = async () => {
      try {
        const detectedCountry = await detectCountry();
        setCountry(detectedCountry);
      } catch (error) {
        console.error('Error detecting country:', error);
        setCountry('US'); // Default to US if detection fails
      } finally {
        setIsDetectingCountry(false);
      }
    };
    getCountry();
  }, []);

  useEffect(() => {
    fetchUserSubscription();
    fetchPaymentHistory();
  }, []);

  const fetchUserSubscription = async () => {
    try {
      // Get user details to check packageType
      if (user) {
        const userIsInTrial = user.isInTrialPeriod || false;
        setIsTrialPeriod(userIsInTrial);
        
        // Only set currentPlan to PRO if not in trial period
        // If in trial, treat as LITE for display purposes
        if (user.packageType === 'PRO' && !userIsInTrial) {
          setCurrentPlan('PRO');
        } else if (user.packageType === 'AGENCY') {
          setCurrentPlan('AGENCY');
        } else {
          // If in trial or packageType is LITE, set to LITE
          setCurrentPlan('LITE');
        }
        setSubscriptionStatus(user.subscriptionStatus || 'active');
        
        // Debug logging
        console.log('🔍 PlansAndBilling - User subscription check:', {
          packageType: user.packageType,
          isInTrialPeriod: userIsInTrial,
          currentPlan: user.packageType === 'PRO' && !userIsInTrial ? 'PRO' : (user.packageType === 'AGENCY' ? 'AGENCY' : 'LITE')
        });
      }

      // Try to get detailed subscription info
      try {
        const subscription = await stripeService.getSubscription();
        setUserSubscription(subscription);
      } catch (error) {
        // If no subscription exists, user is on LITE plan
        console.log('No subscription found, user on LITE plan');
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
    }
  };

  const handleUpgrade = async (planType) => {
    if (planType === currentPlan) return;

    setLoading(prev => ({ ...prev, [planType]: true }));

    try {
      if (planType === 'LITE') {
        // Downgrade to LITE (would need cancellation logic)
        alert('To downgrade to LITE, please contact support.');
      } else {
        // Store current plan for post-payment redirect logic
        localStorage.setItem('previousPlan', currentPlan);
        
        // Upgrade to PRO or AGENCY
        await stripeService.createCheckoutSession(planType);
      }
    } catch (error) {
      console.error('Error during upgrade:', error);
      alert('Failed to process upgrade. Please try again.');
    } finally {
      setTimeout(() => {
        setLoading(prev => ({ ...prev, [planType]: false }));
      }, 1000);
    }
  };

  const handleStartFreeTrial = async () => {
    setFreeTrialLoading(true);
    try {
      localStorage.setItem('previousPlan', currentPlan);
      await stripeService.createCheckoutSession('PRO', null, 7);
    } catch (error) {
      console.error('Error starting free trial:', error);
      alert(error.response?.data?.message || 'Failed to start free trial. Please try again.');
    } finally {
      setFreeTrialLoading(false);
    }
  };

  const handleCancelSubscription = async () => {
    setCancelling(true);
    setCancelMessage('');

    try {
      // Cancel subscription immediately
      const result = await stripeService.cancelSubscription(false);
      
      // Check the correct response structure - result.data.success instead of result.success
      if (result.data && result.data.success) {
        // Update Redux state immediately
        dispatch(updatePackageType({
          packageType: 'LITE',
          subscriptionStatus: 'cancelled'
        }));
        
        // Update local state immediately
        setCurrentPlan('LITE');
        setSubscriptionStatus('cancelled');
        setUserSubscription(null);
        
        // Show success message
        setCancelMessage('Subscription cancelled successfully! You have been downgraded to the LITE plan.');
        
        // Hide confirmation modal
        setShowCancelConfirm(false);
        
        // Refresh payment history in case cancellation creates a record
        setTimeout(() => {
          fetchPaymentHistory();
        }, 1000);
      } else {
        // Handle case where API call succeeded but cancellation failed
        setCancelMessage('Failed to cancel subscription. Please try again or contact support.');
      }
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      // Show more detailed error message if available
      const errorMessage = error.response?.data?.message || error.message || 'Failed to cancel subscription. Please try again or contact support.';
      setCancelMessage(errorMessage);
    } finally {
      setCancelling(false);
    }
  };

  const fetchPaymentHistory = async () => {
    setLoadingHistory(true);
    try {
      const history = await stripeService.getPaymentHistory();
      
      // Deduplicate by sessionId or stripePaymentIntentId (safety measure)
      const uniqueHistory = history.filter((payment, index, self) => 
        index === self.findIndex(p => 
          (payment.sessionId && p.sessionId === payment.sessionId) ||
          (payment.stripePaymentIntentId && p.stripePaymentIntentId === payment.stripePaymentIntentId)
        )
      );
      
      // Sort by most recent first
      const sortedHistory = uniqueHistory.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
      setPaymentHistory(sortedHistory);
    } catch (error) {
      console.error('Error fetching payment history:', error);
      setPaymentHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleShowMore = () => {
    setVisiblePayments(prev => prev + 5);
  };

  const formatDate = (dateString) => {
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatAmount = (amount, currency = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount / 100); // Stripe amounts are in cents
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'succeeded':
      case 'paid':
        return 'text-green-600 bg-green-100';
      case 'pending':
        return 'text-yellow-600 bg-yellow-100';
      case 'failed':
        return 'text-red-600 bg-red-100';
      default:
        return 'text-gray-600 bg-gray-100';
    }
  };

  const getPlanIcon = (plan) => {
    const IconComponent = plans[plan].icon;
    return <IconComponent className="w-6 h-6" />;
  };

  const getPlanColor = (plan) => {
    const colors = { 
      emerald: 'from-emerald-500 to-emerald-600', 
      blue: 'from-blue-500 to-blue-600', 
      purple: 'from-purple-500 to-purple-600'
    };
    return colors[plans[plan].color] || colors.emerald;
  };

  // Only show PRO as current plan if not in trial period
  // If in trial, don't show PRO as current plan
  const isCurrentPlan = (plan) => {
    // Double check: if user is in trial, never show PRO as current plan
    if (plan === 'PRO' && (isTrialPeriod || user?.isInTrialPeriod)) {
      return false;
    }
    // Check if plan matches currentPlan
    if (plan !== currentPlan) return false;
    return true;
  };
  const canUpgrade = (plan) => {
    const planOrder = { LITE: 0, PRO: 1, AGENCY: 2 };
    return planOrder[plan] > planOrder[currentPlan];
  };

  // Show loading spinner while detecting country
  if (isDetectingCountry) {
    return (
      <div className="min-h-screen bg-[#eeeeee] flex items-center justify-center">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
          <p className="text-gray-600">Loading billing information...</p>
        </div>
      </div>
    );
  }

  // Render India billing component for Indian users
  if (country === 'IN') {
    return <IndiaBilling />;
  }

  // Default billing page for other countries (Stripe)
  return (
    <div className="min-h-screen bg-[#eeeeee]">
      {/* Cancel Success/Error Message */}
      {cancelMessage && (
        <motion.div 
          initial={{ opacity: 0, y: -50 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -50 }}
          className={`fixed top-4 left-1/2 transform -translate-x-1/2 z-50 max-w-md w-full mx-4 p-4 rounded-xl shadow-xl ${
            cancelMessage.includes('successfully') 
              ? 'bg-green-500 text-white' 
              : 'bg-red-500 text-white'
          }`}
        >
          <div className="flex items-center space-x-3">
            {cancelMessage.includes('successfully') ? (
              <Check className="w-5 h-5 flex-shrink-0" />
            ) : (
              <X className="w-5 h-5 flex-shrink-0" />
            )}
            <p className="text-sm font-medium">{cancelMessage}</p>
            <button 
              onClick={() => setCancelMessage('')}
              className="ml-auto hover:opacity-80"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      )}

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-white rounded-2xl p-8 max-w-md w-full mx-4 shadow-2xl"
          >
            <div className="text-center">
              <div className="relative w-20 h-20 mx-auto mb-6">
                {/* Animated background circles */}
                <div className="absolute inset-0 bg-red-100 rounded-full animate-pulse"></div>
                <div className="absolute inset-2 bg-red-200 rounded-full animate-ping opacity-30"></div>
                <div className="absolute inset-0 bg-gradient-to-r from-red-100 to-red-200 rounded-full flex items-center justify-center">
                  <div className="w-12 h-12 bg-gradient-to-r from-red-500 to-red-600 rounded-full flex items-center justify-center shadow-lg">
                    <X className="w-6 h-6 text-white" />
                  </div>
                </div>
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-3">Cancel Subscription</h3>
              <p className="text-gray-600 mb-6">
                Are you sure you want to cancel your subscription? You will be immediately downgraded to the LITE plan and lose access to all premium features.
              </p>
              
              <div className="flex space-x-4">
                {/* Keep Subscription Button */}
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="
                    flex-1 py-4 px-6 bg-gradient-to-r from-gray-100 to-gray-200 
                    hover:from-gray-200 hover:to-gray-300 text-gray-700 rounded-2xl 
                    font-semibold transition-all duration-300 transform hover:scale-105 
                    hover:shadow-lg focus:outline-none focus:ring-4 focus:ring-gray-300/50
                    active:scale-95
                  "
                >
                  Keep Subscription
                </button>
                
                {/* Cancel Now Button */}
                <button
                  onClick={handleCancelSubscription}
                  disabled={cancelling}
                  className="
                    relative overflow-hidden flex-1 py-4 px-6 
                    bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800
                    text-white rounded-2xl font-semibold transition-all duration-300 
                    transform hover:scale-105 hover:shadow-xl hover:shadow-red-500/25
                    active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed 
                    disabled:transform-none focus:outline-none focus:ring-4 focus:ring-red-500/20
                    flex items-center justify-center space-x-2
                  "
                >
                  {/* Loading spinner or text */}
                  {cancelling ? (
                    <>
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span>Cancelling...</span>
                    </>
                  ) : (
                    <>
                      <X className="w-4 h-4" />
                      <span>Cancel Now</span>
                    </>
                  )}
                  
                  {/* Shimmer effect */}
                  <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-700"></div>
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Header Section */}
      <div className="relative overflow-hidden">
        {/* Background Elements */}
        <div className="absolute inset-0 bg-gradient-to-r from-blue-600/10 via-purple-600/10 to-pink-600/10"></div>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-gradient-to-r from-pink-400 to-red-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse delay-1000"></div>
        
        <div className="relative px-6 py-12">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-4xl mx-auto"
          >
            <div className="inline-flex items-center space-x-2 bg-white/80 backdrop-blur-sm rounded-full px-6 py-2 mb-6 shadow-lg">
              <Sparkles className="w-5 h-5 text-blue-600" />
              <span className="text-sm font-semibold text-gray-700">Plans & Billing Management</span>
            </div>
            
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-gray-900 via-blue-900 to-purple-900 bg-clip-text text-transparent mb-6">
              Choose Your Perfect Plan
            </h1>
            <p className="text-xl text-gray-600 mb-8 max-w-2xl mx-auto">
              Unlock powerful insights and scale your Amazon business with our comprehensive analytics platform
            </p>
          </motion.div>
        </div>
              </div>
              
      <div className="max-w-7xl mx-auto px-6 pb-16">
        {/* Plans Grid */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.2 }}
          className="mb-16"
        >
          <div className="text-center mb-12 mt-8">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Upgrade Your Experience</h2>
            <p className="text-xl text-gray-600">Choose the plan that fits your business needs</p>
        </div>

          {/* Try 7 days for Free card - visible only for LITE users who have not been served a trial */}
          {showFreeTrialCard && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mb-8 max-w-5xl mx-auto"
            >
              <div className="relative overflow-hidden bg-white rounded-xl shadow-lg border-2 border-amber-200 transition-all duration-300 hover:shadow-xl hover:border-amber-300">
                <div className="p-6 flex flex-col sm:flex-row items-center justify-between gap-6">
                  <div className="flex items-center gap-4 flex-1">
                    <div className="w-16 h-16 bg-gradient-to-r from-amber-400 via-orange-500 to-amber-600 rounded-xl flex items-center justify-center shadow-md flex-shrink-0">
                      <Zap className="w-8 h-8 text-white" />
                    </div>
                    <div>
                      <h3 className="text-2xl font-bold text-gray-900 mb-1">Try 7 days for Free</h3>
                      <p className="text-gray-600">Start your PRO trial. No charge until trial ends. Cancel anytime.</p>
                    </div>
                  </div>
                  <button
                    onClick={handleStartFreeTrial}
                    disabled={freeTrialLoading}
                    className="w-full sm:w-auto py-4 px-8 rounded-2xl font-bold text-lg transition-all duration-300 flex items-center justify-center space-x-2 bg-gradient-to-r from-amber-500 via-orange-500 to-amber-600 text-white hover:shadow-xl transform hover:scale-105 hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex-shrink-0"
                  >
                    {freeTrialLoading ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Sparkles className="w-5 h-5" />
                        <span>Start Free Trial</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {Object.entries(plans)
              .filter(([planKey]) => planKey !== 'LITE')
              .map(([planKey, plan], index) => (
              <motion.div
                key={planKey}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 + index * 0.1 }}
                className={`relative group ${plan.popular ? 'lg:scale-105 z-10' : ''}`}
              >
                {/* Plan Card */}
                <div className={`relative overflow-hidden bg-white rounded-xl shadow-lg border-2 transition-all duration-300 group-hover:shadow-xl group-hover:border-gray-300 ${
                  plan.popular 
                    ? 'border-blue-200' 
                    : 'border-gray-200'
                }`}>
                  
                  {/* Card Content */}
                  <div className="p-6">
                    {/* Plan Header */}
                    <div className="text-center mb-6">
                      <div className={`w-16 h-16 bg-gradient-to-r ${plan.gradient} rounded-xl flex items-center justify-center mx-auto mb-4 shadow-md`}>
                        <plan.icon className="w-8 h-8 text-white" />
                </div>

                      <h3 className="text-2xl font-bold text-gray-900 mb-2">{plan.displayName}</h3>
                      <p className="text-gray-600 mb-4">{plan.description}</p>
                      
                      <div className="mb-4">
                        <span className="text-5xl font-bold text-gray-900">${plan.price}</span>
                        {plan.price > 0 && <span className="text-xl text-gray-500">/month</span>}
              </div>

                      {plan.price === 0 && (
                        <div className="inline-flex items-center space-x-1 text-emerald-600 bg-emerald-100 px-3 py-1 rounded-full text-sm font-medium">
                          <Sparkles className="w-4 h-4" />
                          <span>Forever Free</span>
                    </div>
                      )}
                    </div>

                    {/* Features List */}
                    <div className="space-y-4 mb-8">
                      {plan.features.map((feature, index) => (
                        <div key={index} className="flex items-center space-x-3">
                          <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                            <Check className="w-3 h-3 text-green-600" />
                  </div>
                          <span className="text-gray-700">{feature}</span>
                </div>
                      ))}
                      
                      {/* Show limitations for LITE plan */}
                      {plan.limitations && plan.limitations.length > 0 && (
                        <>
                          {plan.limitations.map((limitation, index) => (
                            <div key={`limitation-${index}`} className="flex items-center space-x-3 opacity-60">
                              <div className="w-5 h-5 bg-red-100 rounded-full flex items-center justify-center flex-shrink-0">
                                <X className="w-3 h-3 text-red-500" />
                              </div>
                              <span className="text-gray-500 line-through">{limitation}</span>
                            </div>
                          ))}
                        </>
                      )}
                    </div>

                    {/* Action Button */}
                    <button
                      onClick={() => handleUpgrade(planKey)}
                      disabled={isCurrentPlan(planKey) || loading[planKey]}
                      className={`w-full py-4 px-6 rounded-2xl font-bold text-lg transition-all duration-300 flex items-center justify-center space-x-2 ${
                        isCurrentPlan(planKey)
                          ? 'bg-green-100 text-green-700 cursor-not-allowed'
                          : canUpgrade(planKey)
                          ? `bg-gradient-to-r ${plan.gradient} text-white hover:shadow-xl transform hover:scale-105 hover:-translate-y-1`
                          : 'bg-gray-100 text-gray-500 cursor-not-allowed'
                      }`}
                    >
                      {loading[planKey] ? (
                        <Loader2 className="w-5 h-5 animate-spin" />
                      ) : isCurrentPlan(planKey) ? (
                        <>
                          <Award className="w-5 h-5" />
                          <span>Current Plan</span>
                        </>
                      ) : canUpgrade(planKey) ? (
                        <>
                          <span>Upgrade to {plan.displayName}</span>
                          <TrendingUp className="w-5 h-5" />
                        </>
                      ) : (
                        <span>Contact Sales</span>
                      )}
                    </button>
                  </div>
                </div>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Billing Information */}
        {currentPlan !== 'LITE' && (
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="mb-16"
          >
            <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-gray-900 flex items-center space-x-3">
                  <CreditCard className="w-6 h-6 text-blue-600" />
                  <span>Billing Information</span>
                </h3>
                
                {/* Cancel Subscription Button */}
                <div className="relative group">
                  <button
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={cancelling}
                    className={`
                      relative overflow-hidden flex items-center space-x-3 px-8 py-4 
                      bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700
                      text-white rounded-2xl font-semibold text-sm
                      transition-all duration-300 ease-out transform
                      hover:scale-105 hover:shadow-2xl hover:shadow-red-500/25
                      active:scale-95 active:shadow-lg
                      disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none
                      before:absolute before:inset-0 before:bg-gradient-to-r before:from-white/20 before:to-transparent 
                      before:opacity-0 hover:before:opacity-100 before:transition-opacity before:duration-300
                      focus:outline-none focus:ring-4 focus:ring-red-500/20
                    `}
                  >
                    {/* Background shimmer effect */}
                    <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/10 to-transparent translate-x-[-100%] group-hover:translate-x-[100%] transition-transform duration-1000 ease-out"></div>
                    
                    {/* Icon with animation */}
                    <div className="relative z-10 flex items-center justify-center">
                      {cancelling ? (
                        <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      ) : (
                        <X className="w-5 h-5 transform group-hover:rotate-90 transition-transform duration-300" />
                      )}
                    </div>
                    
                    {/* Text */}
                    <span className="relative z-10 whitespace-nowrap">
                      {cancelling ? 'Cancelling...' : 'Cancel Subscription'}
                    </span>
                    
                    {/* Ripple effect on click */}
                    <div className="absolute inset-0 rounded-2xl opacity-0 group-active:opacity-100 bg-white/20 transition-opacity duration-150"></div>
                  </button>
                  
                  {/* Tooltip */}
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-3 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none whitespace-nowrap">
                    This will immediately downgrade you to LITE plan
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl p-6">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center">
                      <Calendar className="w-6 h-6 text-blue-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Next Billing Date</h4>
                      <p className="text-gray-600">
                        {userSubscription?.nextBillingDate 
                          ? new Date(userSubscription.nextBillingDate).toLocaleDateString('en-US', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            })
                          : (() => {
                              // Calculate next billing date (30 days from now if no subscription data)
                              const nextMonth = new Date();
                              nextMonth.setMonth(nextMonth.getMonth() + 1);
                              return nextMonth.toLocaleDateString('en-US', {
                                year: 'numeric',
                                month: 'long',
                                day: 'numeric'
                              });
                            })()
                        }
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl p-6">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                      <Shield className="w-6 h-6 text-green-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Payment Status</h4>
                      <div className="flex items-center space-x-2">
                        <div className={`w-3 h-3 rounded-full ${
                          userSubscription?.paymentStatus === 'paid' ? 'bg-green-500' : 'bg-blue-500'
                        }`}></div>
                        <p className={`font-medium ${
                          userSubscription?.paymentStatus === 'paid' ? 'text-green-600' : 'text-blue-600'
                        }`}>
                          {userSubscription?.paymentStatus?.toUpperCase() || 'ACTIVE'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-gradient-to-r from-purple-50 to-violet-50 rounded-2xl p-6">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-purple-100 rounded-xl flex items-center justify-center">
                      <CreditCard className="w-6 h-6 text-purple-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Current Plan</h4>
                      <p className="text-gray-600 font-medium">
                        {plans[currentPlan].displayName}
                      </p>
                      <p className="text-sm text-gray-500">
                        ${plans[currentPlan].price}/month
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        )}

        {/* Payment History Section */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.5 }}
          className="mb-16"
        >
          <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-2xl font-bold text-gray-900 flex items-center space-x-3">
                <Receipt className="w-6 h-6 text-blue-600" />
                <span>Payment History</span>
              </h3>
              
              {/* Download all history button */}
              <button
                className="flex items-center space-x-2 px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-xl font-medium transition-all duration-300 hover:shadow-lg"
                onClick={async () => {
                  try {
                    // Download all available invoices
                    const downloadPromises = paymentHistory
                      .filter(p => p.invoiceUrl || p.invoicePdf || p.stripePaymentIntentId || p.razorpayPaymentId)
                      .map(async (payment) => {
                        try {
                          if (payment.invoicePdf || payment.invoiceUrl) {
                            window.open(payment.invoicePdf || payment.invoiceUrl, '_blank');
                          } else if (payment.stripePaymentIntentId) {
                            await stripeService.downloadInvoice(payment.stripePaymentIntentId);
                          } else if (payment.razorpayPaymentId) {
                            const razorpayService = (await import('../../../services/razorpayService')).default;
                            await razorpayService.downloadInvoice(payment.razorpayPaymentId);
                          }
                        } catch (error) {
                          console.error(`Error downloading invoice for payment ${payment.sessionId}:`, error);
                        }
                      });
                    
                    // Open invoices with slight delay to avoid popup blockers
                    for (let i = 0; i < downloadPromises.length; i++) {
                      await downloadPromises[i];
                      if (i < downloadPromises.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 500)); // 500ms delay between downloads
                      }
                    }
                  } catch (error) {
                    console.error('Error downloading payment history:', error);
                    alert('Some invoices could not be downloaded. Please try downloading them individually.');
                  }
                }}
              >
                <Download className="w-4 h-4" />
                <span>Download All</span>
              </button>
            </div>

            {loadingHistory ? (
              <div className="flex items-center justify-center py-12">
                <div className="flex items-center space-x-3">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
                  <span className="text-gray-600">Loading payment history...</span>
                </div>
              </div>
            ) : paymentHistory.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <History className="w-8 h-8 text-gray-400" />
                </div>
                <h4 className="text-lg font-semibold text-gray-900 mb-2">No Payment History</h4>
                <p className="text-gray-600">You haven't made any payments yet. Payment history will appear here once you upgrade to a paid plan.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {paymentHistory.slice(0, visiblePayments).map((payment, index) => (
                  <motion.div
                    key={payment.stripePaymentIntentId || payment.sessionId || payment.paymentId || `payment-${index}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.1 }}
                    className="bg-gradient-to-r from-gray-50 to-white rounded-2xl p-6 border border-gray-200 hover:shadow-lg transition-all duration-300"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl flex items-center justify-center">
                          <Receipt className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900 mb-1">
                            Subscription Payment
                          </h4>
                          <p className="text-sm text-gray-600">
                            {formatDate(payment.paymentDate)}
                          </p>
                          {payment.stripePaymentIntentId && (
                            <p className="text-xs text-gray-500 mt-1">
                              ID: {payment.stripePaymentIntentId.slice(-8)}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      <div className="text-right flex items-center space-x-4">
                        <div>
                          <div className="text-xl font-bold text-gray-900 mb-2">
                            {formatAmount(payment.amount, payment.currency)}
                          </div>
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(payment.status)}`}>
                            {payment.status?.charAt(0).toUpperCase() + payment.status?.slice(1) || 'Unknown'}
                          </span>
                        </div>
                        {/* Download Invoice Button - Always show for all payments */}
                        <button
                          onClick={async () => {
                            try {
                              if (payment.invoicePdf || payment.invoiceUrl) {
                                // Direct download if URL is already available
                                window.open(payment.invoicePdf || payment.invoiceUrl, '_blank');
                              } else if (payment.stripePaymentIntentId) {
                                // Fetch invoice URL from Stripe
                                await stripeService.downloadInvoice(payment.stripePaymentIntentId);
                              } else if (payment.razorpayPaymentId) {
                                // Fetch invoice URL from Razorpay
                                const razorpayService = (await import('../../../services/razorpayService')).default;
                                await razorpayService.downloadInvoice(payment.razorpayPaymentId);
                              } else if (payment.sessionId) {
                                // Try to get invoice using session ID (for Stripe)
                                await stripeService.downloadInvoice(payment.sessionId);
                              } else {
                                alert('Invoice information not available for this payment. Please contact support.');
                              }
                            } catch (error) {
                              console.error('Error downloading invoice:', error);
                              alert('Failed to download invoice. Please try again or contact support.');
                            }
                          }}
                          className="flex items-center space-x-2 px-4 py-2 bg-blue-100 hover:bg-blue-200 text-blue-700 rounded-xl font-medium transition-all duration-300 hover:shadow-lg"
                          title="Download Invoice"
                        >
                          <Download className="w-4 h-4" />
                          <span className="text-sm">Invoice</span>
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}

                {/* Show More Button */}
                {visiblePayments < paymentHistory.length && (
                  <div className="text-center pt-6">
                    <button
                      onClick={handleShowMore}
                      className="
                        inline-flex items-center space-x-3 px-8 py-4 
                        bg-gradient-to-r from-blue-500 to-blue-600 hover:from-blue-600 hover:to-blue-700
                        text-white rounded-2xl font-semibold transition-all duration-300 
                        transform hover:scale-105 hover:shadow-xl hover:shadow-blue-500/25
                        active:scale-95 focus:outline-none focus:ring-4 focus:ring-blue-500/20
                      "
                    >
                      <span>Show More Payments</span>
                      <ChevronDown className="w-5 h-5" />
                    </button>
                    <p className="text-sm text-gray-600 mt-3">
                      Showing {visiblePayments} of {paymentHistory.length} payments
                    </p>
                  </div>
                )}

                {/* Show less option when showing more than 5 */}
                {visiblePayments > 5 && visiblePayments >= paymentHistory.length && (
                  <div className="text-center pt-4">
                    <button
                      onClick={() => setVisiblePayments(5)}
                      className="text-blue-600 hover:text-blue-700 font-medium transition-colors duration-300"
                    >
                      Show Less
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>

        {/* Support Section */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.7 }}
          className="text-center"
        >
          <div className="bg-gradient-to-r from-gray-800 via-blue-800 to-purple-800 rounded-xl p-8 text-white">
            <div className="max-w-2xl mx-auto">
              <div className="w-16 h-16 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center mx-auto mb-6">
                <MessageCircle className="w-8 h-8 text-white" />
              </div>
              
              <h3 className="text-3xl font-bold mb-4">Need Help with Your Plan?</h3>
              <p className="text-xl text-white/80 mb-8">
                Our dedicated support team is here to help you choose the right plan and answer any billing questions.
              </p>
              
              <button 
                onClick={() => navigate('/seller-central-checker/settings?tab=support')}
                className="inline-flex items-center space-x-3 bg-white text-gray-900 px-8 py-4 rounded-2xl font-bold text-lg hover:bg-gray-100 transition-all duration-300 transform hover:scale-105 hover:shadow-xl"
              >
                <MessageCircle className="w-5 h-5" />
                <span>Contact Support</span>
                <ArrowRight className="w-5 h-5" />
              </button>
            </div>
              </div>
        </motion.div>
      </div>
    </div>
  );
} 