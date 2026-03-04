import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Mail, ArrowRight, Loader2, Shield, Key, CheckCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';

const EmailVerificationForNewPassword = () => {
    const [email, setEmail] = useState("");
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const [message, setMessage] = useState("");
    const [errorMessage, setErrorMessage] = useState("");

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }, []);

    const validateEmail = (email) => {
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    };

    const handleChange = (e) => {
        setEmail(e.target.value);
        if (errors.email) {
            setErrors({ ...errors, email: '' });
        }
    };

    const handleFocus = () => {
        setErrors({ ...errors, email: '' });
        setErrorMessage('');
        setMessage('');
    };

    const validateForm = () => {
        const newErrors = {};
        
        if (!email.trim()) {
            newErrors.email = 'Email is required';
        } else if (!validateEmail(email)) {
            newErrors.email = 'Please enter a valid email address';
        }
        
        setErrors(newErrors);
        return Object.keys(newErrors).length === 0;
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        
        if (!validateForm()) {
            return;
        }

        setLoading(true);
        setMessage("");
        setErrorMessage("");

        try {
            const response = await axios.post(
                `${import.meta.env.VITE_BASE_URI}/app/verify-email-for-password-reset`,
                { email },
                { withCredentials: true }
            );

            if (response.status === 200) {
                setMessage("Password reset link has been sent to your email. Please check your inbox.");
                setEmail("");
            }
        } catch (error) {
            setErrorMessage(error.response?.data?.message || 'Failed to send reset link. Please try again.');
            setEmail("");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center relative overflow-hidden">
            {/* Form Section */}
            <div className="relative w-full flex items-center justify-center px-4 py-4 lg:py-8">
                <div className="w-full max-w-lg">
                    <motion.div
                        initial={{ opacity: 0, y: 30, scale: 0.9 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ duration: 0.8, type: "spring", stiffness: 100 }}
                        className="bg-[#161b22] rounded-3xl border border-[#30363d] p-8 relative overflow-hidden"
                    >
                        {/* Logo and Header */}
                        <div className="relative text-center mb-8">
                            {/* Security Badge */}
                            <motion.div
                                initial={{ scale: 0, rotate: -180 }}
                                animate={{ scale: 1, rotate: 0 }}
                                transition={{ delay: 0.3, type: "spring", stiffness: 200 }}
                                className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-blue-500 to-blue-600 rounded-full mb-6 shadow-lg"
                            >
                                <Shield className="w-10 h-10 text-white" />
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: 1, scale: 1 }}
                                transition={{ duration: 0.5, delay: 0.5 }}
                                className="flex justify-center mb-4"
                            >
                                <img 
                                    src="https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png" 
                                    alt="SellerQI Logo" 
                                    className="h-8 w-auto opacity-90"
                                />
                            </motion.div>
                            
                            <motion.h1
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.6, duration: 0.6 }}
                                className="text-2xl lg:text-3xl font-bold text-gray-100 mb-3"
                            >
                                Reset Your Password
                            </motion.h1>
                            
                            <motion.p
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.7, duration: 0.6 }}
                                className="text-gray-500 text-sm leading-relaxed max-w-sm mx-auto"
                            >
                                Don't worry, it happens! Enter your email and we'll send you a secure link to create a new password.
                            </motion.p>
                            
                            {/* Security Features */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 0.8, duration: 0.6 }}
                                className="flex items-center justify-center gap-6 mt-4 text-xs text-gray-500"
                            >
                                <div className="flex items-center gap-1">
                                    <Key className="w-3 h-3 text-blue-400" />
                                    <span>Secure</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3 text-blue-400" />
                                    <span>Encrypted</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Shield className="w-3 h-3 text-blue-400" />
                                    <span>Protected</span>
                                </div>
                            </motion.div>
                        </div>

                        {/* Form */}
                        <motion.form
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: 0.9, duration: 0.6 }}
                            onSubmit={handleSubmit} 
                            className="relative space-y-6"
                        >
                            {/* Email Field */}
                            <div>
                                <motion.label
                                    initial={{ opacity: 0, x: -20 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ delay: 1, duration: 0.5 }}
                                    className="block text-sm font-semibold text-gray-300 mb-3"
                                >
                                    Email Address
                                </motion.label>
                                <motion.div
                                    initial={{ opacity: 0, scale: 0.95 }}
                                    animate={{ opacity: 1, scale: 1 }}
                                    transition={{ delay: 1.1, duration: 0.5 }}
                                    className="relative group"
                                >
                                    <Mail className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 z-10 transition-colors duration-300 group-focus-within:text-blue-400" />
                                    <input
                                        type="email"
                                        name="email"
                                        value={email}
                                        onChange={handleChange}
                                        onFocus={handleFocus}
                                        className={`relative w-full pl-12 pr-4 py-4 border-2 rounded-xl focus:outline-none focus:ring-4 focus:ring-blue-500/20 focus:border-blue-500 transition-all duration-300 bg-[#21262d] text-gray-100 placeholder-gray-500 ${
                                            errors.email 
                                                ? 'border-red-500 bg-red-500/10 focus:border-red-500 focus:ring-red-500/20' 
                                                : 'border-[#30363d] hover:border-gray-500'
                                        }`}
                                        placeholder="Enter your email address"
                                    />
                                </motion.div>
                                {errors.email && (
                                    <motion.p
                                        initial={{ opacity: 0, y: -10 }}
                                        animate={{ opacity: 1, y: 0 }}
                                        className="text-red-400 text-xs mt-2 flex items-center gap-1"
                                    >
                                        <span className="w-1 h-1 bg-red-400 rounded-full"></span>
                                        {errors.email}
                                    </motion.p>
                                )}
                            </div>

                            {/* Submit Button */}
                            <motion.button
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 1.2, duration: 0.5 }}
                                type="submit"
                                disabled={loading}
                                className={`relative w-full py-4 px-6 rounded-xl font-bold text-lg transition-all duration-300 flex items-center justify-center gap-3 overflow-hidden group ${
                                    loading
                                        ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-500 hover:to-blue-600 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30 transform hover:scale-[1.02] active:scale-[0.98]'
                                }`}
                            >
                                {!loading && (
                                    <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 -translate-x-full group-hover:translate-x-full transition-transform duration-1000"></div>
                                )}
                                <div className="relative flex items-center gap-3">
                                    {loading ? (
                                        <Loader2 className="w-6 h-6 animate-spin" />
                                    ) : (
                                        <>
                                            <Mail className="w-5 h-5" />
                                            <span>Send Reset Link</span>
                                            <ArrowRight className="w-5 h-5 transition-transform duration-300 group-hover:translate-x-1" />
                                        </>
                                    )}
                                </div>
                            </motion.button>

                            {/* Success Message */}
                            <AnimatePresence>
                                {message && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.9, y: -20 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.9, y: -20 }}
                                        className="relative bg-green-500/10 border-2 border-green-500/40 rounded-2xl p-6 text-center overflow-hidden"
                                    >
                                        <div className="relative flex items-center justify-center gap-3 mb-2">
                                            <CheckCircle className="w-6 h-6 text-green-400" />
                                            <span className="font-semibold text-green-300">Email Sent Successfully!</span>
                                        </div>
                                        <p className="text-green-400/90 text-sm leading-relaxed">{message}</p>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Error Message */}
                            <AnimatePresence>
                                {errorMessage && (
                                    <motion.div
                                        initial={{ opacity: 0, scale: 0.9, y: -20 }}
                                        animate={{ opacity: 1, scale: 1, y: 0 }}
                                        exit={{ opacity: 0, scale: 0.9, y: -20 }}
                                        className="relative bg-red-500/10 border-2 border-red-500/40 rounded-2xl p-6 text-center overflow-hidden"
                                    >
                                        <div className="relative flex items-center justify-center gap-3 mb-2">
                                            <div className="w-6 h-6 rounded-full bg-red-500 flex items-center justify-center">
                                                <span className="text-white text-sm font-bold">!</span>
                                            </div>
                                            <span className="font-semibold text-red-300">Something went wrong</span>
                                        </div>
                                        <p className="text-red-400/90 text-sm leading-relaxed">{errorMessage}</p>
                                    </motion.div>
                                )}
                            </AnimatePresence>

                            {/* Back to Login Link */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: 1.3, duration: 0.5 }}
                                className="text-center pt-4"
                            >
                                <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-[#21262d] border border-[#30363d] hover:bg-[#1c2128] transition-all duration-300">
                                    <span className="text-gray-400 text-sm">Remember your password?</span>
                                    <button
                                        type="button"
                                        onClick={() => navigate('/')}
                                        className="text-blue-400 hover:text-blue-300 font-semibold text-sm transition-colors duration-300 flex items-center gap-1 group"
                                    >
                                        Sign in
                                        <ArrowRight className="w-3 h-3 transition-transform duration-300 group-hover:translate-x-1" />
                                    </button>
                                </div>
                            </motion.div>
                        </motion.form>
                    </motion.div>
                </div>
            </div>
        </div>
    );
};

export default EmailVerificationForNewPassword;
