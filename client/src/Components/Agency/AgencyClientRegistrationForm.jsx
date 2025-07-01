import React, { useState } from 'react';
import BeatLoader from "react-spinners/BeatLoader";
import { useNavigate } from 'react-router-dom';
import Mail from '../../assets/Icons/mail.png';
import Hidden from '../../assets/Icons/hidden.png';
import Show from '../../assets/Icons/show.png';
import agencyService from '../../services/agencyService';

const AgencyClientRegistrationForm = ({ onSuccess }) => {
  const [formData, setFormData] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    whatsapp: '',
    email: '',
    password: ''
  });
  const [errors, setErrors] = useState({});
  const [passwordStatus, setPasswordStatus] = useState("password");
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
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

    if (!nameRegex.test(formData.firstName)) {
      newErrors.firstName = 'Enter a valid first name (only letters, min 2 characters)';
    }
    if (!nameRegex.test(formData.lastName)) {
      newErrors.lastName = 'Enter a valid last name (only letters, min 2 characters)';
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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    
    setLoading(true);
    try {
      const response = await agencyService.registerClient(formData);
      setLoading(false);
      onSuccess && onSuccess(response.data);
    } catch (error) {
      setLoading(false);
      setErrorMessage(error.message || 'Failed to register client');
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <div className="mb-6">
        <h2 className="text-2xl font-semibold text-center text-gray-800 mb-2">
          Register Your First Client
        </h2>
        <p className="text-sm text-gray-600 text-center">
          As an agency owner, please register your first client to get started
        </p>
      </div>

      <form className="space-y-4" onSubmit={handleSubmit}>
        {/* Name Fields */}
        <div className="flex gap-3">
          <div className="w-1/2">
            <label className="text-sm font-medium text-gray-700">First Name</label>
            <input
              type="text"
              name="firstName"
              value={formData.firstName}
              onChange={handleChange}
              onFocus={handleFocus}
              placeholder="Enter client's first name"
              className={`w-full mt-1 p-3 text-sm border ${
                errors.firstName ? 'border-red-500' : 'border-gray-300'
              } rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            {errors.firstName && <p className="text-red-500 text-xs mt-1">{errors.firstName}</p>}
          </div>
          <div className="w-1/2">
            <label className="text-sm font-medium text-gray-700">Last Name</label>
            <input
              type="text"
              name="lastName"
              value={formData.lastName}
              onChange={handleChange}
              onFocus={handleFocus}
              placeholder="Enter client's last name"
              className={`w-full mt-1 p-3 text-sm border ${
                errors.lastName ? 'border-red-500' : 'border-gray-300'
              } rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            {errors.lastName && <p className="text-red-500 text-xs mt-1">{errors.lastName}</p>}
          </div>
        </div>

        {/* Phone Fields */}
        <div className="flex gap-3">
          <div className="w-1/2">
            <label className="text-sm font-medium text-gray-700">Phone</label>
            <input
              type="text"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              onFocus={handleFocus}
              placeholder="Enter client's phone number"
              className={`w-full mt-1 p-3 text-sm border ${
                errors.phone ? 'border-red-500' : 'border-gray-300'
              } rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            {errors.phone && <p className="text-red-500 text-xs mt-1">{errors.phone}</p>}
          </div>
          <div className="w-1/2">
            <label className="text-sm font-medium text-gray-700">WhatsApp</label>
            <input
              type="text"
              name="whatsapp"
              value={formData.whatsapp}
              onChange={handleChange}
              onFocus={handleFocus}
              placeholder="Enter client's WhatsApp number"
              className={`w-full mt-1 p-3 text-sm border ${
                errors.whatsapp ? 'border-red-500' : 'border-gray-300'
              } rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500`}
            />
            {errors.whatsapp && <p className="text-red-500 text-xs mt-1">{errors.whatsapp}</p>}
          </div>
        </div>

        {/* Email */}
        <div>
          <label className="text-sm font-medium text-gray-700">Email</label>
          <div className={`flex items-center border ${
            errors.email ? 'border-red-500' : 'border-gray-300'
          } rounded-md p-3 mt-1`}>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              onFocus={handleFocus}
              placeholder="Enter client's email"
              className="w-full bg-transparent outline-none text-sm"
            />
            <img src={Mail} className="w-4 h-4 opacity-50" alt="email" />
          </div>
          {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
        </div>

        {/* Password */}
        <div>
          <label className="text-sm font-medium text-gray-700">Password</label>
          <div className={`flex items-center border ${
            errors.password ? 'border-red-500' : 'border-gray-300'
          } rounded-md p-3 mt-1`}>
            <input
              type={passwordStatus}
              name="password"
              value={formData.password}
              onChange={handleChange}
              onFocus={handleFocus}
              placeholder="Enter client's password"
              className="w-full bg-transparent outline-none text-sm"
            />
            <div onClick={changePasswordStatus} className="cursor-pointer">
              <img 
                src={passwordStatus === "password" ? Hidden : Show} 
                className="w-4 h-4 opacity-50" 
                alt="Password visibility" 
              />
            </div>
          </div>
          {errors.password && <p className="text-red-500 text-xs mt-1">{errors.password}</p>}
          <p className="text-xs text-gray-500 mt-1">
            It must be a combination of minimum 8 letters, numbers, and symbols.
          </p>
        </div>



        {/* Action Button */}
        <div className="pt-4">
          <button 
            type="submit"
            disabled={loading}
            className={`w-full h-12 text-sm font-semibold rounded-md transition-all ${
              loading 
                ? 'bg-gray-400 text-gray-600 cursor-not-allowed' 
                : 'bg-blue-600 text-white hover:bg-blue-700'
            }`}
          >
            {loading ? <BeatLoader color="#ffffff" size={8} /> : 'Register Client'}
          </button>
        </div>

        {errorMessage && (
          <div className="text-red-500 text-center text-sm mt-4">
            {errorMessage}
          </div>
        )}
      </form>
    </div>
  );
};

export default AgencyClientRegistrationForm; 