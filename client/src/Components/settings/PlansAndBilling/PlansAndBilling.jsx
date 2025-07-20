import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
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
  X
} from 'lucide-react';
import stripeService from '../../../services/stripeService';
import axiosInstance from '../../../config/axios.config';

export default function PlansAndBilling() {
  const [currentPlan, setCurrentPlan] = useState('LITE');
  const [subscriptionStatus, setSubscriptionStatus] = useState('active');
  const [loading, setLoading] = useState({});
  const [userSubscription, setUserSubscription] = useState(null);
  const user = useSelector((state) => state.Auth.user);
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

  useEffect(() => {
    fetchUserSubscription();
  }, []);

  const fetchUserSubscription = async () => {
    try {
      // Get user details to check packageType
      if (user) {
        setCurrentPlan(user.packageType || 'LITE');
        setSubscriptionStatus(user.subscriptionStatus || 'active');
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

  const isCurrentPlan = (plan) => plan === currentPlan;
  const canUpgrade = (plan) => {
    const planOrder = { LITE: 0, PRO: 1, AGENCY: 2 };
    return planOrder[plan] > planOrder[currentPlan];
  };

    return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-indigo-100">
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
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-gray-900 mb-4">Upgrade Your Experience</h2>
            <p className="text-xl text-gray-600">Choose the plan that fits your business needs</p>
        </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
            {Object.entries(plans).map(([planKey, plan], index) => (
              <motion.div
                key={planKey}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 + index * 0.1 }}
                className={`relative group ${plan.popular ? 'lg:scale-105 z-10' : ''}`}
              >
                {/* Plan Card */}
                <div className={`relative overflow-hidden bg-white rounded-3xl shadow-xl border-2 transition-all duration-300 group-hover:shadow-2xl group-hover:border-gray-300 ${
                  plan.popular 
                    ? 'border-blue-200' 
                    : 'border-gray-200'
                }`}>
                  
                  {/* Card Content */}
                  <div className="p-8">
                    {/* Plan Header */}
                    <div className="text-center mb-8">
                      <div className={`w-20 h-20 bg-gradient-to-r ${plan.gradient} rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg`}>
                        <plan.icon className="w-10 h-10 text-white" />
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
            <div className="bg-white/80 backdrop-blur-lg rounded-3xl p-8 shadow-xl border border-white/20">
              <h3 className="text-2xl font-bold text-gray-900 mb-6 flex items-center space-x-3">
                <CreditCard className="w-6 h-6 text-blue-600" />
                <span>Billing Information</span>
              </h3>
              
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

        {/* Support Section */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, delay: 0.6 }}
          className="text-center"
        >
          <div className="bg-gradient-to-r from-gray-900 via-blue-900 to-purple-900 rounded-3xl p-12 text-white">
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