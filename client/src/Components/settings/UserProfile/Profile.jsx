import React, { useState, useRef, useEffect } from "react";
import ProfilePic from "./ProfilePic";
import Upload from "./Upload";
import Preview from "./Preview";
import { useSelector, useDispatch } from 'react-redux';
import { loginSuccess } from '../../../redux/slices/authSlice.js';
import axios from 'axios';
import BeatLoader from "react-spinners/BeatLoader";
import { User, Phone, Mail, Edit3 } from "lucide-react";

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
        dispatch(loginSuccess(response.data.data.UpdateInfo));
       
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

  return (
    <div className="bg-white rounded-2xl border border-gray-200/80 shadow-sm hover:shadow-lg transition-all duration-300 overflow-hidden">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-slate-900 via-purple-900 to-slate-900 px-6 py-8 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")"}}></div>
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-2 h-8 bg-gradient-to-b from-blue-400 to-purple-500 rounded-full"></div>
            <div className="flex items-center gap-3">
              <User className="w-6 h-6 text-white" />
              <h2 className="text-2xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                Profile Details
              </h2>
            </div>
          </div>
          <p className="text-gray-300 text-sm">Manage your personal information and account settings</p>
        </div>
      </div>

      {/* Content Section */}
      <div className="p-6">
        {/* Profile Image Section */}
        <div className="mb-8">
          {(!pic || pic.length === 0) && <Upload handleFile={handleFile} />}
          {!close && <Preview image={image} setImage={setImage} setClose={setClose} />}
          {(pic !== null && pic.length !== 0) && <ProfilePic handleFile={handleFile} setClose={setClose} />}
        </div>

        {/* Form Section */}
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
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
        <div className="flex justify-end pt-6 border-t border-gray-200/80 mt-8">
          <button
            type="submit"
            className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium rounded-xl hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-lg hover:shadow-xl min-w-[160px] justify-center"
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
      </div>
    </div>
  );
}

// Updated InputField component with modern styling
const InputField = ({ label, value, editable, color, name, func, onEdit, icon: Icon }) => (
  <div className="space-y-2">
    <label className="block text-sm font-semibold text-gray-900">{label}</label>
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
        className={`w-full pl-10 pr-12 py-3 border-2 rounded-xl transition-all duration-200 font-medium ${
          editable 
            ? 'bg-gray-50 border-gray-200 text-gray-500 cursor-not-allowed' 
            : 'bg-white border-blue-200 text-gray-900 focus:border-blue-500 focus:ring-2 focus:ring-blue-200 focus:outline-none'
        }`}
        style={{ 
          borderColor: editable ? '#e5e7eb' : (color === '#333651' ? '#3b82f6' : '#e5e7eb')
        }}
      />
      <button
        type="button"
        className={`absolute inset-y-0 right-0 px-3 flex items-center transition-all duration-200 rounded-r-xl ${
          editable 
            ? 'bg-gray-100 hover:bg-gray-200 text-gray-600' 
            : 'bg-blue-50 hover:bg-blue-100 text-blue-600'
        }`}
        onClick={onEdit}
      >
        <Edit3 className="w-4 h-4" />
      </button>
    </div>
  </div>
);
