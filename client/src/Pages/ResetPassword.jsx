import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock, Eye, EyeOff, Shield, Key, CheckCircle, ArrowRight, Loader2 } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import axios from 'axios';
import RingLoader from "react-spinners/RingLoader";

const ResetPassword = () => {
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [errors, setErrors] = useState({});
    const [loading, setLoading] = useState(false);
    const [errorMessage, setErrorMessage] = useState("");
    const [successMessage, setSuccessMessage] = useState("");
    const [verifyingCode, setVerifyingCode] = useState(true);
    const [resetCode, setResetCode] = useState("");
    const navigate = useNavigate();
    const { code } = useParams();

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        
        const verifyResetCode = async () => {
            if (!code) {
                navigate('/error?status=404');
                return;
            }
            
            try {
                const response = await axios.post(
                    `${import.meta.env.VITE_BASE_URI}/app/verify-reset-password-code`,
                    { code }
                );
                
                if (response.status === 200) {
                    setResetCode(code);
                    setTimeout(() => {
                        setVerifyingCode(false);
                    }, 1000);
                }
            } catch (error) {
                navigate('/error?status=404');
            }
        };
        
        verifyResetCode();
    }, [code, navigate]);

    const handleChange = (e) => {
        const { name, value } = e.target;
        if (name === 'newPassword') {
            setNewPassword(value);
        } else if (name === 'confirmPassword') {
            setConfirmPassword(value);
        }
        
        // Clear errors when user starts typing
        if (errors[name]) {
            setErrors(prev => ({ ...prev, [name]: '' }));
        }
        
        // Clear mismatch error when passwords start to match
        if (name === 'newPassword' && value === confirmPassword) {
            setErrors(prev => ({ ...prev, mismatch: '' }));
        }
        if (name === 'confirmPassword' && value === newPassword) {
            setErrors(prev => ({ ...prev, mismatch: '' }));
        }
    };

    const handleFocus = (name) => {
        setErrors(prev => ({ ...prev, [name]: '' }));
        setErrorMessage('');
    };

    const validateForm = () => {
        const newErrors = {};
        const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
        
        if (!newPassword) {
            newErrors.newPassword = 'New password is required';
        } else if (!passwordRegex.test(newPassword)) {
            newErrors.newPassword = 'Password must be at least 8 characters with a letter, number, and special character';
        }
        
        if (!confirmPassword) {
            newErrors.confirmPassword = 'Please confirm your password';
        } else if (newPassword && confirmPassword && newPassword !== confirmPassword) {
            newErrors.mismatch = 'Passwords do not match';
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
        setErrorMessage('');
        setSuccessMessage('');

        try {
            const response = await axios.post(
                `${import.meta.env.VITE_BASE_URI}/app/reset-password`,
                { 
                    newPassword,
                    code 
                },
                { withCredentials: true }
            );

            if (response.status === 200) {
                setSuccessMessage("Password reset successfully! Redirecting to login...");
                setNewPassword("");
                setConfirmPassword("");
                setTimeout(() => {
                    navigate('/');
                }, 3000);
            }
        } catch (error) {
            setErrorMessage(error.response?.data?.message || "Failed to reset password. Please try again.");
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-emerald-50 relative overflow-hidden">
            {/* Loading Screen */}
            <AnimatePresence>
                {verifyingCode && (
                    <motion.div
                        key="loader"
                        initial={{ opacity: 1 }}
                        exit={{ opacity: 0, scale: 0.9 }}
                        transition={{ duration: 1, ease: "easeInOut" }}
                        className="fixed inset-0 z-50 bg-gradient-to-br from-indigo-100 via-white to-purple-100 flex justify-center items-center"
                    >
                        <motion.div
                            initial={{ scale: 0.8, opacity: 0 }}
                            animate={{ scale: 1, opacity: 1 }}
                            className="flex flex-col items-center gap-8 p-8 bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl"
                        >
                            <div className="relative">
                                <RingLoader 
                                    color="#6366f1" 
                                    size={80} 
                                    speedMultiplier={1.2}
                                />
                                <motion.div
                                    animate={{ rotate: 360 }}
                                    transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                                    className="absolute inset-0 rounded-full border-2 border-dashed border-purple-300"
                                />
                            </div>
                            <div className="text-center">
                                <h3 className="text-xl font-bold text-gray-800 mb-2">Verifying Reset Code</h3>
                                <p className="text-gray-600">Please wait while we validate your password reset link...</p>
                            </div>
                        </motion.div>
                    </motion.div>
                )}
            </AnimatePresence>

            {/* Enhanced Background Elements */}
            <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))] dark:bg-grid-slate-700/25 dark:[mask-image:linear-gradient(0deg,rgba(255,255,255,0.1),rgba(255,255,255,0.5))]"></div>
            
            {/* Animated Background Blobs */}
            <div className="absolute top-10 right-10 w-96 h-96 bg-gradient-to-br from-indigo-200 to-purple-200 rounded-full mix-blend-multiply filter blur-xl opacity-30 animate-pulse"></div>
            <div className="absolute top-60 left-10 w-80 h-80 bg-gradient-to-br from-emerald-200 to-cyan-200 rounded-full mix-blend-multiply filter blur-xl opacity-25 animate-pulse animation-delay-2000"></div>
            <div className="absolute bottom-20 right-1/4 w-64 h-64 bg-gradient-to-br from-pink-200 to-rose-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-4000"></div>
            
            {/* Floating Elements */}
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1, duration: 2 }}
                className="absolute top-20 left-20 w-4 h-4 bg-indigo-400 rounded-full blur-sm opacity-40"
            />
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 1.5, duration: 2 }}
                className="absolute top-32 right-32 w-3 h-3 bg-emerald-400 rounded-full blur-sm opacity-30"
            />
            <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 2, duration: 2 }}
                className="absolute bottom-40 left-1/4 w-2 h-2 bg-purple-400 rounded-full blur-sm opacity-50"
            />

            {/* Main Content */}
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: verifyingCode ? 0 : 1 }}
                transition={{ duration: 1, delay: verifyingCode ? 0 : 1 }}
                className="min-h-screen flex items-center justify-center px-4 py-4 lg:py-8"
            >
                <div className="w-full max-w-lg">
                    <motion.div
                        initial={{ opacity: 0, y: 30, scale: 0.9 }}
                        animate={{ opacity: verifyingCode ? 0 : 1, y: verifyingCode ? 30 : 0, scale: verifyingCode ? 0.9 : 1 }}
                        transition={{ duration: 0.8, type: "spring", stiffness: 100, delay: verifyingCode ? 0 : 1.2 }}
                        className="bg-white/90 backdrop-blur-xl rounded-3xl border border-white/20 shadow-2xl p-8 relative overflow-hidden"
                    >
                        {/* Card Background Gradient */}
                        <div className="absolute inset-0 bg-gradient-to-br from-white/40 to-white/10 rounded-3xl"></div>
                        
                        {/* Header */}
                        <div className="relative text-center mb-8">
                            {/* Security Badge */}
                            <motion.div
                                initial={{ scale: 0, rotate: -180 }}
                                animate={{ scale: verifyingCode ? 0 : 1, rotate: verifyingCode ? -180 : 0 }}
                                transition={{ delay: verifyingCode ? 0 : 1.5, type: "spring", stiffness: 200 }}
                                className="inline-flex items-center justify-center w-20 h-20 bg-gradient-to-br from-emerald-500 to-green-600 rounded-full mb-6 shadow-lg"
                            >
                                <Key className="w-10 h-10 text-white" />
                            </motion.div>

                            <motion.div
                                initial={{ opacity: 0, scale: 0.8 }}
                                animate={{ opacity: verifyingCode ? 0 : 1, scale: verifyingCode ? 0.8 : 1 }}
                                transition={{ duration: 0.5, delay: verifyingCode ? 0 : 1.7 }}
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
                                animate={{ opacity: verifyingCode ? 0 : 1, y: verifyingCode ? 20 : 0 }}
                                transition={{ delay: verifyingCode ? 0 : 1.8, duration: 0.6 }}
                                className="text-2xl lg:text-3xl font-bold bg-gradient-to-r from-gray-900 to-gray-700 bg-clip-text text-transparent mb-3"
                            >
                                Create New Password
                            </motion.h1>
                            
                            <motion.p
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: verifyingCode ? 0 : 1, y: verifyingCode ? 20 : 0 }}
                                transition={{ delay: verifyingCode ? 0 : 1.9, duration: 0.6 }}
                                className="text-gray-600 text-sm leading-relaxed max-w-sm mx-auto"
                            >
                                Choose a strong password to secure your account. Make sure it's unique and easy for you to remember.
                            </motion.p>
                            
                            {/* Security Features */}
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: verifyingCode ? 0 : 1, y: verifyingCode ? 20 : 0 }}
                                transition={{ delay: verifyingCode ? 0 : 2, duration: 0.6 }}
                                className="flex items-center justify-center gap-6 mt-4 text-xs text-gray-500"
                            >
                                <div className="flex items-center gap-1">
                                    <Lock className="w-3 h-3 text-emerald-500" />
                                    <span>Secure</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <CheckCircle className="w-3 h-3 text-indigo-500" />
                                    <span>Encrypted</span>
                                </div>
                                <div className="flex items-center gap-1">
                                    <Shield className="w-3 h-3 text-purple-500" />
                                    <span>Protected</span>
                                </div>
                            </motion.div>
                        </div>

                        {/* Form */}
                        <motion.form
                            initial={{ opacity: 0, y: 20 }}
                            animate={{ opacity: verifyingCode ? 0 : 1, y: verifyingCode ? 20 : 0 }}
                            transition={{ delay: verifyingCode ? 0 : 2.1, duration: 0.6 }}
                            onSubmit={handleSubmit} 
                            className="relative space-y-6"
                        >
                            {/* New Password Field */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-800 mb-3">
                                    New Password
                                </label>
                                <div className="relative group">
                                    <Lock className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 z-10" />
                                    <input
                                        type={showNewPassword ? "text" : "password"}
                                        name="newPassword"
                                        value={newPassword}
                                        onChange={handleChange}
                                        onFocus={() => handleFocus('newPassword')}
                                        className={`w-full pl-12 pr-12 py-4 border-2 rounded-xl focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all duration-300 bg-white/80 backdrop-blur-sm text-gray-800 placeholder-gray-400 ${
                                            errors.newPassword || errors.mismatch
                                                ? 'border-red-400 bg-red-50/80' 
                                                : 'border-gray-200 hover:border-emerald-300'
                                        }`}
                                        placeholder="Enter your new password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowNewPassword(!showNewPassword)}
                                        className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-emerald-500"
                                    >
                                        {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                    </button>
                                </div>
                                {errors.newPassword && (
                                    <p className="text-red-500 text-xs mt-2">{errors.newPassword}</p>
                                )}
                            </div>

                            {/* Confirm Password Field */}
                            <div>
                                <label className="block text-sm font-semibold text-gray-800 mb-3">
                                    Confirm Password
                                </label>
                                <div className="relative group">
                                    <Lock className="absolute left-4 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5 z-10" />
                                    <input
                                        type={showConfirmPassword ? "text" : "password"}
                                        name="confirmPassword"
                                        value={confirmPassword}
                                        onChange={handleChange}
                                        onFocus={() => handleFocus('confirmPassword')}
                                        className={`w-full pl-12 pr-12 py-4 border-2 rounded-xl focus:outline-none focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all duration-300 bg-white/80 backdrop-blur-sm text-gray-800 placeholder-gray-400 ${
                                            errors.confirmPassword || errors.mismatch
                                                ? 'border-red-400 bg-red-50/80' 
                                                : 'border-gray-200 hover:border-emerald-300'
                                        }`}
                                        placeholder="Confirm your new password"
                                    />
                                    <button
                                        type="button"
                                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                        className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-emerald-500"
                                    >
                                        {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                                    </button>
                                </div>
                                {(errors.confirmPassword || errors.mismatch) && (
                                    <p className="text-red-500 text-xs mt-2">{errors.confirmPassword || errors.mismatch}</p>
                                )}
                            </div>

                            {/* Submit Button */}
                            <button
                                type="submit"
                                disabled={loading || successMessage}
                                className={`w-full py-4 px-6 rounded-xl font-bold text-lg transition-all duration-300 flex items-center justify-center gap-3 ${
                                    loading || successMessage
                                        ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                                        : 'bg-gradient-to-r from-emerald-600 via-green-600 to-emerald-700 text-white hover:from-emerald-700 hover:via-green-700 hover:to-emerald-800 shadow-lg hover:shadow-xl'
                                }`}
                            >
                                {loading ? (
                                    <Loader2 className="w-6 h-6 animate-spin" />
                                ) : (
                                    <>
                                        <Key className="w-5 h-5" />
                                        <span>Reset Password</span>
                                        <ArrowRight className="w-5 h-5" />
                                    </>
                                )}
                            </button>

                            {/* Messages */}
                            {successMessage && (
                                <div className="bg-emerald-50 border-2 border-emerald-200 rounded-xl p-4 text-center">
                                    <div className="flex items-center justify-center gap-2 mb-2">
                                        <CheckCircle className="w-5 h-5 text-emerald-600" />
                                        <span className="font-semibold text-emerald-800">Success!</span>
                                    </div>
                                    <p className="text-emerald-700 text-sm">{successMessage}</p>
                                </div>
                            )}

                            {errorMessage && (
                                <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4 text-center">
                                    <div className="flex items-center justify-center gap-2 mb-2">
                                        <span className="font-semibold text-red-800">Error!</span>
                                    </div>
                                    <p className="text-red-700 text-sm">{errorMessage}</p>
                                </div>
                            )}

                            {/* Back to Login */}
                            <div className="text-center pt-4">
                                <button
                                    type="button"
                                    onClick={() => navigate('/')}
                                    className="text-emerald-600 hover:text-emerald-700 font-semibold text-sm transition-colors"
                                >
                                    Remember your password? Sign in
                                </button>
                            </div>
                        </motion.form>
                    </motion.div>
                </div>
            </motion.div>
        </div>
    );
};

export default ResetPassword;