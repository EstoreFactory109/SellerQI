import React, { useState, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, Clock, RotateCcw, ArrowRight, Loader2 } from 'lucide-react';
import axios from "axios";
import BeatLoader from "react-spinners/BeatLoader";
import { clearAuthCache } from '../utils/authCoordinator.js';
import stripeService from '../services/stripeService.js';
import { detectCountry } from '../utils/countryDetection.js';
import axiosInstance from '../config/axios.config.js';
import { useDispatch } from 'react-redux';
import { updateTrialStatus } from '../redux/slices/authSlice.js';


const PENDING_VERIFICATION_EMAIL = 'pendingVerificationEmail';
const PENDING_VERIFICATION_PHONE = 'pendingVerificationPhone';

const OtpVerification = () => {
  const [otp, setOtp] = useState(["", "", "", "", ""]);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const location = useLocation();
  const stateData = location.state || {};
  // Use state first, then sessionStorage (so resend works after refresh)
  const [email, setEmail] = useState(() => stateData.email || sessionStorage.getItem(PENDING_VERIFICATION_EMAIL) || '');
  const [phone, setPhone] = useState(() => stateData.phone ?? sessionStorage.getItem(PENDING_VERIFICATION_PHONE) ?? '');
  const { intendedPackage: stateIntendedPackage } = stateData;
  const [loading, setLoading] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(300); // 5 minutes in seconds
  const [resendCooldown, setResendCooldown] = useState(40); // 40 seconds cooldown
  const [canResend, setCanResend] = useState(false);
  const [isExpired, setIsExpired] = useState(false);
  const [detectedCountry, setDetectedCountry] = useState(null); // For trial flow
  const one = useRef(null);
  const two = useRef(null);
  const three = useRef(null);
  const four = useRef(null);
  const five = useRef(null);
  
  const navigate = useNavigate();
  const dispatch = useDispatch();
  
  // Get intended package from state or localStorage
  // If null/undefined, user will choose plan on pricing page
  const intendedPackage = stateIntendedPackage !== null && stateIntendedPackage !== undefined 
    ? stateIntendedPackage 
    : localStorage.getItem('intendedPackage');

  // Persist email/phone so resend works after refresh
  useEffect(() => {
    if (stateData.email) {
      sessionStorage.setItem(PENDING_VERIFICATION_EMAIL, stateData.email);
      setEmail(stateData.email);
    }
    if (stateData.phone != null && stateData.phone !== '') {
      sessionStorage.setItem(PENDING_VERIFICATION_PHONE, stateData.phone);
      setPhone(stateData.phone);
    }
  }, [stateData.email, stateData.phone]);

  useEffect(() => {
    one.current.focus();
    
    // Detect country for trial flow
    const detectUserCountry = async () => {
      try {
        const country = await detectCountry();
        setDetectedCountry(country);
      } catch (error) {
        console.error('Error detecting country:', error);
        setDetectedCountry(null);
      }
    };
    detectUserCountry();
  }, []);

  // Timer effect for OTP expiration
  useEffect(() => {
    if (timeRemaining > 0 && !isExpired) {
      const timer = setTimeout(() => {
        setTimeRemaining(timeRemaining - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else if (timeRemaining === 0) {
      setIsExpired(true);
    }
  }, [timeRemaining, isExpired]);

  // Resend cooldown effect
  useEffect(() => {
    if (resendCooldown > 0) {
      const timer = setTimeout(() => {
        setResendCooldown(resendCooldown - 1);
      }, 1000);
      return () => clearTimeout(timer);
    } else {
      setCanResend(true);
    }
  }, [resendCooldown]);

  // Format time display
  const formatTime = (seconds) => {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  const getOtp = (e, index, nextRef) => {
    let newOtp = [...otp];
    newOtp[index] = e.target.value;
    setOtp(newOtp);

    if (e.target.value && nextRef?.current) {
      nextRef.current.focus();
    }

    if (error) {
      setError(false); // Reset error when user starts typing again
    }
    if (errorMessage) {
      setErrorMessage(''); // Reset error message when user starts typing
    }
  };

  const handleResendOTP = async () => {
    if (!canResend) return;
    if (!email || !email.trim()) {
      setErrorMessage('Email is required to resend OTP.');
      return;
    }
    try {
      setLoading(true);
      // Server expects email (required) and optional phone as exactly 10 digits
      const phoneDigits = (phone && typeof phone === 'string') ? phone.replace(/\D/g, '') : '';
      const body = { email: email.trim() };
      if (phoneDigits.length === 10) body.phone = phoneDigits;
      const response = await axios.post(`${import.meta.env.VITE_BASE_URI}/app/resend-otp`, body);
      
      if (response.status === 200) {
        // Reset timers
        setTimeRemaining(300);
        setResendCooldown(40);
        setCanResend(false);
        setIsExpired(false);
        setOtp(["", "", "", "", ""]);
        setError(false);
        setErrorMessage('');
        one.current.focus();
      }
    } catch (error) {
      console.error("Resend failed", error);
      const msg = error.response?.data?.message || error.response?.data?.errors?.[0]?.msg;
      setErrorMessage(msg || 'Failed to resend OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (isExpired) {
      setErrorMessage('OTP has expired. Please request a new one.');
      return;
    }
    
    if (otp.includes("")) {
      setError(true);
      setErrorMessage('Please fill in all OTP fields.');
      return;
    }
    
    setLoading(true);
    setError(false);
    setErrorMessage('');
    
    try {
      const response = await axios.post(`${import.meta.env.VITE_BASE_URI}/app/verify-user`, {
        email,
        otp: otp.join(""),
      },{withCredentials:true});
      
      if (response.status === 200) {
        // Clear pending verification data (used for resend after refresh)
        sessionStorage.removeItem(PENDING_VERIFICATION_EMAIL);
        sessionStorage.removeItem(PENDING_VERIFICATION_PHONE);
        // Clear any cached auth state to force fresh checks
        clearAuthCache();
        localStorage.setItem("isAuth", "true");
        
        const isIndianUser = detectedCountry === 'IN';
        
        // Redirect based on intended package
        // If no intended package: Redirect to pricing page to choose plan
        // PRO-Trial: For India use manual trial, for others use Stripe trial
        // PRO: Go to Stripe payment page (requires immediate payment)
        // AGENCY: Go to Stripe payment page (requires immediate payment)
        if (!intendedPackage || intendedPackage === 'null' || intendedPackage === 'undefined') {
          // No plan selected - redirect to connect-to-amazon page (skip pricing)
          localStorage.removeItem('intendedPackage');
          navigate("/connect-to-amazon");
        } else if (intendedPackage === 'PRO-Trial') {
          localStorage.removeItem('intendedPackage');
          
          if (isIndianUser) {
            // Indian users: Use Razorpay with 7-day trial (payment method collected, charged after trial)
            try {
              const razorpayService = (await import('../services/razorpayService.js')).default;
              razorpayService.initiatePayment(
                'PRO',
                // Success callback
                (result) => {
                  console.log('Razorpay trial started:', result);
                  if (result?.isTrialing) {
                    dispatch(updateTrialStatus({
                      packageType: result.planType || 'PRO',
                      subscriptionStatus: 'trialing',
                      isInTrialPeriod: true,
                      trialEndsDate: result.trialEndsDate
                    }));
                  }
                  navigate(`/subscription-success?gateway=razorpay&isTrialing=true&isNewSignup=true`);
                },
                // Error callback
                (error) => {
                  console.error('Razorpay trial failed:', error);
                  if (error.message !== 'Payment cancelled by user') {
                    setErrorMessage(error.message || 'Failed to start free trial. Please try again.');
                  }
                  setLoading(false);
                },
                7 // 7-day trial period
              );
            } catch (razorpayError) {
              console.error('Razorpay error:', razorpayError);
              setErrorMessage('Failed to initiate free trial. Please try again.');
              setLoading(false);
              return;
            }
          } else {
            // Non-Indian users: Go to Stripe checkout with 7-day trial
            // Payment method collected, charged after trial ends
            try {
              await stripeService.createCheckoutSession('PRO', null, 7);
              // stripeService will handle the redirect to Stripe
            } catch (stripeError) {
              console.error('Stripe checkout error:', stripeError);
              setErrorMessage('Failed to initiate free trial. Please try again.');
              setLoading(false);
              return;
            }
          }
        } else if (intendedPackage === 'PRO' || intendedPackage === 'AGENCY') {
          const packageToCheckout = intendedPackage;
          localStorage.removeItem('intendedPackage');
          
          if (isIndianUser && packageToCheckout === 'PRO') {
            // Indian users with PRO: Use Razorpay (direct payment, no trial)
            try {
              const razorpayService = (await import('../services/razorpayService.js')).default;
              razorpayService.initiatePayment(
                'PRO',
                // Success callback
                (result) => {
                  console.log('Razorpay payment successful:', result);
                  navigate(`/subscription-success?gateway=razorpay&isNewSignup=true`);
                },
                // Error callback
                (error) => {
                  console.error('Razorpay payment failed:', error);
                  if (error.message !== 'Payment cancelled by user') {
                    setErrorMessage(error.message || 'Failed to process payment. Please try again.');
                  }
                  setLoading(false);
                }
              );
            } catch (razorpayError) {
              console.error('Razorpay error:', razorpayError);
              setErrorMessage('Failed to initiate payment. Please try again.');
              setLoading(false);
              return;
            }
          } else {
            // Non-Indian users or AGENCY: Go to Stripe checkout for immediate payment
            try {
              await stripeService.createCheckoutSession(packageToCheckout);
              // stripeService will handle the redirect to Stripe
            } catch (stripeError) {
              console.error('Stripe checkout error:', stripeError);
              setErrorMessage('Failed to initiate payment. Please try again.');
              setLoading(false);
              return;
            }
          }
        } else {
          // Unknown package - redirect to connect-to-amazon page (skip pricing)
          localStorage.removeItem('intendedPackage');
          navigate("/connect-to-amazon");
        }
      }
    } catch (error) {
      console.error("Verification failed", error);
      setError(true);
      setErrorMessage(error.response?.data?.message || 'Invalid OTP. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="bg-[#161b22] rounded-2xl shadow-xl border border-[#30363d] p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="w-16 h-16 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full flex items-center justify-center mx-auto mb-4"
            >
              <Mail className="w-8 h-8 text-white" />
            </motion.div>
            
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-2xl font-bold text-gray-100 mb-2"
            >
              Verify Your Email
            </motion.h1>
            
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-gray-500 text-sm"
            >
              OTP has been sent to your registered email.
            </motion.p>
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45 }}
              className="mt-3 p-3 rounded-lg bg-amber-500/15 border border-amber-500/40 text-amber-200/95 text-sm text-center"
            >
              Can&apos;t find it? Check your <strong>Promotions</strong>, <strong>Spam</strong>, or <strong>Junk</strong> folder, or search for &quot;SellerQI&quot; or &quot;OTP&quot; in your inbox.
            </motion.div>
          </div>

          {/* Timer Display */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 }}
            className={`text-center mb-6 p-3 rounded-lg ${
              isExpired 
                ? 'bg-red-500/10 border border-red-500/40' 
                : timeRemaining <= 60 
                ? 'bg-yellow-500/10 border border-yellow-500/40' 
                : 'bg-blue-500/10 border border-blue-500/40'
            }`}
          >
            <div className="flex items-center justify-center gap-2 mb-1">
              <Clock className={`w-4 h-4 ${
                isExpired ? 'text-red-400' : timeRemaining <= 60 ? 'text-yellow-400' : 'text-blue-400'
              }`} />
              <span className={`text-sm font-medium ${
                isExpired ? 'text-red-300' : timeRemaining <= 60 ? 'text-yellow-300' : 'text-blue-300'
              }`}>
                {isExpired ? 'OTP Expired' : `Time Remaining: ${formatTime(timeRemaining)}`}
              </span>
            </div>
            {isExpired && (
              <p className="text-xs text-red-400">Please request a new OTP to continue</p>
            )}
          </motion.div>

          {/* OTP Input Form */}
          <motion.form
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
            onSubmit={handleSubmit}
            className="space-y-6"
          >
            <div className="flex justify-center gap-3">
              {[one, two, three, four, five].map((ref, index) => (
                <motion.input
                  key={index}
                  ref={ref}
                  type="text"
                  maxLength={1}
                  value={otp[index]}
                  onChange={(e) => getOtp(e, index, [two, three, four, five, null][index])}
                  disabled={isExpired}
                  initial={{ opacity: 0, scale: 0.5 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: 0.7 + index * 0.1 }}
                  className={`w-12 h-12 text-center text-xl font-semibold border-2 rounded-lg outline-none transition-all duration-200 ${
                    isExpired
                      ? 'border-[#30363d] bg-[#21262d] text-gray-500 cursor-not-allowed'
                      : error && otp[index] === ""
                      ? 'border-red-500 bg-red-500/10 text-red-300 focus:border-red-400 focus:ring-2 focus:ring-red-500/20'
                      : otp[index]
                      ? 'border-green-500 bg-green-500/10 text-green-300 focus:border-green-400 focus:ring-2 focus:ring-green-500/20'
                      : 'border-[#30363d] bg-[#21262d] text-gray-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20'
                  }`}
                />
              ))}
            </div>

            {/* Error Message */}
            <AnimatePresence>
              {errorMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="text-center p-3 bg-red-500/10 border border-red-500/40 rounded-lg"
                >
                  <p className="text-sm text-red-400">{errorMessage}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Verify Button */}
            <motion.button
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8 }}
              type="submit"
              disabled={loading || isExpired}
              className={`w-full py-3 px-4 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center gap-2 ${
                loading || isExpired
                  ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                  : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-500 hover:to-blue-600 transform hover:scale-[1.02] active:scale-[0.98]'
              }`}
            >
              {loading ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <>
                  <span>Verify OTP</span>
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </motion.button>

            {/* Resend Button */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.9 }}
              className="text-center"
            >
              <button
                type="button"
                onClick={handleResendOTP}
                disabled={!canResend || loading}
                className={`text-sm font-medium transition-all duration-200 flex items-center justify-center gap-2 mx-auto ${
                  canResend && !loading
                    ? 'text-blue-400 hover:text-blue-300 cursor-pointer'
                    : 'text-gray-500 cursor-not-allowed'
                }`}
              >
                <RotateCcw className="w-4 h-4" />
                {canResend ? (
                  'Resend OTP'
                ) : (
                  `Resend in ${resendCooldown}s`
                )}
              </button>
            </motion.div>
          </motion.form>
        </div>
      </motion.div>
    </div>
  );
};

export default OtpVerification;
