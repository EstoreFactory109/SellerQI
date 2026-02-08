import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { updatePackageType, loginSuccess } from '../../../redux/slices/authSlice';
import axiosInstance from '../../../config/axios.config';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Check, 
  Crown, 
  Users, 
  Star,
  Zap,
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
  History,
  Shield,
  Mail,
  AlertTriangle
} from 'lucide-react';
import razorpayService from '../../../services/razorpayService';

export default function IndiaBilling() {
  const [currentPlan, setCurrentPlan] = useState('LITE');
  const [subscriptionStatus, setSubscriptionStatus] = useState('active');
  const [loading, setLoading] = useState({});
  const [userSubscription, setUserSubscription] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelMessage, setCancelMessage] = useState('');
  const [showCancelConfirm, setShowCancelConfirm] = useState(false);
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [visiblePayments, setVisiblePayments] = useState(5);
  const [isTrialPeriod, setIsTrialPeriod] = useState(false);
  const [loadingInvoice, setLoadingInvoice] = useState({}); // Track loading state per payment
  const [freeTrialLoading, setFreeTrialLoading] = useState(false);
  const user = useSelector((state) => state.Auth.user);

  // Show "Try 7 days for Free" card only for LITE users who have not been served a trial (hide for PRO and for LITE users whose servedTrial is true)
  const showFreeTrialCard = currentPlan === 'LITE' && user?.servedTrial !== true;
  const dispatch = useDispatch();
  const navigate = useNavigate();

  // India-specific plan configurations
  const plans = {
    LITE: {
      name: 'LITE',
      displayName: 'Free Plan',
      price: 0,
      displayPrice: '₹0',
      currency: 'INR',
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
      price: 1999,
      displayPrice: '₹1,999',
      currency: 'INR',
      icon: Crown,
      color: 'indigo',
      gradient: 'from-indigo-500 via-purple-500 to-purple-600',
      bgGradient: 'from-indigo-50 to-purple-100',
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
      price: null,
      displayPrice: 'Custom',
      currency: 'INR',
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

  useEffect(() => {
    fetchUserSubscription();
    fetchPaymentHistory();
  }, []);

  // Watch for changes in Redux user state and update local state
  useEffect(() => {
    if (user) {
      const userIsInTrial = user.isInTrialPeriod || false;
      setIsTrialPeriod(userIsInTrial);
      
      // Only set currentPlan to PRO if not in trial period
      if (user.packageType === 'PRO' && !userIsInTrial) {
        setCurrentPlan('PRO');
      } else if (user.packageType === 'AGENCY') {
        setCurrentPlan('AGENCY');
      } else {
        setCurrentPlan('LITE');
      }
      setSubscriptionStatus(user.subscriptionStatus || 'active');
    }
  }, [user]);

  const fetchUserSubscription = async () => {
    try {
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
        console.log('🔍 IndiaBilling - User subscription check:', {
          packageType: user.packageType,
          isInTrialPeriod: userIsInTrial,
          currentPlan: user.packageType === 'PRO' && !userIsInTrial ? 'PRO' : (user.packageType === 'AGENCY' ? 'AGENCY' : 'LITE')
        });
      }

      // Try to get detailed subscription info from Razorpay
      try {
        const subscription = await razorpayService.getSubscription();
        setUserSubscription(subscription);
      } catch (error) {
        console.log('No Razorpay subscription found');
      }
    } catch (error) {
      console.error('Error fetching subscription:', error);
    }
  };

  const handleUpgrade = async (planType) => {
    if (planType === currentPlan && !isTrialPeriod) return;

    setLoading(prev => ({ ...prev, [planType]: true }));

    try {
      if (planType === 'LITE') {
        alert('To downgrade to LITE, please cancel your subscription.');
      } else if (planType === 'PRO') {
        // Use Razorpay for India
        await razorpayService.initiatePayment(
          planType,
          async (result) => {
            // Success callback - fetch fresh user data from server
            try {
              // Fetch fresh user data from server to ensure we have latest state
              const response = await axiosInstance.get('/app/profile');
              if (response.status === 200 && response.data?.data) {
                const freshUserData = response.data.data;
                // Update Redux with complete fresh user data
                dispatch(loginSuccess(freshUserData));
                
                // Update local state based on fresh data
                const userIsInTrial = freshUserData.isInTrialPeriod || false;
                setIsTrialPeriod(userIsInTrial);
                
                if (freshUserData.packageType === 'PRO' && !userIsInTrial) {
                  setCurrentPlan('PRO');
                } else if (freshUserData.packageType === 'AGENCY') {
                  setCurrentPlan('AGENCY');
                } else {
                  setCurrentPlan('LITE');
                }
                setSubscriptionStatus(freshUserData.subscriptionStatus || 'active');
              } else {
                // Fallback: update Redux manually if API call fails
                dispatch(updatePackageType({
                  packageType: 'PRO',
                  subscriptionStatus: 'active'
                }));
                setCurrentPlan('PRO');
                setSubscriptionStatus('active');
                setIsTrialPeriod(false);
              }
            } catch (error) {
              console.error('Error fetching fresh user data after payment:', error);
              // Fallback: update Redux manually if API call fails
              dispatch(updatePackageType({
                packageType: 'PRO',
                subscriptionStatus: 'active'
              }));
              setCurrentPlan('PRO');
              setSubscriptionStatus('active');
              setIsTrialPeriod(false);
            }
            
            fetchUserSubscription();
            fetchPaymentHistory();
            setLoading(prev => ({ ...prev, [planType]: false }));
          },
          (error) => {
            // Error callback
            if (error.message !== 'Payment cancelled by user') {
              // Show more detailed error message
              const errorMsg = error.message || 'Payment failed. Please try again or use a different payment method.';
              alert(errorMsg);
            }
            setLoading(prev => ({ ...prev, [planType]: false }));
          }
        );
      } else if (planType === 'AGENCY') {
        // Navigate to support page
        navigate('/seller-central-checker/settings?tab=support');
        setLoading(prev => ({ ...prev, [planType]: false }));
      }
    } catch (error) {
      console.error('Error during upgrade:', error);
      alert('Failed to process upgrade. Please try again.');
      setLoading(prev => ({ ...prev, [planType]: false }));
    }
  };

  const handleStartFreeTrial = () => {
    setFreeTrialLoading(true);
    razorpayService.initiatePayment(
      'PRO',
      async (result) => {
        try {
          const response = await axiosInstance.get('/app/profile');
          if (response.status === 200 && response.data?.data) {
            const freshUserData = response.data.data;
            dispatch(loginSuccess(freshUserData));
            const userIsInTrial = freshUserData.isInTrialPeriod || false;
            setIsTrialPeriod(userIsInTrial);
            if (freshUserData.packageType === 'PRO' && !userIsInTrial) {
              setCurrentPlan('PRO');
            } else if (freshUserData.packageType === 'AGENCY') {
              setCurrentPlan('AGENCY');
            } else {
              setCurrentPlan('LITE');
            }
            setSubscriptionStatus(freshUserData.subscriptionStatus || 'active');
          } else {
            dispatch(updatePackageType({
              packageType: 'PRO',
              subscriptionStatus: 'active'
            }));
            setCurrentPlan('PRO');
            setSubscriptionStatus('active');
            setIsTrialPeriod(false);
          }
        } catch (error) {
          console.error('Error fetching fresh user data after payment:', error);
          dispatch(updatePackageType({
            packageType: 'PRO',
            subscriptionStatus: 'active'
          }));
          setCurrentPlan('PRO');
          setSubscriptionStatus('active');
          setIsTrialPeriod(false);
        }
        fetchUserSubscription();
        fetchPaymentHistory();
        setFreeTrialLoading(false);
      },
      (error) => {
        if (error.message !== 'Payment cancelled by user') {
          const errorMsg = error.message || 'Payment failed. Please try again or use a different payment method.';
          alert(errorMsg);
        }
        setFreeTrialLoading(false);
      },
      7 // 7-day trial
    );
  };

  const handleCancelSubscription = async () => {
    setCancelling(true);
    setCancelMessage('');

    try {
      const result = await razorpayService.cancelSubscription();
      
      if (result.statusCode === 200 || result.data?.success) {
        // Update Redux state immediately
        dispatch(updatePackageType({
          packageType: 'LITE',
          subscriptionStatus: 'cancelled'
        }));
        
        // Update local state immediately
        setCurrentPlan('LITE');
        setSubscriptionStatus('cancelled');
        setUserSubscription(null);
        
        setCancelMessage('Subscription cancelled successfully! You have been downgraded to the LITE plan.');
        setShowCancelConfirm(false);
        
        setTimeout(() => {
          fetchPaymentHistory();
        }, 1000);
      } else {
        setCancelMessage('Failed to cancel subscription. Please try again or contact support.');
      }
    } catch (error) {
      console.error('Error cancelling subscription:', error);
      const errorMessage = error.response?.data?.message || error.message || 'Failed to cancel subscription. Please try again or contact support.';
      setCancelMessage(errorMessage);
    } finally {
      setCancelling(false);
    }
  };

  const fetchPaymentHistory = async () => {
    setLoadingHistory(true);
    try {
      const history = await razorpayService.getPaymentHistory();
      
      // Deduplicate by paymentId or razorpayPaymentId (safety measure)
      const uniqueHistory = history.filter((payment, index, self) => 
        index === self.findIndex(p => 
          (payment.paymentId && p.paymentId === payment.paymentId) ||
          (payment.razorpayPaymentId && p.razorpayPaymentId === payment.razorpayPaymentId) ||
          (payment.orderId && p.orderId === payment.orderId)
        )
      );
      
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
    return new Date(dateString).toLocaleDateString('en-IN', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  const formatAmount = (amount, currency = 'INR') => {
    // Amount is already in rupees (converted from paise on backend)
    // No need to divide by 100 again
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount);
  };

  const getStatusColor = (status) => {
    switch (status?.toLowerCase()) {
      case 'succeeded':
      case 'paid':
        return 'text-green-400 bg-green-500/10 border border-green-500/40';
      case 'pending':
        return 'text-yellow-400 bg-yellow-500/10 border border-yellow-500/40';
      case 'failed':
        return 'text-red-400 bg-red-500/10 border border-red-500/40';
      default:
        return 'text-gray-400 bg-[#21262d] border border-[#30363d]';
    }
  };

  const isCurrentPlan = (plan) => plan === currentPlan && !isTrialPeriod;
  const canUpgrade = (plan) => {
    if (isTrialPeriod && plan === 'PRO') return true;
    const planOrder = { LITE: 0, PRO: 1, AGENCY: 2 };
    return planOrder[plan] > planOrder[currentPlan];
  };

  return (
    <div className="min-h-screen bg-[#1a1a1a]">
      {/* Cancel Success/Error Message */}
      <AnimatePresence>
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
      </AnimatePresence>

      {/* Payment Failed Warning Banner */}
      <AnimatePresence>
        {subscriptionStatus === 'past_due' && currentPlan !== 'LITE' && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="bg-gradient-to-r from-amber-600 via-orange-600 to-red-600 text-white"
          >
            <div className="max-w-6xl mx-auto px-4 py-3">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-white/20 rounded-full">
                    <AlertTriangle className="w-5 h-5" />
                  </div>
                  <div>
                    <p className="font-bold text-base">Payment Failed</p>
                    <p className="text-xs opacity-90">
                      Your last payment was unsuccessful. Please update your payment method to avoid losing access to Pro features.
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => handleUpgrade('PRO')}
                  className="flex-shrink-0 px-4 py-2 bg-white text-orange-600 font-bold rounded-xl hover:bg-gray-100 transition-all duration-300 flex items-center space-x-2 shadow-lg text-sm"
                >
                  <CreditCard className="w-4 h-4" />
                  <span>Update Payment</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Cancel Confirmation Modal */}
      {showCancelConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50 p-4">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="bg-[#161b22] rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl border border-[#30363d]"
          >
            <div className="text-center">
              <div className="relative w-16 h-16 mx-auto mb-4">
                <div className="absolute inset-0 bg-red-500/20 rounded-full animate-pulse"></div>
                <div className="absolute inset-2 bg-red-500/30 rounded-full animate-ping opacity-30"></div>
                <div className="absolute inset-0 bg-red-500/10 rounded-full flex items-center justify-center">
                  <div className="w-10 h-10 bg-red-600 rounded-full flex items-center justify-center shadow-lg">
                    <X className="w-5 h-5 text-white" />
                  </div>
                </div>
              </div>
              <h3 className="text-xl font-bold text-gray-100 mb-2">Cancel Subscription</h3>
              <p className="text-gray-400 mb-4 text-sm">
                Are you sure you want to cancel your subscription? You will be immediately downgraded to the LITE plan and lose access to all premium features.
              </p>
              
              <div className="flex space-x-3">
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 py-2.5 px-4 bg-[#21262d] hover:bg-[#30363d] text-gray-200 rounded-xl font-semibold transition-all duration-300 transform hover:scale-105 border border-[#30363d]"
                >
                  Keep Subscription
                </button>
                
                <button
                  onClick={handleCancelSubscription}
                  disabled={cancelling}
                  className="relative overflow-hidden flex-1 py-2.5 px-4 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
                  {cancelling ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                      <span className="text-sm">Cancelling...</span>
                    </>
                  ) : (
                    <>
                      <X className="w-4 h-4" />
                      <span className="text-sm">Cancel Now</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Hero Section - Matching IndiaPricing Style */}
      <section className="bg-blue-600 text-white py-12 px-4">
        <div className="max-w-6xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* SellerQI Logo */}
            <motion.div
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="mb-4"
            >
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-4 py-2 inline-block border border-white/20">
                <img 
                  src="https://res.cloudinary.com/ddoa960le/image/upload/v1752478546/Seller_QI_Logo___V1_1_t9s3kh.png" 
                  alt="SellerQI Logo" 
                  className="h-8 w-auto mx-auto"
                />
              </div>
            </motion.div>
            
            <div className="inline-block bg-white/10 backdrop-blur-sm px-4 py-1.5 rounded-full text-xs font-semibold mb-3 border border-white/20">
              🇮🇳 Plans & Billing - India
            </div>
            <h1 className="text-3xl md:text-4xl font-bold mb-3">
              Manage Your Plan & Billing
            </h1>
            <p className="text-base mb-6 opacity-90 max-w-2xl mx-auto">
              {isTrialPeriod 
                ? 'Your free trial is active. Upgrade to continue enjoying all features after the trial ends.'
                : `Current Plan: ${plans[currentPlan]?.displayName || currentPlan} - Manage your subscription and view payment history`
              }
            </p>
            
            {/* Current Plan Badge */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="inline-flex items-center space-x-2 bg-white/10 backdrop-blur-sm px-4 py-2 rounded-full border border-white/20"
            >
              <Crown className="w-4 h-4" />
              <span className="font-semibold text-base">
                {plans[currentPlan]?.displayName || currentPlan}
                {isTrialPeriod && ' (Free Trial)'}
              </span>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Plans Section */}
      <section className="bg-[#1a1a1a] py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.2 }}
            className="mb-16"
          >
            <div className="text-center mb-8">
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="text-3xl font-bold mb-3 text-gray-100"
              >
                {isTrialPeriod ? 'Upgrade Before Trial Ends' : 'Choose Your Plan'}
              </motion.h2>
              <motion.p
                initial={{ opacity: 0 }}
                whileInView={{ opacity: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="text-base text-gray-400"
              >
                {isTrialPeriod 
                  ? 'Upgrade now to continue enjoying all features after your trial ends'
                  : 'Select the perfect plan for your business needs'
                }
              </motion.p>
            </div>

          {/* Try 7 days for Free card - visible only for LITE users who have not been served a trial */}
          {showFreeTrialCard && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mb-8 max-w-5xl mx-auto"
            >
              <div className="relative overflow-hidden bg-[#161b22] rounded-xl shadow-lg border-2 border-amber-500/40 transition-all duration-300 hover:shadow-xl hover:border-amber-500/60">
                <div className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div className="flex items-center gap-3 flex-1">
                    <div className="w-12 h-12 bg-amber-600 rounded-xl flex items-center justify-center shadow-md flex-shrink-0">
                      <Zap className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-100 mb-1">Try 7 days for Free</h3>
                      <p className="text-gray-400 text-sm">Start your PRO trial. No charge until trial ends. Cancel anytime.</p>
                    </div>
                  </div>
                  <button
                    onClick={handleStartFreeTrial}
                    disabled={freeTrialLoading}
                    className="w-full sm:w-auto py-2.5 px-6 rounded-xl font-bold text-base transition-all duration-300 flex items-center justify-center space-x-2 bg-amber-600 text-white hover:bg-amber-700 hover:shadow-xl transform hover:scale-105 hover:-translate-y-1 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none flex-shrink-0"
                  >
                    {freeTrialLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Start Free Trial</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* PRO Plan Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="relative group lg:scale-105 z-10"
            >
              <div className="relative overflow-hidden bg-[#161b22] rounded-xl shadow-lg border-2 border-blue-500/40 transition-all duration-300 group-hover:shadow-xl group-hover:border-blue-500/60">
                <div className="p-4">
                  <div className="text-center mb-4">
                    <div className={`w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-3 shadow-md`}>
                      <Crown className="w-6 h-6 text-white" />
                    </div>

                    <h3 className="text-xl font-bold text-gray-100 mb-1">{plans.PRO.displayName}</h3>
                    <p className="text-gray-400 mb-3 text-sm">{plans.PRO.description}</p>
                    
                    <div className="mb-3">
                      <div className="text-lg line-through text-gray-500 mb-2">₹8,999/month</div>
                      <div className="text-4xl md:text-5xl font-bold text-blue-400 mb-1">
                        ₹1,999<span className="text-xl font-normal">/month</span>
                      </div>
                      <div className="text-sm text-gray-400 mb-2">For Indian registered sellers</div>
                      <div className="flex items-center justify-center gap-2 mb-2">
                        <span className="inline-block bg-emerald-500 text-white px-3 py-1 rounded-md font-semibold text-xs">
                          Save 78%
                        </span>
                        <span className="inline-block bg-blue-600/20 text-blue-400 px-3 py-1 rounded-md font-semibold text-xs border border-blue-500/40">
                          7-Day Free Trial
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Features List */}
                  <div className="space-y-2 mb-4">
                    {plans.PRO.features.map((feature, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        <div className="w-4 h-4 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0 border border-green-500/40">
                          <Check className="w-2.5 h-2.5 text-green-400" />
                        </div>
                        <span className="text-gray-300 text-sm">{feature}</span>
                      </div>
                    ))}
                  </div>

                  {/* Action Button */}
                  <button
                    onClick={() => handleUpgrade('PRO')}
                    disabled={isCurrentPlan('PRO') || loading.PRO}
                    className={`w-full py-2.5 px-4 rounded-xl font-bold text-base transition-all duration-300 flex items-center justify-center space-x-2 ${
                      isCurrentPlan('PRO')
                        ? 'bg-green-500/10 text-green-400 cursor-not-allowed border border-green-500/40'
                        : canUpgrade('PRO')
                        ? `bg-blue-600 text-white hover:bg-blue-700 hover:shadow-xl transform hover:scale-105 hover:-translate-y-1`
                        : 'bg-[#21262d] text-gray-500 cursor-not-allowed border border-[#30363d]'
                    }`}
                  >
                    {loading.PRO ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : isCurrentPlan('PRO') ? (
                      <>
                        <Award className="w-5 h-5" />
                        <span>Current Plan</span>
                      </>
                    ) : isTrialPeriod ? (
                      <>
                        <span>Upgrade to Pro</span>
                        <TrendingUp className="w-5 h-5" />
                      </>
                    ) : canUpgrade('PRO') ? (
                      <>
                        <span>Upgrade to {plans.PRO.displayName}</span>
                        <TrendingUp className="w-5 h-5" />
                      </>
                    ) : (
                      <span>Current Plan</span>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>

            {/* AGENCY Plan Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="relative group"
            >
              <div className="relative overflow-hidden bg-[#161b22] rounded-xl shadow-lg border-2 border-[#30363d] transition-all duration-300 group-hover:shadow-xl group-hover:border-[#21262d]">
                <div className="p-4">
                  <div className="text-center mb-4">
                    <div className={`w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center mx-auto mb-3 shadow-md`}>
                      <Users className="w-6 h-6 text-white" />
                    </div>

                    <h3 className="text-xl font-bold text-gray-100 mb-1">{plans.AGENCY.displayName}</h3>
                    <p className="text-gray-400 mb-3 text-sm">{plans.AGENCY.description}</p>
                    
                    <div className="mb-3">
                      <span className="text-4xl font-bold text-gray-100">Custom</span>
                      <span className="text-lg text-gray-400"> pricing</span>
                    </div>
                  </div>

                  {/* Features List */}
                  <div className="space-y-2 mb-4">
                    {plans.AGENCY.features.map((feature, index) => (
                      <div key={index} className="flex items-center space-x-2">
                        <div className="w-4 h-4 bg-green-500/20 rounded-full flex items-center justify-center flex-shrink-0 border border-green-500/40">
                          <Check className="w-2.5 h-2.5 text-green-400" />
                        </div>
                        <span className="text-gray-300 text-sm">{feature}</span>
                      </div>
                    ))}
                  </div>

                  {/* Contact Us Button */}
                  <button
                    onClick={() => handleUpgrade('AGENCY')}
                    disabled={loading.AGENCY}
                    className={`w-full py-2.5 px-4 rounded-xl font-bold text-base transition-all duration-300 flex items-center justify-center space-x-2 bg-blue-600 text-white hover:bg-blue-700 hover:shadow-xl transform hover:scale-105 hover:-translate-y-1`}
                  >
                    {loading.AGENCY ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <Mail className="w-4 h-4" />
                        <span>Contact Us</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>
        </div>
      </section>

      {/* Billing Information Section - Only show for active PRO subscription */}
      {currentPlan === 'PRO' && !isTrialPeriod && (
        <section className="bg-[#1a1a1a] py-12 px-4">
          <div className="max-w-6xl mx-auto">
            <motion.div 
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.4 }}
            >
              <motion.h2
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5 }}
                className="text-3xl font-bold text-center mb-8 text-gray-100"
              >
                Billing Information
              </motion.h2>
              
              <div className="bg-[#161b22] rounded-xl p-4 shadow-lg border border-[#30363d]">
              <div className="flex items-center justify-end mb-4">
                {/* Cancel Subscription Button */}
                <div className="relative group">
                  <button
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={cancelling}
                    className="relative overflow-hidden flex items-center space-x-2 px-6 py-2.5 bg-red-600 hover:bg-red-700 text-white rounded-xl font-semibold text-sm transition-all duration-300 ease-out transform hover:scale-105 hover:shadow-2xl hover:shadow-red-500/25 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {cancelling ? (
                      <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : (
                      <X className="w-4 h-4" />
                    )}
                    <span className="text-sm">{cancelling ? 'Cancelling...' : 'Cancel Subscription'}</span>
                  </button>
                  
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-2 py-1 bg-[#21262d] text-gray-100 text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none whitespace-nowrap border border-[#30363d]">
                    This will immediately downgrade you to LITE plan
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-[#21262d]"></div>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-[#1a1a1a] rounded-xl p-4 border border-[#30363d]">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center border border-blue-500/40">
                      <Calendar className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-100 mb-1 text-sm">Next Billing Date</h4>
                      <p className="text-gray-400 text-sm">
                        {userSubscription?.nextBillingDate 
                          ? new Date(userSubscription.nextBillingDate).toLocaleDateString('en-IN', {
                              year: 'numeric',
                              month: 'long',
                              day: 'numeric'
                            })
                          : (() => {
                              const nextMonth = new Date();
                              nextMonth.setMonth(nextMonth.getMonth() + 1);
                              return nextMonth.toLocaleDateString('en-IN', {
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
                
                <div className="bg-[#1a1a1a] rounded-xl p-4 border border-[#30363d]">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-green-600/20 rounded-xl flex items-center justify-center border border-green-500/40">
                      <Shield className="w-5 h-5 text-green-400" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-100 mb-1 text-sm">Payment Status</h4>
                      <div className="flex items-center space-x-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${
                          userSubscription?.paymentStatus === 'paid' ? 'bg-green-500' : 'bg-blue-500'
                        }`}></div>
                        <p className={`font-medium text-sm ${
                          userSubscription?.paymentStatus === 'paid' ? 'text-green-400' : 'text-blue-400'
                        }`}>
                          {userSubscription?.paymentStatus?.toUpperCase() || 'ACTIVE'}
                        </p>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="bg-[#1a1a1a] rounded-xl p-4 border border-[#30363d]">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 bg-blue-600/20 rounded-xl flex items-center justify-center border border-blue-500/40">
                      <CreditCard className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-100 mb-1 text-sm">Current Plan</h4>
                      <p className="text-gray-300 font-medium text-sm">
                        {plans[currentPlan]?.displayName}
                      </p>
                      <p className="text-xs text-gray-400">
                        ₹{plans[currentPlan]?.price?.toLocaleString('en-IN')}/month
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        </div>
        </section>
      )}

      {/* Payment History Section */}
      <section className="bg-[#1a1a1a] py-12 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.5 }}
          >
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="text-3xl font-bold text-center mb-8 text-gray-100"
            >
              Payment History
            </motion.h2>
            
            <div className="bg-[#161b22] rounded-xl p-4 shadow-lg border border-[#30363d]">

            {loadingHistory ? (
              <div className="flex items-center justify-center py-8">
                <div className="flex items-center space-x-3">
                  <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
                  <span className="text-gray-400">Loading payment history...</span>
                </div>
              </div>
            ) : paymentHistory.length === 0 ? (
              <div className="text-center py-8">
                <div className="w-14 h-14 bg-[#1a1a1a] rounded-full flex items-center justify-center mx-auto mb-3 border border-[#30363d]">
                  <History className="w-7 h-7 text-gray-500" />
                </div>
                <h4 className="text-lg font-semibold text-gray-100 mb-2">No Payment History</h4>
                <p className="text-gray-400 text-sm">You haven't made any payments yet. Payment history will appear here once you upgrade to a paid plan.</p>
              </div>
            ) : (
              <div className="space-y-4">
                {paymentHistory.slice(0, visiblePayments).map((payment, index) => (
                  <motion.div
                    key={payment.razorpayPaymentId || payment.paymentId || payment.orderId || `payment-${index}`}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.1 }}
                    className="bg-[#1a1a1a] rounded-xl p-4 border border-[#30363d] hover:shadow-lg transition-all duration-300"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center">
                          <Receipt className="w-5 h-5 text-white" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-100 mb-1 text-sm">
                            Subscription Payment
                          </h4>
                          <p className="text-xs text-gray-400">
                            {formatDate(payment.paymentDate)}
                          </p>
                        </div>
                      </div>
                      
                      <div className="text-right flex items-center space-x-3">
                        <div>
                          <div className="text-lg font-bold text-gray-100 mb-1">
                            {formatAmount(payment.amount, payment.currency || 'INR')}
                          </div>
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${getStatusColor(payment.status).replace('text-gray-600 bg-gray-100', 'text-gray-300 bg-[#21262d] border border-[#30363d]')}`}>
                            {payment.status?.charAt(0).toUpperCase() + payment.status?.slice(1) || 'Unknown'}
                          </span>
                        </div>
                        {/* Download Invoice Button - Always show for all payments */}
                        <button
                          onClick={async () => {
                            const paymentId = payment.razorpayPaymentId || payment.paymentId || payment.id;
                            setLoadingInvoice(prev => ({ ...prev, [paymentId]: true }));
                            
                            try {
                              if (payment.invoicePdf || payment.invoiceUrl) {
                                // Direct download if URL is already available
                                const invoiceUrl = payment.invoicePdf || payment.invoiceUrl;
                                const newWindow = window.open(invoiceUrl, '_blank');
                                
                                // Wait a moment for the window to open, then stop loading
                                setTimeout(() => {
                                  setLoadingInvoice(prev => ({ ...prev, [paymentId]: false }));
                                }, 500);
                              } else if (payment.razorpayPaymentId) {
                                // Fetch invoice URL from Razorpay
                                await razorpayService.downloadInvoice(payment.razorpayPaymentId);
                                setLoadingInvoice(prev => ({ ...prev, [paymentId]: false }));
                              } else if (payment.paymentId) {
                                // Try using paymentId for Razorpay
                                await razorpayService.downloadInvoice(payment.paymentId);
                                setLoadingInvoice(prev => ({ ...prev, [paymentId]: false }));
                              } else {
                                alert('Invoice information not available for this payment. Please contact support.');
                                setLoadingInvoice(prev => ({ ...prev, [paymentId]: false }));
                              }
                            } catch (error) {
                              console.error('Error downloading invoice:', error);
                              alert('Failed to download invoice. Please try again or contact support.');
                              setLoadingInvoice(prev => ({ ...prev, [paymentId]: false }));
                            }
                          }}
                          disabled={loadingInvoice[payment.razorpayPaymentId || payment.paymentId || payment.id]}
                          className="flex items-center space-x-2 px-3 py-1.5 bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 rounded-xl font-medium transition-all duration-300 hover:shadow-lg disabled:opacity-50 disabled:cursor-not-allowed border border-blue-500/40"
                          title="Download Invoice"
                        >
                          {loadingInvoice[payment.razorpayPaymentId || payment.paymentId || payment.id] ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <span className="text-xs">Invoice</span>
                          )}
                        </button>
                      </div>
                    </div>
                  </motion.div>
                ))}

                {visiblePayments < paymentHistory.length && (
                  <div className="text-center pt-4">
                    <button
                      onClick={handleShowMore}
                      className="inline-flex items-center space-x-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-semibold transition-all duration-300 transform hover:scale-105"
                    >
                      <span className="text-sm">Show More Payments</span>
                      <ChevronDown className="w-4 h-4" />
                    </button>
                    <p className="text-xs text-gray-400 mt-2">
                      Showing {visiblePayments} of {paymentHistory.length} payments
                    </p>
                  </div>
                )}

                {visiblePayments > 5 && visiblePayments >= paymentHistory.length && (
                  <div className="text-center pt-3">
                    <button
                      onClick={() => setVisiblePayments(5)}
                      className="text-blue-400 hover:text-blue-300 font-medium transition-colors duration-300 text-sm"
                    >
                      Show Less
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </motion.div>
      </div>
      </section>

      {/* Support Section */}
      <section className="bg-[#161b22] text-white py-12 px-4 border-t border-[#30363d]">
        <div className="max-w-4xl mx-auto text-center">
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.7 }}
          >
            <motion.h2
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="text-3xl font-bold mb-3 text-gray-100"
            >
              Need Help with Your Plan?
            </motion.h2>
            <motion.p
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="text-base mb-6 text-gray-400"
            >
              Our dedicated support team is here to help you choose the right plan and answer any billing questions.
            </motion.p>
            <motion.button
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
              onClick={() => navigate('/seller-central-checker/settings?tab=support')}
              className="max-w-md mx-auto w-full py-3 px-6 rounded-lg text-base font-semibold transition-all duration-300 bg-blue-600 text-white hover:bg-blue-700 shadow-lg"
            >
              <div className="flex items-center justify-center space-x-2">
                <MessageCircle className="w-4 h-4" />
                <span>Contact Support</span>
                <ArrowRight className="w-4 h-4" />
              </div>
            </motion.button>
          </motion.div>
        </div>
      </section>
    </div>
  );
}

