import React from 'react';
import { Check, Loader2, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

export default function IndiaPricing({ loading, handleFreeTrial, handleSubscribe, handleContactUs }) {
  return (
    <div className="w-full">
      {/* Hero Section */}
      <section className="bg-gradient-to-br from-indigo-600 via-purple-600 to-purple-700 text-white py-20 px-4">
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
              className="mb-8"
            >
              <div className="bg-white/10 backdrop-blur-sm rounded-xl px-6 py-3 inline-block">
                <img 
                  src="https://res.cloudinary.com/ddoa960le/image/upload/v1752478546/Seller_QI_Logo___V1_1_t9s3kh.png" 
                  alt="SellerQI Logo" 
                  className="h-10 w-auto mx-auto"
                />
              </div>
            </motion.div>
            
            <div className="inline-block bg-white/20 backdrop-blur-sm px-5 py-2 rounded-full text-sm font-semibold mb-5">
              🇮🇳 Special Pricing for Indian Sellers
            </div>
            <h1 className="text-4xl md:text-5xl font-bold mb-5">
              Built for India,<br />Priced for Indian Sellers
            </h1>
            <p className="text-xl mb-10 opacity-90 max-w-2xl mx-auto">
              World-class Amazon selling tools at prices that work for Indian entrepreneurs
            </p>
            
            {/* Pricing Box */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="bg-white text-gray-900 p-10 rounded-xl max-w-md mx-auto shadow-2xl"
            >
              <div className="mb-6">
                <div className="text-2xl line-through text-gray-400 mb-3">₹8,999/month</div>
                <div className="text-5xl md:text-6xl font-bold text-indigo-600 mb-2">
                  ₹1,999<span className="text-2xl font-normal">/month</span>
                </div>
                <div className="text-base text-gray-600 mb-3">For Indian registered sellers</div>
                <div className="flex items-center justify-center gap-3 mb-3">
                <span className="inline-block bg-emerald-500 text-white px-4 py-2 rounded-md font-semibold text-sm">
                  Save 78%
                </span>
                  <span className="inline-block bg-indigo-100 text-indigo-700 px-4 py-2 rounded-md font-semibold text-sm">
                    7-Day Free Trial
                  </span>
                </div>
              </div>
              <button
                onClick={handleFreeTrial}
                disabled={loading.freeTrial}
                className={`w-full py-4 px-8 rounded-lg text-lg font-semibold transition-all duration-300 ${
                  loading.freeTrial
                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                    : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg'
                }`}
              >
                {loading.freeTrial ? (
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                ) : (
                  'Start Your 7-Day Free Trial'
                )}
              </button>
              <p className="text-sm text-gray-500 mt-3">No credit card required • Cancel anytime</p>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Mission Section */}
      <section className="bg-white py-20 px-4">
        <div className="max-w-4xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-4xl font-bold text-center mb-10"
          >
            Why We're Doing This
          </motion.h2>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="text-lg leading-relaxed text-gray-600 space-y-5"
          >
            <p>
              SellerQI is built in India, by Indians who understand the challenges of selling on Amazon.
              We've been there - dealing with inventory headaches, PPC budgets that disappear, and reimbursements that take forever.
            </p>
            <p>
              We're committed to <strong className="text-gray-900">Atmanirbhar Bharat</strong> by making world-class tools accessible to Indian sellers at Indian prices.
              When local sellers succeed with better tools and insights, India's e-commerce ecosystem succeeds.
            </p>
            <p>
              This isn't a trial or temporary discount. This is permanent pricing for Indian businesses, because we believe
              Indian sellers deserve the same tools that international brands use, without paying international prices.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-gray-50 py-20 px-4">
        <div className="max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-4xl font-bold text-center mb-5"
          >
            Everything You Need, Nothing Held Back
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-center text-lg text-emerald-600 font-semibold mb-12"
          >
            Full feature access at Indian pricing - no tier games
          </motion.p>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                title: 'Root Cause Analysis',
                description: 'AI-powered insights that tell you exactly why your sales dropped or listings got suppressed'
              },
              {
                title: 'Listing Optimization',
                description: 'Per-ASIN keyword suggestions and content optimization based on real data'
              },
              {
                title: 'PPC Management',
                description: 'Smart bid adjustments and campaign recommendations that actually save money'
              },
              {
                title: 'Reimbursement Detection',
                description: 'Automatically find lost inventory, damaged units, and overcharged fees'
              },
              {
                title: 'Account Health',
                description: 'Real-time monitoring with alerts before issues become account risks'
              },
              {
                title: 'Instant Alerts',
                description: 'Email & WhatsApp notifications for suppressions, Buy Box loss, inventory issues'
              }
            ].map((feature, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="bg-white p-6 rounded-lg border-l-4 border-indigo-600"
              >
                <h3 className="text-xl font-bold mb-3">{feature.title}</h3>
                <p className="text-gray-600">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Initiatives Section */}
      <section className="bg-white py-16 px-4 border-t border-gray-200">
        <div className="max-w-6xl mx-auto">
          <motion.h3
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center text-xl text-gray-600 mb-10"
          >
            Proudly Supporting Indian Initiatives
          </motion.h3>
          <div className="flex justify-center items-center gap-12 flex-wrap">
            {[
              { label: 'Atmanirbhar Bharat', icon: '🇮🇳' },
              { label: 'Make in India', icon: '🏭' },
              { label: 'Vocal for Local', icon: '🗣️' }
            ].map((initiative, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.8 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                className="flex flex-col items-center gap-4"
              >
                <div className="w-20 h-20 bg-gray-100 border-2 border-dashed border-indigo-600 rounded-full flex items-center justify-center text-2xl">
                  {initiative.icon}
                </div>
                <div className="text-sm font-semibold text-gray-900">{initiative.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Eligibility Section */}
      <section className="bg-yellow-50 py-16 px-4">
        <div className="max-w-3xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-3xl font-bold text-center mb-10"
          >
            Who Gets This Pricing?
          </motion.h2>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="bg-white p-10 rounded-lg"
          >
            <ul className="space-y-4">
              {[
                'Your business is registered in India',
                'You have a valid GST registration number',
                'Payment via Indian bank account, UPI, or Indian credit/debit card',
                'Selling on Amazon.in or managing Indian inventory on global Amazon stores'
              ].map((item, i) => (
                <li key={i} className="flex items-start gap-3 text-base py-3 border-b border-gray-200 last:border-0">
                  <Check className="w-6 h-6 text-emerald-500 flex-shrink-0 mt-0.5" />
                  <span>{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="bg-indigo-600 text-white py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-4xl font-bold mb-5"
          >
            Ready to Scale Smarter?
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-lg mb-8 opacity-90"
          >
            Join Indian sellers who are already using SellerQI to grow their Amazon business
          </motion.p>
          <motion.button
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.2 }}
            onClick={handleFreeTrial}
            disabled={loading.freeTrial}
            className={`max-w-md mx-auto w-full py-4 px-8 rounded-lg text-lg font-semibold transition-all duration-300 ${
              loading.freeTrial
                ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                : 'bg-white text-indigo-600 hover:bg-gray-100 shadow-lg'
            }`}
          >
            {loading.freeTrial ? (
              <Loader2 className="w-5 h-5 animate-spin mx-auto" />
            ) : (
              'Start 7-Day Free Trial - ₹1,999/month after'
            )}
          </motion.button>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-sm mt-4 opacity-80"
          >
            No credit card required • Full access for 7 days • Cancel anytime
          </motion.p>
        </div>
      </section>
    </div>
  );
}
