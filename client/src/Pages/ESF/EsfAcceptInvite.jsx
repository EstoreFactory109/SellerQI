import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Mail,
  User,
  Lock,
  Shield,
  Loader2,
  Eye,
  EyeOff,
  AlertCircle,
  CheckCircle,
} from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import PhoneNumberInput, { validatePhoneParts, buildPhoneValue } from '../../Components/Shared/PhoneNumberInput.jsx';
import PasswordCriteriaList from '../../Components/Shared/PasswordCriteriaList.jsx';
import { isPasswordValid, passwordErrorMessage, extractServerError } from '../../utils/passwordCriteria.js';
import sellerQILogo from '../../assets/Logo/sellerQILogo.png';

const ROLE_LABELS = {
  admin: 'Admin — manage clients and team members',
  member: 'Member — manage clients',
};

/**
 * Where an invited team member lands from the emailed link.
 *
 * Email and role come from the invitation and are shown read-only — the whole
 * point of an invite is that those two are decided by the inviter. Everything
 * else is the new member's to fill in, including their own password.
 */
const EsfAcceptInvite = () => {
  const { token } = useParams();
  const navigate = useNavigate();

  const [invite, setInvite] = useState(null);
  const [checking, setChecking] = useState(true);
  const [inviteError, setInviteError] = useState('');

  const [formData, setFormData] = useState({ firstname: '', lastname: '', phone: '', password: '' });
  const [countryCode, setCountryCode] = useState('+1');
  const [showPassword, setShowPassword] = useState(false);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [done, setDone] = useState(false);

  useEffect(() => {
    const check = async () => {
      try {
        const res = await axiosInstance.get(`/app/esf/invites/token/${token}`);
        if (res.data?.statusCode === 200) setInvite(res.data.data);
        else setInviteError(res.data?.message || 'This invitation link is not valid');
      } catch (err) {
        setInviteError(extractServerError(err, 'This invitation link is not valid'));
      } finally {
        setChecking(false);
      }
    };
    check();
  }, [token]);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
    setErrors({ ...errors, [e.target.name]: '' });
  };

  const validate = () => {
    const next = {};
    const nameRegex = /^[A-Za-z]{2,}$/;
    if (!nameRegex.test(formData.firstname)) next.firstname = 'Valid first name (letters only, min 2)';
    if (!nameRegex.test(formData.lastname)) next.lastname = 'Valid last name (letters only, min 2)';
    Object.assign(next, validatePhoneParts(countryCode, formData.phone));
    if (!formData.password) next.password = 'Password is required';
    else if (!isPasswordValid(formData.password)) next.password = passwordErrorMessage(formData.password);
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setSubmitting(true);
    setErrorMessage('');
    try {
      const res = await axiosInstance.post(`/app/esf/invites/token/${token}/accept`, {
        firstname: formData.firstname,
        lastname: formData.lastname,
        phone: buildPhoneValue(countryCode, formData.phone),
        password: formData.password,
      });
      if (res.data?.statusCode === 201) {
        // Accepting signs them in, so go straight into the portal.
        setDone(true);
        localStorage.setItem('isEsfAuth', 'true');
        setTimeout(() => navigate('/esf/clients', { replace: true }), 1200);
      } else {
        setErrorMessage(res.data?.message || 'Could not complete your account. Please try again.');
      }
    } catch (err) {
      setErrorMessage(extractServerError(err, 'Could not complete your account. Please try again.'));
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = (hasError, rightPadding = 'pr-4') =>
    `w-full pl-10 ${rightPadding} py-2.5 rounded-lg border bg-white/[0.04] text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/70 transition ${
      hasError ? 'border-red-500/60' : 'border-white/10 hover:border-white/20'
    }`;
  const lockedClass =
    'w-full pl-10 pr-4 py-2.5 rounded-lg border border-white/10 bg-white/[0.02] text-gray-400 cursor-not-allowed';
  const labelClass = 'block text-sm font-medium text-gray-400 mb-1.5';

  const shell = (children) => (
    <div className="min-h-screen bg-[#0b0f17] flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-lg">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="bg-[#101722]/90 rounded-2xl border border-white/10 shadow-2xl shadow-black/20 backdrop-blur p-6"
        >
          <div className="flex justify-center mb-5">
            <img src={sellerQILogo} alt="SellerQI" className="h-9 w-auto object-contain" />
          </div>
          {children}
        </motion.div>
      </div>
    </div>
  );

  if (checking) {
    return shell(
      <div className="flex flex-col items-center gap-3 py-10">
        <Loader2 className="w-6 h-6 animate-spin text-blue-400" />
        <p className="text-sm text-gray-400">Checking your invitation…</p>
      </div>
    );
  }

  if (inviteError) {
    return shell(
      <div className="text-center py-6">
        <div className="w-12 h-12 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center mx-auto mb-3">
          <AlertCircle className="w-6 h-6 text-red-400" />
        </div>
        <h1 className="text-lg font-semibold text-gray-100 mb-1">Invitation unavailable</h1>
        <p className="text-sm text-gray-400 mb-5">{inviteError}</p>
        <button
          type="button"
          onClick={() => navigate('/esf-login')}
          className="px-5 py-2.5 rounded-lg text-sm font-medium bg-blue-600 text-white hover:bg-blue-500 transition-colors"
        >
          Go to sign in
        </button>
      </div>
    );
  }

  if (done) {
    return shell(
      <div className="text-center py-6">
        <div className="w-12 h-12 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center mx-auto mb-3">
          <CheckCircle className="w-6 h-6 text-emerald-400" />
        </div>
        <h1 className="text-lg font-semibold text-gray-100 mb-1">Welcome to the team</h1>
        <p className="text-sm text-gray-400">Taking you to the portal…</p>
      </div>
    );
  }

  return shell(
    <>
      <div className="text-center mb-5">
        <h1 className="text-xl font-bold text-gray-100 mb-1">Complete your account</h1>
        <p className="text-sm text-gray-500">
          {invite?.invitedByName ? `${invite.invitedByName} invited you` : 'You have been invited'} to the
          eStore Factory portal
        </p>
      </div>

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
        {/* Fixed by the invitation */}
        <div>
          <label className={labelClass}>Email</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
            <input type="email" value={invite?.email || ''} className={lockedClass} disabled readOnly />
          </div>
          <p className="mt-1 text-xs text-gray-500">Set by your invitation and cannot be changed.</p>
        </div>

        <div>
          <label className={labelClass}>Role</label>
          <div className="relative">
            <Shield className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
            <input
              type="text"
              value={ROLE_LABELS[invite?.role] || invite?.role || ''}
              className={lockedClass}
              disabled
              readOnly
            />
          </div>
          <p className="mt-1 text-xs text-gray-500">An admin can change your role later.</p>
        </div>

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
          disabled={submitting}
        />

        <div>
          <label className={labelClass}>Password</label>
          <div className="relative">
            <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
            <input
              type={showPassword ? 'text' : 'password'}
              name="password"
              value={formData.password}
              onChange={handleChange}
              className={inputClass(!!errors.password, 'pr-12')}
              placeholder="Create a password"
              autoComplete="new-password"
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
          <PasswordCriteriaList value={formData.password} error={errors.password} />
        </div>

        <button
          type="submit"
          disabled={submitting}
          className="w-full inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-lg shadow-blue-950/30 disabled:opacity-50"
        >
          {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Join the team
        </button>
      </form>
    </>
  );
};

export default EsfAcceptInvite;
