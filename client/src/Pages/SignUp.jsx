import React, { useState } from 'react';
import BeatLoader from "react-spinners/BeatLoader";
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
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
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };


  const [errorMessage, setErrorMessage] = useState('');
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    try {
      const response = await axios.post('http://localhost:4000/app/register', formData, { withCredentials: true });
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
    navigate('/');
  };

  return (
    <div className="w-screen h-screen flex items-center justify-center font-roboto">
      <section className="w-1/2 h-full flex flex-col justify-center items-center p-6">
        <form className="w-3/4" onSubmit={handleSubmit}>
          <h1 className="text-4xl font-semibold mb-8">Sign Up</h1>
          <div className="flex gap-4 mb-5">
            <div className="w-1/2">
              <label>First Name</label>
              <input
                type="text"
                name="firstname"
                value={formData.firstname}
                onChange={handleChange}
                onFocus={handleFocus}
                placeholder="Enter Your First name"
                className={`w-full mt-2 p-3 border ${errors.firstname ? 'border-red-500' : 'border-gray-800'} rounded`}
              />
            </div>
            <div className="w-1/2">
              <label>Last Name</label>
              <input
                type="text"
                name="lastname"
                value={formData.lastname}
                onChange={handleChange}
                onFocus={handleFocus}
                placeholder="Enter Your Last name"
                className={`w-full mt-2 p-3 border ${errors.lastname ? 'border-red-500' : 'border-gray-800'} rounded`}
              />
            </div>
          </div>
          <div className="flex gap-4 mb-5">
            <div className="w-1/2">
              <label>Phone</label>
              <input
                type="text"
                name="phone"
                value={formData.phone}
                onChange={handleChange}
                onFocus={handleFocus}
                placeholder="Enter Your Phone number"
                className={`w-full mt-2 p-3 border ${errors.phone ? 'border-red-500' : 'border-gray-800'} rounded`}
              />
            </div>
            <div className="w-1/2">
              <label>Whatsapp</label>
              <input
                type="text"
                name="whatsapp"
                value={formData.whatsapp}
                onChange={handleChange}
                onFocus={handleFocus}
                placeholder="Enter Your Whatsapp number"
                className={`w-full mt-2 p-3 border ${errors.whatsapp ? 'border-red-500' : 'border-gray-800'} rounded`}
              />
            </div>
          </div>
          <label>Email</label>
          <div className={`flex items-center border ${errors.email ? 'border-red-500' : 'border-gray-800'} rounded p-3 mt-2 mb-5`}>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              onFocus={handleFocus}
              placeholder="Enter Your Email"
              className="w-full bg-transparent outline-none"
            />
            <img src={Mail} className="w-5 h-5 opacity-50" alt="email" />
          </div>
          <label>Password</label>
          <div className="mb-5">
            <div className={`flex items-center border ${errors.password ? 'border-red-500' : 'border-gray-800'} rounded p-3 mt-2`}>
              <input
                type={passwordStatus}
                name="password"
                value={formData.password}
                onChange={handleChange}
                onFocus={handleFocus}
                placeholder="Enter Your Password"
                className="w-full bg-transparent outline-none"
              />
              <div onClick={changePasswordStatus}>
                {passwordStatus === "password" ? <img src={Hidden} className="w-5 h-5 opacity-50 cursor-pointer" alt="Password Icon" /> : <img src={Show} className="w-5 h-5 opacity-50 cursor-pointer" alt="Password Icon" />}
              </div>
            </div>
            <p className="text-sm font-light">It must be a combination of minimum 8 letters, numbers, and symbols.</p>
          </div>
          <button className="w-full h-12 font-semibold bg-gray-900 text-white cursor-pointer active:scale-95">{loading ? <BeatLoader color="#ffffff" size={10} /> : <>Sign Up</>}</button>
          <div className="w-full flex justify-center items-center mt-4 font-light">
            <p>
              Already Have an Account? <span className="font-semibold cursor-pointer hover:underline" onClick={navigateToLogin}>Sign In</span>
            </p>
          </div>
          {errorMessage && (<p className='text-red-500 py-3 w-full flex justify-center'>{errorMessage}</p>)}
        </form>
      </section>
      <Right />
    </div>
  );
};

export default SignUp;
