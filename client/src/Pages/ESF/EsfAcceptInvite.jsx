import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import { extractServerError } from '../../utils/passwordCriteria.js';
import sellerQILogo from '../../assets/Logo/sellerQILogo.png';

/**
 * Where an invited team member lands from the emailed link.
 *
 * Opening the link is the acceptance: the account is created from the invitation
 * (email, role and any nickname the inviter gave) and they are signed straight
 * in. There is nothing to fill in. Next time they use "Log in as a member" on
 * /esf-login, which emails a one-time sign-in link.
 */
const EsfAcceptInvite = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  // StrictMode runs effects twice in development; the invite must be spent once.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const accept = async () => {
      try {
        const res = await axiosInstance.post(`/app/esf/invites/token/${token}/accept`);
        if (res.data?.statusCode === 201) {
          localStorage.setItem('isEsfAuth', 'true');
          setDone(true);
          setTimeout(() => navigate('/esf/clients', { replace: true }), 1200);
        } else {
          setError(res.data?.message || 'This invitation link is not valid');
        }
      } catch (err) {
        setError(extractServerError(err, 'This invitation link is not valid'));
      }
    };
    accept();
  }, [token, navigate]);

  return (
    <div className="min-h-screen bg-[#0b0f17] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-[#101722]/90 rounded-2xl border border-white/10 shadow-2xl shadow-black/20 backdrop-blur p-6"
        >
          <div className="flex justify-center mb-5">
            <img src={sellerQILogo} alt="SellerQI" className="h-9 w-auto object-contain" />
          </div>

          {error ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto mb-3">
                <AlertCircle className="w-6 h-6 text-red-400" />
              </div>
              <h1 className="text-lg font-semibold text-gray-100 mb-1">Invitation unavailable</h1>
              <p className="text-sm text-gray-400 mb-5">{error}</p>
              <button
                type="button"
                onClick={() => navigate('/esf-login')}
                className="px-5 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
              >
                Go to sign in
              </button>
            </div>
          ) : done ? (
            <div className="text-center py-6">
              <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
                <CheckCircle className="w-6 h-6 text-emerald-400" />
              </div>
              <h1 className="text-lg font-semibold text-gray-100 mb-1">Welcome to the team</h1>
              <p className="text-sm text-gray-400">Taking you to the portal…</p>
            </div>
          ) : (
            <div className="flex flex-col items-center gap-3 py-10">
              <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
              <p className="text-sm text-gray-400">Accepting your invitation…</p>
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
};

export default EsfAcceptInvite;
