import React, { useState, useMemo } from "react";
import axios from "axios";
import BeatLoader from "react-spinners/BeatLoader";
import Connect from '../../../assets/Icons/connect.png';
import {useNavigate} from 'react-router-dom'
import { Search, ChevronDown } from 'lucide-react';

// Complete list of Amazon marketplaces with region mapping
const COUNTRY_DATA = [
  // North America (NA)
  { code: 'CA', name: 'Canada', marketplaceId: 'A2EUQ1WTGCTBG2', region: 'NA', flag: '🇨🇦' },
  { code: 'US', name: 'United States of America', marketplaceId: 'ATVPDKIKX0DER', region: 'NA', flag: '🇺🇸' },
  { code: 'MX', name: 'Mexico', marketplaceId: 'A1AM78C64UM0Y8', region: 'NA', flag: '🇲🇽' },
  { code: 'BR', name: 'Brazil', marketplaceId: 'A2Q3Y263D00KWC', region: 'NA', flag: '🇧🇷' },
  
  // Europe (EU)
  { code: 'IE', name: 'Ireland', marketplaceId: 'A28R8C7NBKEWEA', region: 'EU', flag: '🇮🇪' },
  { code: 'ES', name: 'Spain', marketplaceId: 'A1RKKUPIHCS9HS', region: 'EU', flag: '🇪🇸' },
  { code: 'UK', name: 'United Kingdom', marketplaceId: 'A1F83G8C2ARO7P', region: 'EU', flag: '🇬🇧' },
  { code: 'FR', name: 'France', marketplaceId: 'A13V1IB3VIYZZH', region: 'EU', flag: '🇫🇷' },
  { code: 'BE', name: 'Belgium', marketplaceId: 'AMEN7PMS3EDWL', region: 'EU', flag: '🇧🇪' },
  { code: 'NL', name: 'Netherlands', marketplaceId: 'A1805IZSGTT6HS', region: 'EU', flag: '🇳🇱' },
  { code: 'DE', name: 'Germany', marketplaceId: 'A1PA6795UKMFR9', region: 'EU', flag: '🇩🇪' },
  { code: 'IT', name: 'Italy', marketplaceId: 'APJ6JRA9NG5V4', region: 'EU', flag: '🇮🇹' },
  { code: 'SE', name: 'Sweden', marketplaceId: 'A2NODRKZP88ZB9', region: 'EU', flag: '🇸🇪' },
  { code: 'ZA', name: 'South Africa', marketplaceId: 'AE08WJ6YKNBMC', region: 'EU', flag: '🇿🇦' },
  { code: 'PL', name: 'Poland', marketplaceId: 'A1C3SOZRARQ6R3', region: 'EU', flag: '🇵🇱' },
  { code: 'EG', name: 'Egypt', marketplaceId: 'ARBP9OOSHTCHU', region: 'EU', flag: '🇪🇬' },
  { code: 'TR', name: 'Turkey', marketplaceId: 'A33AVAJ2PDY3EV', region: 'EU', flag: '🇹🇷' },
  { code: 'SA', name: 'Saudi Arabia', marketplaceId: 'A17E79C6D8DWNP', region: 'EU', flag: '🇸🇦' },
  { code: 'AE', name: 'United Arab Emirates', marketplaceId: 'A2VIGQ35RCS4UG', region: 'EU', flag: '🇦🇪' },
  { code: 'IN', name: 'India', marketplaceId: 'A21TJRUUN4KGV', region: 'EU', flag: '🇮🇳' },
  
  // Far East (FE)
  { code: 'SG', name: 'Singapore', marketplaceId: 'A19VAU5U5O7RUS', region: 'FE', flag: '🇸🇬' },
  { code: 'AU', name: 'Australia', marketplaceId: 'A39IBJ37TRP1C6', region: 'FE', flag: '🇦🇺' },
  { code: 'JP', name: 'Japan', marketplaceId: 'A1VC38T7YXB528', region: 'FE', flag: '🇯🇵' },
];

// Region display names
const REGION_NAMES = {
  'NA': 'North America',
  'EU': 'Europe',
  'FE': 'Far East'
};

const AmazonConnectPopup = ({ closeAddAccount}) => {
  const navigate = useNavigate();
  const [marketPlace, setMarketPlace] = useState("");
  const [region, setRegion] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  // Get selected country data
  const selectedCountry = useMemo(() => {
    return COUNTRY_DATA.find(country => country.code === marketPlace);
  }, [marketPlace]);

  // Filter countries based on search query
  const filteredCountries = useMemo(() => {
    if (!searchQuery.trim()) return COUNTRY_DATA;
    const query = searchQuery.toLowerCase();
    return COUNTRY_DATA.filter(country => 
      country.name.toLowerCase().includes(query) || 
      country.code.toLowerCase().includes(query)
    );
  }, [searchQuery]);

  const handleCountrySelect = (countryCode) => {
    const country = COUNTRY_DATA.find(c => c.code === countryCode);
    if (country) {
      setMarketPlace(countryCode);
      setRegion(country.region);
      setIsDropdownOpen(false);
      setSearchQuery("");
      
      // Debug logging for region detection
      console.log("=== Country Selection Debug ===");
      console.log("Selected Country:", country.name);
      console.log("Country Code:", countryCode);
      console.log("Auto-detected Region:", country.region);
      console.log("Region Name:", REGION_NAMES[country.region]);
      console.log("Marketplace ID:", country.marketplaceId);
      console.log("===============================");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    if (!marketPlace || !region) {
      alert("Please select a country");
      return;
    }
    
    setLoading(true);
    try {
      console.log("Submitting with region:", region, "and country:", marketPlace);
      
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
        <p className="text-center text-gray-500 text-sm mb-6">Select your country to connect</p>

        <form onSubmit={handleSubmit}>
          {/* Country Selection with Search */}
          <label className="block text-gray-700 mb-1">Select Country</label>
          <div className="relative mb-4">
            {/* Selected Country Display / Dropdown Trigger */}
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full border border-gray-300 rounded-md p-2.5 outline-none text-left flex items-center justify-between hover:border-gray-400 transition-colors"
            >
              {selectedCountry ? (
                <span className="flex items-center gap-2">
                  <span className="text-lg">{selectedCountry.flag}</span>
                  <span>{selectedCountry.name}</span>
                </span>
              ) : (
                <span className="text-gray-400">-- Select Country --</span>
              )}
              <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* Dropdown */}
            {isDropdownOpen && (
              <div className="absolute z-50 w-full mt-1 bg-white border border-gray-300 rounded-md shadow-lg overflow-hidden">
                {/* Search Input */}
                <div className="p-2 border-b border-gray-200">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search country..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 bg-gray-50 border border-gray-200 rounded outline-none focus:border-[#333651] text-sm"
                      autoFocus
                    />
                  </div>
                </div>

                {/* Country List */}
                <div className="max-h-48 overflow-y-auto">
                  {filteredCountries.length === 0 ? (
                    <div className="px-3 py-4 text-center text-gray-500 text-sm">
                      No countries found
                    </div>
                  ) : (
                    <>
                      {['NA', 'EU', 'FE'].map(regionCode => {
                        const regionCountries = filteredCountries.filter(c => c.region === regionCode);
                        if (regionCountries.length === 0) return null;
                        
                        return (
                          <div key={regionCode}>
                            <div className="px-3 py-1.5 bg-gray-100 text-xs font-semibold text-gray-500 uppercase tracking-wider sticky top-0">
                              {REGION_NAMES[regionCode]}
                            </div>
                            {regionCountries.map(country => (
                              <button
                                key={country.code}
                                type="button"
                                onClick={() => handleCountrySelect(country.code)}
                                className={`w-full px-3 py-2 text-left hover:bg-blue-50 transition-colors flex items-center gap-2 text-sm ${
                                  marketPlace === country.code ? 'bg-blue-50 border-l-2 border-[#333651]' : ''
                                }`}
                              >
                                <span className="text-base">{country.flag}</span>
                                <span className="flex-1">{country.name}</span>
                                <span className="text-xs text-gray-400">{country.code}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Click outside to close dropdown */}
          {isDropdownOpen && (
            <div 
              className="fixed inset-0 z-40" 
              onClick={() => {
                setIsDropdownOpen(false);
                setSearchQuery("");
              }}
            />
          )}

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