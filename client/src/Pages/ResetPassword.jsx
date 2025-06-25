import React, { useState, useEffect } from 'react'
import Hidden from '../assets/Icons/hidden.png'
import Show from '../assets/Icons/show.png'
import Right from '../Components/Forms/Right'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import BeatLoader from "react-spinners/BeatLoader";
import RingLoader from "react-spinners/RingLoader";
import { motion, AnimatePresence } from 'framer-motion';
import { useParams } from 'react-router-dom';

const ResetPassword = () => {
    const [newPasswordStatus, setNewPasswordStatus] = useState("password");
    const [confirmPasswordStatus, setConfirmPasswordStatus] = useState("password");
    const [newPassword, setNewPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [errors, setErrors] = useState({ newPassword: false, confirmPassword: false, mismatch: false });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [success, setSuccess] = useState(false);
    const [verifyingCode, setVerifyingCode] = useState(true);
    const [resetCode, setResetCode] = useState("");
    const navigate = useNavigate();
    const {code} = useParams();

    useEffect(() => {
        const verifyResetCode = async () => {
           
            
            
            if (!code) {
                // No code in params, navigate to error page with 404
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
                    // Add delay to allow the slide-up animation to complete
                    setTimeout(() => {
                        setVerifyingCode(false);
                    }, 100);
                }
            } catch (error) {
                // Invalid code, navigate to error page
                navigate('/error?status=404');
            }
        };
        
        verifyResetCode();
    }, [navigate]);

    const changeNewPasswordStatus = () => {
        setNewPasswordStatus(prev => prev === "password" ? "text" : "password");
    };

    const changeConfirmPasswordStatus = () => {
        setConfirmPasswordStatus(prev => prev === "password" ? "text" : "password");
    };

    const NavigateToLogin = () => {
        navigate('/login');
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setError(null);

        const newPasswordError = newPassword.trim() === "" || newPassword.length < 8;
        const confirmPasswordError = confirmPassword.trim() === "" || confirmPassword.length < 8;
        const mismatchError = newPassword !== confirmPassword;

        setErrors({
            newPassword: newPasswordError,
            confirmPassword: confirmPasswordError,
            mismatch: mismatchError && !newPasswordError && !confirmPasswordError,
        });

        if (newPasswordError || confirmPasswordError || mismatchError) {
            setLoading(false);
            if (mismatchError && !newPasswordError && !confirmPasswordError) {
                setError("Passwords do not match");
            }
            return;
        }

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
                setSuccess(true);
                setLoading(false);
                setNewPassword("");
                setConfirmPassword("");
                setTimeout(() => {
                    navigate('/');
                }, 2000);
            }
        } catch (error) {
            setLoading(false);
            setError(error.response?.data?.message || "Failed to reset password. Please try again.");
        }
    };

    return (
        <div className="w-screen h-screen flex font-roboto">
            <AnimatePresence>
                {verifyingCode && (
                    <motion.div
                        key="loader"
                        initial={{ y: 0 }}
                        animate={{ y: 0 }}
                        exit={{ y: "-100%" }}
                        transition={{ duration: 0.8, ease: "easeInOut" }}
                        className="fixed inset-0 z-50 bg-white flex justify-center items-center"
                    >
                        <div className="flex flex-col items-center gap-6">
                            <RingLoader 
                                color="#111827" 
                                size={80} 
                                speedMultiplier={1.2}
                            />
                            <p className="text-gray-700 text-lg font-medium">Verifying your reset code...</p>
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
            
            {/* Main Content */}
            <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: verifyingCode ? 0 : 1 }}
                transition={{ duration: 0.5, delay: verifyingCode ? 0 : 0.8 }}
                className="w-full h-full flex"
            >
                {/* Left Section */}
                <section className="w-1/2 h-full flex flex-col justify-center items-center p-6">
                    <motion.form 
                        className="w-4/5" 
                        onSubmit={handleSubmit}
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: verifyingCode ? 20 : 0, opacity: verifyingCode ? 0 : 1 }}
                        transition={{ duration: 0.5, delay: verifyingCode ? 0 : 1 }}
                    >
                        <h1 className="text-2xl font-semibold mb-6">Reset Password</h1>
                        
                        {success && (
                            <div className="w-full p-3 mb-4 bg-green-100 text-green-700 rounded-md">
                                Password reset successfully! Redirecting to login...
                            </div>
                        )}

                        <label className="block">New Password</label>
                        <div className={`flex items-center border rounded-md mt-2 mb-4 p-2 gap-2 ${errors.newPassword ? 'border-red-500' : 'border-black'}`}>
                            <input
                                type={newPasswordStatus}
                                name="newPassword"
                                value={newPassword}
                                onChange={(e) => {
                                    setNewPassword(e.target.value);
                                    if (errors.newPassword && e.target.value.trim().length >= 8) {
                                        setErrors(prev => ({ ...prev, newPassword: false }));
                                    }
                                    if (errors.mismatch && e.target.value === confirmPassword) {
                                        setErrors(prev => ({ ...prev, mismatch: false }));
                                        setError(null);
                                    }
                                }}
                                placeholder="Enter Your New Password"
                                className="w-full bg-transparent border-none outline-none"
                            />
                            <div onClick={changeNewPasswordStatus}>
                                {
                                    newPasswordStatus === "password"
                                        ? <img src={Hidden} className="w-5 h-5 opacity-50 cursor-pointer" alt="Password Icon" />
                                        : <img src={Show} className="w-5 h-5 opacity-50 cursor-pointer" alt="Password Icon" />
                                }
                            </div>
                        </div>

                        <label className="block">Confirm Password</label>
                        <div className={`flex items-center border rounded-md p-2 mt-2 mb-4 gap-2 ${errors.confirmPassword || errors.mismatch ? 'border-red-500' : 'border-black'}`}>
                            <input
                                type={confirmPasswordStatus}
                                name="confirmPassword"
                                value={confirmPassword}
                                onChange={(e) => {
                                    setConfirmPassword(e.target.value);
                                    if (errors.confirmPassword && e.target.value.trim().length >= 8) {
                                        setErrors(prev => ({ ...prev, confirmPassword: false }));
                                    }
                                    if (errors.mismatch && e.target.value === newPassword) {
                                        setErrors(prev => ({ ...prev, mismatch: false }));
                                        setError(null);
                                    }
                                }}
                                placeholder="Confirm Your New Password"
                                className="w-full bg-transparent border-none outline-none"
                            />
                            <div onClick={changeConfirmPasswordStatus}>
                                {
                                    confirmPasswordStatus === "password"
                                        ? <img src={Hidden} className="w-5 h-5 opacity-50 cursor-pointer" alt="Password Icon" />
                                        : <img src={Show} className="w-5 h-5 opacity-50 cursor-pointer" alt="Password Icon" />
                                }
                            </div>
                        </div>

                        <div className="text-sm text-gray-600 mb-4">
                            Password must be at least 8 characters long
                        </div>

                        <button
                            type="submit"
                            className="w-full py-3 font-semibold bg-gray-900 text-white cursor-pointer active:scale-95"
                            disabled={success}
                        >
                            {loading ? <BeatLoader color="white" size={8} /> : <p>Reset Password</p>}
                        </button>

                        <div className="w-full flex justify-center items-center mt-4 font-light">
                            <p>
                                Remember your password? <span className="font-semibold cursor-pointer hover:underline" onClick={NavigateToLogin}>Login</span>
                            </p>
                        </div>

                        {error && <div className="text-red-500 py-3 w-full flex justify-center">
                            <p>
                                {error}
                            </p>
                        </div>}
                    </motion.form>
                </section>

                {/* Right Section */}
                <Right />
            </motion.div>
        </div>
    )
}

export default ResetPassword