import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, User, Lock, UserPlus, Loader2, Eye, EyeOff } from 'lucide-react';
import PhoneNumberInput, { validatePhoneParts, buildPhoneValue } from '../Shared/PhoneNumberInput.jsx';
import axiosInstance from '../../config/axios.config.js';

/**
 * Add-team-member form for the ESF portal.
 * Creates a User with accessType 'esfUser' who can then sign in at /esf-login.
 */
const EsfAddUserForm = ({ onCancel, onCreated, showCancelButton = false }) => {
  const [formData, setFormData] = useState({
    firstname: '',
    lastname: '',
    phone: '',
    email: '',
    password: '',
  });
  const [countryCode, setCountryCode] = useState('+1');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: '' });
  };

  const handleFocus = (e) => {
    setErrors({ ...errors, [e.target.name]: '' });
  };

  const validateForm = () => {
    const newErrors = {};
    const nameRegex = /^[A-Za-z]{2,}$/;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!nameRegex.test(formData.firstname)) {
      newErrors.firstname = 'Valid first name (letters only, min 2)';
    }
    if (!nameRegex.test(formData.lastname)) {
      newErrors.lastname = 'Valid last name (letters only, min 2)';
    }
    Object.assign(newErrors, validatePhoneParts(countryCode, formData.phone));
    if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Valid email address';
    }
    if (!formData.password || formData.password.length < 8) {
      newErrors.password = 'Password must be at least 8 characters';
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
      const res = await axiosInstance.post('/app/esf/users', {
        ...formData,
        phone: buildPhoneValue(countryCode, formData.phone), // keep the country code
      });

      if (res.data?.statusCode === 201 && res.data?.data) {
        onCreated?.({ clientsAdded: 0, lastLoginAt: null, ...res.data.data });
      } else {
        setErrorMessage(res.data?.message || 'Failed to add team member. Please try again.');
      }
    } catch (error) {
      const errors = error.response?.data?.errors;
      setErrorMessage(errors?.[0]?.msg || error.response?.data?.message || 'Failed to add team member. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = (hasError, rightPadding = 'pr-4') =>
    `w-full pl-10 ${rightPadding} py-2.5 rounded-lg border bg-white/[0.04] text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/70 transition ${
      hasError ? 'border-red-500/60' : 'border-white/10 hover:border-white/20'
    }`;
  const labelClass = 'block text-sm font-medium text-gray-400 mb-1.5';

  return (
    <>
      {errorMessage && (
        <motion.div
          initial={{ opacity: 0, y: -6 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-red-400 text-sm"
        >
          {errorMessage}
        </motion.div>
      )}

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>First name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
              <input
                type="text"
                name="firstname"
                value={formData.firstname}
                onChange={handleChange}
                onFocus={handleFocus}
                className={inputClass(!!errors.firstname)}
                placeholder="First name"
              />
            </div>
            {errors.firstname && <p className="text-red-400 text-xs mt-1">{errors.firstname}</p>}
          </div>
          <div>
            <label className={labelClass}>Last name</label>
            <div className="relative">
              <User className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
              <input
                type="text"
                name="lastname"
                value={formData.lastname}
                onChange={handleChange}
                onFocus={handleFocus}
                className={inputClass(!!errors.lastname)}
                placeholder="Last name"
              />
            </div>
            {errors.lastname && <p className="text-red-400 text-xs mt-1">{errors.lastname}</p>}
          </div>
        </div>

        <PhoneNumberInput
          countryCode={countryCode}
          phone={formData.phone}
          onCountryCodeChange={(code) => {
            setCountryCode(code);
            setFormData({ ...formData, phone: '' }); // lengths differ per country
            setErrors({ ...errors, phone: '', countryCode: '' });
          }}
          onPhoneChange={(value) => {
            setFormData({ ...formData, phone: value });
            setErrors({ ...errors, phone: '' });
          }}
          errors={errors}
          label="Phone"
          disabled={loading}
        />

        <div>
          <label className={labelClass}>Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              onFocus={handleFocus}
              className={inputClass(!!errors.email)}
              placeholder="Work email"
            />
          </div>
          {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
        </div>

        <div>
          <label className={labelClass}>Temporary password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              value={formData.password}
              onChange={handleChange}
              onFocus={handleFocus}
              className={inputClass(!!errors.password, 'pr-12')}
              placeholder="At least 8 characters"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-300 transition-colors"
              aria-label={showPassword ? 'Hide password' : 'Show password'}
            >
              {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>
          {errors.password && <p className="text-red-400 text-xs mt-1">{errors.password}</p>}
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 pt-2">
          {showCancelButton && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-400 border border-white/10 hover:bg-white/[0.05] hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={loading}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-lg shadow-blue-950/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                Add member
              </>
            )}
          </button>
        </div>
      </form>

      <p className="mt-4 text-xs text-gray-500 border-t border-white/10 pt-4">
        The member signs in at <span className="text-gray-400">/esf-login</span> with this email and
        password. They will be able to add clients and other team members.
      </p>
    </>
  );
};

export default EsfAddUserForm;
