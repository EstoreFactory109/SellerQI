import React, { useState } from 'react'
import Mail from '../assets/Icons/mail.png'
import Right from '../Components/Forms/Right'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import BeatLoader from "react-spinners/BeatLoader";


const EmailVerificationForNewPassword = () => {

    const [email, setEmail] = useState("");
    const [errors, setErrors] = useState({ email: false});
    const [loading, setLoading] = useState(false);
    const navigate = useNavigate();
    const [message, setMessage] = useState("");

    const validateEmail = (email) => {
        // Basic email regex validation
        const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        return re.test(email);
    };
    
    const [Error, setError] = useState(null)
    
    const handleSubmit = async (e) => {
        e.preventDefault();
        setLoading(true);
        setMessage(""); // Clear any previous messages

        const emailError = email.trim() === "" || !validateEmail(email);

        setErrors({
            email: emailError,
        });

        if (emailError) {
            setLoading(false);
            return;
        }

        try {
            // Update this endpoint to your email verification endpoint
            const response = await axios.post(
                `${import.meta.env.VITE_BASE_URI}/app/verify-email-for-password-reset`,
                { email },
                { withCredentials: true }
            );

            if (response.status === 200) {
                setLoading(false);
                setEmail("");
                setMessage("Password reset link has been sent to your email. Please check your inbox.");
                setError(null); // Clear any previous errors
                // Navigate to next step or show success message
                // navigate('/reset-password');
            }
        } catch (error) {
            setLoading(false);
            setEmail("");
            setError(error.response?.data?.message);
            setMessage(""); // Clear success message on error

        }
    };



    return (
        <div className="w-screen h-screen flex font-roboto">
            {/* Left Section */}
            <section className="w-1/2 h-full flex flex-col justify-center items-center p-6">
                <form className="w-4/5" onSubmit={handleSubmit}>
                    <h1 className="text-2xl font-semibold mb-6">Reset Password</h1>
                    <p className="text-gray-600 mb-6">Enter your email address and we'll send you a link to reset your password.</p>

                    <label className="block">Email</label>
                    <div className={`flex items-center border rounded-md mt-2 mb-4 p-2 gap-2 ${errors.email ? 'border-red-500' : 'border-black'}`}>
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
                            className="w-full bg-transparent border-none outline-none"
                        />
                        <img src={Mail} className="w-5 h-5 opacity-50" alt="Mail Icon" />
                    </div>

                    <button
                        type="submit"
                        className="w-full py-3 font-semibold bg-gray-900 text-white cursor-pointer active:scale-95"
                    >
                        {loading ? <BeatLoader color="white" size={8} /> : <p>Send Reset Link</p>}
                    </button>

                    {message && <div className="text-green-600 py-3 w-full flex justify-center">
                        <p>
                            {message}
                        </p>
                    </div>}

                    <div className="w-full flex justify-center items-center mt-4 font-light">
                        <p>
                            Remember your password? <span className="font-semibold cursor-pointer hover:underline" onClick={() => navigate('/')}>Log In</span>
                        </p>
                    </div>

                    {Error && <div className="text-red-500 py-3 w-full flex justify-center">
                        <p>
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

export default EmailVerificationForNewPassword;
