import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Crown, Lock, ArrowRight, Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';

const UpgradeRequiredOverlay = ({ children }) => {
  const navigate = useNavigate();

  const handleUpgrade = () => {
    navigate('/seller-central-checker/settings?tab=plans-billing');
  };

  return (
    <div className="relative w-full h-full min-h-screen">
      {/* Blurred Background Content */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="filter blur-md brightness-75 pointer-events-none select-none">
          {children}
        </div>
      </div>

      {/* Gradient Overlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-gray-900/60 via-blue-900/40 to-purple-900/60 backdrop-blur-sm" />

      {/* Upgrade CTA Card */}
      <div className="absolute inset-0 flex items-center justify-center p-4 z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full text-center relative overflow-hidden"
        >
          {/* Decorative Background */}
          <div className="absolute top-0 left-0 w-full h-2 bg-gradient-to-r from-blue-500 via-purple-500 to-pink-500" />
          <div className="absolute -top-20 -right-20 w-40 h-40 bg-gradient-to-br from-blue-100 to-purple-100 rounded-full blur-3xl opacity-50" />
          <div className="absolute -bottom-20 -left-20 w-40 h-40 bg-gradient-to-br from-purple-100 to-pink-100 rounded-full blur-3xl opacity-50" />

          {/* Lock Icon */}
          <div className="relative mb-6">
            <div className="w-20 h-20 bg-gradient-to-br from-blue-500 via-purple-500 to-pink-500 rounded-full flex items-center justify-center mx-auto shadow-lg shadow-purple-500/30">
              <Lock className="w-10 h-10 text-white" />
            </div>
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="absolute -top-1 -right-1 w-6 h-6 bg-yellow-400 rounded-full flex items-center justify-center shadow-md"
              style={{ left: '55%' }}
            >
              <Sparkles className="w-3 h-3 text-yellow-800" />
            </motion.div>
          </div>

          {/* Content */}
          <h2 className="text-2xl font-bold text-gray-900 mb-3 relative">
            Upgrade to Unlock This Page
          </h2>
          <p className="text-gray-600 leading-relaxed mb-6 relative">
            This feature is available for Pro users. Upgrade your plan to access all premium features and supercharge your Amazon business.
          </p>

          {/* Features Preview */}
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-xl p-5 mb-6 relative border border-blue-100">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Crown className="w-5 h-5 text-blue-600" />
              <span className="font-semibold text-blue-900">Pro Features Include:</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm text-gray-700">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-blue-500 rounded-full" />
                <span>Full Dashboard Access</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-purple-500 rounded-full" />
                <span>Issues & Analytics</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-pink-500 rounded-full" />
                <span>PPC Campaign Audit</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-indigo-500 rounded-full" />
                <span>Profitability Reports</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full" />
                <span>Reimbursement Tracking</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
                <span>Priority Support</span>
              </div>
            </div>
          </div>

          {/* CTA Button */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleUpgrade}
            className="w-full bg-gradient-to-r from-blue-600 via-purple-600 to-pink-600 text-white py-4 px-6 rounded-xl font-semibold text-lg hover:shadow-xl hover:shadow-purple-500/25 transition-all duration-300 flex items-center justify-center gap-3 relative overflow-hidden group"
          >
            <span className="relative z-10">Upgrade to Pro</span>
            <ArrowRight className="w-5 h-5 relative z-10 group-hover:translate-x-1 transition-transform" />
            <div className="absolute inset-0 bg-gradient-to-r from-blue-700 via-purple-700 to-pink-700 opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
          </motion.button>

          {/* Free trial link */}
          <p className="text-xs text-gray-500 mt-4 relative">
            Unlock all features with a simple upgrade
          </p>
          <button
            type="button"
            onClick={handleUpgrade}
            className="relative mt-2 text-sm text-indigo-600 hover:text-indigo-800 hover:underline focus:outline-none focus:ring-0"
          >
            First time here? Start your 7-day free trial
          </button>
        </motion.div>
      </div>
    </div>
  );
};

export default UpgradeRequiredOverlay;

