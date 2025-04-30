import React, { useState, useRef, useEffect } from "react";
import ProfilePic from "./ProfilePic";
import Upload from "./Upload";
import Preview from "./Preview";
import { useSelector, useDispatch } from 'react-redux';
import { loginSuccess } from '../../../redux/slices/authSlice.js';
import axios from 'axios';
import BeatLoader from "react-spinners/BeatLoader";

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
    <div className="max-w-full mx-auto p-6 bg-white rounded-lg shadow-md">
      <h2 className="text-base font-light mb-1">PROFILE DETAILS</h2>
      <p className="text-sm text-gray-500 mb-6">Edit your profile details</p>

      {(!pic || pic.length === 0) && <Upload handleFile={handleFile} />}
      {!close && <Preview image={image} setImage={setImage} setClose={setClose} />}
      {(pic !== null && pic.length !== 0) && <ProfilePic handleFile={handleFile} setClose={setClose} />}

      <form className="grid grid-cols-1 md:grid-cols-2 gap-4" onSubmit={handleSubmit}>
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
        />

        {/* Email */}
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
        />
        
        <button type="submit" className="hidden" ref={submitBtn}></button>
      </form>

      <div className="flex justify-end gap-4 mt-8">
        <button
          type="submit"
          className="w-[10rem] h-10  bg-[#333651] text-white rounded-md"
          onClick={clickSave}
        >
          {loading ? <BeatLoader color="#fff" size={8} /> : <p>Save Information</p>}
        </button>
      </div>
    </div>
  );
}

// Reusable InputField component
const InputField = ({ label, value, editable, color, name, func, onEdit }) => (
  <div>
    <label className="block text-sm font-medium text-gray-700">{label}</label>
    <div className="mt-1 flex w-full h-10 rounded-md border-2 pl-2" style={{ borderColor: color }}>
      <input
        type="text"
        disabled={editable}
        value={value}
        onChange={func}
        name={name}
        className="w-[93%] outline-none"
        style={{ color }}
      />
      <button
        type="button"
        className="bg-gray-300 w-[7%] px-2 border-l-2"
        style={{ borderColor: color }}
        onClick={onEdit}
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 20h9" />
          <path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" />
        </svg>
      </button>
    </div>
  </div>
);
