import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Mail, 
  Eye, 
  EyeOff, 
  Lock, 
  ArrowRight,
  Loader2
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

import { useDispatch } from 'react-redux';
import { loginSuccess } from '../redux/slices/authSlice.js';
import stripeService from '../services/stripeService';
import googleAuthService from '../services/googleAuthService.js';

const Login = () => {
    const [showPassword, setShowPassword] = useState(false);
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [rememberMe, setRememberMe] = useState(false);
    const [errors, setErrors] = useState({ email: false, password: false });
    const [loading, setLoading] = useState(false);
    const [googleLoading, setGoogleLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState('');
    const navigate = useNavigate();
    const dispatch = useDispatch();

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const handleGoogleSignIn = async () => {
        setGoogleLoading(true);
        try {
            const response = await googleAuthService.handleGoogleSignIn();
            
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
            }
        } catch (error) {
            console.error('Google sign-in failed:', error);
            setErrorMessage(error.response?.data?.message || 'Google sign-in failed. Please try again.');
        } finally {
            setGoogleLoading(false);
        }
    };

    const navigateToSignup = () => {
        navigate('/sign-up');
    };

    const navigateToForgotPassword = () => {
        navigate('/verify-email-for-password-reset');
    };

    const validateEmail = (email) => {
        // Basic email regex validation
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);

        const emailError = email.trim() === "" || !validateEmail(email);
        const passwordError = password.trim() === "" || password.length < 8;

        setErrors({
            email: emailError,
            password: passwordError,
        });

        if (emailError || passwordError) {
            setLoading(false);
            return;
        }

        try {
            const response = await axios.post(
                `${import.meta.env.VITE_BASE_URI}/app/login`,
                { email, password },
                { withCredentials: true }
            );

            if (response.status === 200) {
                dispatch(loginSuccess(response.data.data));
                setEmail("");
                setPassword("");
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
                
                setLoading(false);
            }
        } catch (error) {
            setLoading(false);
            setEmail("");
            setPassword("");
            setErrorMessage(error.response?.data?.message);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-b from-gray-50 via-white to-white flex items-center justify-center">
            {/* Background Elements */}
            <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))] dark:bg-grid-slate-700/25 dark:[mask-image:linear-gradient(0deg,rgba(255,255,255,0.1),rgba(255,255,255,0.5))]"></div>
            <div className="absolute top-10 right-10 w-72 h-72 bg-gray-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
            <div className="absolute top-40 left-10 w-72 h-72 bg-emerald-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-2000"></div>
            
            {/* Form Section */}
            <div className="relative w-full flex items-center justify-center px-4 py-8 lg:py-16">
                <div className="w-full max-w-lg">
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6 }}
                        className="bg-white rounded-2xl border border-gray-200 shadow-xl p-10"
                    >
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
                                    className="h-12 w-auto"
                                />
                            </motion.div>
                            <h1 className="text-2xl lg:text-3xl font-bold text-gray-900 mb-2">
                                Welcome Back
                            </h1>
                            <p className="text-gray-600">
                                Sign in to continue optimizing your Amazon business
                            </p>
                        </div>

                        {/* Form */}
                        <form onSubmit={handleSubmit} className="space-y-6">
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
                                        value={email}
                                        onChange={(e) => {
                                            setEmail(e.target.value);
                                            if (errors.email && e.target.value.trim() !== "") {
                                                setErrors(prev => ({ ...prev, email: false }));
                                            }
                                        }}
                                        className={`w-full pl-10 pr-4 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300 ${
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
                                        Please enter a valid email address
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
                                        value={password}
                                        onChange={(e) => {
                                            setPassword(e.target.value);
                                            if (errors.password && e.target.value.trim().length >= 8) {
                                                setErrors(prev => ({ ...prev, password: false }));
                                            }
                                        }}
                                        className={`w-full pl-10 pr-12 py-3 border rounded-xl focus:outline-none focus:ring-2 focus:ring-[#3B4A6B] focus:border-transparent transition-all duration-300 ${
                                            errors.password ? 'border-red-500 bg-red-50' : 'border-gray-300 hover:border-gray-400'
                                        }`}
                                        placeholder="Enter your password"
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
                                        Password must be at least 8 characters
                                    </motion.p>
                                )}
                            </div>

                            {/* Remember Me and Forgot Password */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <input
                                        type="checkbox"
                                        id="remember"
                                        checked={rememberMe}
                                        onChange={(e) => setRememberMe(e.target.checked)}
                                        className="w-4 h-4 text-[#3B4A6B] bg-gray-100 border-gray-300 rounded focus:ring-[#3B4A6B] focus:ring-2"
                                    />
                                    <label htmlFor="remember" className="text-sm text-gray-700">
                                        Remember me
                                    </label>
                                </div>
                                <button
                                    type="button"
                                    onClick={navigateToForgotPassword}
                                    className="text-sm text-[#3B4A6B] hover:text-[#2d3a52] font-medium hover:underline transition-colors"
                                >
                                    Forgot password?
                                </button>
                            </div>

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={loading}
                                className={`w-full py-4 px-6 rounded-xl font-semibold text-lg transition-all duration-300 flex items-center justify-center gap-2 ${
                                    loading
                                        ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-[#3B4A6B] to-[#333651] text-white hover:from-[#2d3a52] hover:to-[#2a2e42] shadow-lg hover:shadow-xl'
                                }`}
                            >
                                {loading ? (
                                    <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                    <>
                                        Sign In
                                        <ArrowRight className="w-5 h-5" />
                                    </>
                                )}
                            </button>

                            {/* Divider */}
                            <div className="flex items-center my-6">
                                <div className="flex-1 border-t border-gray-300"></div>
                                <span className="mx-4 text-gray-500 text-sm font-medium">Or continue with</span>
                                <div className="flex-1 border-t border-gray-300"></div>
                            </div>

                            {/* Social Buttons */}
                            <div className="space-y-3">
                                <button
                                    type="button"
                                    onClick={handleGoogleSignIn}
                                    disabled={googleLoading}
                                    className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-gray-300 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all duration-300 font-medium"
                                >
                                    {googleLoading ? (
                                        <Loader2 className="w-5 h-5 animate-spin" />
                                    ) : (
                                        <>
                                            <svg className="w-5 h-5" viewBox="0 0 24 24">
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
                                    className="w-full flex items-center justify-center gap-3 py-3 px-4 border border-gray-300 rounded-xl hover:bg-gray-50 hover:border-gray-400 transition-all duration-300 font-medium"
                                >
                                    <svg className="w-5 h-5" viewBox="0 0 24 24" fill="#FF9900">
                                        <path d="M.045 18.02c.072-.116.187-.124.348-.022 3.636 2.11 7.594 3.166 11.87 3.166 2.852 0 5.668-.533 8.447-1.595l.316-.12c.174-.065.348-.1.478-.174.13-.074.217-.148.26-.22l-.434-.868c-.13.065-.26.13-.434.174l-.26.087c-2.61.976-5.32 1.465-8.143 1.465-4.06 0-7.775-.977-11.157-2.93-.131-.075-.218-.131-.291-.163z"/>
                                        <path d="M.045 5.98c.072.116.187.124.348.022 3.636-2.11 7.594-3.166 11.87-3.166 2.852 0 5.668.533 8.447 1.595l.316.12c.174.065.348.1.478.174.13.074.217.148.26.22l-.434.868c-.13-.065-.26-.13-.434-.174l-.26-.087c-2.61-.976-5.32-1.465-8.143-1.465-4.06 0-7.775.977-11.157 2.93-.131.075-.218.131-.291.163z"/>
                                        <path d="M.131 12L.045 5.98v12.04L.131 12z"/>
                                        <path d="M23.855 12c0-.855-.855-1.595-2.565-2.22l-.348-.131v4.702l.348-.131c1.71-.625 2.565-1.365 2.565-2.22z"/>
                                    </svg>
                                    Continue with Amazon
                                </button>
                            </div>

                            {/* Sign Up Link */}
                            <div className="text-center pt-4">
                                <p className="text-gray-600 text-sm">
                                    Don't have an account?{' '}
                                    <button
                                        type="button"
                                        onClick={navigateToSignup}
                                        className="text-[#3B4A6B] hover:text-[#2d3a52] font-semibold hover:underline transition-colors"
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

export default Login;