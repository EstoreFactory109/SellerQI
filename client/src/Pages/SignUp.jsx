import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Mail, 
  Eye, 
  EyeOff, 
  User, 
  Phone, 
  Lock, 
  ArrowRight,
  Loader2,
  AlertCircle,
  X
} from 'lucide-react';

import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { loginSuccess, updateTrialStatus } from '../redux/slices/authSlice';
import { clearAuthCache } from '../utils/authCoordinator.js';
import googleAuthService from '../services/googleAuthService.js';
import { countryCodesData } from '../utils/countryCodesData.js';
import { detectCountry } from '../utils/countryDetection.js';
import axiosInstance from '../config/axios.config.js';

// Helper function to get country flag from ISO code
const getCountryFlag = (isoCode) => {
  if (!isoCode || isoCode === 'XX') return '🏳️'; // Default flag for unknown countries
  return `https://flagsapi.com/${isoCode}/flat/32.png`;
};

// Default fallback country data for unknown codes
const defaultCountryData = {
  iso: 'XX',
  name: 'Unknown Country',
  pattern: /^\d{7,15}$/,
  placeholder: 'Enter phone number',
  minLength: 7,
  maxLength: 15
};

const SignUp = () => {
  const [plans, setPlans] = useState("PRO-Trial"); // Default to PRO-Trial, can be "PRO-Trial" or "PRO"
  const [formData, setFormData] = useState({
    firstname: '',
    lastname: '',
    phone: '',
    email: '',
    password: ''
  });
  const [countryCode, setCountryCode] = useState('+1'); // Default country code
  const [selectedCountry, setSelectedCountry] = useState(countryCodesData['+1'] || defaultCountryData); // Default to US
  const [countryFlag, setCountryFlag] = useState('🇺🇸'); // Default flag
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [detectedCountry, setDetectedCountry] = useState(null); // For trial flow
  const navigate = useNavigate();
  const dispatch = useDispatch();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
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

  // Auto-dismiss error messages after 5 seconds
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => {
        setErrorMessage('');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  // Update selected country when country code changes
  useEffect(() => {
    const foundCountry = countryCodesData[countryCode];
    if (foundCountry) {
      setSelectedCountry(foundCountry);
      // Try to get flag from API, fallback to emoji
      const flagUrl = getCountryFlag(foundCountry.iso);
      setCountryFlag(flagUrl);
    } else {
      // If no country found, use default country data but keep the entered code
      setSelectedCountry({...defaultCountryData, code: countryCode});
      setCountryFlag('🏳️'); // Default flag for unknown countries
    }
  }, [countryCode]);

  // Handle URL parameters for plan selection
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const plan = params.get("intended_package");
    if(plan){
      setPlans(plan);
    } else {
      // No extension in URL - user will choose plan on pricing page after signup
      setPlans(null);
    }
  }, []);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: '' });
    // Clear general error message when user starts typing
    if (errorMessage) {
      setErrorMessage('');
    }
  };

  const handleFocus = (e) => {
    setErrors({ ...errors, [e.target.name]: '' });
  };

  const handleCountryCodeChange = (e) => {
    const value = e.target.value;
    // Only allow + and digits, max 4 characters (+XXX)
    if (value.match(/^\+?\d{0,3}$/) || value === '+') {
      const formattedValue = value.startsWith('+') ? value : '+' + value.replace(/[^\d]/g, '');
      setCountryCode(formattedValue);
      setFormData({ ...formData, phone: '' }); // Clear phone input when country changes
      setErrors({ ...errors, phone: '', countryCode: '' }); // Clear phone and country code errors when country changes
    }
  };

  const handlePhoneChange = (e) => {
    const value = e.target.value;
    // Only allow digits and spaces, and enforce max length
    const cleanValue = value.replace(/[^\d\s]/g, '');
    const digitsOnly = cleanValue.replace(/\s+/g, '');
    
    if (digitsOnly.length <= selectedCountry.maxLength) {
      setFormData({ ...formData, phone: cleanValue });
      setErrors({ ...errors, phone: '' });
      // Clear general error message when user starts typing
      if (errorMessage) {
        setErrorMessage('');
      }
    }
  };

  const validateForm = () => {
    let newErrors = {};
    const nameRegex = /^[A-Za-z]{2,}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!nameRegex.test(formData.firstname)) {
      newErrors.firstname = 'Enter a valid first name (only letters, min 2 characters)';
    }
    if (!nameRegex.test(formData.lastname)) {
      newErrors.lastname = 'Enter a valid last name (only letters, min 2 characters)';
    }
    
    // Country code validation
    if (!countryCode || countryCode === '+' || countryCode.length < 2) {
      newErrors.countryCode = 'Country code is required';
    }
    
    // Phone validation based on selected country
    const cleanPhone = formData.phone.replace(/\s+/g, ''); // Remove spaces
    if (!cleanPhone) {
      newErrors.phone = 'Phone number is required';
    } else if (!selectedCountry.pattern.test(cleanPhone)) {
      newErrors.phone = `Enter a valid phone number for ${selectedCountry.name} (${selectedCountry.minLength}${selectedCountry.minLength !== selectedCountry.maxLength ? `-${selectedCountry.maxLength}` : ''} digits)`;
    }
    
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Enter a valid email address';
    }
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (!passwordRegex.test(formData.password)) {
      newErrors.password = 'Password must be at least 8 characters, with a letter, a number, and a special character';
    }
    
    if (!termsAccepted) {
      newErrors.terms = 'You must agree to the Terms of Use and Privacy Policy';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    try {
      // Determine package settings based on selected plan
      // If no plan selected (plans is null), user will choose on pricing page after signup
      // PRO-Trial: 7-day Stripe trial (payment method collected, charged after trial ends)
      // PRO: Requires payment after email verification
      // AGENCY: Requires payment after email verification
      const isPROTrial = plans === "PRO-Trial";
      const isPRO = plans === "PRO";
      const isAGENCY = plans === "AGENCY";
      const noPlanSelected = plans === null || plans === undefined;
      
      // Determine packageType based on plan
      // If no plan selected, default to LITE (user will choose on pricing page)
      // For PRO-Trial, start as LITE until Stripe trial is activated
      let packageType = "LITE";
      if (isAGENCY) {
        packageType = "AGENCY";
      } else if (isPRO) {
        packageType = "PRO";
      }
      // PRO-Trial starts as LITE, will be upgraded when Stripe checkout completes
      
      const formDataWithTerms = {
        ...formData,
        phone: `${countryCode} ${formData.phone}`, // Include country code
        allTermsAndConditionsAgreed: termsAccepted,
        packageType: packageType, // LITE for no plan or PRO-Trial, PRO for PRO, AGENCY for AGENCY
        isInTrialPeriod: false, // Trial is now managed by Stripe, not manually
        subscriptionStatus: noPlanSelected || isPROTrial ? "active" : "inactive", // LITE is active, PRO/AGENCY needs payment first
        trialEndsDate: null, // Trial dates managed by Stripe
        intendedPackage: plans, // Store the intended package for post-verification flow (null if no plan)
      };
      const response = await axios.post(`${import.meta.env.VITE_BASE_URI}/app/register`, formDataWithTerms, { withCredentials: true });
      if (response.status === 201) {
        setLoading(false);
        // Store intended package in localStorage for email verification page (null if no plan)
        if (plans) {
          localStorage.setItem('intendedPackage', plans);
        } else {
          localStorage.removeItem('intendedPackage'); // Clear if exists
        }
        navigate('/verify-email', { state: { email: formData.email, phone: `${countryCode} ${formData.phone}`, intendedPackage: plans } });
      }
    } catch (error) {
      setLoading(false);
      setErrorMessage(error.response?.data?.message);
    }
  };

  const navigateToLogin = () => {
    navigate('/');
  };

  const handleGoogleSignUp = async () => {
    if (!termsAccepted) {
        setErrors({ ...errors, terms: 'You must agree to the Terms of Use and Privacy Policy' });
        return;
    }

    setGoogleLoading(true);
    try {
      // Determine package settings based on selected plan
      const isPROTrial = plans === "PRO-Trial";
      const isAGENCY = plans === "AGENCY";
      const noPlanSelected = plans === null || plans === undefined;
      const isIndianUser = detectedCountry === 'IN';
      
      // Determine packageType based on plan
      // If no plan selected, default to LITE (user will choose on pricing page)
      // For PRO-Trial, start as LITE until trial is activated (Stripe for non-India, manual for India)
      let packageType = "LITE";
      if (isAGENCY) {
        packageType = "AGENCY";
      } else if (plans === "PRO") {
        packageType = "PRO";
      }
      
      // For Indian users with PRO-Trial, we'll activate manual trial after signup
      const isInTrialPeriod = false;
      const subscriptionStatus = noPlanSelected || isPROTrial ? "active" : "inactive";
      const trialEndsDate = null;
      
      const response = await googleAuthService.handleGoogleSignUp(packageType, isInTrialPeriod, subscriptionStatus, trialEndsDate);
        
        if (response.statusCode === 201) {
          // New user registration - continue with signup flow
          // Clear any cached auth state to force fresh checks
          clearAuthCache();
          // Store auth information
          localStorage.setItem("isAuth", "true");
          dispatch(loginSuccess(response.data || response));
          
          // If no plan selected, redirect to connect-to-amazon page (skip pricing)
          if (noPlanSelected) {
            navigate('/connect-to-amazon');
          } else if (isPROTrial) {
            // PRO-Trial: Different flow for India vs non-India
            if (isIndianUser) {
              // Indian users: Use Razorpay with 7-day trial (payment method collected, charged after trial)
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
                  // Note: setGoogleLoading(false) is handled in the finally block
                },
                7 // 7-day trial period
              );
            } else {
              // Non-Indian users: Go to Stripe checkout with 7-day trial
              // Payment method collected, charged after trial ends
              const stripeService = (await import('../services/stripeService.js')).default;
              await stripeService.createCheckoutSession('PRO', null, 7);
            }
          } else {
            // PRO/AGENCY (paid): Go to Stripe payment (for non-India) or Razorpay (for India)
            if (isIndianUser && packageType === 'PRO') {
              // Indian users with PRO: Use Razorpay (direct payment, no trial)
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
                  // Note: setGoogleLoading(false) is handled in the finally block
                }
              );
            } else {
              // Non-Indian users or AGENCY: Go to Stripe payment
              localStorage.setItem('intendedPackage', plans);
              const stripeService = (await import('../services/stripeService.js')).default;
              await stripeService.createCheckoutSession(packageType);
            }
          }
          
        } else {
            // Non-200/201 response - treat as error
            console.error('Google sign-up returned unexpected status:', response.statusCode);
            setErrorMessage(response.message || 'Google sign-up failed. Please try again.');
        }
    } catch (error) {
        console.error('Google sign-up failed:', error);
        
        // Handle 409 Conflict - user already exists
        if (error.response?.status === 409) {
          setErrorMessage('An account with this email already exists. Please login instead.');
          setTimeout(() => {
            navigate('/');
          }, 2000);
        } else {
          setErrorMessage(error.response?.data?.message || 'Google sign-up failed. Please try again.');
        }
    } finally {
        setGoogleLoading(false);
    }
  };

  const handleAmazonSignUp = () => {
    if (!termsAccepted) {
        setErrors({ ...errors, terms: 'You must agree to the Terms of Use and Privacy Policy' });
        return;
    }
    
    // TODO: Implement Amazon signup functionality
    // For now, show a message that this feature is coming soon
    setErrorMessage('Amazon signup is coming soon. Please use email signup or Google signup for now.');
  };

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center">
      {/* Form Section */}
      <div className="relative w-full flex items-center justify-center px-4 py-4 lg:py-8">
        <div className="w-full max-w-lg">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="bg-[#161b22] rounded-2xl border border-[#30363d] p-6"
          >
            {/* Logo and Header */}
            <div className="text-center mb-6">
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="flex justify-center mb-4"
              >
                <img 
                  src="https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png" 
                  alt="SellerQI Logo" 
                  className="h-10 w-auto"
                />
              </motion.div>
              <h1 className="text-xl lg:text-2xl font-bold text-gray-100 mb-2">
                Join SellerQI Today
              </h1>
              <p className="text-gray-500 text-sm">
                Start optimizing your Amazon business with AI-powered insights
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    First Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                         <input
                       type="text"
                       name="firstname"
                       value={formData.firstname}
                       onChange={handleChange}
                       onFocus={handleFocus}
                       className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-gray-100 ${
                         errors.firstname ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
                       }`}
                       placeholder="Enter first name"
                     />
                  </div>
                  {errors.firstname && (
                    <motion.p
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-red-400 text-xs mt-1"
                    >
                      {errors.firstname}
                    </motion.p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">
                    Last Name
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                         <input
                       type="text"
                       name="lastname"
                       value={formData.lastname}
                       onChange={handleChange}
                       onFocus={handleFocus}
                       className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-gray-100 ${
                         errors.lastname ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
                       }`}
                       placeholder="Enter last name"
                     />
                  </div>
                  {errors.lastname && (
                    <motion.p
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-red-400 text-xs mt-1"
                    >
                      {errors.lastname}
                    </motion.p>
                  )}
                </div>
              </div>

              {/* Phone Field with Country Code */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Phone Number
                </label>
                <div className="flex">
                  {/* Country Code Input */}
                  <div className="relative">
                    <div className={`flex items-center gap-2 px-3 py-2.5 h-11 border rounded-l-lg bg-[#21262d] ${
                      errors.countryCode ? 'border-red-500 bg-red-500/10' : 'border-[#30363d]'
                    }`}>
                      <div className="w-5 h-4 flex items-center justify-center">
                        {countryFlag.startsWith('http') ? (
                          <img 
                            src={countryFlag} 
                            alt={`${selectedCountry.name} flag`} 
                            className="w-5 h-4 object-cover rounded-sm"
                            onError={(e) => {
                              // Fallback to emoji if image fails to load
                              e.target.outerHTML = '<span class="text-sm">🏳️</span>';
                            }}
                          />
                        ) : (
                          <span className="text-sm">{countryFlag}</span>
                        )}
                      </div>
                      <input
                        type="text"
                        value={countryCode}
                        onChange={handleCountryCodeChange}
                        onFocus={() => setErrors({ ...errors, countryCode: '' })}
                        className={`w-16 text-sm font-medium text-gray-100 bg-transparent border-none outline-none focus:ring-0 ${
                          errors.phone || errors.countryCode ? 'text-red-400' : ''
                        }`}
                        placeholder="+1"
                        maxLength={4}
                      />
                    </div>
                  </div>
                  
                  {/* Phone Number Input */}
                  <div className="relative flex-1">
                    <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="text"
                      name="phone"
                      value={formData.phone}
                      onChange={handlePhoneChange}
                      onFocus={handleFocus}
                      className={`w-full pl-10 pr-4 py-2.5 h-11 border-t border-r border-b rounded-r-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-gray-100 ${
                        errors.phone ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
                      }`}
                      placeholder={selectedCountry.placeholder}
                      maxLength={selectedCountry.maxLength + Math.floor(selectedCountry.maxLength / 3)} // Extra space for formatting
                    />
                  </div>
                </div>
                {errors.countryCode && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-red-400 text-xs mt-1"
                  >
                    {errors.countryCode}
                  </motion.p>
                )}
                {errors.phone && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-red-400 text-xs mt-1"
                  >
                    {errors.phone}
                  </motion.p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Enter {selectedCountry.minLength}{selectedCountry.minLength !== selectedCountry.maxLength ? `-${selectedCountry.maxLength}` : ''} digits for {selectedCountry.name}
                </p>
              </div>

              {/* Email Field */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                     <input
                     type="email"
                     name="email"
                     value={formData.email}
                     onChange={handleChange}
                     onFocus={handleFocus}
                     className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-gray-100 ${
                       errors.email ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
                     }`}
                     placeholder="Enter your email"
                   />
                </div>
                {errors.email && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-red-400 text-xs mt-1"
                  >
                    {errors.email}
                  </motion.p>
                )}
              </div>

              {/* Password Field */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                                     <input
                     type={showPassword ? "text" : "password"}
                     name="password"
                     value={formData.password}
                     onChange={handleChange}
                     onFocus={handleFocus}
                     className={`w-full pl-10 pr-12 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-gray-100 ${
                       errors.password ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
                     }`}
                     placeholder="Create a password"
                   />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {errors.password && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-red-400 text-xs mt-1"
                  >
                    {errors.password}
                  </motion.p>
                )}
                                 <p className="text-xs text-gray-500 mt-0.5">
                   Min 8 chars with letters, numbers & symbols
                 </p>
              </div>

              {/* Terms Checkbox */}
              <div>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="termsCheckbox"
                    checked={termsAccepted}
                    onChange={(e) => {
                      setTermsAccepted(e.target.checked);
                      if (e.target.checked) {
                        setErrors({ ...errors, terms: '' });
                      }
                    }}
                    className="mt-1 w-4 h-4 text-blue-500 bg-[#21262d] border-[#30363d] rounded focus:ring-blue-500 focus:ring-2"
                  />
                  <label htmlFor="termsCheckbox" className="text-sm text-gray-300 leading-relaxed">
                    I agree to the{' '}
                    <Link to="https://www.sellerqi.com/terms-of-use" className="text-blue-400 hover:text-blue-300 underline font-medium">
                      Terms of Use
                    </Link>
                    {' '}and{' '}
                    <Link to="https://www.sellerqi.com/privacy-policy" className="text-blue-400 hover:text-blue-300 underline font-medium">
                      Privacy Policy
                    </Link>
                  </label>
                </div>
                {errors.terms && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-red-400 text-xs mt-2"
                  >
                    {errors.terms}
                  </motion.p>
                )}
              </div>

                             {/* Submit Button */}
               <button
                 type="submit"
                 disabled={!termsAccepted || loading}
                 className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
                   !termsAccepted || loading
                     ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                     : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-500 hover:to-blue-600 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30'
                 }`}
               >
                 {loading ? (
                   <Loader2 className="w-5 h-5 animate-spin" />
                 ) : (
                   <>
                     Create Account
                     <ArrowRight className="w-5 h-5" />
                   </>
                 )}
               </button>

               {/* Divider */}
               <div className="flex items-center my-4">
                 <div className="flex-1 border-t border-[#30363d]"></div>
                 <span className="mx-3 text-gray-500 text-sm font-medium">Or continue with</span>
                 <div className="flex-1 border-t border-[#30363d]"></div>
               </div>

                             {/* Social Buttons */}
               <div className="space-y-2">
                 <button
                   type="button"
                   onClick={handleGoogleSignUp}
                   disabled={googleLoading}
                   className={`w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-[#30363d] rounded-lg transition-all duration-300 font-medium text-sm bg-[#21262d] ${
                     googleLoading 
                       ? 'text-gray-500 cursor-not-allowed' 
                       : 'hover:bg-[#1c2128] hover:border-gray-500 text-gray-300'
                   }`}
                 >
                   {googleLoading ? (
                     <Loader2 className="w-4 h-4 animate-spin" />
                   ) : (
                     <>
                       <svg className="w-4 h-4" viewBox="0 0 24 24">
                         <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                         <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                         <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                         <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                       </svg>
                       Continue with Google
                     </>
                   )}
                 </button>

               { /* <button
                   type="button"
                   onClick={handleAmazonSignUp}
                   className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all duration-300 font-medium text-sm"
                 >
                   <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#FF9900">
                     <path d="M.045 18.02c.072-.116.187-.124.348-.022 3.636 2.11 7.594 3.166 11.87 3.166 2.852 0 5.668-.533 8.447-1.595l.316-.12c.174-.065.348-.1.478-.174.13-.074.217-.148.26-.22l-.434-.868c-.13.065-.26.13-.434.174l-.26.087c-2.61.976-5.32 1.465-8.143 1.465-4.06 0-7.775-.977-11.157-2.93-.131-.075-.218-.131-.291-.163z"/>
                     <path d="M.045 5.98c.072.116.187.124.348.022 3.636-2.11 7.594-3.166 11.87-3.166 2.852 0 5.668.533 8.447 1.595l.316.12c.174.065.348.1.478.174.13.074.217.148.26.22l-.434.868c-.13-.065-.26-.13-.434-.174l-.26-.087c-2.61-.976-5.32-1.465-8.143-1.465-4.06 0-7.775.977-11.157 2.93-.131.075-.218.131-.291.163z"/>
                     <path d="M.131 12L.045 5.98v12.04L.131 12z"/>
                     <path d="M23.855 12c0-.855-.855-1.595-2.565-2.22l-.348-.131v4.702l.348-.131c1.71-.625 2.565-1.365 2.565-2.22z"/>
                   </svg>
                   Continue with Amazon
                 </button>*/}
               </div>

                             {/* Login Link */}
               <div className="text-center pt-2">
                 <p className="text-gray-500 text-sm">
                   Already have an account?{' '}
                   <button
                     type="button"
                     onClick={navigateToLogin}
                     className="text-blue-400 hover:text-blue-300 font-semibold hover:underline transition-colors"
                   >
                     Sign in
                   </button>
                 </p>
               </div>

              {/* Error Message */}
              <AnimatePresence>
                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 relative"
                  >
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-red-300 font-medium text-sm">Registration Failed</p>
                        <p className="text-red-400/90 text-sm mt-1">{errorMessage}</p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setErrorMessage('')}
                        className="text-red-400 hover:text-red-300 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}
                             </AnimatePresence>
             </form>
           </motion.div>
         </div>
       </div>
     </div>
  );
};

export default SignUp;