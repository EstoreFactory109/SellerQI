import React, { useState } from 'react'
import Mail from '../assets/Icons/mail.png'
import Hidden from '../assets/Icons/hidden.png'
import Show from '../assets/Icons/show.png'
import Right from '../Components/Forms/Right'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import BeatLoader from "react-spinners/BeatLoader";
import {useDispatch} from 'react-redux';
import { loginSuccess } from '../redux/slices/authSlice.js';
import stripeService from '../services/stripeService';


const Login = () => {
    const [PasswordStatus, setPasswordStatus] = useState("password");
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [errors, setErrors] = useState({ email: false, password: false });
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const dispatch = useDispatch();

    


    const changePasswordStatus = () => {
        setPasswordStatus(prev => prev === "password" ? "text" : "password");
    };

    const NavigateToSignup = () => {
        navigate('/sign-up');
    };

    const NavigateToverifyEmailForResetPassword = () => {
        navigate('/verify-email-for-password-reset');
    };

    const validateEmail = (email) => {
        // Basic email regex validation
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    };
    const [Error, setError] = useState(null)
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
            // You can dispatch or navigate here
        } catch (error) {
            setLoading(false);
            setEmail("");
            setPassword("");
            setError(error.response?.data?.message);

        }
    };



    return (
        <div className="w-screen h-screen flex font-roboto">
            {/* Left Section */}
            <section className="w-1/2 h-full flex flex-col justify-center items-center p-6">
                <form className="w-4/5" onSubmit={handleSubmit}>
                    <div className='flex justify-center items-center w-full h-8 mb-3'>
                        <img src='https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png' alt='SellerQI Logo' className='w-auto h-16' />
                    </div>
                    <h1 className="text-xl font-semibold mb-4 text-center">Welcome to SellerQI</h1>

                    <label className="block text-sm">Email</label>
                    <div className={`flex items-center border rounded-md mt-1 mb-3 p-2 gap-2 ${errors.email ? 'border-red-500' : 'border-black'}`}>
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
                            placeholder="Enter Your Email"
                            className="w-full bg-transparent border-none outline-none text-sm"
                        />
                        <img src={Mail} className="w-4 h-4 opacity-50" alt="Mail Icon" />
                    </div>

                    <label className="block text-sm">Password</label>
                    <div className={`flex items-center border rounded-md p-2 mt-1 mb-3 gap-2 ${errors.password ? 'border-red-500' : 'border-black'}`}>
                        <input
                            type={PasswordStatus}
                            name="password"
                            value={password}
                            onChange={(e) => {
                                setPassword(e.target.value);
                                if (errors.password && e.target.value.trim().length >= 8) {
                                    setErrors(prev => ({ ...prev, password: false }));
                                }
                            }}
                            placeholder="Enter Your Password"
                            className="w-full bg-transparent border-none outline-none text-sm"
                        />
                        <div onClick={changePasswordStatus}>
                            {
                                PasswordStatus === "password"
                                    ? <img src={Hidden} className="w-4 h-4 opacity-50 cursor-pointer" alt="Password Icon" />
                                    : <img src={Show} className="w-4 h-4 opacity-50 cursor-pointer" alt="Password Icon" />
                            }
                        </div>
                    </div>

                    <div className="flex justify-between items-center mt-1 mb-3">
                        <div className="flex items-center gap-2">
                            <input type="checkbox" name="remember" id="remember" className="w-3 h-3" />
                            <label htmlFor="remember" className="text-xs">Remember Me</label>
                        </div>
                        <p className="text-xs cursor-pointer hover:underline" onClick={NavigateToverifyEmailForResetPassword}>Forgot Password?</p>
                    </div>

                    <button
                        type="submit"
                        className="w-full h-10 text-sm font-semibold bg-gray-900 text-white cursor-pointer active:scale-95"
                    >
                        {loading ? <BeatLoader color="white" size={8} /> : <p>Log In</p>}
                    </button>

                    {/* Divider */}
                    <div className="flex items-center my-4">
                        <div className="flex-1 border-t border-gray-300"></div>
                        <span className="mx-3 text-gray-500 text-xs">OR</span>
                        <div className="flex-1 border-t border-gray-300"></div>
                    </div>
                    
                    {/* Social Signin Buttons */}
                    <div className="mb-4 space-y-2">
                        <button 
                            type="button"
                            className="w-full flex items-center justify-center gap-2 p-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24">
                                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
                            </svg>
                            <span className="text-gray-700 text-sm font-medium">Continue with Google</span>
                        </button>
                        
                        <button 
                            type="button"
                            className="w-full flex items-center justify-center gap-2 p-2 border border-gray-300 rounded hover:bg-gray-50 transition-colors"
                        >
                            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="#FF9900">
                                <path d="M.045 18.02c.072-.116.187-.124.348-.022 3.636 2.11 7.594 3.166 11.87 3.166 2.852 0 5.668-.533 8.447-1.595l.316-.12c.174-.065.348-.1.478-.174.13-.074.217-.148.26-.22l-.434-.868c-.13.065-.26.13-.434.174l-.26.087c-2.61.976-5.32 1.465-8.143 1.465-4.06 0-7.775-.977-11.157-2.93-.131-.075-.218-.131-.291-.163z"/>
                                <path d="M.045 5.98c.072.116.187.124.348.022 3.636-2.11 7.594-3.166 11.87-3.166 2.852 0 5.668.533 8.447 1.595l.316.12c.174.065.348.1.478.174.13.074.217.148.26.22l-.434.868c-.13-.065-.26-.13-.434-.174l-.26-.087c-2.61-.976-5.32-1.465-8.143-1.465-4.06 0-7.775.977-11.157 2.93-.131.075-.218.131-.291.163z"/>
                                <path d="M.131 12L.045 5.98v12.04L.131 12z"/>
                                <path d="M23.855 12c0-.855-.855-1.595-2.565-2.22l-.348-.131v4.702l.348-.131c1.71-.625 2.565-1.365 2.565-2.22z"/>
                            </svg>
                            <span className="text-gray-700 text-sm font-medium">Continue with Amazon</span>
                        </button>
                    </div>

                                         <div className="w-full flex justify-center items-center mt-2 font-light">
                         <p className="text-xs">
                             No account yet? <span className="font-semibold cursor-pointer hover:underline" onClick={NavigateToSignup}>Signup</span>
                         </p>
                     </div>

                     {Error && <div className="text-red-500 py-2 w-full flex justify-center">
                         <p className="text-xs">
                             {Error}
                         </p>
                     </div>}
                </form>
            </section>

            {/* Right Section */}
            <Right />
        </div>
    )
}

export default Login;
