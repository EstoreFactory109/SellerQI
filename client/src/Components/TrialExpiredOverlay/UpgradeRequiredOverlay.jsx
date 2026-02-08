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
      {/* Blurred Background Content - light enough to understand the page behind */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="filter blur-md brightness-90 pointer-events-none select-none">
          {children}
        </div>
      </div>

      {/* Semi-transparent overlay so background remains visible */}
      <div className="absolute inset-0 bg-[#111827]/40 backdrop-blur-[2px]" />

      {/* Upgrade CTA Card - dark theme to match main pages */}
      <div className="absolute inset-0 flex items-center justify-center p-4 z-10">
        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ duration: 0.4, ease: 'easeOut' }}
          className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-2xl p-8 max-w-lg w-full text-center relative overflow-hidden"
        >
          {/* Top accent bar */}
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#60a5fa] via-[#a78bfa] to-[#22d3ee]" />

          {/* Lock Icon */}
          <div className="relative mb-6">
            <div className="w-20 h-20 bg-[#21262d] border border-[#30363d] rounded-full flex items-center justify-center mx-auto">
              <Lock className="w-10 h-10 text-[#60a5fa]" />
            </div>
            <motion.div
              animate={{ scale: [1, 1.2, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="absolute -top-1 -right-1 w-6 h-6 bg-[#fbbf24]/90 rounded-full flex items-center justify-center border border-[#30363d]"
              style={{ left: '55%' }}
            >
              <Sparkles className="w-3 h-3 text-[#111827]" />
            </motion.div>
          </div>

          {/* Content */}
          <h2 className="text-2xl font-bold text-[#e6edf3] mb-3 relative">
            Upgrade to Unlock This Page
          </h2>
          <p className="text-[#9ca3af] leading-relaxed mb-6 relative">
            This feature is available for Pro users. Upgrade your plan to access all premium features and supercharge your Amazon business.
          </p>

          {/* Features Preview - dark card */}
          <div className="bg-[#21262d] rounded-xl p-5 mb-6 relative border border-[#30363d]">
            <div className="flex items-center justify-center gap-2 mb-3">
              <Crown className="w-5 h-5 text-[#60a5fa]" />
              <span className="font-semibold text-[#e6edf3]">Pro Features Include:</span>
            </div>
            <div className="grid grid-cols-2 gap-2 text-sm text-[#9ca3af]">
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-[#60a5fa] rounded-full" />
                <span>Full Dashboard Access</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-[#a78bfa] rounded-full" />
                <span>Issues & Analytics</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-[#22d3ee] rounded-full" />
                <span>PPC Campaign Audit</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-[#a78bfa] rounded-full" />
                <span>Profitability Reports</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-[#34d399] rounded-full" />
                <span>Reimbursement Tracking</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-1.5 h-1.5 bg-[#fbbf24] rounded-full" />
                <span>Priority Support</span>
              </div>
            </div>
          </div>

          {/* CTA Button - dark theme accent */}
          <motion.button
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
            onClick={handleUpgrade}
            className="w-full bg-[#2563eb] hover:bg-[#1d4ed8] text-white py-4 px-6 rounded-xl font-semibold text-lg border border-[#3b82f6]/50 transition-all duration-300 flex items-center justify-center gap-3 relative overflow-hidden group"
          >
            <span className="relative z-10">Upgrade to Pro</span>
            <ArrowRight className="w-5 h-5 relative z-10 group-hover:translate-x-1 transition-transform" />
          </motion.button>

          {/* Free trial link */}
          <p className="text-xs text-[#6e7681] mt-4 relative">
            Unlock all features with a simple upgrade
          </p>
          <button
            type="button"
            onClick={handleUpgrade}
            className="relative mt-2 text-sm text-[#60a5fa] hover:text-[#93c5fd] focus:outline-none focus:ring-0 transition-colors"
          >
            First time here? Start your 7-day free trial
          </button>
        </motion.div>
      </div>
    </div>
  );
};

export default UpgradeRequiredOverlay;

