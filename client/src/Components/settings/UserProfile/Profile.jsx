import React, { useState, useRef, useEffect } from "react";
import ProfilePic from "./ProfilePic";
import Upload from "./Upload";
import Preview from "./Preview";
import { useSelector, useDispatch } from 'react-redux';
import { updateProfileDetails } from '../../../redux/slices/authSlice.js';
import axios from 'axios';
import BeatLoader from "react-spinners/BeatLoader";
import { User, Phone, Mail, Edit3, Lock, Eye, EyeOff, Shield, CheckCircle, AlertCircle } from "lucide-react";

export default function ProfileForm() {
  const dispatch = useDispatch();
  const Details = useSelector((state) => state.Auth.user);
  const pic = useSelector(state => state.profileImage?.imageLink);

  const [firstname, setFirstname] = useState('');
  const [lastname, setLastname] = useState('');
  const [phone, setPhone] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [email, setEmail] = useState('');

  const [loading, setLoading] = useState(false);
  const [image, setImage] = useState(null);
  const [close, setClose] = useState(true);

  // Super Admin Password Update States
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordSuccess, setPasswordSuccess] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Check if current session is a super admin session
  const isSuperAdminSession = Details?.isSuperAdminSession === true;

  const [firstNameStatus, setFirstNameStatus] = useState(true);
  const [firstNameColor, setFirstNameColor] = useState('#9ba3ad');

  const [lastNameStatus, setLastNameStatus] = useState(true);
  const [lastNameColor, setLastNameColor] = useState('#9ba3ad');

  const [phoneStatus, setPhoneStatus] = useState(true);
  const [phoneColor, setPhoneColor] = useState('#9ba3ad');

  const [whatsappStatus, setWhatsappStatus] = useState(true);
  const [whatsappColor, setWhatsappColor] = useState('#9ba3ad');

  const [emailStatus, setEmailStatus] = useState(true);
  const [emailColor, setEmailColor] = useState('#9ba3ad');

  const submitBtn = useRef(null);

  useEffect(() => {
    if (Details) {
      setFirstname(Details.firstName || '');
      setLastname(Details.lastName || '');
      setPhone(Details.phone || '');
      setWhatsapp(Details.whatsapp || '');
      setEmail(Details.email || '');
    }
  }, [Details]);

  const handleFile = (file) => {
    if (file && file.type.startsWith('image/')) {
      const preview = URL.createObjectURL(file);
      setImage({ file, preview });
      setClose(false);
    }
  };

  const toggleEdit = (statusSetter, colorSetter, currentStatus) => {
    statusSetter(!currentStatus);
    colorSetter(prev => prev === '#9ba3ad' ? '#333651' : '#9ba3ad');
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);

    const data = {
      firstName: firstname,
      lastName: lastname,
      phone: phone,
      whatsapp: whatsapp,
      email: email,
    };

    try {
      const response = await axios.put(`${import.meta.env.VITE_BASE_URI}/app/updateDetails`, data, { withCredentials: true });
      if (response.status === 200) {
        dispatch(updateProfileDetails(response.data.data.UpdateInfo));
       
      }
    } catch (error) {
      console.error(error);
    }
    setLoading(false);
    setFirstNameStatus(true);
    setFirstNameColor('#9ba3ad')
    setLastNameStatus(true);
    setLastNameColor('#9ba3ad')
    setPhoneStatus(true);
    setPhoneColor('#9ba3ad')
    setWhatsappStatus(true);
    setWhatsappColor('#9ba3ad')
    setEmailStatus(true);
    setEmailColor('#9ba3ad')
   
  };

  const clickSave = (e) => {
    e.preventDefault();
    submitBtn.current.click();
  };

  // Super Admin: Update user password
  const handlePasswordUpdate = async (e) => {
    e.preventDefault();
    setPasswordError('');
    setPasswordSuccess('');

    // Validation
    if (!newPassword || !confirmPassword) {
      setPasswordError('Please fill in both password fields');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters long');
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match');
      return;
    }

    setPasswordLoading(true);

    try {
      const response = await axios.put(
        `${import.meta.env.VITE_BASE_URI}/app/super-admin/update-user-password`,
        { 
          userId: Details?.userId,
          newPassword: newPassword 
        },
        { withCredentials: true }
      );

      if (response.status === 200) {
        setPasswordSuccess('Password updated successfully!');
        setNewPassword('');
        setConfirmPassword('');
        // Clear success message after 5 seconds
        setTimeout(() => setPasswordSuccess(''), 5000);
      }
    } catch (error) {
      console.error('Password update error:', error);
      setPasswordError(error.response?.data?.message || 'Failed to update password. Please try again.');
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
      {/* Header Section */}
      <div className="bg-blue-600 px-4 py-5 text-white relative overflow-hidden">
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-2 h-6 bg-blue-400 rounded-full"></div>
            <div className="flex items-center gap-3">
              <User className="w-5 h-5 text-white" />
              <h2 className="text-xl font-bold text-white">
                Profile Details
              </h2>
            </div>
          </div>
          <p className="text-gray-200 text-xs">Manage your personal information and account settings</p>
        </div>
      </div>

      {/* Content Section */}
      <div className="p-4">
        {/* Profile Image Section */}
        <div className="mb-4">
          {(!pic || pic.length === 0) && <Upload handleFile={handleFile} />}
          {!close && <Preview image={image} setImage={setImage} setClose={setClose} />}
          {(pic !== null && pic.length !== 0) && <ProfilePic handleFile={handleFile} setClose={setClose} />}
        </div>

        {/* Form Section */}
        <form className="space-y-4" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* First Name */}
            <InputField
              label="First Name"
              value={firstname}
              editable={firstNameStatus}
              color={firstNameColor}
              name="firstName"
              func={(e) => setFirstname(e.target.value)}
              onEdit={(e) => {
                e.preventDefault();
                toggleEdit(setFirstNameStatus, setFirstNameColor, firstNameStatus);
              }}
              icon={User}
            />

            {/* Last Name */}
            <InputField
              label="Last Name"
              value={lastname}
              editable={lastNameStatus}
              color={lastNameColor}
              name="lastName"
              func={(e) => setLastname(e.target.value)}
              onEdit={(e) => {
                e.preventDefault();
                toggleEdit(setLastNameStatus, setLastNameColor, lastNameStatus);
              }}
              icon={User}
            />

            {/* Phone */}
            <InputField
              label="Phone"
              value={phone}
              editable={phoneStatus}
              color={phoneColor}
              name="phone"
              func={(e) => setPhone(e.target.value)}
              onEdit={(e) => {
                e.preventDefault();
                toggleEdit(setPhoneStatus, setPhoneColor, phoneStatus);
              }}
              icon={Phone}
            />

            {/* Whatsapp */}
            <InputField
              label="Whatsapp"
              value={whatsapp}
              editable={whatsappStatus}
              color={whatsappColor}
              name="whatsapp"
              func={(e) => setWhatsapp(e.target.value)}
              onEdit={(e) => {
                e.preventDefault();
                toggleEdit(setWhatsappStatus, setWhatsappColor, whatsappStatus);
              }}
              icon={Phone}
            />

            {/* Email */}
            <div className="lg:col-span-2">
              <InputField
                label="Email"
                value={email}
                editable={emailStatus}
                color={emailColor}
                name="email"
                func={(e) => setEmail(e.target.value)}
                onEdit={(e) => {
                  e.preventDefault();
                  toggleEdit(setEmailStatus, setEmailColor, emailStatus);
                }}
                icon={Mail}
              />
            </div>
          </div>
          
          <button type="submit" className="hidden" ref={submitBtn}></button>
        </form>

        {/* Save Button */}
        <div className="flex justify-end pt-4 border-t border-[#30363d] mt-4">
          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-medium rounded-xl hover:bg-blue-700 transition-all duration-200 shadow-lg hover:shadow-xl min-w-[160px] justify-center"
            onClick={clickSave}
          >
            {loading ? <BeatLoader color="#fff" size={8} /> : (
              <>
                <User className="w-4 h-4" />
                Save Information
              </>
            )}
          </button>
        </div>

        {/* Super Admin: Password Update Section */}
        {isSuperAdminSession && (
          <div className="mt-4 pt-4 border-t border-[#30363d]">
            <div className="flex items-center gap-3 mb-4">
              <div className="p-2 bg-amber-500/20 rounded-lg">
                <Shield className="w-5 h-5 text-amber-400" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-gray-100">Super Admin: Update User Password</h3>
                <p className="text-sm text-gray-400">Set a new password for this user account</p>
              </div>
            </div>

            <form onSubmit={handlePasswordUpdate} className="space-y-4">
              {/* Success Message */}
              {passwordSuccess && (
                <div className="flex items-center gap-2 p-3 bg-green-500/10 border border-green-500/40 rounded-lg text-green-400">
                  <CheckCircle className="w-5 h-5" />
                  <span className="text-sm font-medium">{passwordSuccess}</span>
                </div>
              )}

              {/* Error Message */}
              {passwordError && (
                <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/40 rounded-lg text-red-400">
                  <AlertCircle className="w-5 h-5" />
                  <span className="text-sm font-medium">{passwordError}</span>
                </div>
              )}

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* New Password */}
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-100">New Password</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Lock className="w-5 h-5 text-gray-400" />
                    </div>
                    <input
                      type={showNewPassword ? "text" : "password"}
                      value={newPassword}
                      onChange={(e) => setNewPassword(e.target.value)}
                      placeholder="Enter new password"
                      className="w-full pl-10 pr-12 py-2.5 border-2 border-[#30363d] rounded-xl transition-all duration-200 font-medium bg-[#1a1a1a] text-gray-100 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-300"
                      onClick={() => setShowNewPassword(!showNewPassword)}
                    >
                      {showNewPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>

                {/* Confirm Password */}
                <div className="space-y-2">
                  <label className="block text-sm font-semibold text-gray-100">Confirm Password</label>
                  <div className="relative">
                    <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
                      <Lock className="w-5 h-5 text-gray-400" />
                    </div>
                    <input
                      type={showConfirmPassword ? "text" : "password"}
                      value={confirmPassword}
                      onChange={(e) => setConfirmPassword(e.target.value)}
                      placeholder="Confirm new password"
                      className="w-full pl-10 pr-12 py-2.5 border-2 border-[#30363d] rounded-xl transition-all duration-200 font-medium bg-[#1a1a1a] text-gray-100 focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 focus:outline-none"
                    />
                    <button
                      type="button"
                      className="absolute inset-y-0 right-0 px-3 flex items-center text-gray-400 hover:text-gray-300"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    >
                      {showConfirmPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="flex justify-end pt-4">
                <button
                  type="submit"
                  disabled={passwordLoading}
                  className="flex items-center gap-2 px-6 py-2.5 bg-amber-600 text-white font-medium rounded-xl hover:bg-amber-700 transition-all duration-200 shadow-lg hover:shadow-xl min-w-[180px] justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {passwordLoading ? <BeatLoader color="#fff" size={8} /> : (
                    <>
                      <Lock className="w-4 h-4" />
                      Update Password
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        )}
      </div>
    </div>
  );
}

// Updated InputField component with modern styling
const InputField = ({ label, value, editable, color, name, func, onEdit, icon: Icon }) => (
  <div className="space-y-2">
    <label className="block text-sm font-semibold text-gray-100">{label}</label>
    <div className="relative">
      <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
        <Icon className="w-5 h-5 text-gray-400" />
      </div>
      <input
        type="text"
        disabled={editable}
        value={value}
        onChange={func}
        name={name}
        className={`w-full pl-10 pr-12 py-2.5 border-2 rounded-xl transition-all duration-200 font-medium ${
          editable 
            ? 'bg-[#1a1a1a] border-[#30363d] text-gray-500 cursor-not-allowed' 
            : 'bg-[#1a1a1a] border-[#30363d] text-gray-100 focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 focus:outline-none'
        }`}
        style={{ 
          borderColor: editable ? '#30363d' : (color === '#333651' ? '#3b82f6' : '#30363d')
        }}
      />
      <button
        type="button"
        className={`absolute inset-y-0 right-0 px-3 flex items-center transition-all duration-200 rounded-r-xl ${
          editable 
            ? 'bg-[#21262d] hover:bg-[#30363d] text-gray-400' 
            : 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-400'
        }`}
        onClick={onEdit}
      >
        <Edit3 className="w-4 h-4" />
      </button>
    </div>
  </div>
);
