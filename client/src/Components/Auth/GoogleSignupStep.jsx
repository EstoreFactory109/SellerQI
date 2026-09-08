import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, Sparkles, X } from 'lucide-react';
import { Link } from 'react-router-dom';

/**
 * Shown when someone signs in with Google and has no account yet.
 *
 * Google has already proved who they are, and every new account currently gets
 * the same plan with no payment step, so the only thing genuinely left to
 * collect is consent. No name, email, password, phone or plan questions.
 *
 * Agency sign-up is not offered here — it needs an agency name and a separate
 * activation endpoint, so it links out instead.
 */
const GoogleSignupStep = ({ profile, onSubmit, onCancel, loading, error }) => {
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [termsError, setTermsError] = useState('');

  const handleSubmit = () => {
    if (!termsAccepted) {
      setTermsError('You must agree to the Terms of Use and Privacy Policy');
      return;
    }
    setTermsError('');
    onSubmit();
  };

  const firstName = profile?.firstName?.trim();

  return (
    <AnimatePresence>
      <>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[200] bg-[#111827]/60 backdrop-blur-[2px]"
          aria-hidden
        />
        <div className="fixed inset-0 z-[201] flex items-center justify-center p-4 overflow-y-auto">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.3, ease: 'easeOut' }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="google-signup-title"
            className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-2xl p-6 sm:p-8 max-w-md w-full relative overflow-hidden my-8"
          >
            <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-[#60a5fa] via-[#a78bfa] to-[#22d3ee]" />

            <button
              type="button"
              onClick={onCancel}
              aria-label="Close"
              disabled={loading}
              className="absolute top-4 right-4 text-gray-500 hover:text-gray-300 transition-colors disabled:opacity-50"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="w-14 h-14 bg-[#21262d] border border-[#30363d] rounded-full flex items-center justify-center mb-5">
              <Sparkles className="w-7 h-7 text-[#60a5fa]" />
            </div>

            <h2 id="google-signup-title" className="text-xl font-bold text-[#e6edf3] mb-2">
              {firstName ? `Welcome, ${firstName}` : 'Welcome'}
            </h2>
            <p className="text-sm text-[#9ca3af] leading-relaxed mb-6">
              You don&rsquo;t have a SellerQI account yet
              {profile?.email ? <> — we&rsquo;ll create one for <span className="text-[#e6edf3]">{profile.email}</span>.</> : '.'}{' '}
              Next you&rsquo;ll connect your Amazon account so we can analyse it.
            </p>

            <label className="flex items-start gap-2 mb-1 cursor-pointer">
              <input
                type="checkbox"
                checked={termsAccepted}
                onChange={(e) => {
                  setTermsAccepted(e.target.checked);
                  setTermsError('');
                }}
                disabled={loading}
                className="mt-0.5 w-4 h-4 rounded border-[#484f58] bg-[#0d1117] accent-[#60a5fa]"
              />
              <span className="text-xs text-[#9ca3af] leading-relaxed">
                I agree to the{' '}
                <a href="https://www.sellerqi.com/terms-of-use" target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">
                  Terms of Use
                </a>{' '}
                and{' '}
                <a href="https://www.sellerqi.com/privacy-policy" target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">
                  Privacy Policy
                </a>
              </span>
            </label>
            {termsError && <p className="text-xs text-red-400 mb-2">{termsError}</p>}
            {error && <p className="text-xs text-red-400 mt-2 mb-1">{error}</p>}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={loading}
              className="w-full mt-4 bg-[#60a5fa] hover:bg-[#3b82f6] disabled:opacity-60 text-[#0d1117] font-semibold rounded-xl py-3 flex items-center justify-center gap-2 transition-colors"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              {loading ? 'Creating your account…' : 'Create my account'}
            </button>

            <p className="text-[11px] text-[#6b7280] text-center mt-4">
              Running an agency?{' '}
              <Link to="/agency-sign-up" className="text-[#60a5fa] hover:underline">
                Use agency sign-up
              </Link>
            </p>
          </motion.div>
        </div>
      </>
    </AnimatePresence>
  );
};

export default GoogleSignupStep;
