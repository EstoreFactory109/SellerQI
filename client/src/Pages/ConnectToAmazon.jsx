import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import Right from "../Components/Forms/Right";
import axios from 'axios'
import BeatLoader from "react-spinners/BeatLoader";

const AmazonConnect = () => {
  const [marketPlace, setMarketPlace] = useState("");
  const [region, setRegion] = useState("");
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  
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
    
    // Validate selections
    if (!region || !marketPlace) {
      alert("Please select both region and marketplace");
      return;
    }
    
    setLoading(true);
    try {
      const response = await axios.post(`${import.meta.env.VITE_BASE_URI}/app/token/SaveAllDetails`, {
        region: region,
        country: marketPlace
      }, { withCredentials: true });

      // Redirect to connect accounts page with region and country parameters
      if (response.status === 201) {
        setLoading(false);
        
        // Navigate with query parameters
        navigate(`/connect-accounts?country=${marketPlace}&region=${region}`);
        
        // Alternative: Using navigate with object syntax
        // navigate({
        //   pathname: '/connect-accounts',
        //   search: `?country=${marketPlace}&region=${region}`
        // });
      }

    } catch (error) {
      setLoading(false);
      console.error("Error saving details:", error);
      alert("Failed to save marketplace details. Please try again.");
    }
  };

  return (
    <div className="w-screen h-screen flex font-roboto">
      
      {/* Left Section */}
      <section className="w-1/2 h-full flex flex-col justify-center items-center">
        <form className="w-3/4" onSubmit={handleSubmit}>
          {/* Header */}
          <div className="mb-8">
            <h1 className="text-2xl font-semibold mb-2">Connect to Amazon</h1>
            <p className="text-sm text-gray-600">
              Connect your Amazon account and within 24 hours all your data will be populated in the system.
            </p>
          </div>

          {/* Region Selection */}
          <label className="block text-gray-700 mb-2">Region</label>
          <div className="w-full border border-gray-300 rounded-md p-2 flex items-center mb-4">
            <select
              className="w-full bg-transparent outline-none"
              value={region}
              onChange={handleRegionChange}
              required
            >
              <option value="">-- Select Region --</option>
              <option value="NA">North America</option>
              <option value="EU">Europe</option>
              <option value="FE">Far East</option>
            </select>
          </div>

          {/* Primary Marketplace Selection */}
          <label className="block text-gray-700 mb-2">Primary Marketplace</label>
          <div className="w-full border border-gray-300 rounded-md p-2 flex items-center">
            <select
              className="w-full bg-transparent outline-none"
              value={marketPlace}
              onChange={handleMarketPlaceChange}
              disabled={!region}
              required
            >
              <option value="">-- Select Marketplace --</option>

              {/* North America */}
              {region === "NA" && (
                <>
                  <option value="US">United States</option>
                  <option value="CA">Canada</option>
                  <option value="MX">Mexico</option>
                  <option value="BR">Brazil</option>
                </>
              )}

              {/* Europe */}
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

              {/* Far East */}
              {region === "FE" && (
                <>
                  <option value="JP">Japan</option>
                  <option value="SG">Singapore</option>
                  <option value="AU">Australia</option>
                </>
              )}
            </select>
          </div>

          {/* Helper Text */}
          {!region && (
            <p className="text-xs text-gray-500 mt-1">Please select a region first</p>
          )}

          {/* Submit Button */}
          <button 
            type="submit"
            className="w-full h-12 mt-6 bg-gray-800 text-white font-semibold rounded-md hover:bg-gray-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
            disabled={loading || !region || !marketPlace}
          >
            {loading ? <BeatLoader color="#ffffff" size={10} /> : <p>Connect To Amazon</p>}
          </button>
        </form>
      </section>

      {/* Right Section */}
      <Right />
    </div>
  );
};

export default AmazonConnect;