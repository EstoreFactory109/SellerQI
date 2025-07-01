import React, { useState, useEffect } from 'react';
import { Check, X, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import Navbar from '../Components/Navigation/Navbar';
import Footer from '../Components/Navigation/Footer';
import stripeService from '../services/stripeService';
import { useSelector } from 'react-redux';

export default function PricingPage() {
  const navigate = useNavigate();
  const [openFaq, setOpenFaq] = useState(null);
  const [loading, setLoading] = useState({
    LITE: false,
    PRO: false,
    AGENCY: false
  });
  const [currentPlan, setCurrentPlan] = useState(null);
  const [subscriptionStatus, setSubscriptionStatus] = useState(null);
  
  // Get user auth status from Redux and localStorage fallback
  const isAuthenticatedRedux = useSelector(state => state.auth?.isAuthenticated || false);
  const isAuthenticatedLocal = localStorage.getItem('isAuth') === 'true';
  const isAuthenticated = isAuthenticatedRedux || isAuthenticatedLocal;
  
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // Fetch current subscription status if authenticated
    if (isAuthenticated) {
      fetchSubscriptionStatus();
    }
    
  }, [isAuthenticated, isAuthenticatedRedux, isAuthenticatedLocal]);

  // Separate useEffect to handle intended plan after authentication is confirmed
  useEffect(() => {
    if (isAuthenticated && subscriptionStatus !== null) {
      // Check if user came here for a specific subscription plan
      const intendedPlan = localStorage.getItem('intendedPlan');
      if (intendedPlan && ['PRO', 'AGENCY', 'LITE'].includes(intendedPlan)) {
        // Auto-trigger subscription for the intended plan
        setTimeout(() => {
          handleSubscribe(intendedPlan);
        }, 500); // Small delay to ensure page is loaded
      }
    }
  }, [isAuthenticated, subscriptionStatus]);

  const fetchSubscriptionStatus = async () => {
    try {
      const status = await stripeService.getSubscriptionStatus();
      setSubscriptionStatus(status);
      setCurrentPlan(status.plan);
    } catch (error) {
      console.error('Error fetching subscription status:', error);
    }
  };

  const handleSubscribe = async (planType) => {
    // Check if user is authenticated
    if (!isAuthenticated) {
      // Store the intended plan in localStorage
      localStorage.setItem('intendedPlan', planType);
      // Redirect to signup page for subscription purchases
      navigate('/sign-up');
      return;
    }

    // Set loading state
    setLoading(prev => ({ ...prev, [planType]: true }));

        try {
      // Create checkout session for all plans (AGENCY will be handled without Stripe redirect)
      const session = await stripeService.createCheckoutSession(planType);
      
      if (session && session.url) {
        if (planType === 'LITE' || planType === 'AGENCY') {
          // For LITE and AGENCY plans, redirect to success page
          navigate('/subscription-success');
        } else {
          // For PRO plan, redirect to Stripe Checkout
          window.location.href = session.url;
        }
      } else {
        alert('Failed to get checkout URL. Please try again.');
      }
        } catch (error) {
      console.error('Error creating checkout session:', error);
      
      // Handle specific error cases
      if (error.response) {
        if (error.response.status === 401) {
          alert('Session expired. Please log in again.');
          localStorage.removeItem('isAuth');
          navigate('/log-in');
          return;
        } else if (error.response.status === 403) {
          alert('Permission denied. Please check your account status.');
          return;
        }
      } else if (error.request) {
        alert('Network error. Please check your connection and try again.');
        return;
      }
      
      alert(`Failed to start subscription process: ${error.response?.data?.message || error.message}`);
    } finally {
      setLoading(prev => ({ ...prev, [planType]: false }));
    }
  };

  const handleManageSubscription = async () => {
    if (!isAuthenticated) {
      navigate('/log-in');
      return;
    }

    try {
      const session = await stripeService.createPortalSession();
      if (session.url) {
        window.location.href = session.url;
      }
    } catch (error) {
      console.error('Error creating portal session:', error);
      alert('Failed to open subscription management. Please try again.');
    }
  };

  const getButtonText = (planType) => {
    if (loading[planType]) {
      return <Loader2 className="w-5 h-5 animate-spin mx-auto" />;
    }
    
    if (currentPlan === planType && subscriptionStatus?.hasSubscription) {
      return 'Current Plan';
    }
    
    if (currentPlan && currentPlan !== planType && subscriptionStatus?.hasSubscription) {
      const currentPlanPrices = { LITE: 0, AGENCY: 49, PRO: 99 };
      const targetPlanPrices = { LITE: 0, AGENCY: 49, PRO: 99 };
      
      if (targetPlanPrices[planType] > currentPlanPrices[currentPlan]) {
        return 'Upgrade';
      } else if (targetPlanPrices[planType] < currentPlanPrices[currentPlan]) {
        return 'Downgrade';
      }
    }
    
    return 'Subscribe';
  };

  const isButtonDisabled = (planType) => {
    return (currentPlan === planType && subscriptionStatus?.hasSubscription) || loading[planType];
  };
  
  const faqs = [
    {
      q: "What's the difference between Lite and Pro?",
      a: 'Lite gives you basic product audit summary for free. Pro includes everything - detailed reports, fix recommendations, expert consultation, and tracking for multiple products.',
    },
    {
      q: 'Will I lose data if I downgrade?',
      a: 'No, your historical data will be preserved. However, you will lose access to premium features like downloading reports and expert consultation.',
    },
    {
      q: 'Can I cancel anytime?',
      a: 'Yes, you can cancel the subscription anytime you want. You will continue to have access until the end of your billing period.',
    },
    {
      q: 'How often is my product data updated?',
      a: 'Product data is updated daily for Pro and Agency plans. Lite plan users can refresh their data once per week.',
    },
    {
      q: 'Do you offer refunds?',
      a: 'Yes, we offer a 7-day money-back guarantee. If you\'re not satisfied, contact our support team for a full refund.',
    },
  ];

  return (
    <div className="min-h-screen bg-white flex flex-col">
      {/* Header */}
      <Navbar />
      <main className="flex-1 w-full">
        <section className="py-20 px-4">
          <div className="container mx-auto max-w-3xl text-center mb-16">
            <h1 className="text-5xl font-extrabold mb-6 leading-tight">
              Choose the <span className="text-red-500">Plan</span> That Grows<br />With You
            </h1>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">
              Start with a free audit. Upgrade when you're ready for full insights, reports & expert-backed solutions.
            </p>
            
            {/* Show manage subscription button if user has active subscription */}
            {subscriptionStatus?.hasSubscription && (
              <button
                onClick={handleManageSubscription}
                className="mt-6 text-blue-600 hover:text-blue-700 underline font-medium"
              >
                Manage Your Subscription
              </button>
            )}
          </div>
          
          <div className="container mx-auto flex flex-col md:flex-row gap-8 justify-center items-end mb-24">
            {/* LITE */}
            <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-[0_2px_16px_0_rgba(0,0,0,0.06)] p-8 flex flex-col items-center max-w-xs mx-auto min-h-[520px] relative z-0">
              <div className="text-lg font-bold mb-2">LITE</div>
              <div className="text-3xl font-extrabold mb-2">$0<span className="text-base font-normal">/mo</span></div>
              <div className="text-gray-500 mb-6 text-center">Perfect for new Amazon sellers who want a quick health check.</div>
              <ul className="mb-8 space-y-3 text-left w-full">
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Product Audit Summary</li>
                <li className="flex items-center gap-2 text-red-500"><X className="w-5 h-5" />Download Reports</li>
                <li className="flex items-center gap-2 text-red-500"><X className="w-5 h-5" />Fix Recommendations</li>
                <li className="flex items-center gap-2 text-red-500"><X className="w-5 h-5" />Expert Consultation</li>
                <li className="flex items-center gap-2 text-red-500"><X className="w-5 h-5" />Track Multiple Products</li>
                <li className="flex items-center gap-2 text-red-500"><X className="w-5 h-5" />Issue Breakdown</li>
              </ul>
              <button 
                onClick={() => handleSubscribe('LITE')}
                disabled={isButtonDisabled('LITE')}
                className={`px-6 py-2 rounded w-full font-semibold shadow-md transition-all ${
                  isButtonDisabled('LITE')
                    ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                    : 'bg-[#23253A] text-white hover:bg-gray-800'
                }`}
              >
                {getButtonText('LITE')}
              </button>
            </div>
            
            {/* PRO */}
            <div className="flex-1 bg-[#23253A] rounded-2xl border-4 border-yellow-400 shadow-[0_8px_32px_0_rgba(0,0,0,0.18)] p-10 flex flex-col items-center max-w-xs mx-auto min-h-[560px] scale-105 relative z-10">
              <div className="absolute -top-7 left-1/2 -translate-x-1/2 bg-green-500 text-white text-xs font-bold px-6 py-2 rounded-full shadow-lg z-20">RECOMMENDED</div>
              <div className="text-lg font-bold mb-2 text-white">PRO</div>
              <div className="text-4xl font-extrabold mb-2 text-white">$99<span className="text-base font-normal text-gray-300">/mo</span></div>
              <div className="text-white mb-6 text-center font-medium">Recommended for serious sellers who want full visibility, fixes, and growth.</div>
              <ul className="mb-8 space-y-3 text-left w-full">
                <li className="flex items-center gap-2 text-green-400 font-semibold"><Check className="w-5 h-5" />Product Audit Summary</li>
                <li className="flex items-center gap-2 text-green-400 font-semibold"><Check className="w-5 h-5" />Download Reports</li>
                <li className="flex items-center gap-2 text-green-400 font-semibold"><Check className="w-5 h-5" />Fix Recommendations</li>
                <li className="flex items-center gap-2 text-green-400 font-semibold"><Check className="w-5 h-5" />Expert Consultation</li>
                <li className="flex items-center gap-2 text-green-400 font-semibold"><Check className="w-5 h-5" />Track Multiple Products</li>
                <li className="flex items-center gap-2 text-green-400 font-semibold"><Check className="w-5 h-5" />Issue Breakdown</li>
              </ul>
              <button 
                onClick={() => handleSubscribe('PRO')}
                disabled={isButtonDisabled('PRO')}
                className={`px-6 py-3 rounded w-full font-extrabold shadow-lg text-lg tracking-wide transition-all ${
                  isButtonDisabled('PRO')
                    ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                    : 'bg-yellow-400 text-black hover:bg-yellow-500'
                }`}
              >
                {getButtonText('PRO')}
              </button>
            </div>
            
            {/* AGENCY */}
            <div className="flex-1 bg-white rounded-2xl border border-gray-200 shadow-[0_2px_16px_0_rgba(0,0,0,0.06)] p-8 flex flex-col items-center max-w-xs mx-auto min-h-[520px] relative z-0">
              <div className="text-lg font-bold mb-2">AGENCY</div>
              <div className="text-3xl font-extrabold mb-2">$49<span className="text-base font-normal">/mo</span></div>
              <div className="text-gray-500 mb-6 text-center">Great for first time audits or early stage sellers.</div>
              <ul className="mb-8 space-y-3 text-left w-full">
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Product Audit Summary</li>
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Download Reports</li>
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Fix Recommendations</li>
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Expert Consultation</li>
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Track Multiple Products</li>
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Issue Breakdown</li>
                <li className="flex items-center gap-2 text-green-600"><Check className="w-5 h-5" />Minimum 5 Accounts</li>
              </ul>
              <button 
                onClick={() => handleSubscribe('AGENCY')}
                disabled={isButtonDisabled('AGENCY')}
                className={`px-6 py-2 rounded w-full font-semibold shadow-md transition-all ${
                  isButtonDisabled('AGENCY')
                    ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                    : 'bg-[#23253A] text-white hover:bg-gray-800'
                }`}
              >
                {getButtonText('AGENCY')}
              </button>
            </div>
          </div>
        </section>
        
        {/* FAQ Section */}
        <section className="bg-gray-100 py-20 px-4">
          <div className="container mx-auto max-w-3xl">
            <div className="text-center mb-12">
              <div className="text-xs font-bold text-red-400 mb-2 tracking-widest">FAQS</div>
              <h2 className="text-3xl font-extrabold mb-2">Frequently Asked Questions</h2>
            </div>
            <div className="space-y-4">
              {faqs.map((faq, i) => (
                <div 
                  key={i} 
                  className={`bg-white rounded-lg overflow-hidden transition-all duration-300 border ${
                    openFaq === i ? 'border-blue-200 shadow-md' : 'border-transparent'
                  }`}
                >
                  <button
                    className="w-full text-left px-6 py-4 font-semibold flex justify-between items-center focus:outline-none text-lg"
                    onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  >
                    <span>{faq.q}</span>
                    <motion.span 
                      className={`ml-4 text-2xl font-bold`}
                      animate={{ 
                        rotate: openFaq === i ? 45 : 0,
                        color: openFaq === i ? '#3b82f6' : '#9ca3af'
                      }}
                      transition={{ duration: 0.2, ease: "easeOut" }}
                    >
                      +
                    </motion.span>
                  </button>
                  <motion.div
                    initial={false}
                    animate={{
                      height: openFaq === i ? 'auto' : 0,
                      opacity: openFaq === i ? 1 : 0
                    }}
                    transition={{ 
                      duration: 0.25, 
                      ease: "easeOut",
                      opacity: { duration: 0.2 }
                    }}
                    className="overflow-hidden"
                  >
                    <div className="px-6 pb-4 text-gray-600 text-base bg-blue-50">
                      {faq.a}
                    </div>
                  </motion.div>
                </div>
              ))}
            </div>
          </div>
        </section>
        
        {/* Contact CTA */}
        <section className="py-20 bg-white text-center">
          <div className="mb-8">
            <div className="w-24 h-24 mx-auto bg-black rounded-full flex items-center justify-center mb-5">
              <img src="https://res.cloudinary.com/ddoa960le/image/upload/q_auto:good,f_auto,w_1200/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png" alt="Seller QI Logo" loading="eager" />
            </div>
            <h2 className="text-2xl font-bold mb-2">Still have questions? We're here for you!</h2>
            <Link to="/contact-us" className="inline-block mt-4 bg-[#23253A] text-white px-6 py-2 rounded font-semibold shadow hover:bg-gray-800 transition-colors">
              Contact Us <span className="ml-2">&gt;</span>
            </Link>
          </div>
        </section>
      </main>
      {/* Footer */}
      <Footer />
    </div>
  );
}