import React, { useState } from "react";
import axios from "axios";
import BeatLoader from "react-spinners/BeatLoader";
import Connect from '../../../assets/Icons/connect.png';
import {useNavigate} from 'react-router-dom'

const AmazonConnectPopup = ({ closeAddAccount}) => {
  const navigate = useNavigate();
  const [marketPlace, setMarketPlace] = useState("");
  const [region, setRegion] = useState("");
  const [loading, setLoading] = useState(false);

  const handleMarketPlaceChange = (e) => {
    setMarketPlace(e.target.value);
    console.log("Selected Marketplace:", e.target.value);
  };

  const handleRegionChange = (e) => {
    setRegion(e.target.value);
    console.log("Selected Region:", e.target.value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    try {
      const response = await axios.post(
        `${import.meta.env.VITE_BASE_URI}/app/token/saveDetailsOfOtherAccounts`,
        {
          region: region,
          country: marketPlace,
        },
        { withCredentials: true }
      );

      if (response.status === 201) {
        setLoading(false);
        // Navigate to profile selection page with region parameter
        navigate(`/connect-accounts?region=${region}&country=${marketPlace}`)
      }
    } catch (error) {
      setLoading(false);
      throw new Error(error);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-30 flex justify-center items-center z-50">
      <div className="bg-white rounded-lg shadow-lg w-full max-w-md p-6 relative">
        {/* Close button */}
        <button onClick={closeAddAccount} className="absolute top-4 right-4 text-gray-500 hover:text-gray-700">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Icon */}
        <div className="flex justify-center mb-4">
          <div className="bg-yellow-100 rounded-full p-2">
            <img src={Connect} alt="Connect" className="w-8 h-8" />
          </div>
        </div>

        <h2 className="text-2xl font-semibold text-center mb-2">Connect to Amazon</h2>
        <p className="text-center text-gray-500 text-sm mb-6">Select your region and primary marketplace</p>

        <form onSubmit={handleSubmit}>
          {/* Region */}
          <label className="block text-gray-700 mb-1">Region</label>
          <select
            className="w-full border border-gray-300 rounded-md p-2 mb-4 outline-none"
            value={region}
            onChange={handleRegionChange}
          >
            <option value="">-- Select Region --</option>
            <option value="NA">North America</option>
            <option value="EU">Europe</option>
            <option value="FE">Far East</option>
          </select>

          {/* Marketplace */}
          <label className="block text-gray-700 mb-1">Primary Marketplace</label>
          <select
            className="w-full border border-gray-300 rounded-md p-2 mb-6 outline-none"
            value={marketPlace}
            onChange={handleMarketPlaceChange}
          >
            <option value="">-- Select Marketplace --</option>
            {region === "NA" && (
              <>
                <option value="US">United States</option>
                <option value="CA">Canada</option>
                <option value="MX">Mexico</option>
                <option value="BR">Brazil</option>
              </>
            )}
            {region === "EU" && (
              <>
                <option value="UK">United Kingdom</option>
                <option value="DE">Germany</option>
                <option value="FR">France</option>
                <option value="IT">Italy</option>
                <option value="ES">Spain</option>
                <option value="NL">Netherlands</option>
                <option value="BE">Belgium</option>
                <option value="SE">Sweden</option>
                <option value="PL">Poland</option>
                <option value="TR">Turkey</option>
                <option value="SA">Saudi Arabia</option>
                <option value="AE">United Arab Emirates</option>
                <option value="EG">Egypt</option>
                <option value="ZA">South Africa</option>
                <option value="IN">India</option>
              </>
            )}
            {region === "FE" && (
              <>
                <option value="JP">Japan</option>
                <option value="SG">Singapore</option>
                <option value="AU">Australia</option>
              </>
            )}
          </select>

          {/* Buttons */}
          <div className="flex justify-between">
            <button
              type="button"
              onClick={closeAddAccount}
              className="w-1/2 h-12 border border-gray-300 rounded-md mr-2 text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w-1/2 h-12 bg-[#333651] text-white rounded-md hover:bg-gray-700 flex items-center justify-center"
            >
              {loading ? <BeatLoader color="#ffffff" size={10} /> : "Connect Now"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AmazonConnectPopup;