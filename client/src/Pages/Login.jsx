import React, { useState } from 'react'
import Mail from '../assets/Icons/mail.png'
import Hidden from '../assets/Icons/hidden.png'
import Show from '../assets/Icons/show.png'
import Right from '../Components/Forms/Right'
import { useNavigate } from 'react-router-dom'
import axios from 'axios'
import BeatLoader from "react-spinners/BeatLoader";
import {useDispatch} from 'react-redux';
import { loginSuccess } from '../redux/slices/authSlice.js'


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
                setLoading(false);
                setEmail("");
                setPassword("");
                localStorage.setItem("isAuth",true)
                
                window.location.href = "/seller-central-checker/dashboard";
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
                    <h1 className="text-2xl font-semibold mb-6">Log In</h1>

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

                    <label className="block">Password</label>
                    <div className={`flex items-center border rounded-md p-2 mt-2 mb-4 gap-2 ${errors.password ? 'border-red-500' : 'border-black'}`}>
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
                            className="w-full bg-transparent border-none outline-none"
                        />
                        <div onClick={changePasswordStatus}>
                            {
                                PasswordStatus === "password"
                                    ? <img src={Hidden} className="w-5 h-5 opacity-50 cursor-pointer" alt="Password Icon" />
                                    : <img src={Show} className="w-5 h-5 opacity-50 cursor-pointer" alt="Password Icon" />
                            }
                        </div>
                    </div>

                    <div className="flex justify-between items-center mt-2 mb-4">
                        <div className="flex items-center gap-2">
                            <input type="checkbox" name="remember" id="remember" />
                            <label htmlFor="remember">Remember Me</label>
                        </div>
                        <p className="text-sm cursor-pointer">Forgot Password?</p>
                    </div>

                    <button
                        type="submit"
                        className="w-full py-3 font-semibold bg-gray-900 text-white cursor-pointer active:scale-95"
                    >
                        {loading ? <BeatLoader color="white" size={8} /> : <p>Log In</p>}
                    </button>

                    <div className="w-full flex justify-center items-center mt-4 font-light">
                        <p>
                            No account yet? <span className="font-semibold cursor-pointer hover:underline" onClick={NavigateToSignup}>Signup</span>
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

export default Login;
