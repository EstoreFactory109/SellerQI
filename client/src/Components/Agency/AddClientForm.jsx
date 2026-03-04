import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Mail,
  User,
  Phone,
  UserPlus,
  Loader2,
} from 'lucide-react';
import axios from 'axios';
import { useDispatch } from 'react-redux';
import { loginSuccess } from '../../redux/slices/authSlice';

const AddClientForm = ({ onCancel, showCancelButton = false, agencyName = '' }) => {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    firstname: '',
    lastname: '',
    phone: '',
    email: '',
  });
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const dispatch = useDispatch();

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

    if (!nameRegex.test(formData.firstname)) {
      newErrors.firstname = 'Valid first name (letters only, min 2)';
    }
    if (!nameRegex.test(formData.lastname)) {
      newErrors.lastname = 'Valid last name (letters only, min 2)';
    }
    if (!phoneRegex.test(formData.phone)) {
      newErrors.phone = 'Valid 10-digit phone';
    }
    if (!emailRegex.test(formData.email)) {
      newErrors.email = 'Valid email address';
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
      const clientData = {
        ...formData,
        allTermsAndConditionsAgreed: true,
      };
      const response = await axios.post(
        `${import.meta.env.VITE_BASE_URI}/app/register-agency-client`,
        clientData,
        { withCredentials: true }
      );
      if (response.status === 201) {
        const responseData = response.data.data;
        if (responseData.adminToken) {
          localStorage.setItem('isAdminAuth', 'true');
          localStorage.setItem('adminAccessType', responseData.adminAccessType || 'enterpriseAdmin');
          localStorage.setItem('adminId', responseData.adminId);
        }
        localStorage.setItem('isAuth', 'true');
        dispatch(loginSuccess({
          _id: responseData.clientId,
          firstName: responseData.firstName,
          lastName: responseData.lastName,
          email: responseData.email,
          packageType: 'PRO',
          isVerified: true,
        }));
        // Redirect to agency client connect-to-amazon when adding from agency dashboard
        // Prefer agencyName from API response (reliable); fallback to prop; use 'agency' if both missing (backend still validates ownership)
        const name = responseData.agencyName || agencyName || 'agency';
        if (responseData.clientId) {
          navigate(`/agency/${encodeURIComponent(name)}/client/${responseData.clientId}/connect-to-amazon`, { replace: true });
        } else {
          window.location.href = '/connect-to-amazon';
        }
      }
    } catch (error) {
      setErrorMessage(error.response?.data?.message || 'Failed to add client. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const inputClass = (hasError) =>
    `w-full pl-10 pr-4 py-2.5 rounded-lg border bg-[#21262d] text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${
      hasError ? 'border-red-500/60' : 'border-[#30363d] hover:border-[#484f58]'
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

        <div>
          <label className={labelClass}>Phone</label>
          <div className="relative">
            <Phone className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
            <input
              type="tel"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              onFocus={handleFocus}
              className={inputClass(!!errors.phone)}
              placeholder="10-digit phone number"
            />
          </div>
          {errors.phone && <p className="text-red-400 text-xs mt-1">{errors.phone}</p>}
        </div>

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
              placeholder="Client email"
            />
          </div>
          {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
        </div>

        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 pt-2">
          {showCancelButton && onCancel && (
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 rounded-lg text-sm font-medium text-gray-400 border border-[#30363d] hover:bg-[#21262d] hover:text-gray-200 transition-colors"
            >
              Cancel
            </button>
          )}
          <button
            type="submit"
            disabled={loading}
            className="flex-1 sm:flex-none inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                Add client
              </>
            )}
          </button>
        </div>
      </form>

      <p className="mt-4 text-xs text-gray-500 border-t border-[#252525] pt-4">
        The client will be added to your agency. You can access their account using the "Login as client" option from the Clients list.
      </p>
    </>
  );
};

export default AddClientForm;
