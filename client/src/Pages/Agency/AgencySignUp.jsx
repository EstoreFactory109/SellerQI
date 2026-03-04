import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mail,
  Eye,
  EyeOff,
  User,
  Phone,
  Lock,
  ArrowRight,
  Loader2,
  AlertCircle,
  X,
  Building2,
} from 'lucide-react';
import axios from 'axios';
import { useNavigate, Link } from 'react-router-dom';
import { countryCodesData } from '../../utils/countryCodesData.js';

const defaultCountryData = {
  iso: 'XX',
  name: 'Unknown Country',
  pattern: /^\d{7,15}$/,
  placeholder: 'Enter phone number',
  minLength: 7,
  maxLength: 15,
};

const getCountryFlag = (isoCode) => {
  if (!isoCode || isoCode === 'XX') return '🏳️';
  return `https://flagsapi.com/${isoCode}/flat/32.png`;
};

const AgencySignUp = () => {
  const [formData, setFormData] = useState({
    firstname: '',
    lastname: '',
    agencyName: '',
    phone: '',
    email: '',
    password: '',
  });
  const [countryCode, setCountryCode] = useState('+1');
  const [selectedCountry, setSelectedCountry] = useState(countryCodesData['+1'] || defaultCountryData);
  const [countryFlag, setCountryFlag] = useState('🇺🇸');
  const [errors, setErrors] = useState({});
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [termsAccepted, setTermsAccepted] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  useEffect(() => {
    const found = countryCodesData[countryCode];
    if (found) {
      setSelectedCountry(found);
      setCountryFlag(getCountryFlag(found.iso));
    } else {
      setSelectedCountry({ ...defaultCountryData, code: countryCode });
      setCountryFlag('🏳️');
    }
  }, [countryCode]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: '' });
    if (errorMessage) setErrorMessage('');
  };

  const handleFocus = (e) => {
    setErrors({ ...errors, [e.target.name]: '' });
  };

  const handleCountryCodeChange = (e) => {
    const value = e.target.value;
    if (value.match(/^\+?\d{0,3}$/) || value === '+') {
      const formattedValue = value.startsWith('+') ? value : '+' + value.replace(/[^\d]/g, '');
      setCountryCode(formattedValue);
      setFormData({ ...formData, phone: '' });
      setErrors({ ...errors, phone: '', countryCode: '' });
    }
  };

  const handlePhoneChange = (e) => {
    const value = e.target.value.replace(/[^\d\s]/g, '');
    const digitsOnly = value.replace(/\s+/g, '');
    if (digitsOnly.length <= selectedCountry.maxLength) {
      setFormData({ ...formData, phone: value });
      setErrors({ ...errors, phone: '' });
    }
  };

  const validateForm = () => {
    const nameRegex = /^[A-Za-z]{2,}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const passwordRegex = /^(?=.*[A-Za-z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]{8,}$/;
    const newErrors = {};

    if (!nameRegex.test(formData.firstname)) {
      newErrors.firstname = 'Enter a valid first name (only letters, min 2 characters)';
    }
    if (!nameRegex.test(formData.lastname)) {
      newErrors.lastname = 'Enter a valid last name (only letters, min 2 characters)';
    }
    if (!formData.agencyName || formData.agencyName.trim().length < 2) {
      newErrors.agencyName = 'Agency name is required (min 2 characters)';
    } else if (formData.agencyName.trim().length > 100) {
      newErrors.agencyName = 'Agency name must not exceed 100 characters';
    }
    if (!countryCode || countryCode === '+' || countryCode.length < 2) {
      newErrors.countryCode = 'Country code is required';
    }
    const cleanPhone = formData.phone.replace(/\s+/g, '');
    if (!cleanPhone) {
      newErrors.phone = 'Phone number is required';
    } else if (!selectedCountry.pattern.test(cleanPhone)) {
      newErrors.phone = `Enter a valid phone number for ${selectedCountry.name} (${selectedCountry.minLength}${selectedCountry.minLength !== selectedCountry.maxLength ? `-${selectedCountry.maxLength}` : ''} digits)`;
    }
    if (!formData.email) {
      newErrors.email = 'Email is required';
    } else if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Enter a valid email address';
    }
    if (!formData.password) {
      newErrors.password = 'Password is required';
    } else if (!passwordRegex.test(formData.password)) {
      newErrors.password = 'Password must be at least 8 characters, with a letter, number, and special character';
    }
    if (!termsAccepted) {
      newErrors.terms = 'You must agree to the Terms of Use and Privacy Policy';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    setLoading(true);
    setErrorMessage('');
    try {
      const payload = {
        ...formData,
        phone: `${countryCode} ${formData.phone}`.trim(),
        allTermsAndConditionsAgreed: termsAccepted,
        packageType: 'AGENCY',
        isInTrialPeriod: false,
        subscriptionStatus: 'inactive',
        trialEndsDate: null,
        intendedPackage: 'AGENCY',
      };
      const response = await axios.post(
        `${import.meta.env.VITE_BASE_URI}/app/register`,
        payload,
        { withCredentials: true }
      );
      if (response.status === 201) {
        localStorage.setItem('intendedPackage', 'AGENCY');
        navigate('/verify-email', {
          state: {
            email: formData.email,
            phone: `${countryCode} ${formData.phone}`.trim(),
            intendedPackage: 'AGENCY',
          },
        });
      }
    } catch (err) {
      setErrorMessage(err.response?.data?.message || 'Sign up failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center">
      <div className="relative w-full flex items-center justify-center px-4 py-4 lg:py-8">
        <div className="w-full max-w-lg">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="bg-[#161b22] rounded-2xl border border-[#30363d] p-6"
          >
            <div className="text-center mb-6">
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="flex justify-center mb-4"
              >
                <img
                  src="https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png"
                  alt="SellerQI Logo"
                  className="h-10 w-auto"
                />
              </motion.div>
              <h1 className="text-xl lg:text-2xl font-bold text-gray-100 mb-2">
                Agency Sign Up
              </h1>
              <p className="text-gray-500 text-sm">
                Create your agency account to manage multiple clients
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">First Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="text"
                      name="firstname"
                      value={formData.firstname}
                      onChange={handleChange}
                      onFocus={handleFocus}
                      className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-gray-100 ${
                        errors.firstname ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
                      }`}
                      placeholder="Enter first name"
                    />
                  </div>
                  {errors.firstname && (
                    <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-red-400 text-xs mt-1">
                      {errors.firstname}
                    </motion.p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-2">Last Name</label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="text"
                      name="lastname"
                      value={formData.lastname}
                      onChange={handleChange}
                      onFocus={handleFocus}
                      className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-gray-100 ${
                        errors.lastname ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
                      }`}
                      placeholder="Enter last name"
                    />
                  </div>
                  {errors.lastname && (
                    <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-red-400 text-xs mt-1">
                      {errors.lastname}
                    </motion.p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Agency Name</label>
                <div className="relative">
                  <Building2 className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="text"
                    name="agencyName"
                    value={formData.agencyName}
                    onChange={handleChange}
                    onFocus={handleFocus}
                    className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-gray-100 ${
                      errors.agencyName ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
                    }`}
                    placeholder="Enter your agency name"
                  />
                </div>
                {errors.agencyName && (
                  <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-red-400 text-xs mt-1">
                    {errors.agencyName}
                  </motion.p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Phone Number</label>
                <div className="flex">
                  <div className={`flex items-center gap-2 px-3 py-2.5 h-11 border rounded-l-lg bg-[#21262d] ${
                    errors.countryCode ? 'border-red-500 bg-red-500/10' : 'border-[#30363d]'
                  }`}>
                    <div className="w-5 h-4 flex items-center justify-center">
                      {countryFlag.startsWith('http') ? (
                        <img
                          src={countryFlag}
                          alt={`${selectedCountry.name} flag`}
                          className="w-5 h-4 object-cover rounded-sm"
                          onError={(e) => { e.target.outerHTML = '<span class="text-sm">🏳️</span>'; }}
                        />
                      ) : (
                        <span className="text-sm">{countryFlag}</span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={countryCode}
                      onChange={handleCountryCodeChange}
                      onFocus={() => setErrors({ ...errors, countryCode: '' })}
                      className={`w-16 text-sm font-medium text-gray-100 bg-transparent border-none outline-none focus:ring-0 ${
                        errors.phone || errors.countryCode ? 'text-red-400' : ''
                      }`}
                      placeholder="+1"
                      maxLength={4}
                    />
                  </div>
                  <div className="relative flex-1">
                    <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="text"
                      name="phone"
                      value={formData.phone}
                      onChange={handlePhoneChange}
                      onFocus={handleFocus}
                      className={`w-full pl-10 pr-4 py-2.5 h-11 border-t border-r border-b rounded-r-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-gray-100 ${
                        errors.phone ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
                      }`}
                      placeholder={selectedCountry.placeholder}
                      maxLength={selectedCountry.maxLength + Math.floor(selectedCountry.maxLength / 3)}
                    />
                  </div>
                </div>
                {errors.countryCode && (
                  <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-red-400 text-xs mt-1">{errors.countryCode}</motion.p>
                )}
                {errors.phone && (
                  <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-red-400 text-xs mt-1">{errors.phone}</motion.p>
                )}
                <p className="text-xs text-gray-500 mt-1">
                  Enter {selectedCountry.minLength}{selectedCountry.minLength !== selectedCountry.maxLength ? `-${selectedCountry.maxLength}` : ''} digits for {selectedCountry.name}
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Email Address</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="email"
                    name="email"
                    value={formData.email}
                    onChange={handleChange}
                    onFocus={handleFocus}
                    className={`w-full pl-10 pr-4 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-gray-100 ${
                      errors.email ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
                    }`}
                    placeholder="Enter your email"
                  />
                </div>
                {errors.email && (
                  <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-red-400 text-xs mt-1">{errors.email}</motion.p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-300 mb-2">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    name="password"
                    value={formData.password}
                    onChange={handleChange}
                    onFocus={handleFocus}
                    className={`w-full pl-10 pr-12 py-2.5 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-all duration-300 text-gray-100 ${
                      errors.password ? 'border-red-500 bg-red-500/10' : 'border-[#30363d] bg-[#21262d] hover:border-gray-500'
                    }`}
                    placeholder="Create a password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
                {errors.password && (
                  <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-red-400 text-xs mt-1">{errors.password}</motion.p>
                )}
                <p className="text-xs text-gray-500 mt-0.5">Min 8 chars with letters, numbers & symbols</p>
              </div>

              <div>
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    id="termsCheckbox"
                    checked={termsAccepted}
                    onChange={(e) => {
                      setTermsAccepted(e.target.checked);
                      if (e.target.checked) setErrors({ ...errors, terms: '' });
                    }}
                    className="mt-1 w-4 h-4 text-blue-500 bg-[#21262d] border-[#30363d] rounded focus:ring-blue-500 focus:ring-2"
                  />
                  <label htmlFor="termsCheckbox" className="text-sm text-gray-300 leading-relaxed">
                    I agree to the{' '}
                    <Link to="https://www.sellerqi.com/terms-of-use" className="text-blue-400 hover:text-blue-300 underline font-medium" target="_blank" rel="noopener noreferrer">Terms of Use</Link>
                    {' '}and{' '}
                    <Link to="https://www.sellerqi.com/privacy-policy" className="text-blue-400 hover:text-blue-300 underline font-medium" target="_blank" rel="noopener noreferrer">Privacy Policy</Link>
                  </label>
                </div>
                {errors.terms && (
                  <motion.p initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="text-red-400 text-xs mt-2">{errors.terms}</motion.p>
                )}
              </div>

              <button
                type="submit"
                disabled={!termsAccepted || loading}
                className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
                  !termsAccepted || loading
                    ? 'bg-gray-600 text-white/60 cursor-not-allowed'
                    : 'bg-blue-600 text-white hover:bg-blue-500'
                }`}
              >
                {loading ? <Loader2 className="w-5 h-5 animate-spin" /> : (<>Create Account<ArrowRight className="w-5 h-5" /></>)}
              </button>

              <div className="text-center pt-2">
                <p className="text-gray-500 text-sm">
                  Already have an agency account?{' '}
                  <Link to="/agency-login" className="text-blue-400 hover:text-blue-300 font-semibold hover:underline transition-colors">
                    Sign in
                  </Link>
                </p>
              </div>

              <AnimatePresence>
                {errorMessage && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 relative"
                  >
                    <div className="flex items-start gap-3">
                      <AlertCircle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="text-red-300 font-medium text-sm">Registration Failed</p>
                        <p className="text-red-400/90 text-sm mt-1">{errorMessage}</p>
                      </div>
                      <button type="button" onClick={() => setErrorMessage('')} className="text-red-400 hover:text-red-300 transition-colors">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </form>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default AgencySignUp;
