import React from 'react';
import { Check, Loader2, Zap, Users, Crown, Sparkles, Mail } from 'lucide-react';
import { motion } from 'framer-motion';

export default function IndiaPricing({ loading, handleFreeTrial, handleSubscribe, handleContactUs }) {
  return (
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
            <span className="text-3xl font-bold text-gray-900">₹0</span>
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
            <span className="text-3xl font-bold text-white">₹1,999</span>
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
            <span className="text-3xl font-bold text-gray-900">Custom</span>
            <span className="text-gray-500 text-sm ml-1">pricing</span>
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
            onClick={() => handleContactUs('AGENCY')}
            disabled={loading.AGENCY}
            className={`w-full py-3 px-4 rounded-xl font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
              loading.AGENCY
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-gradient-to-r from-purple-500 to-indigo-600 text-white hover:from-purple-600 hover:to-indigo-700 shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30'
            }`}
          >
            {loading.AGENCY ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              <>
                <Mail className="w-5 h-5" />
                Contact Us
              </>
            )}
          </button>
        </motion.div>
      </div>
    </div>
  );
}

