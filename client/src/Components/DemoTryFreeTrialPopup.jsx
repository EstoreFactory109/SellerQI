import React from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowRight, X } from 'lucide-react';

/**
 * Demo-only upsell popup.
 * Opens when users attempt actions inside public demo pages.
 */
const DemoTryFreeTrialPopup = ({ open, onClose }) => {
  const navigate = useNavigate();

  if (!open) return null;

  const handleStartTrial = () => {
    if (onClose) onClose();
    navigate('/sign-up');
  };

  const handleClose = () => {
    if (onClose) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center p-4 bg-black/60"
      role="dialog"
      aria-modal="true"
      aria-label="Try free trial"
      onClick={handleClose}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        className="w-full max-w-md bg-[#161b22] border border-[#30363d] shadow-2xl rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative p-6">
          {/* Top accent bar */}
          <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-indigo-500 to-cyan-400" />

          <div className="flex items-start justify-between gap-4">
            <div className="pt-1">
              <h2 className="text-xl font-bold text-[#e6edf3]">Try free trial</h2>
              <p className="text-sm text-[#9ca3af] mt-2 leading-relaxed">
                Start your 7-day free trial to unlock QMate and “Fix it” actions on SellerQI.
              </p>
            </div>

            <button
              type="button"
              onClick={handleClose}
              className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-[#21262d] border border-[#30363d]"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="mt-5">
            <button
              type="button"
              onClick={handleStartTrial}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white py-3 px-4 rounded-xl font-semibold text-sm border border-blue-500/50 transition-colors flex items-center justify-center gap-2"
            >
              Start free trial
              <ArrowRight className="w-4 h-4" />
            </button>

            <button
              type="button"
              onClick={handleClose}
              className="w-full mt-2 bg-transparent hover:bg-[#21262d] text-gray-200 py-2.5 px-4 rounded-xl font-semibold text-sm border border-[#30363d] transition-colors"
            >
              Continue in demo
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
};

export default DemoTryFreeTrialPopup;

