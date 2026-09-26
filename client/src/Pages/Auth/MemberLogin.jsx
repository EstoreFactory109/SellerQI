import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, Send, Loader2, AlertCircle, CheckCircle, ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import axiosInstance from '../../config/axios.config.js';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Log in as a member" — for people invited to help run someone else's seller
 * account. Members have no password: they enter their email and we send a
 * one-time sign-in link (see MemberLoginLinkVerify for where it lands).
 */
export default function MemberLogin() {
  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState('');
  const [errorMessage, setErrorMessage] = useState('');
  const [sentMessage, setSentMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const trimmed = email.trim();
    if (!trimmed) return setFieldError('Email is required');
    if (!EMAIL_REGEX.test(trimmed)) return setFieldError('Please enter a valid email address');

    setIsLoading(true);
    setErrorMessage('');
    try {
      const res = await axiosInstance.post('/app/members/login-link', { email: trimmed });
      setSentMessage(res.data?.message || 'Check your inbox for a sign-in link.');
    } catch (err) {
      setErrorMessage(
        err.response?.status === 429
          ? 'Too many attempts. Please wait a moment and try again.'
          : err.response?.data?.message || 'Could not send the sign-in link. Please try again.'
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center">
      <div className="relative w-full flex items-center justify-center px-4 py-4 lg:py-8">
        <div className="w-full max-w-lg">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="bg-[#161b22] rounded-2xl border border-[#30363d] p-6"
          >
            <div className="text-center mb-6">
              <div className="flex justify-center mb-4">
                <img
                  src="https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png"
                  alt="SellerQI Logo"
                  className="h-10 w-auto"
                />
              </div>
              <h1 className="text-xl lg:text-2xl font-bold text-gray-100 mb-2">Log in as a member</h1>
              <p className="text-gray-500 text-sm">
                Enter the email you were invited with and we will send you a one-time sign-in link
              </p>
            </div>

            {sentMessage && (
              <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/40 flex items-start gap-2">
                <CheckCircle className="w-4 h-4 text-green-400 shrink-0 mt-0.5" />
                <p className="text-green-300 text-sm">{sentMessage}</p>
              </div>
            )}
            {errorMessage && (
              <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/40 flex items-start gap-2">
                <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-red-400 text-sm">{errorMessage}</p>
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => {
                      setEmail(e.target.value);
                      setFieldError('');
                      setErrorMessage('');
                    }}
                    className={`w-full pl-10 pr-4 py-2.5 border rounded-lg text-gray-100 focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300 ${
                      fieldError ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
                    }`}
                    placeholder="Enter your email"
                  />
                </div>
                {fieldError && <p className="text-red-500 text-xs mt-1">{fieldError}</p>}
              </div>

              <button
                type="submit"
                disabled={isLoading}
                className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
                  isLoading ? 'bg-gray-600 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-500'
                }`}
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Send className="w-5 h-5" />
                    {sentMessage ? 'Send again' : 'Send link'}
                  </>
                )}
              </button>
            </form>

            <div className="text-center pt-4">
              <Link
                to="/"
                className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-400 hover:text-gray-200 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to sign in
              </Link>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
