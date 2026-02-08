import React from 'react';
import { Check, Loader2, Sparkles, Target, FileText, TrendingUp, Package, Shield, Bell, Zap } from 'lucide-react';
import { motion } from 'framer-motion';
import sellerQILogo from '../../assets/Logo/sellerQILogo.png';

const featureIcons = [Target, FileText, TrendingUp, Package, Shield, Bell];

export default function IndiaPricing({ loading, handleFreeTrial, handleSubscribe, handleContactUs }) {
  return (
    <div className="w-full bg-[#0d1117]">
      {/* Hero Section - gradient and glow */}
      <section className="relative overflow-hidden border-b border-[#30363d] text-gray-100 py-24 px-4">
        {/* Background gradient orbs */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[400px] bg-blue-500/10 rounded-full blur-3xl" />
          <div className="absolute bottom-0 right-0 w-[500px] h-[300px] bg-emerald-500/5 rounded-full blur-3xl" />
          <div className="absolute bottom-0 left-0 w-[400px] h-[250px] bg-blue-600/5 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-6xl mx-auto text-center">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
          >
            {/* SellerQI Logo */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="mb-8"
            >
              <div className="inline-block rounded-2xl px-8 py-4 bg-gradient-to-br from-[#161b22] to-[#21262d] border border-[#30363d] shadow-xl">
                <img src={sellerQILogo} alt="SellerQI Logo" className="h-11 w-auto" />
              </div>
            </motion.div>
            
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.4, delay: 0.15 }}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-blue-600/30 to-blue-500/20 border border-blue-500/50 px-5 py-2.5 rounded-full text-sm font-semibold mb-6 text-blue-200 shadow-lg shadow-blue-500/10"
            >
              <span className="text-lg">🇮🇳</span>
              <span>Special Pricing for Indian Sellers</span>
              <Sparkles className="w-4 h-4 text-amber-400" />
            </motion.div>
            <h1 className="text-4xl md:text-6xl font-extrabold mb-4 text-white tracking-tight">
              Built for India,<br />
              <span className="bg-gradient-to-r from-blue-400 to-emerald-400 bg-clip-text text-transparent">Priced for Indian Sellers</span>
            </h1>
            <p className="text-xl md:text-2xl text-gray-400 max-w-2xl mx-auto mb-12 leading-relaxed">
              World-class Amazon selling tools at prices that work for Indian entrepreneurs
            </p>
            
            {/* Pricing Card - highlighted */}
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="relative max-w-md mx-auto"
            >
              <div className="absolute -inset-[1px] bg-gradient-to-r from-blue-500/50 via-emerald-500/30 to-blue-500/50 rounded-2xl blur-sm opacity-80" />
              <div className="relative bg-gradient-to-br from-[#161b22] to-[#21262d] border border-[#30363d] text-gray-100 p-10 rounded-2xl shadow-2xl">
                <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                  <span className="inline-flex items-center gap-1.5 bg-amber-500 text-gray-900 px-4 py-1.5 rounded-full text-xs font-bold shadow-lg">
                    <Zap className="w-3.5 h-3.5" />
                    Most Popular
                  </span>
                </div>
                <div className="mb-6 pt-2">
                  <div className="text-2xl line-through text-gray-500 mb-2">₹8,999/month</div>
                  <div className="flex items-baseline justify-center gap-1 flex-wrap">
                    <span className="text-5xl md:text-6xl font-extrabold bg-gradient-to-r from-blue-400 to-blue-300 bg-clip-text text-transparent">₹1,999</span>
                    <span className="text-xl text-gray-400">/month</span>
                  </div>
                  <div className="text-sm text-gray-400 mt-2">For Indian registered sellers</div>
                  <div className="flex items-center justify-center gap-3 mt-4 flex-wrap">
                    <span className="inline-flex items-center gap-1.5 bg-emerald-500/20 text-emerald-400 border border-emerald-500/50 px-4 py-2 rounded-xl font-bold text-sm">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                      Save 78%
                    </span>
                    <span className="inline-flex items-center gap-1.5 bg-blue-600/25 text-blue-300 border border-blue-500/50 px-4 py-2 rounded-xl font-semibold text-sm">
                      <Sparkles className="w-4 h-4" />
                      7-Day Free Trial
                    </span>
                  </div>
                </div>
                <button
                  onClick={handleFreeTrial}
                  disabled={loading.freeTrial}
                  className={`w-full py-4 px-8 rounded-xl text-lg font-bold transition-all duration-300 flex items-center justify-center gap-2 ${
                    loading.freeTrial
                      ? 'bg-[#21262d] text-gray-500 cursor-not-allowed border border-[#30363d]'
                      : 'bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-600 shadow-lg shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-0.5'
                  }`}
                >
                  {loading.freeTrial ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      <Sparkles className="w-5 h-5" />
                      Start Your 7-Day Free Trial
                    </>
                  )}
                </button>
                <p className="text-xs text-gray-500 mt-3 text-center">Payment method required • Charged after trial ends</p>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* Mission Section */}
      <section className="relative bg-[#161b22] py-24 px-4 border-t border-[#30363d]">
        <div className="max-w-4xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-4xl md:text-5xl font-bold text-center mb-4 text-white"
          >
            Why We're Doing This
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center text-blue-400 font-semibold mb-12 text-lg"
          >
            Our mission is to empower Indian sellers
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="space-y-6 text-lg leading-relaxed text-gray-300"
          >
            <p className="bg-[#21262d]/50 border-l-4 border-blue-500 pl-6 py-4 rounded-r-xl">
              SellerQI is built in India, by Indians who understand the challenges of selling on Amazon.
              We've been there — dealing with inventory headaches, PPC budgets that disappear, and reimbursements that take forever.
            </p>
            <p>
              We're committed to <strong className="text-white">Atmanirbhar Bharat</strong> by making world-class tools accessible to Indian sellers at Indian prices.
              When local sellers succeed with better tools and insights, India's e-commerce ecosystem succeeds.
            </p>
            <p className="bg-[#21262d]/50 border-l-4 border-emerald-500/70 pl-6 py-4 rounded-r-xl">
              This isn't a trial or temporary discount. This is <strong className="text-gray-100">permanent pricing</strong> for Indian businesses — because we believe
              Indian sellers deserve the same tools that international brands use, without paying international prices.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Features Section */}
      <section className="bg-[#0d1117] py-24 px-4 border-t border-[#30363d]">
        <div className="max-w-6xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-4xl md:text-5xl font-bold text-center mb-3 text-white"
          >
            Everything You Need, Nothing Held Back
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-center text-lg text-emerald-400 font-semibold mb-14"
          >
            Full feature access at Indian pricing — no tier games
          </motion.p>
          
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              { title: 'Root Cause Analysis', description: 'AI-powered insights that tell you exactly why your sales dropped or listings got suppressed' },
              { title: 'Listing Optimization', description: 'Per-ASIN keyword suggestions and content optimization based on real data' },
              { title: 'PPC Management', description: 'Smart bid adjustments and campaign recommendations that actually save money' },
              { title: 'Reimbursement Detection', description: 'Automatically find lost inventory, damaged units, and overcharged fees' },
              { title: 'Account Health', description: 'Real-time monitoring with alerts before issues become account risks' },
              { title: 'Instant Alerts', description: 'Email & WhatsApp notifications for suppressions, Buy Box loss, inventory issues' }
            ].map((feature, i) => {
              const Icon = featureIcons[i];
              return (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 20 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: i * 0.08 }}
                  whileHover={{ y: -4 }}
                  className="group bg-gradient-to-br from-[#161b22] to-[#21262d] border border-[#30363d] p-6 rounded-2xl border-l-4 border-l-blue-500 hover:border-l-blue-400 hover:shadow-xl hover:shadow-blue-500/10 transition-all duration-300"
                >
                  <div className="w-12 h-12 rounded-xl bg-blue-600/20 border border-blue-500/40 flex items-center justify-center mb-4 group-hover:bg-blue-600/30 transition-colors">
                    <Icon className="w-6 h-6 text-blue-400" />
                  </div>
                  <h3 className="text-xl font-bold mb-2 text-white">{feature.title}</h3>
                  <p className="text-gray-400 text-sm leading-relaxed">{feature.description}</p>
                </motion.div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Initiatives Section */}
      <section className="bg-[#161b22] py-20 px-4 border-t border-[#30363d]">
        <div className="max-w-6xl mx-auto">
          <motion.h3
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-center text-2xl font-bold text-white mb-12"
          >
            Proudly Supporting Indian Initiatives
          </motion.h3>
          <div className="flex justify-center items-center gap-16 flex-wrap">
            {[
              { label: 'Atmanirbhar Bharat', icon: '🇮🇳', color: 'from-amber-500/20 to-orange-500/20 border-amber-500/40' },
              { label: 'Make in India', icon: '🏭', color: 'from-blue-500/20 to-indigo-500/20 border-blue-500/40' },
              { label: 'Vocal for Local', icon: '🗣️', color: 'from-emerald-500/20 to-green-500/20 border-emerald-500/40' }
            ].map((initiative, i) => (
              <motion.div
                key={i}
                initial={{ opacity: 0, scale: 0.85 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: i * 0.1 }}
                whileHover={{ scale: 1.05 }}
                className="flex flex-col items-center gap-5"
              >
                <div className={`w-24 h-24 rounded-2xl bg-gradient-to-br ${initiative.color} border-2 flex items-center justify-center text-4xl shadow-lg`}>
                  {initiative.icon}
                </div>
                <div className="text-base font-bold text-gray-100">{initiative.label}</div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Eligibility Section */}
      <section className="bg-[#0d1117] py-24 px-4 border-t border-[#30363d]">
        <div className="max-w-3xl mx-auto">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-3xl md:text-4xl font-bold text-center mb-4 text-white"
          >
            Who Gets This Pricing?
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            className="text-center text-gray-400 mb-10"
          >
            Simple eligibility for Indian sellers
          </motion.p>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.1 }}
            className="bg-gradient-to-br from-[#161b22] to-[#21262d] border border-[#30363d] p-8 md:p-10 rounded-2xl shadow-xl"
          >
            <ul className="space-y-1">
              {[
                'Your business is registered in India',
                'You have a valid GST registration number',
                'Payment via Indian bank account, UPI, or Indian credit/debit card',
                'Selling on Amazon.in or managing Indian inventory on global Amazon stores'
              ].map((item, i) => (
                <li key={i} className="flex items-center gap-4 py-4 px-4 rounded-xl hover:bg-[#21262d]/80 transition-colors border-b border-[#30363d]/50 last:border-0 text-gray-300">
                  <div className="w-10 h-10 rounded-full bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center flex-shrink-0">
                    <Check className="w-5 h-5 text-emerald-400" />
                  </div>
                  <span className="text-base font-medium">{item}</span>
                </li>
              ))}
            </ul>
          </motion.div>
        </div>
      </section>

      {/* Final CTA Section */}
      <section className="relative bg-gradient-to-b from-[#161b22] to-[#0d1117] border-t border-[#30363d] py-24 px-4 overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-blue-500/10 rounded-full blur-3xl" />
        </div>
        <div className="relative max-w-4xl mx-auto text-center">
          <motion.h2
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5 }}
            className="text-4xl md:text-5xl font-extrabold mb-4 text-white"
          >
            Ready to Scale Smarter?
          </motion.h2>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.1 }}
            className="text-xl text-gray-400 mb-10 max-w-2xl mx-auto"
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
            className={`max-w-md mx-auto w-full py-5 px-8 rounded-xl text-lg font-bold transition-all duration-300 flex items-center justify-center gap-2 ${
              loading.freeTrial
                ? 'bg-[#21262d] text-gray-500 cursor-not-allowed border border-[#30363d]'
                : 'bg-gradient-to-r from-blue-600 to-blue-500 text-white hover:from-blue-500 hover:to-blue-600 shadow-xl shadow-blue-500/25 hover:shadow-blue-500/40 hover:-translate-y-1'
            }`}
          >
            {loading.freeTrial ? (
              <Loader2 className="w-6 h-6 animate-spin" />
            ) : (
              <>
                <Sparkles className="w-5 h-5" />
                Start 7-Day Free Trial — ₹1,999/month after
              </>
            )}
          </motion.button>
          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.5, delay: 0.3 }}
            className="text-sm mt-5 text-gray-500"
          >
            Payment method required • Full access for 7 days • Cancel anytime
          </motion.p>
          <div className="flex flex-wrap justify-center gap-8 mt-10 text-sm text-gray-400">
            <span className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> No setup fees</span>
            <span className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Secure payment</span>
            <span className="flex items-center gap-2"><Check className="w-4 h-4 text-emerald-400" /> Cancel anytime</span>
          </div>
        </div>
      </section>
    </div>
  );
}
