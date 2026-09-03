import React, { useState } from 'react';
import { Key, Lock, Loader2, CheckCircle, AlertCircle, Eye, EyeOff } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

/** Update-password card for the ESF portal. */
export default function EsfPassword() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!currentPassword || !newPassword || !confirmPassword) {
      setError('Please fill in all fields.');
      return;
    }
    if (newPassword.length < 8) {
      setError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.');
      return;
    }
    setLoading(true);
    try {
      await axiosInstance.put('/app/esf/update-password', { currentPassword, newPassword });
      setSuccess('Password updated successfully.');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update password. Please check your current password.');
    } finally {
      setLoading(false);
    }
  };

  const fieldClass =
    'w-full pl-10 pr-10 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/70';

  const passwordField = (label, value, setValue, show, setShow, placeholder, autoComplete) => (
    <div>
      <label className="block text-gray-300 text-sm font-medium mb-1">{label}</label>
      <div className="relative">
        <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
        <input
          type={show ? 'text' : 'password'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          className={fieldClass}
          placeholder={placeholder}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          onClick={() => setShow((s) => !s)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-400"
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </button>
      </div>
    </div>
  );

  return (
    <div className="bg-[#101722]/90 rounded-2xl border border-white/10 shadow-2xl shadow-black/20 hover:shadow-black/30 transition-all duration-300 overflow-hidden">
      <div className="bg-blue-600 px-4 py-5 text-white relative overflow-hidden">
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-2 h-6 bg-blue-400 rounded-full" />
          <div className="flex items-center gap-3">
            <Key className="w-5 h-5 text-white" />
            <h2 className="text-xl font-bold text-white">Update password</h2>
          </div>
        </div>
        <p className="text-gray-200 text-xs mt-1">Change your portal account password</p>
      </div>
      <div className="p-4">
        {success && (
          <div className="mb-4 flex items-center gap-2 text-emerald-400 text-sm">
            <CheckCircle className="w-4 h-4" />
            {success}
          </div>
        )}
        {error && (
          <div className="mb-4 flex items-center gap-2 text-red-400 text-sm">
            <AlertCircle className="w-4 h-4" />
            {error}
          </div>
        )}
        <form onSubmit={handleSubmit} className="space-y-4 max-w-md">
          {passwordField('Current password', currentPassword, setCurrentPassword, showCurrent, setShowCurrent, 'Enter current password', 'current-password')}
          {passwordField('New password', newPassword, setNewPassword, showNew, setShowNew, 'At least 8 characters', 'new-password')}
          {passwordField('Confirm new password', confirmPassword, setConfirmPassword, showConfirm, setShowConfirm, 'Confirm new password', 'new-password')}
          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 shadow-lg shadow-blue-950/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Update password
          </button>
        </form>
      </div>
    </div>
  );
}
