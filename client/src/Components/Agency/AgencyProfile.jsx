import React, { useState, useEffect, useRef } from 'react';
import { User, Building2, Loader2, CheckCircle, AlertCircle, Pencil, Upload, ImagePlus, X } from 'lucide-react';
import axiosInstance from '../../config/axios.config.js';

const MAX_FILE_SIZE_MB = 2;
const ACCEPTED_TYPES = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];

export default function AgencyProfile() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    firstName: '',
    lastName: '',
    phone: '',
    whatsapp: '',
    agencyName: '',
    email: '',
  });
  const [profilePic, setProfilePic] = useState('');
  const [profilePicFile, setProfilePicFile] = useState(null);
  const [profilePicPreview, setProfilePicPreview] = useState('');
  const [logoError, setLogoError] = useState('');
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [activeField, setActiveField] = useState(null);
  const fileInputRef = useRef(null);
  const agencyNameRef = useRef(null);
  const firstNameRef = useRef(null);
  const lastNameRef = useRef(null);
  const phoneRef = useRef(null);
  const whatsappRef = useRef(null);

  const activateField = (field) => {
    setActiveField(field);
    setTimeout(() => {
      if (field === 'agencyName') agencyNameRef.current?.focus();
      if (field === 'firstName') firstNameRef.current?.focus();
      if (field === 'lastName') lastNameRef.current?.focus();
      if (field === 'phone') phoneRef.current?.focus();
      if (field === 'whatsapp') whatsappRef.current?.focus();
    }, 0);
  };

  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await axiosInstance.get('/app/admin/profile');
        if (res.data?.statusCode === 200 && res.data?.data?.adminInfo) {
          const info = res.data.data.adminInfo;
          setForm({
            firstName: info.firstName || '',
            lastName: info.lastName || '',
            phone: info.phone || '',
            whatsapp: info.whatsapp || '',
            agencyName: info.agencyName || '',
            email: info.email || '',
          });
          if (info.profilePic) setProfilePic(info.profilePic);
        }
      } catch (err) {
        setError('Failed to load profile');
      } finally {
        setLoading(false);
      }
    };
    fetchProfile();
  }, []);

  const handleChange = (e) => {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    setError('');
    setSuccess('');
  };

  const validateAndSetFile = (file) => {
    setLogoError('');
    if (!file) return;
    if (!ACCEPTED_TYPES.includes(file.type)) {
      setLogoError('Please use PNG, JPG, or WebP.');
      return;
    }
    const sizeMB = file.size / (1024 * 1024);
    if (sizeMB > MAX_FILE_SIZE_MB) {
      setLogoError(`File must be under ${MAX_FILE_SIZE_MB}MB.`);
      return;
    }
    if (profilePicPreview) URL.revokeObjectURL(profilePicPreview);
    setProfilePicFile(file);
    setProfilePicPreview(URL.createObjectURL(file));
  };

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    validateAndSetFile(file);
    e.target.value = '';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    const file = e.dataTransfer?.files?.[0];
    validateAndSetFile(file);
  };

  const removeLogoSelection = () => {
    setLogoError('');
    setProfilePicFile(null);
    if (profilePicPreview) {
      URL.revokeObjectURL(profilePicPreview);
      setProfilePicPreview('');
    }
  };

  const handleUploadLogo = async () => {
    if (!profilePicFile) return;
    setUploadingLogo(true);
    setLogoError('');
    try {
      const formData = new FormData();
      formData.append('avatar', profilePicFile);
      const picRes = await axiosInstance.put('/app/admin/profile-pic', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      const newUrl = picRes.data?.data?.profilePicUrl;
      if (newUrl) {
        setProfilePic(newUrl);
        window.dispatchEvent(new CustomEvent('agency-logo-updated', { detail: { profilePicUrl: newUrl } }));
      }
      setProfilePicFile(null);
      if (profilePicPreview) {
        URL.revokeObjectURL(profilePicPreview);
        setProfilePicPreview('');
      }
      setSuccess('Logo uploaded successfully.');
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setLogoError(err.response?.data?.message || 'Upload failed. Try again.');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');
    setLogoError('');
    try {
      await axiosInstance.put('/app/admin/profile', {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone,
        whatsapp: form.whatsapp,
        agencyName: form.agencyName,
      });
      if (profilePicFile) {
        const formData = new FormData();
        formData.append('avatar', profilePicFile);
        const picRes = await axiosInstance.put('/app/admin/profile-pic', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
        const newUrl = picRes.data?.data?.profilePicUrl;
        if (newUrl) {
          setProfilePic(newUrl);
          window.dispatchEvent(new CustomEvent('agency-logo-updated', { detail: { profilePicUrl: newUrl } }));
        }
      }
      setSuccess('Profile updated successfully.');
      setProfilePicFile(null);
      setProfilePicPreview('');
      setActiveField(null);
      setTimeout(() => setSuccess(''), 4000);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to update profile.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-blue-400 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
      <div className="bg-blue-600 px-4 py-5 text-white relative overflow-hidden">
        <div className="relative z-10 flex items-center gap-3">
          <div className="w-2 h-6 bg-blue-400 rounded-full" />
          <div className="flex items-center gap-3">
            <Building2 className="w-5 h-5 text-white" />
            <h2 className="text-xl font-bold text-white">Agency Profile</h2>
          </div>
        </div>
        <p className="text-gray-200 text-xs mt-1">Update your agency and contact details</p>
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
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex flex-col gap-4 flex-1">
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <label className="text-gray-300 text-sm font-medium">Agency name</label>
                  <button
                    type="button"
                    onClick={() => activateField('agencyName')}
                    className="p-1.5 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                    title="Edit agency name"
                    aria-label="Edit agency name"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
                <input
                  ref={agencyNameRef}
                  type="text"
                  name="agencyName"
                  value={form.agencyName}
                  onChange={handleChange}
                  onBlur={() => setActiveField(null)}
                  readOnly={activeField !== 'agencyName'}
                  className={`w-full px-3 py-2 rounded-lg border text-gray-100 focus:outline-none transition-colors ${
                    activeField === 'agencyName'
                      ? 'bg-[#0d0d0d] border-blue-500 ring-2 ring-blue-500/40 cursor-text'
                      : 'bg-[#1a1a1a] border-[#30363d] cursor-default'
                  }`}
                  placeholder="Your agency name"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="text-gray-300 text-sm font-medium">First name</label>
                    <button
                      type="button"
                      onClick={() => activateField('firstName')}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                      title="Edit first name"
                      aria-label="Edit first name"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    ref={firstNameRef}
                    type="text"
                    name="firstName"
                    value={form.firstName}
                    onChange={handleChange}
                    onBlur={() => setActiveField(null)}
                    readOnly={activeField !== 'firstName'}
                    className={`w-full px-3 py-2 rounded-lg border text-gray-100 focus:outline-none transition-colors ${
                      activeField === 'firstName'
                        ? 'bg-[#0d0d0d] border-blue-500 ring-2 ring-blue-500/40 cursor-text'
                        : 'bg-[#1a1a1a] border-[#30363d] cursor-default'
                    }`}
                    required
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="text-gray-300 text-sm font-medium">Last name</label>
                    <button
                      type="button"
                      onClick={() => activateField('lastName')}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                      title="Edit last name"
                      aria-label="Edit last name"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    ref={lastNameRef}
                    type="text"
                    name="lastName"
                    value={form.lastName}
                    onChange={handleChange}
                    onBlur={() => setActiveField(null)}
                    readOnly={activeField !== 'lastName'}
                    className={`w-full px-3 py-2 rounded-lg border text-gray-100 focus:outline-none transition-colors ${
                      activeField === 'lastName'
                        ? 'bg-[#0d0d0d] border-blue-500 ring-2 ring-blue-500/40 cursor-text'
                        : 'bg-[#1a1a1a] border-[#30363d] cursor-default'
                    }`}
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-gray-300 text-sm font-medium mb-1">Email</label>
                <input
                  type="email"
                  value={form.email}
                  readOnly
                  className="w-full px-3 py-2 rounded-lg bg-[#1a1a1a] border border-[#30363d] text-gray-500 cursor-not-allowed"
                />
                <p className="text-xs text-gray-500 mt-1">Email cannot be changed.</p>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="text-gray-300 text-sm font-medium">Phone</label>
                    <button
                      type="button"
                      onClick={() => activateField('phone')}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                      title="Edit phone"
                      aria-label="Edit phone"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    ref={phoneRef}
                    type="text"
                    name="phone"
                    value={form.phone}
                    onChange={handleChange}
                    onBlur={() => setActiveField(null)}
                    readOnly={activeField !== 'phone'}
                    className={`w-full px-3 py-2 rounded-lg border text-gray-100 focus:outline-none transition-colors ${
                      activeField === 'phone'
                        ? 'bg-[#0d0d0d] border-blue-500 ring-2 ring-blue-500/40 cursor-text'
                        : 'bg-[#1a1a1a] border-[#30363d] cursor-default'
                    }`}
                  />
                </div>
                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className="text-gray-300 text-sm font-medium">WhatsApp</label>
                    <button
                      type="button"
                      onClick={() => activateField('whatsapp')}
                      className="p-1.5 rounded-lg text-gray-500 hover:text-blue-400 hover:bg-blue-500/10 transition-colors"
                      title="Edit WhatsApp"
                      aria-label="Edit WhatsApp"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <input
                    ref={whatsappRef}
                    type="text"
                    name="whatsapp"
                    value={form.whatsapp}
                    onChange={handleChange}
                    onBlur={() => setActiveField(null)}
                    readOnly={activeField !== 'whatsapp'}
                    className={`w-full px-3 py-2 rounded-lg border text-gray-100 focus:outline-none transition-colors ${
                      activeField === 'whatsapp'
                        ? 'bg-[#0d0d0d] border-blue-500 ring-2 ring-blue-500/40 cursor-text'
                        : 'bg-[#1a1a1a] border-[#30363d] cursor-default'
                    }`}
                  />
                </div>
              </div>
            </div>
            <div className="flex flex-col gap-3 flex-shrink-0">
              <label className="text-gray-300 text-sm font-medium">Agency logo</label>
              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES.join(',')}
                onChange={handleFileChange}
                className="sr-only"
                aria-label="Upload agency logo"
              />
              <div
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
                className={`relative w-36 h-36 rounded-xl border-2 overflow-hidden bg-[#0d0d0d] transition-all duration-200 ${
                  isDragging
                    ? 'border-blue-500 bg-blue-500/10 scale-[1.02]'
                    : profilePicPreview || profilePic
                      ? 'border-[#30363d]'
                      : 'border-dashed border-[#404040] hover:border-[#525252]'
                }`}
              >
                {profilePicPreview ? (
                  <img src={profilePicPreview} alt="Logo preview" className="w-full h-full object-cover" />
                ) : profilePic ? (
                  <img src={profilePic} alt="Agency logo" className="w-full h-full object-cover" />
                ) : (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                    className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-500 hover:text-gray-400 cursor-pointer p-3"
                  >
                    <div className="rounded-full bg-[#1a1a1a] p-3 ring-2 ring-[#252525] ring-offset-2 ring-offset-[#0d0d0d]">
                      <ImagePlus className="w-8 h-8" strokeWidth={1.5} />
                    </div>
                    <span className="text-xs text-center leading-tight">
                      {isDragging ? 'Drop here' : 'Click or drag'}
                    </span>
                  </div>
                )}
                {(profilePicPreview || profilePic) && (
                  <div className="absolute inset-0 bg-black/60 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="p-2 rounded-lg bg-white/10 hover:bg-white/20 text-white transition-colors"
                      title="Change logo"
                      aria-label="Change logo"
                    >
                      <Upload className="w-4 h-4" />
                    </button>
                    {profilePicFile && (
                      <button
                        type="button"
                        onClick={removeLogoSelection}
                        className="p-2 rounded-lg bg-white/10 hover:bg-red-500/30 text-white transition-colors"
                        title="Cancel new selection"
                        aria-label="Cancel new selection"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                )}
                {!profilePicPreview && !profilePic && (
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => fileInputRef.current?.click()}
                    onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                    className="absolute inset-0 cursor-pointer"
                    aria-hidden
                  />
                )}
              </div>
              <p className="text-xs text-gray-500 max-w-[9rem]">
                PNG, JPG or WebP. Max {MAX_FILE_SIZE_MB}MB. Shown in navbar and to clients.
              </p>
              {profilePicFile && (
                <button
                  type="button"
                  onClick={handleUploadLogo}
                  disabled={uploadingLogo}
                  className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {uploadingLogo ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Uploading…
                    </>
                  ) : (
                    <>
                      <Upload className="w-4 h-4" />
                      Upload logo
                    </>
                  )}
                </button>
              )}
              {logoError && (
                <p className="text-xs text-red-400 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  {logoError}
                </p>
              )}
            </div>
          </div>
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
            Save changes
          </button>
        </form>
      </div>
    </div>
  );
}
