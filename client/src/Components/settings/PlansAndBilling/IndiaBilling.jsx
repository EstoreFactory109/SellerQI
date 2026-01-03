import React, { useState, useEffect } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { updatePackageType } from '../../../redux/slices/authSlice';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Check, 
  Crown, 
  Users, 
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
  History,
  Shield,
  Mail
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
  const user = useSelector((state) => state.Auth.user);
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

  const fetchUserSubscription = async () => {
    try {
      if (user) {
        setCurrentPlan(user.packageType || 'LITE');
        setSubscriptionStatus(user.subscriptionStatus || 'active');
        setIsTrialPeriod(user.isInTrialPeriod || false);
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
          (result) => {
            // Success callback
            dispatch(updatePackageType({
              packageType: 'PRO',
              subscriptionStatus: 'active'
            }));
            setCurrentPlan('PRO');
            setSubscriptionStatus('active');
            setIsTrialPeriod(false);
            fetchUserSubscription();
            fetchPaymentHistory();
            setLoading(prev => ({ ...prev, [planType]: false }));
          },
          (error) => {
            // Error callback
            if (error.message !== 'Payment cancelled by user') {
              alert(error.message || 'Payment failed. Please try again.');
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
      const sortedHistory = history.sort((a, b) => new Date(b.paymentDate) - new Date(a.paymentDate));
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
    return new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: currency.toUpperCase()
    }).format(amount / 100);
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

  const isCurrentPlan = (plan) => plan === currentPlan && !isTrialPeriod;
  const canUpgrade = (plan) => {
    if (isTrialPeriod && plan === 'PRO') return true;
    const planOrder = { LITE: 0, PRO: 1, AGENCY: 2 };
    return planOrder[plan] > planOrder[currentPlan];
  };

  return (
    <div className="min-h-screen bg-[#eeeeee]">
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
                <button
                  onClick={() => setShowCancelConfirm(false)}
                  className="flex-1 py-4 px-6 bg-gradient-to-r from-gray-100 to-gray-200 hover:from-gray-200 hover:to-gray-300 text-gray-700 rounded-2xl font-semibold transition-all duration-300 transform hover:scale-105"
                >
                  Keep Subscription
                </button>
                
                <button
                  onClick={handleCancelSubscription}
                  disabled={cancelling}
                  className="relative overflow-hidden flex-1 py-4 px-6 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white rounded-2xl font-semibold transition-all duration-300 transform hover:scale-105 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center space-x-2"
                >
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
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Header Section */}
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-indigo-600/10 via-purple-600/10 to-pink-600/10"></div>
        <div className="absolute top-0 left-1/4 w-96 h-96 bg-gradient-to-r from-indigo-400 to-purple-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
        <div className="absolute top-0 right-1/4 w-96 h-96 bg-gradient-to-r from-pink-400 to-red-500 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse delay-1000"></div>
        
        <div className="relative px-6 py-12">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center max-w-4xl mx-auto"
          >
            <div className="inline-flex items-center space-x-2 bg-white/80 backdrop-blur-sm rounded-full px-6 py-2 mb-6 shadow-lg">
              <span className="text-lg">🇮🇳</span>
              <span className="text-sm font-semibold text-gray-700">Plans & Billing - India</span>
            </div>
            
            <h1 className="text-4xl md:text-5xl font-bold bg-gradient-to-r from-gray-900 via-indigo-900 to-purple-900 bg-clip-text text-transparent mb-6">
              Choose Your Perfect Plan
            </h1>
            <p className="text-xl text-gray-600 mb-4 max-w-2xl mx-auto">
              Unlock powerful insights and scale your Amazon business with our comprehensive analytics platform
            </p>
            
            {/* Current Plan Badge */}
            <div className="inline-flex items-center space-x-2 bg-indigo-100 text-indigo-700 px-4 py-2 rounded-full">
              <Crown className="w-4 h-4" />
              <span className="font-medium">
                Current Plan: {plans[currentPlan]?.displayName || currentPlan}
                {isTrialPeriod && ' (Trial)'}
              </span>
            </div>
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
            <h2 className="text-3xl font-bold text-gray-900 mb-4">
              {isTrialPeriod ? 'Upgrade Before Trial Ends' : 'Upgrade Your Experience'}
            </h2>
            <p className="text-xl text-gray-600">Choose the plan that fits your business needs</p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 max-w-5xl mx-auto">
            {/* PRO Plan Card */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="relative group lg:scale-105 z-10"
            >
              <div className="relative overflow-hidden bg-white rounded-xl shadow-lg border-2 border-indigo-200 transition-all duration-300 group-hover:shadow-xl group-hover:border-indigo-300">
                <div className="p-6">
                  <div className="text-center mb-6">
                    <div className={`w-16 h-16 bg-gradient-to-r ${plans.PRO.gradient} rounded-xl flex items-center justify-center mx-auto mb-4 shadow-md`}>
                      <Crown className="w-8 h-8 text-white" />
                    </div>

                    <h3 className="text-2xl font-bold text-gray-900 mb-2">{plans.PRO.displayName}</h3>
                    <p className="text-gray-600 mb-4">{plans.PRO.description}</p>
                    
                    <div className="mb-4">
                      <span className="text-5xl font-bold text-gray-900">₹1,999</span>
                      <span className="text-xl text-gray-500">/month</span>
                    </div>
                    
                    <div className="inline-flex items-center space-x-1 text-emerald-600 bg-emerald-100 px-3 py-1 rounded-full text-sm font-medium">
                      <Sparkles className="w-4 h-4" />
                      <span>Save 78% vs US pricing</span>
                    </div>
                  </div>

                  {/* Features List */}
                  <div className="space-y-4 mb-8">
                    {plans.PRO.features.map((feature, index) => (
                      <div key={index} className="flex items-center space-x-3">
                        <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <Check className="w-3 h-3 text-green-600" />
                        </div>
                        <span className="text-gray-700">{feature}</span>
                      </div>
                    ))}
                  </div>

                  {/* Action Button */}
                  <button
                    onClick={() => handleUpgrade('PRO')}
                    disabled={isCurrentPlan('PRO') || loading.PRO}
                    className={`w-full py-4 px-6 rounded-2xl font-bold text-lg transition-all duration-300 flex items-center justify-center space-x-2 ${
                      isCurrentPlan('PRO')
                        ? 'bg-green-100 text-green-700 cursor-not-allowed'
                        : canUpgrade('PRO')
                        ? `bg-gradient-to-r ${plans.PRO.gradient} text-white hover:shadow-xl transform hover:scale-105 hover:-translate-y-1`
                        : 'bg-gray-100 text-gray-500 cursor-not-allowed'
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
              <div className="relative overflow-hidden bg-white rounded-xl shadow-lg border-2 border-gray-200 transition-all duration-300 group-hover:shadow-xl group-hover:border-gray-300">
                <div className="p-6">
                  <div className="text-center mb-6">
                    <div className={`w-16 h-16 bg-gradient-to-r ${plans.AGENCY.gradient} rounded-xl flex items-center justify-center mx-auto mb-4 shadow-md`}>
                      <Users className="w-8 h-8 text-white" />
                    </div>

                    <h3 className="text-2xl font-bold text-gray-900 mb-2">{plans.AGENCY.displayName}</h3>
                    <p className="text-gray-600 mb-4">{plans.AGENCY.description}</p>
                    
                    <div className="mb-4">
                      <span className="text-5xl font-bold text-gray-900">Custom</span>
                      <span className="text-xl text-gray-500"> pricing</span>
                    </div>
                  </div>

                  {/* Features List */}
                  <div className="space-y-4 mb-8">
                    {plans.AGENCY.features.map((feature, index) => (
                      <div key={index} className="flex items-center space-x-3">
                        <div className="w-5 h-5 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
                          <Check className="w-3 h-3 text-green-600" />
                        </div>
                        <span className="text-gray-700">{feature}</span>
                      </div>
                    ))}
                  </div>

                  {/* Contact Us Button */}
                  <button
                    onClick={() => handleUpgrade('AGENCY')}
                    disabled={loading.AGENCY}
                    className={`w-full py-4 px-6 rounded-2xl font-bold text-lg transition-all duration-300 flex items-center justify-center space-x-2 bg-gradient-to-r ${plans.AGENCY.gradient} text-white hover:shadow-xl transform hover:scale-105 hover:-translate-y-1`}
                  >
                    {loading.AGENCY ? (
                      <Loader2 className="w-5 h-5 animate-spin" />
                    ) : (
                      <>
                        <Mail className="w-5 h-5" />
                        <span>Contact Us</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        </motion.div>

        {/* Billing Information - Only show for active PRO subscription */}
        {currentPlan === 'PRO' && !isTrialPeriod && (
          <motion.div 
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, delay: 0.4 }}
            className="mb-16"
          >
            <div className="bg-white rounded-xl p-6 shadow-lg border border-gray-200">
              <div className="flex items-center justify-between mb-6">
                <h3 className="text-2xl font-bold text-gray-900 flex items-center space-x-3">
                  <CreditCard className="w-6 h-6 text-indigo-600" />
                  <span>Billing Information</span>
                </h3>
                
                {/* Cancel Subscription Button */}
                <div className="relative group">
                  <button
                    onClick={() => setShowCancelConfirm(true)}
                    disabled={cancelling}
                    className="relative overflow-hidden flex items-center space-x-3 px-8 py-4 bg-gradient-to-r from-red-500 to-red-600 hover:from-red-600 hover:to-red-700 text-white rounded-2xl font-semibold text-sm transition-all duration-300 ease-out transform hover:scale-105 hover:shadow-2xl hover:shadow-red-500/25 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {cancelling ? (
                      <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></div>
                    ) : (
                      <X className="w-5 h-5" />
                    )}
                    <span>{cancelling ? 'Cancelling...' : 'Cancel Subscription'}</span>
                  </button>
                  
                  <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-3 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg opacity-0 group-hover:opacity-100 transition-opacity duration-300 pointer-events-none whitespace-nowrap">
                    This will immediately downgrade you to LITE plan
                    <div className="absolute top-full left-1/2 transform -translate-x-1/2 border-4 border-transparent border-t-gray-900"></div>
                  </div>
                </div>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-2xl p-6">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-indigo-100 rounded-xl flex items-center justify-center">
                      <Calendar className="w-6 h-6 text-indigo-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Next Billing Date</h4>
                      <p className="text-gray-600">
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
                
                <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-2xl p-6">
                  <div className="flex items-center space-x-4">
                    <div className="w-12 h-12 bg-green-100 rounded-xl flex items-center justify-center">
                      <Shield className="w-6 h-6 text-green-600" />
                    </div>
                    <div>
                      <h4 className="font-semibold text-gray-900 mb-1">Payment Status</h4>
                      <div className="flex items-center space-x-2">
                        <div className={`w-3 h-3 rounded-full ${
                          userSubscription?.paymentStatus === 'paid' ? 'bg-green-500' : 'bg-indigo-500'
                        }`}></div>
                        <p className={`font-medium ${
                          userSubscription?.paymentStatus === 'paid' ? 'text-green-600' : 'text-indigo-600'
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
                        {plans[currentPlan]?.displayName}
                      </p>
                      <p className="text-sm text-gray-500">
                        ₹{plans[currentPlan]?.price?.toLocaleString('en-IN')}/month
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
                <Receipt className="w-6 h-6 text-indigo-600" />
                <span>Payment History</span>
              </h3>
              
              <button
                className="flex items-center space-x-2 px-4 py-2 bg-indigo-100 hover:bg-indigo-200 text-indigo-700 rounded-xl font-medium transition-all duration-300 hover:shadow-lg"
                onClick={() => console.log('Download payment history')}
              >
                <Download className="w-4 h-4" />
                <span>Download</span>
              </button>
            </div>

            {loadingHistory ? (
              <div className="flex items-center justify-center py-12">
                <div className="flex items-center space-x-3">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
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
                    key={payment.paymentId || index}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: index * 0.1 }}
                    className="bg-gradient-to-r from-gray-50 to-white rounded-2xl p-6 border border-gray-200 hover:shadow-lg transition-all duration-300"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center space-x-4">
                        <div className="w-12 h-12 bg-gradient-to-r from-indigo-500 to-indigo-600 rounded-2xl flex items-center justify-center">
                          <Receipt className="w-6 h-6 text-white" />
                        </div>
                        <div>
                          <h4 className="font-semibold text-gray-900 mb-1">
                            Subscription Payment
                          </h4>
                          <p className="text-sm text-gray-600">
                            {formatDate(payment.paymentDate)}
                          </p>
                          {payment.razorpayPaymentId && (
                            <p className="text-xs text-gray-500 mt-1">
                              ID: {payment.razorpayPaymentId.slice(-8)}
                            </p>
                          )}
                        </div>
                      </div>
                      
                      <div className="text-right">
                        <div className="text-xl font-bold text-gray-900 mb-2">
                          {formatAmount(payment.amount, payment.currency || 'INR')}
                        </div>
                        <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${getStatusColor(payment.status)}`}>
                          {payment.status?.charAt(0).toUpperCase() + payment.status?.slice(1) || 'Unknown'}
                        </span>
                      </div>
                    </div>
                  </motion.div>
                ))}

                {visiblePayments < paymentHistory.length && (
                  <div className="text-center pt-6">
                    <button
                      onClick={handleShowMore}
                      className="inline-flex items-center space-x-3 px-8 py-4 bg-gradient-to-r from-indigo-500 to-indigo-600 hover:from-indigo-600 hover:to-indigo-700 text-white rounded-2xl font-semibold transition-all duration-300 transform hover:scale-105"
                    >
                      <span>Show More Payments</span>
                      <ChevronDown className="w-5 h-5" />
                    </button>
                    <p className="text-sm text-gray-600 mt-3">
                      Showing {visiblePayments} of {paymentHistory.length} payments
                    </p>
                  </div>
                )}

                {visiblePayments > 5 && visiblePayments >= paymentHistory.length && (
                  <div className="text-center pt-4">
                    <button
                      onClick={() => setVisiblePayments(5)}
                      className="text-indigo-600 hover:text-indigo-700 font-medium transition-colors duration-300"
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
          <div className="bg-gradient-to-r from-gray-800 via-indigo-800 to-purple-800 rounded-xl p-8 text-white">
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

