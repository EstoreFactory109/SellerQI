import React, { useState, useMemo } from "react";
import axios from "axios";
import BeatLoader from "react-spinners/BeatLoader";
import {useNavigate} from 'react-router-dom'
import { Search, ChevronDown, Link } from 'lucide-react';

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
    <div className="fixed inset-0 bg-black bg-opacity-50 flex justify-center items-center z-50">
      <div className="bg-[#161b22] rounded-lg shadow-lg w-full max-w-md p-4 relative border border-[#30363d]">
        {/* Close button */}
        <button onClick={closeAddAccount} className="absolute top-3 right-3 text-gray-400 hover:text-gray-200">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Icon */}
        <div className="flex justify-center mb-3">
          <div className="bg-yellow-600/20 rounded-full p-2 border border-yellow-600/40">
            <Link className="w-8 h-8 text-yellow-400" />
          </div>
        </div>

        <h2 className="text-xl font-semibold text-center mb-1 text-gray-100">Connect to Amazon</h2>
        <p className="text-center text-gray-400 text-sm mb-4">Select your country to connect</p>

        <form onSubmit={handleSubmit}>
          {/* Country Selection with Search */}
          <label className="block text-gray-200 mb-1 text-sm">Select Country</label>
          <div className="relative mb-3">
            {/* Selected Country Display / Dropdown Trigger */}
            <button
              type="button"
              onClick={() => setIsDropdownOpen(!isDropdownOpen)}
              className="w-full border border-[#30363d] rounded-md p-2.5 outline-none text-left flex items-center justify-between hover:border-[#21262d] transition-colors bg-[#1a1a1a] text-gray-100"
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
              <div className="absolute z-50 w-full mt-1 bg-[#161b22] border border-[#30363d] rounded-md shadow-lg overflow-hidden">
                {/* Search Input */}
                <div className="p-2 border-b border-[#30363d]">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Search country..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-2 bg-[#1a1a1a] border border-[#30363d] rounded outline-none focus:border-blue-500 text-sm text-gray-100"
                      autoFocus
                    />
                  </div>
                </div>

                {/* Country List */}
                <div className="max-h-48 overflow-y-auto">
                  {filteredCountries.length === 0 ? (
                    <div className="px-3 py-4 text-center text-gray-400 text-sm">
                      No countries found
                    </div>
                  ) : (
                    <>
                      {['NA', 'EU', 'FE'].map(regionCode => {
                        const regionCountries = filteredCountries.filter(c => c.region === regionCode);
                        if (regionCountries.length === 0) return null;
                        
                        return (
                          <div key={regionCode}>
                            <div className="px-3 py-1.5 bg-[#1a1a1a] text-xs font-semibold text-gray-400 uppercase tracking-wider sticky top-0 border-b border-[#30363d]">
                              {REGION_NAMES[regionCode]}
                            </div>
                            {regionCountries.map(country => (
                              <button
                                key={country.code}
                                type="button"
                                onClick={() => handleCountrySelect(country.code)}
                                className={`w-full px-3 py-2 text-left hover:bg-[#21262d] transition-colors flex items-center gap-2 text-sm text-gray-100 ${
                                  marketPlace === country.code ? 'bg-[#21262d] border-l-2 border-blue-500' : ''
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
          <div className="flex justify-between gap-2">
            <button
              type="button"
              onClick={closeAddAccount}
              className="w-1/2 h-10 border border-[#30363d] rounded-md text-gray-200 hover:bg-[#21262d] transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="w-1/2 h-10 bg-blue-600 text-white rounded-md hover:bg-blue-700 flex items-center justify-center transition"
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