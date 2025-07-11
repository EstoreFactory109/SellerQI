import React, { useState,useEffect } from 'react';
import BeatLoader from "react-spinners/BeatLoader";
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import Mail from '../assets/Icons/mail.png';
import Hidden from '../assets/Icons/hidden.png';
import Show from '../assets/Icons/show.png';
import Right from '../Components/Forms/Right';


const SignUp = () => {
  const [formData, setFormData] = useState({
    firstname: '',
    lastname: '',
    phone: '',
    whatsapp: '',
    email: '',
    password: ''
  });
  const [errors, setErrors] = useState({});
  const [passwordStatus, setPasswordStatus] = useState("password");
  const [loading, setLoading] = useState(false);
  const [termsAccepted, setTermsAccepted] = useState(false);
  const navigate = useNavigate();

  const changePasswordStatus = () => {
    setPasswordStatus(passwordStatus === "password" ? "text" : "password");
  };



  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: '' });
  };

  const handleFocus = (e) => {
    setErrors({ ...errors, [e.target.name]: '' });
  };



  const validateForm = () => {
    let newErrors = {};
    const nameRegex = /^[A-Za-z]{2,}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const phoneRegex = /^\d{10}$/;
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;

    if (!nameRegex.test(formData.firstname)) {
      newErrors.firstname = 'Enter a valid first name (only letters, min 2 characters)';
    }
    if (!nameRegex.test(formData.lastname)) {
      newErrors.lastname = 'Enter a valid last name (only letters, min 2 characters)';
    }
    if (!phoneRegex.test(formData.phone)) {
      newErrors.phone = 'Enter a valid 10-digit phone number';
    }
    if (!phoneRegex.test(formData.whatsapp)) {
      newErrors.whatsapp = 'Enter a valid 10-digit WhatsApp number';
    }
    if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Enter a valid email address';
    }
    if (!passwordRegex.test(formData.password)) {
      newErrors.password = 'Password must be at least 8 characters, with a letter, a number, and a special character';
    }
    if (!termsAccepted) {
      newErrors.terms = 'You must agree to the Terms of Use and Privacy Policy';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };


  const [errorMessage, setErrorMessage] = useState('');
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    try {
      const formDataWithTerms = {
        ...formData,
        allTermsAndConditionsAgreed: termsAccepted
      };
      const response = await axios.post(`${import.meta.env.VITE_BASE_URI}/app/register`, formDataWithTerms, { withCredentials: true });
      if (response.status === 201) {
        setLoading(false);
        navigate('/verify-email', { state: { email: formData.email } });
      }
    } catch (error) {
      setLoading(false);
      setErrorMessage(error.response?.data?.message);
    }
  };

  const navigateToLogin = () => {
    navigate('/log-in');
  };

  useEffect(() => {
    // Dynamically load Google's API script
    const script = document.createElement('script');
    script.src = 'https://apis.google.com/js/platform.js';
    script.async = true;
    script.defer = true;
    document.body.appendChild(script);

    // Initialize Google API once the script is loaded
    script.onload = () => {
      window.gapi.load('auth2', () => {
        window.gapi.auth2.init({
          client_id: '113167162939-ucumckjf0vlngbb790md23vd8puck4ll.apps.googleusercontent.com',  // Replace with your actual Google Client ID
        });
      });
    };
  }, []);

  const handleGoogleSignUp = () => {
    const auth2 = window.gapi.auth2.getAuthInstance();

    // Trigger Google Sign-In
    auth2.signIn()
  };


  return (
    <div className="w-screen h-screen flex items-center justify-center font-roboto">
      <section className="w-1/2 h-full flex flex-col justify-center items-center p-6">
        <form className="w-3/4" onSubmit={handleSubmit}>
          <div className='flex justify-center items-center w-full h-8 mb-3'>
            <img src='https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png' alt='SellerQI Logo' className='w-auto h-16' />
          </div>
          <h1 className="text-xl font-semibold mb-4 text-center">Welcome to SellerQI</h1>
          <div className="flex gap-3 mb-3">
            <div className="w-1/2">
              <label className="text-sm">First Name</label>
              <input
                type="text"
                name="firstname"
                value={formData.firstname}
                onChange={handleChange}
                onFocus={handleFocus}
                placeholder="Enter Your First name"
                className={`w-full mt-1 p-2 text-sm border ${errors.firstname ? 'border-red-500' : 'border-gray-800'} rounded`}
              />
            </div>
            <div className="w-1/2">
              <label className="text-sm">Last Name</label>
              <input
                type="text"
                name="lastname"
                value={formData.lastname}
                onChange={handleChange}
                onFocus={handleFocus}
                placeholder="Enter Your Last name"
                className={`w-full mt-1 p-2 text-sm border ${errors.lastname ? 'border-red-500' : 'border-gray-800'} rounded`}
              />
            </div>
          </div>
          <div className="flex gap-3 mb-3">
            <div className="w-1/2">
              <label className="text-sm">Phone</label>
              <input
                type="text"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                onFocus={handleFocus}
                placeholder="Enter Your Phone number"
                className={`w-full mt-1 p-2 text-sm border ${errors.phone ? 'border-red-500' : 'border-gray-800'} rounded`}
              />
            </div>
            <div className="w-1/2">
              <label className="text-sm">Whatsapp</label>
              <input
                type="text"
                name="whatsapp"
                value={formData.whatsapp}
                onChange={handleChange}
                onFocus={handleFocus}
                placeholder="Enter Your Whatsapp number"
                className={`w-full mt-1 p-2 text-sm border ${errors.whatsapp ? 'border-red-500' : 'border-gray-800'} rounded`}
              />
            </div>
          </div>
          <label className="text-sm">Email</label>
          <div className={`flex items-center border ${errors.email ? 'border-red-500' : 'border-gray-800'} rounded p-2 mt-1 mb-3`}>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              onFocus={handleFocus}
              placeholder="Enter Your Email"
              className="w-full bg-transparent outline-none text-sm"
            />
            <img src={Mail} className="w-4 h-4 opacity-50" alt="email" />
          </div>
          <label className="text-sm">Password</label>
          <div className="mb-3">
            <div className={`flex items-center border ${errors.password ? 'border-red-500' : 'border-gray-800'} rounded p-2 mt-1`}>
              <input
                type={passwordStatus}
                name="password"
                value={formData.password}
                onChange={handleChange}
                onFocus={handleFocus}
                placeholder="Enter Your Password"
                className="w-full bg-transparent outline-none text-sm"
              />
              <div onClick={changePasswordStatus}>
                {passwordStatus === "password" ? <img src={Hidden} className="w-4 h-4 opacity-50 cursor-pointer" alt="Password Icon" /> : <img src={Show} className="w-4 h-4 opacity-50 cursor-pointer" alt="Password Icon" />}
              </div>
            </div>
            <p className="text-xs font-light mt-1">It must be a combination of minimum 8 letters, numbers, and symbols.</p>
          </div>
          
          {/* Terms and Conditions Checkbox */}
          <div className="mb-3">
            <div className="flex items-start gap-2">
              <input
                type="checkbox"
                id="termsCheckbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                className="mt-0.5 w-3 h-3 text-gray-900 bg-gray-100 border-gray-300 rounded focus:ring-gray-900"
              />
              <label htmlFor="termsCheckbox" className="text-xs text-gray-700">
                By signing up, you agree to our{' '}
                <Link to="/terms" className="text-blue-600 hover:text-blue-800 underline">
                  Terms of Use
                </Link>
                {' '}and{' '}
                <Link to="/privacy-policy" className="text-blue-600 hover:text-blue-800 underline">
                  Privacy Policy
                </Link>
              </label>
            </div>
            {errors.terms && <p className="text-red-500 text-xs mt-1">{errors.terms}</p>}
          </div>

          <button 
            type="submit"
            disabled={!termsAccepted || loading}
            className={`w-full h-10 text-sm font-semibold cursor-pointer active:scale-95 ${
              !termsAccepted || loading 
                ? 'bg-gray-400 text-gray-600 cursor-not-allowed' 
                : 'bg-gray-900 text-white'
            }`}
          >
            {loading ? <BeatLoader color="#ffffff" size={8} /> : <>Sign Up</>}
          </button>
          
          {/* Divider */}
          <div className="flex items-center my-4">
            <div className="flex-1 border-t border-gray-300"></div>
            <span className="mx-3 text-gray-500 text-xs">OR</span>
            <div className="flex-1 border-t border-gray-300"></div>
          </div>
          
          {/* Social Signup Buttons */}
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
              <span className="text-gray-700 text-sm font-medium" onClick={handleGoogleSignUp}>Continue with Google</span>
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
              Already Have an Account? <span className="font-semibold cursor-pointer hover:underline" onClick={navigateToLogin}>Sign In</span>
            </p>
          </div>
          {errorMessage && (<p className='text-red-500 py-2 w-full flex justify-center text-xs'>{errorMessage}</p>)}
        </form>
      </section>
      <Right />
    </div>
  );
};

export default SignUp;
