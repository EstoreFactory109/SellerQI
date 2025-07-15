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
  Loader2
} from 'lucide-react';

import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { loginSuccess } from '../redux/slices/authSlice';
import googleAuthService from '../services/googleAuthService.js';
import stripeService from '../services/stripeService.js';

const SignUp = () => {
  const [formData, setFormData] = useState({
    firstname: '',
    lastname: '',
    phone: '',
    email: '',
    password: ''
  });
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const navigate = useNavigate();
  const dispatch = useDispatch();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: '' });
  };

  const handleFocus = (e) => {
    setErrors({ ...errors, [e.target.name]: '' });
  };

  const validateForm = () => {
    let newErrors = {};
    const nameRegex = /^[A-Za-z]{2,}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^\d{10}$/;
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!nameRegex.test(formData.firstname)) {
      newErrors.firstname = 'Enter a valid first name (only letters, min 2 characters)';
    }
    if (!nameRegex.test(formData.lastname)) {
      newErrors.lastname = 'Enter a valid last name (only letters, min 2 characters)';
    }
    if (!phoneRegex.test(formData.phone)) {
      newErrors.phone = 'Enter a valid 10-digit phone number';
    }
    if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Enter a valid email address';
    }
    if (!passwordRegex.test(formData.password)) {
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
      const formDataWithTerms = {
        ...formData,
        allTermsAndConditionsAgreed: termsAccepted
      };
      const response = await axios.post(`${import.meta.env.VITE_BASE_URI}/app/register`, formDataWithTerms, { withCredentials: true });
      if (response.status === 201) {
        setLoading(false);
        navigate('/verify-email', { state: { email: formData.email } });
      }
    } catch (error) {
      setLoading(false);
      setErrorMessage(error.response?.data?.message);
    }
  };

  const navigateToLogin = () => {
    navigate('/log-in');
  };

  const handleGoogleSignUp = async () => {
    if (!termsAccepted) {
        setErrors({ ...errors, terms: 'You must agree to the Terms of Use and Privacy Policy' });
        return;
    }

    setGoogleLoading(true);
    try {
        const response = await googleAuthService.handleGoogleSignUp();
        
        if (response.status === 200) {
            dispatch(loginSuccess(response.data));
            localStorage.setItem("isAuth", true);
            
            // Check subscription status before redirecting
            try {
                const subscriptionStatus = await stripeService.getSubscriptionStatus();
                
                if (subscriptionStatus.hasSubscription) {
                    // User has a subscription, redirect to dashboard
                    window.location.href = "/seller-central-checker/dashboard";
                } else {
                    // No subscription, redirect to pricing page
                    navigate("/pricing");
                }
            } catch (error) {
                console.error('Error checking subscription status:', error);
                // If subscription check fails, default to pricing page
                navigate("/pricing");
            }
        } else if (response.status === 201) {
            // New user registered, redirect to connect Amazon
            dispatch(loginSuccess(response.data));
            localStorage.setItem("isAuth", true);
            navigate("/connect-to-amazon");
        }
    } catch (error) {
        console.error('Google sign-up failed:', error);
        setErrorMessage(error.response?.data?.message || 'Google sign-up failed. Please try again.');
    } finally {
        setGoogleLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 via-white to-white flex items-center justify-center">
      {/* Background Elements */}
      <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))] dark:bg-grid-slate-700/25 dark:[mask-image:linear-gradient(0deg,rgba(255,255,255,0.1),rgba(255,255,255,0.5))]"></div>
      <div className="absolute top-10 right-10 w-72 h-72 bg-gray-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
      <div className="absolute top-40 left-10 w-72 h-72 bg-emerald-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-2000"></div>
      
      {/* Form Section */}
      <div className="relative w-full flex items-center justify-center px-4 py-4 lg:py-8">
        <div className="w-full max-w-lg">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="bg-white rounded-2xl border border-gray-200 shadow-xl p-6"
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
              <h1 className="text-xl lg:text-2xl font-bold text-gray-900 mb-2">
                Join SellerQI Today
              </h1>
              <p className="text-gray-600 text-sm">
                Start optimizing your Amazon business with AI-powered insights
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Name Fields */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
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
                       className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300 ${
                         errors.firstname ? 'border-red-500 bg-red-50' : 'border-gray-300 hover:border-gray-400'
                       }`}
                       placeholder="Enter first name"
                     />
                  </div>
                  {errors.firstname && (
                    <motion.p
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-red-500 text-xs mt-1"
                    >
                      {errors.firstname}
                    </motion.p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
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
                       className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300 ${
                         errors.lastname ? 'border-red-500 bg-red-50' : 'border-gray-300 hover:border-gray-400'
                       }`}
                       placeholder="Enter last name"
                     />
                  </div>
                  {errors.lastname && (
                    <motion.p
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="text-red-500 text-xs mt-1"
                    >
                      {errors.lastname}
                    </motion.p>
                  )}
                </div>
              </div>

              {/* Phone Field */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Phone Number
                </label>
                <div className="relative">
                  <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    name="phone"
                    value={formData.phone}
                    onChange={handleChange}
                    onFocus={handleFocus}
                    className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300 ${
                      errors.phone ? 'border-red-500 bg-red-50' : 'border-gray-300 hover:border-gray-400'
                    }`}
                    placeholder="Enter your phone number"
                  />
                </div>
                {errors.phone && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-red-500 text-xs mt-1"
                  >
                    {errors.phone}
                  </motion.p>
                )}
              </div>

              {/* Email Field */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
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
                     className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300 ${
                       errors.email ? 'border-red-500 bg-red-50' : 'border-gray-300 hover:border-gray-400'
                     }`}
                     placeholder="Enter your email"
                   />
                </div>
                {errors.email && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-red-500 text-xs mt-1"
                  >
                    {errors.email}
                  </motion.p>
                )}
              </div>

              {/* Password Field */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
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
                     className={`w-full pl-10 pr-12 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300 ${
                       errors.password ? 'border-red-500 bg-red-50' : 'border-gray-300 hover:border-gray-400'
                     }`}
                     placeholder="Create a password"
                   />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {errors.password && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-red-500 text-xs mt-1"
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
                    onChange={(e) => setTermsAccepted(e.target.checked)}
                    className="mt-1 w-4 h-4 text-[#3B4A6B] bg-gray-100 border-gray-300 rounded focus:ring-[#3B4A6B] focus:ring-2"
                  />
                  <label htmlFor="termsCheckbox" className="text-sm text-gray-700 leading-relaxed">
                    I agree to the{' '}
                    <Link to="/terms" className="text-[#3B4A6B] hover:text-[#2d3a52] underline font-medium">
                      Terms of Use
                    </Link>
                    {' '}and{' '}
                    <Link to="/privacy-policy" className="text-[#3B4A6B] hover:text-[#2d3a52] underline font-medium">
                      Privacy Policy
                    </Link>
                  </label>
                </div>
                {errors.terms && (
                  <motion.p
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="text-red-500 text-xs mt-2"
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
                     ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                     : 'bg-gradient-to-r from-[#3B4A6B] to-[#333651] text-white hover:from-[#2d3a52] hover:to-[#2a2e42] shadow-lg hover:shadow-xl'
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
                 <div className="flex-1 border-t border-gray-300"></div>
                 <span className="mx-3 text-gray-500 text-sm font-medium">Or continue with</span>
                 <div className="flex-1 border-t border-gray-300"></div>
               </div>

                             {/* Social Buttons */}
               <div className="space-y-2">
                 <button
                   type="button"
                   onClick={handleGoogleSignUp}
                   disabled={googleLoading || !termsAccepted}
                   className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all duration-300 font-medium text-sm"
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

                 <button
                   type="button"
                   className="w-full flex items-center justify-center gap-3 py-2.5 px-4 border border-gray-300 rounded-lg hover:bg-gray-50 hover:border-gray-400 transition-all duration-300 font-medium text-sm"
                 >
                   <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#FF9900">
                     <path d="M.045 18.02c.072-.116.187-.124.348-.022 3.636 2.11 7.594 3.166 11.87 3.166 2.852 0 5.668-.533 8.447-1.595l.316-.12c.174-.065.348-.1.478-.174.13-.074.217-.148.26-.22l-.434-.868c-.13.065-.26.13-.434.174l-.26.087c-2.61.976-5.32 1.465-8.143 1.465-4.06 0-7.775-.977-11.157-2.93-.131-.075-.218-.131-.291-.163z"/>
                     <path d="M.045 5.98c.072.116.187.124.348.022 3.636-2.11 7.594-3.166 11.87-3.166 2.852 0 5.668.533 8.447 1.595l.316.12c.174.065.348.1.478.174.13.074.217.148.26.22l-.434.868c-.13-.065-.26-.13-.434-.174l-.26-.087c-2.61-.976-5.32-1.465-8.143-1.465-4.06 0-7.775.977-11.157 2.93-.131.075-.218.131-.291.163z"/>
                     <path d="M.131 12L.045 5.98v12.04L.131 12z"/>
                     <path d="M23.855 12c0-.855-.855-1.595-2.565-2.22l-.348-.131v4.702l.348-.131c1.71-.625 2.565-1.365 2.565-2.22z"/>
                   </svg>
                   Continue with Amazon
                 </button>
               </div>

                             {/* Login Link */}
               <div className="text-center pt-2">
                 <p className="text-gray-600 text-sm">
                   Already have an account?{' '}
                   <button
                     type="button"
                     onClick={navigateToLogin}
                     className="text-[#3B4A6B] hover:text-[#2d3a52] font-semibold hover:underline transition-colors"
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
                    className="bg-red-50 border border-red-200 rounded-xl p-4 text-center"
                  >
                    <p className="text-red-600 text-sm">{errorMessage}</p>
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