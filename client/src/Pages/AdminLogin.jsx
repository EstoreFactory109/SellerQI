import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Eye, EyeOff, Mail, Lock, ArrowRight, Loader2, Shield, Crown } from 'lucide-react';
import { useNavigate, Link } from 'react-router-dom';
import axiosInstance from '../config/axios.config.js';

export default function AdminLogin() {
  const [formData, setFormData] = useState({
    email: '',
    password: ''
  });
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

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
  };

  const handleFocus = (e) => {
    setErrors({ ...errors, [e.target.name]: '' });
    setErrorMessage('');
  };

  const validateForm = () => {
    const newErrors = {};
    
    // Email validation
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!/\S+@\S+\.\S+/.test(formData.email)) {
      newErrors.email = 'Please enter a valid email address';
    }
    
    // Password validation
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (formData.password.length < 6) {
      newErrors.password = 'Password must be at least 6 characters';
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
    setErrorMessage('');
    
    try {
      const response = await axiosInstance.post('/app/auth/admin-login', {
        email: formData.email.toLowerCase().trim(),
        password: formData.password
      });
      
      if (response.data.statusCode === 200) {
        // Handle successful admin login
        localStorage.setItem('isAdminAuth', 'true');
        localStorage.setItem('adminAccessType', response.data.data.accessType);
        localStorage.setItem('adminId', response.data.data.adminId);
        
        // Debug: Log what we're storing
        console.log('🔍 Admin Login Debug - Storing:', {
          isAdminAuth: 'true',
          adminAccessType: response.data.data.accessType,
          adminId: response.data.data.adminId,
          fullResponse: response.data.data
        });
        
        navigate('/manage-accounts');
      }
    } catch (error) {
      console.error('Admin login error:', error);
      setErrorMessage(error.response?.data?.message || 'Admin login failed. Please check your credentials.');
    } finally {
      setIsLoading(false);
    }
  };

  const navigateToUserLogin = () => {
    navigate('/');
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
            className="bg-[#161b22] rounded-lg border border-[#30363d] shadow-lg p-8 relative"
          >
            {/* Admin Badge Overlay */}
            <div className="absolute top-0 right-0 bg-[#21262d] border-b border-l border-[#30363d] text-gray-300 px-4 py-2 rounded-bl-lg rounded-tr-lg">
              <div className="flex items-center gap-1.5">
                <Crown className="w-4 h-4 text-purple-400" />
                <span className="text-xs font-semibold">ADMIN</span>
              </div>
            </div>

            {/* Logo and Header */}
            <div className="text-center mb-8">
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="flex justify-center mb-6"
              >
                <img 
                  src="https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png" 
                  alt="SellerQI Logo" 
                  className="h-10 w-auto"
                />
              </motion.div>
              <h1 className="text-2xl font-semibold text-gray-100 mb-2">
                Admin Portal
              </h1>
              <p className="text-gray-400 text-sm">
                Secure access for system administrators
              </p>
            </div>

            {/* Form */}
            <form onSubmit={handleSubmit} className="space-y-4">
              
              {/* Email Field */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">
                  Admin Email Address
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    onFocus={handleFocus}
                    className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 text-gray-100 ${
                      errors.email ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-[#40464e]'
                    }`}
                    placeholder="Enter your admin email"
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
                    className={`w-full pl-10 pr-12 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 text-gray-100 ${
                      errors.password ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-[#40464e]'
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

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isLoading}
                className={`w-full py-3 px-6 rounded-lg font-medium transition-all duration-200 flex items-center justify-center gap-2 ${
                  isLoading
                    ? 'bg-[#21262d] text-gray-500 cursor-not-allowed border border-[#30363d]'
                    : 'bg-blue-600 text-white hover:bg-blue-500 border border-blue-600 hover:border-blue-500'
                }`}
              >
                {isLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin" />
                ) : (
                  <>
                    <Shield className="w-5 h-5" />
                    Admin Sign In
                    <ArrowRight className="w-5 h-5" />
                  </>
                )}
              </button>

              {/* User Login Link */}
              <div className="text-center pt-2">
                <p className="text-gray-400 text-sm">
                  Not an admin?{' '}
                  <button
                    type="button"
                    onClick={navigateToUserLogin}
                    className="text-blue-400 hover:text-blue-300 font-medium hover:underline transition-colors"
                  >
                    User Login
                  </button>
                </p>
              </div>

              {/* Security Notice */}
              <div className="bg-[#21262d] border border-[#30363d] rounded-lg p-4 text-center">
                <div className="flex items-center justify-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-300 font-medium text-sm">Secure Access</span>
                </div>
                <p className="text-gray-400 text-xs">
                  This portal requires administrator credentials. All access attempts are logged for security purposes.
                </p>
              </div>

              {/* Error Message */}
              <AnimatePresence>
                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="bg-red-500/10 border border-red-500/30 rounded-xl p-4 text-center"
                  >
                    <p className="text-red-400 text-sm font-medium">{errorMessage}</p>
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
