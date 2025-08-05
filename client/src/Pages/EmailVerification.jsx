import React, { useState, useRef, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import axios from "axios";
import BeatLoader from "react-spinners/BeatLoader";
import { clearAuthCache } from '../utils/authCoordinator.js';


const OtpVerification = () => {
  const [otp, setOtp] = useState(["", "", "", "", ""]);
  const [error, setError] = useState(false);
  const location = useLocation();
  const { email } = location.state || {};
  const [loading, setLoading] = useState(false);
  const one = useRef(null);
  const two = useRef(null);
  const three = useRef(null);
  const four = useRef(null);
  const five = useRef(null);
  
  const navigate = useNavigate();

  useEffect(() => {
    one.current.focus();
  }, []);

  const getOtp = (e, index, nextRef) => {
    let newOtp = [...otp];
    newOtp[index] = e.target.value;
    setOtp(newOtp);

    if (e.target.value && nextRef?.current) {
      nextRef.current.focus();
    }

    if (error) {
      setError(false); // Reset error when user starts typing again
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (otp.includes("")) {
      setError(true);
      return;
    }
    setLoading(true);
    try {
      const response = await axios.post(`${import.meta.env.VITE_BASE_URI}/app/verify-user`, {
        email,
        otp: otp.join(""),
      },{withCredentials:true});
      if (response.status === 200) {
        setLoading(false);
        // Clear any cached auth state to force fresh checks
        clearAuthCache();
        localStorage.setItem("isAuth", true);
        
        // After email verification, always redirect to pricing page for plan selection
        navigate("/pricing");
      }
    } catch (error) {
      console.error("Verification failed", error);
    }
  };

  return (
    <section className="flex flex-col items-center justify-center w-full min-h-screen bg-white text-black">
      <div className="container rounded-lg bg-white w-[90%] max-w-[500px] p-12 text-center">
        <h1 className="title text-2xl mb-4">Enter OTP</h1>
        <p className="text-gray-600 mb-8">
          OTP has been sent to your registered email address: <span className="font-medium">{email}</span>
        </p>
        <form id="otp-form" className="w-full flex gap-5 items-center justify-center">
          {[one, two, three, four, five].map((ref, index) => (
            <input
              key={index}
              ref={ref}
              type="text"
              className={`otp-input border-2 ${
                error && otp[index] === "" ? "border-red-500" : "border-[#333651]"
              } text-black text-4xl text-center p-2 w-full max-w-[70px] h-[70px] rounded-md outline-none`}
              maxLength={1}
              value={otp[index]}
              onChange={(e) => getOtp(e, index, [two, three, four, five, null][index])}
            />
          ))}
        </form>
        <button
          id="verify-btn"
          className="cursor-pointer inline-block mt-8 bg-[#333651] text-white px-3 py-2 rounded-md text-lg border-none"
          onClick={handleSubmit}
        >
          {loading ? <BeatLoader size={8} color="#fff" /> : "Verify"}
        </button>
      </div>
    </section>
  );
};

export default OtpVerification;
