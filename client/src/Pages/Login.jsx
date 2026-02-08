import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Mail, Lock, ArrowRight, Loader2, AlertCircle, CheckCircle, X } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import axiosInstance from '../config/axios.config.js';
import { useDispatch } from 'react-redux';
import { loginSuccess } from '../redux/slices/authSlice.js';
import { clearAuthCache } from '../utils/authCoordinator.js';
import googleAuthService from '../services/googleAuthService.js';
import { isSpApiConnected, isAdsAccountConnected } from '../utils/spApiConnectionCheck.js';

export default function Login() {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const navigate = useNavigate();
  const dispatch = useDispatch();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // Check if user is already logged in
    const isAuthenticated = localStorage.getItem('isAuth') === 'true';
    if (isAuthenticated) {
      // Redirect to analyse-account page - it will handle dashboard access based on analysis status
      navigate('/analyse-account');
    }
  }, [navigate]);

  // Auto-dismiss error messages after 5 seconds
  useEffect(() => {
    if (errorMessage) {
      const timer = setTimeout(() => {
        setErrorMessage('');
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [errorMessage]);

  // Auto-dismiss success messages after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => {
        setSuccessMessage('');
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
    // Clear error when user starts typing
    if (errors[name]) {
      setErrors(prev => ({
        ...prev,
        [name]: ''
      }));
    }
    // Also clear general error message when user starts typing
    if (errorMessage) {
      setErrorMessage('');
    }
  };

  const handleFocus = (e) => {
    setErrors({ ...errors, [e.target.name]: '' });
  };

  const validateForm = () => {
    const newErrors = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    
    if (!formData.password) {
      newErrors.password = 'Password is required';
    }
    
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      return;
    }

    setIsLoading(true);
    
    try {
      const response = await axiosInstance.post('/app/login', {
        email: formData.email,
        password: formData.password
      });

      if (response.status === 200) {
        // Clear any cached auth state to force fresh checks
        clearAuthCache();
        
        // Store auth data
        localStorage.setItem('isAuth', 'true');
        
        // Update Redux state - the user data is in response.data.data
        dispatch(loginSuccess({
          user: response.data.data,
          token: 'stored_in_cookies' // Token is stored in HTTP-only cookies
        }));

        // Check if accounts are connected
        const user = response.data.data;
        console.log("user: ",user);
        
        const spApiConnected = isSpApiConnected(user);
        const isSuperAdmin = user?.accessType === 'superAdmin';
        const adsAccountConnected = isAdsAccountConnected(user);
        
        console.log('Login: spApiConnected:', spApiConnected, 'adsAccountConnected:', adsAccountConnected, 'isSuperAdmin:', isSuperAdmin);
        
        // Flow: Super admins always go to dashboard. Regular users go to analyse-account page.
        if (isSuperAdmin) {
          // Super admin → redirect to dashboard directly
          console.log('Login: Super admin - redirecting to dashboard');
          navigate('/seller-central-checker/dashboard');
        } else if (spApiConnected && adsAccountConnected) {
          // Both accounts connected → redirect to analyse-account page
          // Dashboard access will be determined by FirstAnalysisDone status on that page
          console.log('Login: Both accounts connected - redirecting to analyse-account');
          navigate('/analyse-account');
        } else {
          // Accounts not connected → redirect to connect-to-amazon (payment handled later)
          console.log('Login: Accounts not connected - redirecting to connect-to-amazon');
          navigate('/connect-to-amazon');
        }
      }
    } catch (error) {
      console.error('Login error:', error);
      console.log("error.response?.data?.message: ",error.response?.data?.message);
      if (error.response?.status === 401) {
        if(error.response?.data?.message === "User not verified"){
          navigate('/verify-email', { state: { email: formData.email } });
        } else if(error.response?.data?.message === "Seller central not found"){
          // Accounts not connected → redirect to connect-to-amazon (payment handled later)
          localStorage.setItem('isAuth', 'true');
          navigate('/connect-to-amazon');
        } else {
          // Handle wrong password or invalid credentials
          setErrorMessage(error.response?.data?.message || 'Invalid email or password. Please try again.');
        }
      } else if (error.response?.status === 403) {
        setErrorMessage('Account is disabled. Please contact support.');
      } else if (error.response?.status === 404) {
        setErrorMessage('User not found. Please check your email or sign up.');
      } else {
        setErrorMessage(error.response?.data?.message || 'Login failed. Please try again.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const navigateToSignUp = () => {
    navigate('/sign-up');
  };

  const handleGoogleLogin = async () => {
    setGoogleLoading(true);
    try {
      const response = await googleAuthService.handleGoogleSignIn();
      console.log("response: ",response.statusCode);
      if (response.statusCode === 200) {
        // Clear any cached auth state to force fresh checks
        clearAuthCache();
        
        // Store auth information
        localStorage.setItem("isAuth", "true");
        dispatch(loginSuccess(response.data || response));
        
        // Check if accounts are connected
        const user = response.data || response;
        const spApiConnected = isSpApiConnected(user);
        const adsAccountConnected = isAdsAccountConnected(user);
        const isSuperAdmin = user?.accessType === 'superAdmin';
        
        console.log('Google Login: spApiConnected:', spApiConnected, 'adsAccountConnected:', adsAccountConnected, 'isSuperAdmin:', isSuperAdmin);
        
        // Flow: Super admins always go to dashboard. Regular users go to analyse-account page.
        if (isSuperAdmin) {
          // Super admin → redirect to dashboard directly
          console.log('Google Login: Super admin - redirecting to dashboard');
          navigate('/seller-central-checker/dashboard');
        } else if (spApiConnected && adsAccountConnected) {
          // Both accounts connected → redirect to analyse-account page
          // Dashboard access will be determined by FirstAnalysisDone status on that page
          console.log('Google Login: Both accounts connected - redirecting to analyse-account');
          navigate('/analyse-account');
        } else {
          // Accounts not connected → redirect to connect-to-amazon (payment handled later)
          console.log('Google Login: Accounts not connected - redirecting to connect-to-amazon');
          navigate('/connect-to-amazon');
        }
        
      }
    } catch (error) {
      console.error('Google login failed:', error);
      setErrorMessage(error.response?.data?.message || 'Google login failed. Please try again.');
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleAmazonLogin = () => {
    // TODO: Implement Amazon login functionality
    // For now, show a message that this feature is coming soon
    setErrorMessage('Amazon login is coming soon. Please use email login or Google login for now.');
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
                Welcome Back
              </h1>
              <p className="text-gray-500 text-sm">
                Sign in to your SellerQI account
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
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
                    className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300 ${
                      errors.email ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
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
                    className={`w-full pl-10 pr-12 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300 ${
                      errors.password ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
                    }`}
                    placeholder="Enter your password"
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
                    className="text-red-500 text-xs mt-1"
                  >
                    {errors.password}
                  </motion.p>
                )}
              </div>

              {/* Forgot Password Link */}
              <div className="flex justify-end">
                <Link 
                  to="/verify-email-for-password-reset" 
                  className="text-sm text-blue-400 hover:text-blue-300 font-medium hover:underline transition-colors"
                >
                  Forgot your password?
                </Link>
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
                  isLoading
                    ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-500'
                }`}
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    Sign In
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
                  onClick={handleGoogleLogin}
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

                {/*<button
                  type="button"
                  onClick={handleAmazonLogin}
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

              {/* Sign Up Link */}
              <div className="text-center pt-2 space-y-2">
                <p className="text-gray-500 text-sm">
                  Don't have an account?{' '}
                  <button
                    type="button"
                    onClick={navigateToSignUp}
                    className="text-blue-400 hover:text-blue-300 font-semibold hover:underline transition-colors"
                  >
                    Sign up
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
                        <p className="text-red-300 font-medium text-sm">Login Failed</p>
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

              {/* Success Message */}
              <AnimatePresence>
                {successMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="bg-green-500/10 border border-green-500/40 rounded-xl p-4"
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-green-400" />
                      <p className="text-green-300 text-sm font-medium">{successMessage}</p>
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
}