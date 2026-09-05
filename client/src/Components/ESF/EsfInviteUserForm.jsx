import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Mail, Shield, Send, Loader2 } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';
import { extractServerError } from '../../utils/passwordCriteria.js';

/**
 * Invite someone to the ESF staff portal.
 *
 * Only two fields: the address and the starting role. The invitee fills in
 * their own name, phone and password when they accept, so nobody sets another
 * person's password. The role can be changed afterwards from the members page;
 * the email cannot.
 */
const EsfInviteUserForm = ({ onCancel, onSent, showCancelButton = false }) => {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('member');
  const [errors, setErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const validate = () => {
    const next = {};
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!email.trim()) next.email = 'Email is required';
    else if (!emailRegex.test(email.trim())) next.email = 'Enter a valid email address';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validate()) return;
    setLoading(true);
    setErrorMessage('');

    try {
      const res = await axiosInstance.post('/app/esf/invites', { email: email.trim(), role });
      if (res.data?.statusCode === 201 && res.data?.data) {
        onSent?.(res.data.data);
      } else {
        setErrorMessage(res.data?.message || 'Could not send the invitation. Please try again.');
      }
    } catch (error) {
      setErrorMessage(extractServerError(error, 'Could not send the invitation. Please try again.'));
    } finally {
      setLoading(false);
    }
  };

  const inputClass = (hasError) =>
    `w-full pl-10 pr-4 py-2.5 rounded-lg border bg-white/[0.04] text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/70 transition ${
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
        <div>
          <label className={labelClass}>Email address</label>
          <div className="relative">
            <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4" />
            <input
              type="email"
              name="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                setErrors({});
              }}
              className={inputClass(!!errors.email)}
              placeholder="name@company.com"
              autoComplete="off"
            />
          </div>
          {errors.email && <p className="text-red-400 text-xs mt-1">{errors.email}</p>}
        </div>

        <div>
          <label className={labelClass}>Role</label>
          <div className="relative">
            <Shield className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500 w-4 h-4 pointer-events-none" />
            <select
              name="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className={`${inputClass(false)} appearance-none cursor-pointer`}
            >
              <option value="member">Member — manage clients only</option>
              <option value="admin">Admin — manage clients and team members</option>
            </select>
          </div>
          <p className="mt-1 text-xs text-gray-500">
            You can change their role later. Their email address is fixed by the invitation.
          </p>
        </div>

        <div className="flex flex-col-reverse sm:flex-row sm:justify-end gap-2 sm:gap-3 pt-2">
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
            className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-lg text-sm font-semibold bg-blue-600 hover:bg-blue-500 text-white transition-colors shadow-lg shadow-blue-950/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            Send invite
          </button>
        </div>
      </form>

      <p className="mt-4 text-xs text-gray-500 border-t border-white/10 pt-4">
        We will email them a link to join. They set their own name, phone and password —
        you never see or choose it. The invitation expires in 7 days.
      </p>
    </>
  );
};

export default EsfInviteUserForm;
