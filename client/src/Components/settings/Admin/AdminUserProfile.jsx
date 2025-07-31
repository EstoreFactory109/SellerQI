import React, { useState, useRef, useEffect } from "react";
import ProfilePic from "../UserProfile/ProfilePic";
import Upload from "../UserProfile/Upload";
import Preview from "../UserProfile/Preview";
import { useSelector, useDispatch } from 'react-redux';
import { updateProfileDetails } from '../../../redux/slices/authSlice.js';
import axios from 'axios';
import BeatLoader from "react-spinners/BeatLoader";
import { User, Phone, Mail, Edit3, Crown, Shield, Building } from "lucide-react";

export default function AdminUserProfile() {
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

  const validateFirstName = (value) => {
    const namePattern = /^[A-Za-z\s]{2,}$/;
    if (!namePattern.test(value)) {
      setFirstNameStatus(false);
      setFirstNameColor('#e74c3c');
      return false;
    } else {
      setFirstNameStatus(true);
      setFirstNameColor('#27ae60');
      return true;
    }
  };

  const validateLastName = (value) => {
    const namePattern = /^[A-Za-z\s]{2,}$/;
    if (!namePattern.test(value)) {
      setLastNameStatus(false);
      setLastNameColor('#e74c3c');
      return false;
    } else {
      setLastNameStatus(true);
      setLastNameColor('#27ae60');
      return true;
    }
  };

  const validatePhone = (value) => {
    const phonePattern = /^\d{10}$/;
    if (!phonePattern.test(value)) {
      setPhoneStatus(false);
      setPhoneColor('#e74c3c');
      return false;
    } else {
      setPhoneStatus(true);
      setPhoneColor('#27ae60');
      return true;
    }
  };

  const validateWhatsapp = (value) => {
    const whatsappPattern = /^\d{10}$/;
    if (!whatsappPattern.test(value)) {
      setWhatsappStatus(false);
      setWhatsappColor('#e74c3c');
      return false;
    } else {
      setWhatsappStatus(true);
      setWhatsappColor('#27ae60');
      return true;
    }
  };

  const validateEmail = (value) => {
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailPattern.test(value)) {
      setEmailStatus(false);
      setEmailColor('#e74c3c');
      return false;
    } else {
      setEmailStatus(true);
      setEmailColor('#27ae60');
      return true;
    }
  };

  const validateForm = () => {
    const isFirstNameValid = validateFirstName(firstname);
    const isLastNameValid = validateLastName(lastname);
    const isPhoneValid = validatePhone(phone);
    const isWhatsappValid = validateWhatsapp(whatsapp);
    const isEmailValid = validateEmail(email);

    return isFirstNameValid && isLastNameValid && isPhoneValid && isWhatsappValid && isEmailValid;
  };

  const handleFirstNameChange = (e) => {
    setFirstname(e.target.value);
    validateFirstName(e.target.value);
  };

  const handleLastNameChange = (e) => {
    setLastname(e.target.value);
    validateLastName(e.target.value);
  };

  const handlePhoneChange = (e) => {
    setPhone(e.target.value);
    validatePhone(e.target.value);
  };

  const handleWhatsappChange = (e) => {
    setWhatsapp(e.target.value);
    validateWhatsapp(e.target.value);
  };

  const handleEmailChange = (e) => {
    setEmail(e.target.value);
    validateEmail(e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!validateForm()) {
      console.log("Form validation failed");
      return;
    }

    setLoading(true);
    
    try {
      const response = await axios.put(`${import.meta.env.VITE_BASE_URI}/app/update-details`, {
        firstname,
        lastname,
        phone,
        whatsapp,
        email
      }, { withCredentials: true });

      if (response.status === 200) {
        dispatch(updateProfileDetails({
          firstName: firstname,
          lastName: lastname,
          phone: phone,
          whatsapp: whatsapp,
          email: email
        }));
        console.log("Profile updated successfully");
      }
    } catch (error) {
      console.error("Error updating profile:", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      {/* Admin Header */}
      <div className="bg-gradient-to-r from-purple-600 via-indigo-600 to-blue-600 rounded-3xl p-8 text-white">
        <div className="flex items-center gap-6">
          <div className="w-20 h-20 bg-white/20 backdrop-blur-sm rounded-2xl flex items-center justify-center">
            <Crown className="w-10 h-10 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold mb-2">Admin Profile Settings</h1>
            <p className="text-white/80 text-lg">
              Manage your agency owner account information
            </p>
            <div className="mt-3 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <Shield className="w-4 h-4" />
                <span className="text-sm font-medium">Enterprise Admin</span>
              </div>
              <div className="flex items-center gap-2">
                <Building className="w-4 h-4" />
                <span className="text-sm font-medium">AGENCY Plan</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Profile Form */}
      <div className="bg-white rounded-2xl shadow-lg border border-gray-100 p-8">
        <div className="flex items-center gap-3 mb-8">
          <User className="w-6 h-6 text-purple-600" />
          <h2 className="text-2xl font-bold text-gray-900">Personal Information</h2>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Profile Picture Section */}
          <div className="space-y-6">
            <div className="text-center">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">Profile Picture</h3>
              <ProfilePic />
              {!close && <Upload setClose={setClose} />}
              {image && <Preview image={image} setImage={setImage} setClose={setClose} />}
              
              <button
                onClick={() => setClose(false)}
                className="mt-4 flex items-center gap-2 mx-auto bg-purple-100 hover:bg-purple-200 text-purple-700 px-4 py-2 rounded-lg font-medium transition-colors"
              >
                <Edit3 className="w-4 h-4" />
                Change Picture
              </button>
            </div>

            {/* Agency Info */}
            <div className="bg-gradient-to-br from-purple-50 to-indigo-50 rounded-xl p-6">
              <h4 className="font-bold text-gray-900 mb-4 flex items-center gap-2">
                <Building className="w-5 h-5 text-purple-600" />
                Agency Status
              </h4>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Account Type</span>
                  <span className="font-medium text-purple-900">Enterprise Admin</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Plan</span>
                  <span className="font-medium text-purple-900">AGENCY</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-600">Status</span>
                  <span className="font-medium text-green-700">Active</span>
                </div>
              </div>
            </div>
          </div>

          {/* Form Fields */}
          <div className="lg:col-span-2 space-y-6">
            <form onSubmit={handleSubmit} className="space-y-6">
              {/* Name Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    First Name *
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="text"
                      value={firstname}
                      onChange={handleFirstNameChange}
                      className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300"
                      style={{ borderColor: firstNameColor }}
                      placeholder="Enter your first name"
                      required
                    />
                  </div>
                  {!firstNameStatus && (
                    <p className="text-red-500 text-xs mt-1">Please enter a valid first name (min 2 characters, letters only)</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Last Name *
                  </label>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="text"
                      value={lastname}
                      onChange={handleLastNameChange}
                      className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300"
                      style={{ borderColor: lastNameColor }}
                      placeholder="Enter your last name"
                      required
                    />
                  </div>
                  {!lastNameStatus && (
                    <p className="text-red-500 text-xs mt-1">Please enter a valid last name (min 2 characters, letters only)</p>
                  )}
                </div>
              </div>

              {/* Contact Fields */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Phone Number *
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="tel"
                      value={phone}
                      onChange={handlePhoneChange}
                      className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300"
                      style={{ borderColor: phoneColor }}
                      placeholder="Enter 10-digit phone number"
                      required
                    />
                  </div>
                  {!phoneStatus && (
                    <p className="text-red-500 text-xs mt-1">Please enter a valid 10-digit phone number</p>
                  )}
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    WhatsApp Number *
                  </label>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                    <input
                      type="tel"
                      value={whatsapp}
                      onChange={handleWhatsappChange}
                      className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300"
                      style={{ borderColor: whatsappColor }}
                      placeholder="Enter WhatsApp number"
                      required
                    />
                  </div>
                  {!whatsappStatus && (
                    <p className="text-red-500 text-xs mt-1">Please enter a valid 10-digit WhatsApp number</p>
                  )}
                </div>
              </div>

              {/* Email Field */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Email Address *
                </label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
                  <input
                    type="email"
                    value={email}
                    onChange={handleEmailChange}
                    className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all duration-300"
                    style={{ borderColor: emailColor }}
                    placeholder="Enter your email address"
                    required
                  />
                </div>
                {!emailStatus && (
                  <p className="text-red-500 text-xs mt-1">Please enter a valid email address</p>
                )}
              </div>

              {/* Submit Button */}
              <div className="flex justify-end pt-6">
                <button
                  ref={submitBtn}
                  type="submit"
                  disabled={loading}
                  className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400 text-white px-8 py-3 rounded-lg font-medium transition-colors"
                >
                  {loading ? (
                    <>
                      <BeatLoader color="#ffffff" size={8} />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Edit3 className="w-4 h-4" />
                      Update Profile
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}