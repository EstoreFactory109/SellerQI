import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Mail, Lock, ArrowRight, Loader2, AlertCircle, X } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import axiosInstance from '../../config/axios.config.js';
import { useDispatch } from 'react-redux';
import { loginSuccess } from '../../redux/slices/authSlice.js';
import { clearAuthCache } from '../../utils/authCoordinator.js';

export default function AgencyLogin() {
  const [formData, setFormData] = useState({ email: '', password: '' });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const navigate = useNavigate();
  const dispatch = useDispatch();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const isAuth = localStorage.getItem('isAuth') === 'true';
    if (isAuth) {
      const userStr = localStorage.getItem('userAccessType');
      if (userStr === 'enterpriseAdmin') {
        navigate('/manage-agency-users', { replace: true });
      }
    }
  }, [navigate]);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setErrors((prev) => ({ ...prev, [name]: '' }));
    if (errorMessage) setErrorMessage('');
  };

  const handleFocus = (e) => {
    setErrors((prev) => ({ ...prev, [e.target.name]: '' }));
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
    if (!validateForm()) return;
    setIsLoading(true);
    setErrorMessage('');
    try {
      const response = await axiosInstance.post('/app/login', {
        email: formData.email,
        password: formData.password,
      });

      if (response.status === 200) {
        clearAuthCache();
        const user = response.data.data;
        const isAgency = user?.packageType === 'AGENCY' || user?.accessType === 'enterpriseAdmin';

        if (!isAgency) {
          setErrorMessage('Only agency accounts can log in here. Use the main login page for seller accounts.');
          setIsLoading(false);
          return;
        }

        localStorage.setItem('isAuth', 'true');
        localStorage.setItem('userAccessType', 'enterpriseAdmin');
        // Also set admin context for agency admin detection in client views
        localStorage.setItem('isAdminAuth', 'true');
        localStorage.setItem('adminAccessType', 'enterpriseAdmin');
        dispatch(loginSuccess({ user, token: 'stored_in_cookies' }));
        navigate('/manage-agency-users');
      }
    } catch (err) {
      if (err.response?.status === 401) {
        if (err.response?.data?.message === 'User not verified') {
          navigate('/verify-email', { state: { email: formData.email } });
          return;
        }
        setErrorMessage(err.response?.data?.message || 'Invalid email or password.');
      } else if (err.response?.status === 403) {
        setErrorMessage('Account is disabled. Please contact support.');
      } else if (err.response?.status === 404) {
        setErrorMessage('No agency account found with this email. Please sign up first.');
      } else {
        setErrorMessage(err.response?.data?.message || 'Login failed. Please try again.');
      }
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
                Sign in to your agency account
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
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

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Password
                </label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type={showPassword ? 'text' : 'password'}
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

              <div className="flex justify-end">
                <Link
                  to="/verify-email-for-password-reset"
                  className="text-sm text-blue-400 hover:text-blue-300 font-medium hover:underline transition-colors"
                >
                  Forgot your password?
                </Link>
              </div>

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

              <div className="text-center pt-2 space-y-2">
                <p className="text-gray-500 text-sm">
                  Don&apos;t have an agency account?{' '}
                  <Link
                    to="/agency-sign-up"
                    className="text-blue-400 hover:text-blue-300 font-semibold hover:underline transition-colors"
                  >
                    Sign up
                  </Link>
                </p>
              </div>

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
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
