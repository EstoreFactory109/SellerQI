import React, { useState, useEffect } from 'react';
import { Check, X, Loader2, Star, Shield, Zap, BarChart3, Users, Crown, Plus, Minus } from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';
import { useSelector } from 'react-redux';
import axiosInstance from '../config/axios.config.js';
import stripeService from '../services/stripeService.js';

export default function PricingPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [loading, setLoading] = useState({});
  const [openFaq, setOpenFaq] = useState(null);
  const [showCancelledMessage, setShowCancelledMessage] = useState(false);
  
  // Get user auth status from Redux and localStorage fallback
  const isAuthenticatedRedux = useSelector(state => state.auth?.isAuthenticated || false);
  const isAuthenticatedLocal = localStorage.getItem('isAuth') === 'true';
  const isAuthenticated = isAuthenticatedRedux || isAuthenticatedLocal;
  
  // Get user data to access current plan
  const user = useSelector((state) => state.Auth?.user);
  const currentPlan = user?.packageType || 'LITE';
  
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // Check if user came here from cancelled payment
    if (searchParams.get('cancelled') === 'true') {
      setShowCancelledMessage(true);
      // Hide message after 5 seconds
      setTimeout(() => {
        setShowCancelledMessage(false);
      }, 5000);
    }

    // Check if user intended to activate free trial after signup
    const intendedAction = localStorage.getItem('intendedAction');
    if (intendedAction === 'free-trial' && isAuthenticated) {
      // Small delay to ensure the user sees the pricing page briefly
      setTimeout(() => {
        handleFreeTrial();
      }, 1500);
    }
  }, [searchParams, isAuthenticated]);

  const handleSubscribe = async (planType) => {
    // Check if user is authenticated
    if (!isAuthenticated) {
      // Store the intended plan in localStorage
      localStorage.setItem('intendedPlan', planType);
      // Redirect to signup page
      navigate('/sign-up');
      return;
    }

    // Set loading state
    setLoading(prev => ({ ...prev, [planType]: true }));

    try {
      if (planType === 'LITE') {
        // Call API to update user subscription plan to LITE
        const response = await axiosInstance.put('/app/update-subscription-plan', {
          planType: 'LITE'
        });

        if (response.status === 200) {
          // Clear any intended plan since user has now selected LITE
          localStorage.removeItem('intendedPlan');
          
          // Redirect to dashboard for LITE plan users (with limited features)
          setTimeout(() => {
            navigate('/seller-central-checker/dashboard');
          }, 1000);
        }
      } else if (['PRO', 'AGENCY'].includes(planType)) {
        // Store current plan for post-payment redirect logic
        if (isAuthenticated && currentPlan) {
          localStorage.setItem('previousPlan', currentPlan);
        }
        
        // For PRO/AGENCY plans, redirect to Stripe checkout
        await stripeService.createCheckoutSession(planType);
        // The user will be redirected to Stripe, so no need for further processing
      } else {
        throw new Error('Invalid plan type');
      }
      
    } catch (error) {
      console.error('Error handling subscription:', error);
      alert(error.response?.data?.message || 'Failed to process subscription. Please try again.');
    } finally {
      setTimeout(() => {
        setLoading(prev => ({ ...prev, [planType]: false }));
      }, planType === 'LITE' ? 1000 : 500);
    }
  };

  const handleFreeTrial = async () => {
    if (!isAuthenticated) {
      // Store the intended action and redirect to signup
      localStorage.setItem('intendedAction', 'free-trial');
      navigate('/sign-up');
      return;
    }

    setLoading(prev => ({ ...prev, freeTrial: true }));

    try {
      const response = await axiosInstance.post('/app/activate-free-trial');
      
      if (response.status === 200) {
        // Clear any intended action since trial is now activated
        localStorage.removeItem('intendedAction');
        
        // Redirect to connect-to-amazon page for trial users
        setTimeout(() => {
          navigate('/connect-to-amazon');
        }, 1000);
      }
    } catch (error) {
      console.error('Error activating free trial:', error);
      alert(error.response?.data?.message || 'Failed to activate free trial. Please try again.');
    } finally {
      setTimeout(() => {
        setLoading(prev => ({ ...prev, freeTrial: false }));
      }, 1000);
    }
  };

  const getButtonText = (planType) => {
    if (loading[planType]) {
      return <Loader2 className="w-5 h-5 animate-spin mx-auto" />;
    }
    
    switch(planType) {
      case 'LITE':
        return 'Get Started Free';
      case 'PRO':
        return 'Upgrade to Pro';
      case 'AGENCY':
        return 'Upgrade to Agency';
      default:
        return 'Select Plan';
    }
  };

  const isButtonDisabled = (planType) => {
    return loading[planType];
  };
  
  const faqs = [
    {
      q: "What's the difference between Free and Pro?",
      a: 'Free gives you basic product analysis with limited features. Pro includes everything - unlimited analyses, detailed reports, fix recommendations, priority support, and tracking for multiple products.',
    },
    {
      q: 'Will I lose data if I downgrade?',
      a: 'No, your historical data will be preserved. However, you will lose access to premium features like downloading reports and priority support.',
    },
    {
      q: 'Can I cancel anytime?',
      a: 'Yes, you can cancel your subscription anytime. You will continue to have access until the end of your billing period, and you can always return to the free plan.',
    },
    {
      q: 'How often is my product data updated?',
      a: 'Product data is updated in real-time for Pro plans. Free plan users get basic analysis with standard refresh rates.',
    },
    {
      q: 'What is the Agency plan for?',
      a: 'The Agency plan is designed for agencies and consultants managing multiple client accounts. It includes everything in Pro plus agency-specific features like client management and white-label reporting.',
    },
  ];

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <Navbar />
      
      {/* Cancelled Payment Notification */}
      <AnimatePresence>
        {showCancelledMessage && (
          <motion.div
            initial={{ opacity: 0, y: -100 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -100 }}
            className="bg-yellow-50 border-l-4 border-yellow-400 p-4 mx-4 mt-4 rounded-r-lg shadow-sm"
          >
            <div className="flex items-center">
              <div className="flex-shrink-0">
                <X className="h-5 w-5 text-yellow-400" />
              </div>
              <div className="ml-3">
                <p className="text-sm text-yellow-700">
                  Payment was cancelled. No charges were made to your account. You can try again anytime!
                </p>
              </div>
              <div className="ml-auto pl-3">
                <button
                  onClick={() => setShowCancelledMessage(false)}
                  className="text-yellow-500 hover:text-yellow-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      
      <main className="flex-1 w-full">
        {/* Hero Section */}
        <section className="relative bg-gradient-to-b from-gray-50 via-white to-white pt-16 pb-24 px-4 lg:px-6 overflow-hidden">
          {/* Background Elements */}
          <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))] dark:bg-grid-slate-700/25 dark:[mask-image:linear-gradient(0deg,rgba(255,255,255,0.1),rgba(255,255,255,0.5))]"></div>
          <div className="absolute top-10 right-10 w-72 h-72 bg-gray-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
          <div className="absolute top-40 left-10 w-72 h-72 bg-emerald-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-2000"></div>
          
          <div className="relative container mx-auto max-w-4xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              {/* Announcement Bar */}
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-emerald-50 text-emerald-700 rounded-full text-sm font-medium mb-8">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse"></div>
                Choose Your Perfect Plan • All Plans Available Now
              </div>
              
              <h1 className="text-5xl lg:text-6xl font-bold leading-tight text-gray-900 mb-6">
                Choose the <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#3B4A6B] to-emerald-600">Perfect Plan</span> for Your Business
              </h1>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto mb-12">
                Start with our free plan or choose a premium option for advanced features and analytics.
              </p>

              {/* Trust Indicators */}
              <div className="flex flex-wrap justify-center gap-6 text-sm text-gray-500 mb-8">
                <span className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> No setup fees</span>
                <span className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> Always free plan</span>
                <span className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-500" /> Full access</span>
                <span className="flex items-center gap-2"><Shield className="w-4 h-4 text-[#3B4A6B]" /> SOC 2 Compliant</span>
              </div>
            </motion.div>
          </div>
        </section>

        {/* Pricing Cards */}
        <section className="py-24 px-4 lg:px-6 bg-white">
          <div className="container mx-auto max-w-7xl">
            <div className="grid lg:grid-cols-3 gap-8 items-end">
              
              {/* Free Plan */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="bg-white rounded-2xl border-2 border-gray-200 p-8 shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <BarChart3 className="w-8 h-8 text-gray-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">Free Plan</h3>
                  <div className="text-4xl font-bold text-gray-900 mb-2">$0<span className="text-lg text-gray-500 font-normal">/month</span></div>
                  <p className="text-gray-600">Perfect for new sellers getting started</p>
                </div>
                
                <ul className="space-y-4 mb-8">
                  <li className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                    <span className="text-gray-700">Basic product analysis</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <X className="w-5 h-5 text-red-500 flex-shrink-0" />
                    <span className="text-gray-500">Download reports</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <X className="w-5 h-5 text-red-500 flex-shrink-0" />
                    <span className="text-gray-500">Fix recommendations</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <X className="w-5 h-5 text-red-500 flex-shrink-0" />
                    <span className="text-gray-500">Track multiple products</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <X className="w-5 h-5 text-red-500 flex-shrink-0" />
                    <span className="text-gray-500">Priority support</span>
                  </li>
                </ul>
                
                <button 
                  onClick={() => handleSubscribe('LITE')}
                  disabled={isButtonDisabled('LITE')}
                  className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 ${
                    isButtonDisabled('LITE')
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      : 'border-2 border-emerald-500 text-emerald-600 hover:bg-emerald-50'
                  }`}
                >
                  {getButtonText('LITE')}
                </button>
              </motion.div>

              {/* Pro Plan - Featured */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.2 }}
                className="bg-gradient-to-br from-[#3B4A6B] to-[#333651] text-white rounded-2xl p-8 shadow-2xl relative transform lg:scale-105"
              >
                <div className="absolute -top-4 left-1/2 transform -translate-x-1/2 bg-emerald-500 text-white px-6 py-2 rounded-full text-sm font-semibold shadow-lg">
                  Most Popular
                </div>
                
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Crown className="w-8 h-8 text-white" />
                  </div>
                  <h3 className="text-2xl font-bold mb-2">Pro Plan</h3>
                  <div className="text-4xl font-bold mb-2">$99<span className="text-lg opacity-75 font-normal">/month</span></div>
                  <p className="opacity-90">Everything you need to scale</p>
                </div>
                
                <ul className="space-y-4 mb-8">
                  <li className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-emerald-300 flex-shrink-0" />
                    <span>Unlimited product analyses</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-emerald-300 flex-shrink-0" />
                    <span>Download detailed reports</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-emerald-300 flex-shrink-0" />
                    <span>AI-powered fix recommendations</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-emerald-300 flex-shrink-0" />
                    <span>Track unlimited products</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-emerald-300 flex-shrink-0" />
                    <span>Priority support</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-emerald-300 flex-shrink-0" />
                    <span>Advanced analytics</span>
                  </li>
                </ul>
                
                <button
                  onClick={() => handleSubscribe('PRO')}
                  disabled={isButtonDisabled('PRO')}
                  className={`w-full py-4 px-6 rounded-lg font-bold transition-all duration-300 text-lg ${
                    isButtonDisabled('PRO')
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      : 'bg-white text-[#3B4A6B] hover:bg-gray-100 shadow-lg hover:shadow-xl'
                  }`}
                >
                  {getButtonText('PRO')}
                </button>
                
                {/* Free Trial Button - Only for PRO plan */}
                <div className="mt-4 text-center">
                  <p className="text-white/80 text-sm mb-3">or</p>
                  <button
                    onClick={handleFreeTrial}
                    disabled={loading.freeTrial}
                    className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 border-2 ${
                      loading.freeTrial
                        ? 'bg-gray-400 text-gray-200 cursor-not-allowed border-gray-400'
                        : 'bg-transparent border-white text-white hover:bg-white hover:text-[#3B4A6B]'
                    }`}
                  >
                    {loading.freeTrial ? (
                      <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                    ) : (
                      'Start 7-Day Free Trial'
                    )}
                  </button>
                  <p className="text-white/60 text-xs mt-2">No credit card required</p>
                </div>
              </motion.div>

              {/* Agency Plan */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.3 }}
                className="bg-white rounded-2xl border-2 border-gray-200 p-8 shadow-lg hover:shadow-xl transition-all duration-300"
              >
                <div className="text-center mb-8">
                  <div className="w-16 h-16 bg-purple-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Users className="w-8 h-8 text-purple-600" />
                  </div>
                  <h3 className="text-2xl font-bold text-gray-900 mb-2">Agency Plan</h3>
                  <div className="mb-2">
                    <div className="text-4xl font-bold text-gray-900">$49<span className="text-lg text-gray-500 font-normal">/month</span></div>
                    <div className="text-sm font-normal text-gray-600">(Minimum 5 Accounts)</div>
                  </div>
                  <p className="text-gray-600">For agencies & consultants</p>
                </div>
                
                <ul className="space-y-4 mb-8">
                  <li className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                    <span className="text-gray-700">Everything in Pro</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                    <span className="text-gray-700">Client management</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                    <span className="text-gray-700">White-label reports</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                    <span className="text-gray-700">Bulk operations</span>
                  </li>
                  <li className="flex items-center gap-3">
                    <Check className="w-5 h-5 text-emerald-500 flex-shrink-0" />
                    <span className="text-gray-700">Dedicated support</span>
                  </li>
                </ul>
                
                <button 
                  onClick={() => handleSubscribe('AGENCY')}
                  disabled={isButtonDisabled('AGENCY')}
                  className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 ${
                    isButtonDisabled('AGENCY')
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      : 'bg-[#3B4A6B] text-white hover:bg-[#2d3a52] shadow-lg hover:shadow-xl'
                  }`}
                >
                  {getButtonText('AGENCY')}
                </button>
              </motion.div>
            </div>
          </div>
        </section>

        {/* Features Comparison */}
        <section className="py-24 px-4 lg:px-6 bg-gray-50">
          <div className="container mx-auto max-w-6xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
                Why Choose SellerQI?
              </h2>
              <p className="text-xl text-gray-600 max-w-3xl mx-auto">
                Join thousands of successful Amazon sellers who've transformed their business with our comprehensive platform.
              </p>
            </motion.div>

            <div className="grid md:grid-cols-3 gap-8">
              {[
                {
                  icon: Zap,
                  title: "Lightning Fast Analysis",
                  description: "Get comprehensive product insights with our AI-powered analysis engine.",
                  color: "yellow"
                },
                {
                  icon: BarChart3,
                  title: "Actionable Insights",
                  description: "Don't just see data - get specific recommendations on what to fix and how to fix it.",
                  color: "blue"
                },
                {
                  icon: Shield,
                  title: "Enterprise Security",
                  description: "Bank-level encryption and SOC 2 compliance ensure your data is always protected.",
                  color: "green"
                }
              ].map((feature, index) => {
                const Icon = feature.icon;
                const colorClasses = {
                  yellow: "bg-yellow-100 text-yellow-600 border-yellow-200",
                  blue: "bg-blue-50 text-[#3B4A6B] border-blue-200",
                  green: "bg-emerald-50 text-emerald-600 border-emerald-200"
                };
                return (
                  <motion.div
                    key={feature.title}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.6, delay: 0.1 * index }}
                    className="bg-white rounded-2xl p-8 shadow-lg hover:shadow-xl transition-all duration-300"
                  >
                    <div className={`w-16 h-16 rounded-2xl flex items-center justify-center mb-6 ${colorClasses[feature.color]}`}>
                      <Icon className="w-8 h-8" />
                    </div>
                    <h3 className="text-xl font-bold text-gray-900 mb-4">{feature.title}</h3>
                    <p className="text-gray-600 leading-relaxed">{feature.description}</p>
                  </motion.div>
                );
              })}
            </div>
          </div>
        </section>

        {/* Social Proof */}
        <section className="py-24 px-4 lg:px-6 bg-white">
          <div className="container mx-auto max-w-6xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h2 className="text-4xl font-bold text-gray-900 mb-12">
                Trusted by 10,000+ Amazon Sellers
              </h2>
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-8 mb-16">
                <div className="text-center">
                  <div className="text-4xl font-bold text-[#3B4A6B] mb-2">10K+</div>
                  <div className="text-gray-600">Active Users</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-[#3B4A6B] mb-2">$50M+</div>
                  <div className="text-gray-600">Sales Optimized</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-[#3B4A6B] mb-2">2.5M+</div>
                  <div className="text-gray-600">Products Analyzed</div>
                </div>
                <div className="text-center">
                  <div className="text-4xl font-bold text-[#3B4A6B] mb-2">32%</div>
                  <div className="text-gray-600">Avg Revenue Increase</div>
                </div>
              </div>

              {/* Testimonial */}
              <div className="bg-gray-50 rounded-2xl p-8 max-w-4xl mx-auto">
                <div className="flex items-center justify-center mb-4">
                  {[...Array(5)].map((_, i) => (
                    <Star key={i} className="w-5 h-5 text-yellow-400 fill-current" />
                  ))}
                </div>
                <blockquote className="text-xl text-gray-700 mb-6 italic">
                  "SellerQI helped us identify issues we never knew existed. Our main product went from page 3 to #1 in just 6 weeks. Sales increased 127%!"
                </blockquote>
                <div className="flex items-center justify-center gap-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-[#3B4A6B] to-[#333651] rounded-full flex items-center justify-center text-white font-bold">
                    SC
                  </div>
                  <div className="text-left">
                    <div className="font-semibold text-gray-900">Sarah Chen</div>
                    <div className="text-gray-600">TechGadgets Pro • $2.3M ARR</div>
                  </div>
                </div>
              </div>
            </motion.div>
          </div>
        </section>
        
        {/* FAQ Section */}
        <section className="py-24 px-4 lg:px-6 bg-gray-50">
          <div className="container mx-auto max-w-4xl">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="text-center mb-16"
            >
              <h2 className="text-4xl lg:text-5xl font-bold text-gray-900 mb-6">
                Frequently Asked Questions
              </h2>
              <p className="text-xl text-gray-600">
                Everything you need to know about SellerQI pricing and features.
              </p>
            </motion.div>

            <div className="space-y-4">
              {faqs.map((faq, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: 0.1 * index }}
                  className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
                >
                  <button
                    className="w-full p-6 text-left flex items-center justify-between hover:bg-gray-50 transition-colors duration-200"
                    onClick={() => setOpenFaq(openFaq === index ? null : index)}
                  >
                    <h3 className="text-lg font-semibold text-gray-900 pr-4">{faq.q}</h3>
                    <div className="flex-shrink-0">
                      {openFaq === index ? (
                        <Minus className="w-5 h-5 text-[#3B4A6B]" />
                      ) : (
                        <Plus className="w-5 h-5 text-[#3B4A6B]" />
                      )}
                    </div>
                  </button>
                  <AnimatePresence>
                    {openFaq === index && (
                      <motion.div
                        initial={{ opacity: 0, height: 0 }}
                        animate={{ opacity: 1, height: "auto" }}
                        exit={{ opacity: 0, height: 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="overflow-hidden"
                      >
                        <div className="px-6 pb-6 pt-0">
                          <div className="h-px bg-gray-200 mb-4"></div>
                          <p className="text-gray-600 leading-relaxed">{faq.a}</p>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* Final CTA */}
        <section className="py-24 px-4 lg:px-6 bg-gradient-to-r from-[#3B4A6B] via-[#333651] to-[#3B4A6B] text-white relative overflow-hidden">
          <div className="absolute inset-0 bg-black opacity-10"></div>
          <div className="relative container mx-auto max-w-4xl text-center">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
            >
              <h2 className="text-4xl lg:text-5xl font-bold mb-6">
                Ready to Transform Your Amazon Business?
              </h2>
              <p className="text-xl mb-12 opacity-90">
                Join thousands of successful sellers who've chosen SellerQI to scale their business.
              </p>
              
              <div className="flex flex-col sm:flex-row gap-4 justify-center mb-8">
                <button 
                  onClick={() => handleSubscribe('LITE')}
                  className="bg-white text-[#3B4A6B] px-8 py-4 rounded-lg font-semibold text-lg hover:bg-gray-100 transition-all duration-300 shadow-lg"
                >
                  Start Free Today
                </button>
                <Link 
                  to="/contact-us"
                  className="border-2 border-white text-white px-8 py-4 rounded-lg font-semibold text-lg hover:bg-white hover:text-[#3B4A6B] transition-all duration-300"
                >
                  Contact Sales
                </Link>
              </div>

              <div className="flex justify-center gap-8 text-sm opacity-75">
                <span>✓ Always Free Plan</span>
                <span>✓ No setup fees</span>
                <span>✓ Full feature access</span>
              </div>
            </motion.div>
          </div>
        </section>
      </main>
      
      {/* Footer */}
      <Footer />
    </div>
  );
}