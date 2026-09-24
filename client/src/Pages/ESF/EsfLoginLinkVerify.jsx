import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import sellerQILogo from '../../assets/Logo/sellerQILogo.png';

/**
 * Landing page for the one-time link sent by "Log in as a member" on /esf-login.
 * Spends the token and, if it is still good, opens the portal.
 */
const EsfLoginLinkVerify = () => {
  const { token } = useParams();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  // StrictMode runs effects twice in development; a link works exactly once.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    axiosInstance
      .post('/app/esf/login-link/verify', { token })
      .then(() => {
        localStorage.setItem('isEsfAuth', 'true');
        navigate('/esf/clients', { replace: true });
      })
      .catch((err) => {
        setError(err.response?.data?.message || 'This sign-in link is invalid or has expired.');
      });
  }, [token, navigate]);

  return (
    <div className="min-h-screen bg-[#0b0f17] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg bg-[#101722]/90 rounded-2xl border border-white/10 shadow-2xl shadow-black/20 p-6">
        <div className="flex justify-center mb-5">
          <img src={sellerQILogo} alt="SellerQI" className="h-9 w-auto object-contain" />
        </div>
        {error ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="w-6 h-6 text-red-400" />
            </div>
            <h1 className="text-lg font-semibold text-gray-100 mb-1">Could not sign you in</h1>
            <p className="text-sm text-gray-400 mb-5">{error}</p>
            <button
              type="button"
              onClick={() => navigate('/esf-login', { replace: true })}
              className="px-5 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
            >
              Back to sign in
            </button>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
            <p className="text-sm text-gray-400">Signing you in…</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default EsfLoginLinkVerify;
