import React, { useState, useEffect } from 'react';
import { User, Mail, Phone, Loader2, CheckCircle, AlertCircle, Save } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

/** Profile card for the ESF portal. */
export default function EsfProfile() {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '' });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const res = await axiosInstance.get('/app/esf/me');
        const me = res.data?.data;
        if (me) {
          setForm({
            firstName: me.firstName || '',
            lastName: me.lastName || '',
            email: me.email || '',
            phone: me.phone || '',
          });
        }
      } catch (err) {
        setError(err.response?.data?.message || 'Failed to load your profile');
      }
    };
    load();
  }, []);

  const handleChange = (e) => {
    setForm({ ...form, [e.target.name]: e.target.value });
    setError('');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (!form.firstName.trim() || !form.lastName.trim()) {
      setError('First and last name are required.');
      return;
    }
    setLoading(true);
    try {
      await axiosInstance.put('/app/esf/profile', {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
      });
      setSuccess('Profile updated successfully.');
      setTimeout(() => setSuccess(''), 5000);
    } catch (err) {
      const errors = err.response?.data?.errors;
      setError(errors?.[0]?.msg || err.response?.data?.message || 'Failed to update your profile');
    } finally {
      setLoading(false);
    }
  };

  const fieldClass =
    'w-full pl-10 pr-4 py-2 rounded-lg bg-white/[0.04] border border-white/10 text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-500/10 focus:border-blue-500/70 disabled:opacity-60 disabled:cursor-not-allowed';

  return (
    <div className="bg-[#101722]/90 rounded-2xl border border-white/10 shadow-2xl shadow-black/20 hover:shadow-black/30 transition-all duration-300 overflow-hidden">
      <div className="bg-blue-600 px-4 py-5 text-white relative overflow-hidden">
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-2 h-6 bg-blue-400 rounded-full" />
          <div className="flex items-center gap-3">
            <User className="w-5 h-5 text-white" />
            <h2 className="text-xl font-bold text-white">My profile</h2>
          </div>
        </div>
        <p className="text-gray-200 text-xs mt-1">Your details in the eStore Factory portal</p>
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1">First name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  name="firstName"
                  value={form.firstName}
                  onChange={handleChange}
                  className={fieldClass}
                  placeholder="First name"
                />
              </div>
            </div>
            <div>
              <label className="block text-gray-300 text-sm font-medium mb-1">Last name</label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
                <input
                  type="text"
                  name="lastName"
                  value={form.lastName}
                  onChange={handleChange}
                  className={fieldClass}
                  placeholder="Last name"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-gray-300 text-sm font-medium mb-1">Email</label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input type="email" value={form.email} className={fieldClass} disabled />
            </div>
            <p className="text-xs text-gray-500 mt-1">Email cannot be changed.</p>
          </div>

          <div>
            <label className="block text-gray-300 text-sm font-medium mb-1">Phone</label>
            <div className="relative">
              <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
              <input
                type="tel"
                name="phone"
                value={form.phone}
                onChange={handleChange}
                className={fieldClass}
                placeholder="Phone number"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 shadow-lg shadow-blue-950/30 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save changes
          </button>
        </form>
      </div>
    </div>
  );
}
