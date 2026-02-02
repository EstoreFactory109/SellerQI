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


const OtpVerification = () => {
  const [otp, setOtp] = useState(["", "", "", "", ""]);
  const [error, setError] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const location = useLocation();
  const { email, phone, intendedPackage: stateIntendedPackage } = location.state || {};
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
    
    try {
      setLoading(true);
      console.log(email, phone);
      // Call API to resend OTP
      const response = await axios.post(`${import.meta.env.VITE_BASE_URI}/app/resend-otp`, {
        email,
        phone
      });
      
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
      setErrorMessage('Failed to resend OTP. Please try again.');
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
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-cyan-50 flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md"
      >
        <div className="bg-white/80 backdrop-blur-sm rounded-2xl shadow-xl border border-white/20 p-8">
          {/* Header */}
          <div className="text-center mb-8">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ delay: 0.2, type: "spring", stiffness: 200 }}
              className="w-16 h-16 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4"
            >
              <Mail className="w-8 h-8 text-white" />
            </motion.div>
            
            <motion.h1
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="text-2xl font-bold text-gray-900 mb-2"
            >
              Verify Your Email
            </motion.h1>
            
            <motion.p
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.4 }}
              className="text-gray-600 text-sm"
            >
              OTP has been sent to your registered email:
              <br />
              <span className="font-semibold text-gray-900">{email || 'your email'}</span>
            </motion.p>
          </div>

          {/* Timer Display */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.5 }}
            className={`text-center mb-6 p-3 rounded-lg ${
              isExpired 
                ? 'bg-red-50 border border-red-200' 
                : timeRemaining <= 60 
                ? 'bg-yellow-50 border border-yellow-200' 
                : 'bg-blue-50 border border-blue-200'
            }`}
          >
            <div className="flex items-center justify-center gap-2 mb-1">
              <Clock className={`w-4 h-4 ${
                isExpired ? 'text-red-500' : timeRemaining <= 60 ? 'text-yellow-500' : 'text-blue-500'
              }`} />
              <span className={`text-sm font-medium ${
                isExpired ? 'text-red-700' : timeRemaining <= 60 ? 'text-yellow-700' : 'text-blue-700'
              }`}>
                {isExpired ? 'OTP Expired' : `Time Remaining: ${formatTime(timeRemaining)}`}
              </span>
            </div>
            {isExpired && (
              <p className="text-xs text-red-600">Please request a new OTP to continue</p>
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
                      ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed'
                      : error && otp[index] === ""
                      ? 'border-red-400 bg-red-50 text-red-900 focus:border-red-500 focus:ring-2 focus:ring-red-200'
                      : otp[index]
                      ? 'border-green-400 bg-green-50 text-green-900 focus:border-green-500 focus:ring-2 focus:ring-green-200'
                      : 'border-gray-300 bg-white text-gray-900 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200'
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
                  className="text-center p-3 bg-red-50 border border-red-200 rounded-lg"
                >
                  <p className="text-sm text-red-600">{errorMessage}</p>
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
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-gradient-to-r from-indigo-500 to-purple-600 text-white hover:from-indigo-600 hover:to-purple-700 transform hover:scale-[1.02] active:scale-[0.98]'
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
                    ? 'text-indigo-600 hover:text-indigo-700 cursor-pointer'
                    : 'text-gray-400 cursor-not-allowed'
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
