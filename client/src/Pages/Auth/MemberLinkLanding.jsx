import React, { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Loader2, AlertCircle, CheckCircle } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import { clearAuthCache } from '../../utils/authCoordinator.js';

/**
 * Where a member lands from an emailed link. Two kinds of link, one page:
 *
 *   kind="invite" — /member-invite/:token        opening it accepts the invitation
 *   kind="login"  — /member-login/verify/:token  one-time link from "Log in as a member"
 *
 * Either way the server signs them in to the account they belong to and they go
 * straight to its dashboard. Not /analyse-account: that is the owner's "we are
 * scanning your Amazon account" page, which never moves on by itself (it waits
 * for a click, or polls every 15 minutes while the owner's first scan runs), so a
 * member joining an existing account was left sitting on it.
 */
const COPY = {
  invite: {
    working: 'Accepting your invitation…',
    done: 'Invitation accepted',
    failed: 'Invitation unavailable',
    fallback: 'This invitation link is not valid.',
  },
  login: {
    working: 'Signing you in…',
    done: 'Signed in',
    failed: 'Could not sign you in',
    fallback: 'This sign-in link is invalid or has expired.',
  },
};

const MemberLinkLanding = ({ kind }) => {
  const { token } = useParams();
  const navigate = useNavigate();
  const copy = COPY[kind];
  const [error, setError] = useState('');
  const [accountName, setAccountName] = useState(null);
  // StrictMode runs effects twice in development; a link works exactly once.
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    const request =
      kind === 'invite'
        ? axiosInstance.post(`/app/members/invite/${token}/accept`)
        : axiosInstance.post('/app/members/login-link/verify', { token });

    request
      .then((res) => {
        clearAuthCache();
        localStorage.setItem('isAuth', 'true');
        setAccountName(res.data?.data?.accountName || '');
        setTimeout(() => navigate('/seller-central-checker/dashboard', { replace: true }), 1000);
      })
      .catch((err) => setError(err.response?.data?.message || copy.fallback));
  }, [kind, token, navigate, copy.fallback]);

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center px-4">
      <div className="w-full max-w-lg bg-[#161b22] rounded-2xl border border-[#30363d] p-6">
        <div className="flex justify-center mb-5">
          <img
            src="https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png"
            alt="SellerQI Logo"
            className="h-10 w-auto"
          />
        </div>
        {error ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto mb-3">
              <AlertCircle className="w-6 h-6 text-red-400" />
            </div>
            <h1 className="text-lg font-semibold text-gray-100 mb-1">{copy.failed}</h1>
            <p className="text-sm text-gray-400 mb-5">{error}</p>
            <button
              type="button"
              onClick={() => navigate('/member-login', { replace: true })}
              className="px-5 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
            >
              Log in as a member
            </button>
          </div>
        ) : accountName !== null ? (
          <div className="text-center py-6">
            <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
              <CheckCircle className="w-6 h-6 text-emerald-400" />
            </div>
            <h1 className="text-lg font-semibold text-gray-100 mb-1">{copy.done}</h1>
            <p className="text-sm text-gray-400">
              Opening {accountName || 'the account'}…
            </p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-3 py-10">
            <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
            <p className="text-sm text-gray-400">{copy.working}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default MemberLinkLanding;
