import React, { useState, useMemo, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from 'framer-motion';
import { Globe, ChevronDown, ArrowRight, Loader2, Package, ShoppingCart, Zap, Search } from 'lucide-react';
import axios from 'axios';
import { useSelector } from 'react-redux';
import { hasPremiumAccess } from '../../utils/subscriptionCheck.js';
import { devLog } from '../../utils/devLogger.js';

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

const AmazonConnect = ({ isAgencyContext = false, clientId = null, agencyName = '' }) => {
  const [marketPlace, setMarketPlace] = useState("");
  const [region, setRegion] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [checkingSubscription, setCheckingSubscription] = useState(true);
  const navigate = useNavigate();
  
  // Get user data from Redux
  const userData = useSelector(state => state.Auth?.user);
  const isAuthenticated = useSelector(state => state.Auth?.isAuthenticated) || localStorage.getItem('isAuth') === 'true';

  // Check authentication on mount - allow all authenticated users to proceed
  useEffect(() => {
    const checkAuth = async () => {
      // If not authenticated, redirect to login
      if (!isAuthenticated) {
        devLog('ConnectToAmazon: Not authenticated - redirecting to login');
        navigate('/', { replace: true });
        return;
      }

      // Allow all authenticated users to proceed (skip pricing check)
      // New signups with LITE package can connect Amazon first, then pay later
      devLog('ConnectToAmazon: User authenticated - allowing access');
      setCheckingSubscription(false);
    };

    checkAuth();
  }, [isAuthenticated, navigate]);
  
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

      devLog("ConnectToAmazon country select:", {
        countryName: country.name,
        countryCode,
        region: country.region,
        regionName: REGION_NAMES[country.region],
        marketplaceId: country.marketplaceId,
      });
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    
    // Validate selections
    if (!region || !marketPlace) {
      alert("Please select a country");
      return;
    }
    
    setLoading(true);
    try {
      devLog("ConnectToAmazon submit:", { region, country: marketPlace });
      
      const response = await axios.post(`${import.meta.env.VITE_BASE_URI}/app/token/SaveAllDetails`, {
        region: region,
        country: marketPlace
      }, { withCredentials: true });

      // Redirect to connect accounts page with region and country parameters
      if (response.status === 201) {
        setLoading(false);
        if (isAgencyContext && clientId && agencyName) {
          navigate(`/agency/${encodeURIComponent(agencyName)}/client/${clientId}/connect-accounts?country=${marketPlace}&region=${region}`);
        } else {
          navigate(`/connect-accounts?country=${marketPlace}&region=${region}`);
        }
      }

    } catch (error) {
      setLoading(false);
      console.error("Error saving details:", error);
      alert("Failed to save marketplace details. Please try again.");
    }
  };

  // Show loading state while checking subscription
  if (checkingSubscription) {
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          <p className="text-white/70">Verifying subscription...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center font-roboto relative overflow-hidden">
      {/* Main Content */}
      <div className="relative z-10 w-full max-w-6xl mx-auto px-4 py-8">
        <div className="grid lg:grid-cols-2 gap-12 items-center">
          
          {/* Left Side - Marketing Content */}
          <motion.div
            initial={{ opacity: 0, x: -50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8 }}
            className="space-y-8"
          >
            {/* Brand Logo/Identity */}
            <div className="flex items-center space-x-3">
              <img 
                src="https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png"
                alt="SellerQI Logo"
                className="h-8 w-auto object-contain"
              />
              <div>
                <h2 className="text-xl font-bold text-white">SellerQI</h2>
                <p className="text-sm text-white/60">Amazon Analytics Platform</p>
              </div>
            </div>

            <div className="space-y-6">
              <h1 className="text-4xl lg:text-5xl font-bold text-white leading-tight">
                Connect to <span className="text-blue-400">Amazon</span>
              </h1>
              
              <p className="text-lg text-white/70 leading-relaxed">
                Unlock powerful insights from your Amazon seller account. Get comprehensive analytics, 
                track performance, and optimize your business within 24 hours.
              </p>

              {/* Feature highlights */}
              <div className="grid grid-cols-1 gap-4">
                {[
                  { icon: ShoppingCart, title: "Sales Analytics", desc: "Track revenue, units sold, and trends" },
                  { icon: Zap, title: "Performance Insights", desc: "Monitor product rankings and metrics" },
                  { icon: Package, title: "Inventory Management", desc: "Stay on top of stock levels" }
                ].map((feature, index) => (
                  <motion.div
                    key={index}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.3 + index * 0.1 }}
                    className="flex items-center space-x-4 p-4 bg-[#161b22] backdrop-blur-sm rounded-xl border border-[#30363d]"
                  >
                    <div className="w-10 h-10 bg-blue-500/20 rounded-lg flex items-center justify-center border border-blue-500/30">
                      <feature.icon className="w-5 h-5 text-blue-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-white">{feature.title}</h3>
                      <p className="text-sm text-white/70">{feature.desc}</p>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>

          {/* Right Side - Form */}
          <motion.div
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="w-full"
          >
            <div className="bg-[#161b22] rounded-3xl shadow-2xl border border-[#30363d] p-8 lg:p-10">
              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Header */}
                <div className="text-center space-y-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.5, type: "spring", stiffness: 200 }}
                    className="flex justify-center"
                  >
                    <img 
                      src="https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png"
                      alt="SellerQI Logo"
                      className="h-12 w-auto object-contain"
                    />
                  </motion.div>
                  <div>
                    <h2 className="text-2xl font-bold text-white">Start Your Journey</h2>
                    <p className="text-white/60">Select your Amazon marketplace to begin</p>
                  </div>
                </div>

                {/* Country Selection with Search */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="space-y-3"
                >
                  <label className="flex items-center gap-3 text-base font-semibold text-white/90">
                    <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center border border-blue-500/30">
                      <Globe className="w-4 h-4 text-blue-400" />
                    </div>
                    Select Your Country
                  </label>
                  
                  <div className="relative">
                    {/* Selected Country Display / Dropdown Trigger */}
                    <button
                      type="button"
                      onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                      className="w-full px-5 py-4 bg-[#21262d] border-2 border-[#30363d] rounded-xl outline-none transition-all duration-300 focus:border-blue-500 focus:ring-4 focus:ring-blue-500/20 text-base shadow-sm hover:shadow-md text-left flex items-center justify-between text-gray-100"
                    >
                      {selectedCountry ? (
                        <span className="flex items-center gap-2">
                          <span className="text-xl">{selectedCountry.flag}</span>
                          <span>{selectedCountry.name}</span>
                          <span className="text-xs text-gray-400 bg-[#161b22] px-2 py-0.5 rounded-full ml-2 border border-[#30363d]">
                            {REGION_NAMES[selectedCountry.region]}
                          </span>
                        </span>
                      ) : (
                        <span className="text-gray-500">-- Select your country --</span>
                      )}
                      <ChevronDown className={`w-5 h-5 text-gray-400 transition-transform duration-200 ${isDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {/* Dropdown */}
                    {isDropdownOpen && (
                      <motion.div
                        initial={{ opacity: 0, y: -10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -10 }}
                        className="absolute z-50 w-full mt-2 bg-[#161b22] border-2 border-[#30363d] rounded-xl shadow-xl overflow-hidden"
                      >
                        {/* Search Input */}
                        <div className="p-3 border-b border-[#30363d]">
                          <div className="relative">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                            <input
                              type="text"
                              placeholder="Search country..."
                              value={searchQuery}
                              onChange={(e) => setSearchQuery(e.target.value)}
                              className="w-full pl-10 pr-4 py-2.5 bg-[#21262d] border border-[#30363d] text-gray-100 rounded-lg outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20 text-sm placeholder-gray-500"
                              autoFocus
                            />
                          </div>
                        </div>

                        {/* Country List */}
                        <div className="max-h-64 overflow-y-auto">
                          {filteredCountries.length === 0 ? (
                            <div className="px-4 py-8 text-center text-gray-500">
                              No countries found matching "{searchQuery}"
                            </div>
                          ) : (
                            <>
                              {/* Group by region */}
                              {['NA', 'EU', 'FE'].map(regionCode => {
                                const regionCountries = filteredCountries.filter(c => c.region === regionCode);
                                if (regionCountries.length === 0) return null;
                                
                                return (
                                  <div key={regionCode}>
                                    <div className="px-4 py-2 bg-[#21262d] text-xs font-semibold text-gray-400 uppercase tracking-wider sticky top-0 border-b border-[#30363d]">
                                      {REGION_NAMES[regionCode]}
                                    </div>
                                    {regionCountries.map(country => (
                                      <button
                                        key={country.code}
                                        type="button"
                                        onClick={() => handleCountrySelect(country.code)}
                                        className={`w-full px-4 py-3 text-left hover:bg-[#21262d] transition-colors flex items-center gap-3 text-gray-300 ${
                                          marketPlace === country.code ? 'bg-blue-500/10 border-l-4 border-blue-500' : ''
                                        }`}
                                      >
                                        <span className="text-xl">{country.flag}</span>
                                        <span className="flex-1">{country.name}</span>
                                        <span className="text-xs text-gray-500">{country.code}</span>
                                      </button>
                                    ))}
                                  </div>
                                );
                              })}
                            </>
                          )}
                        </div>
                      </motion.div>
                    )}
                  </div>
                </motion.div>

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

                {/* Submit Button */}
                <motion.button
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8 }}
                  type="submit"
                  disabled={loading || !region || !marketPlace}
                  className={`group relative w-full py-4 px-6 rounded-xl font-bold text-lg transition-all duration-300 flex items-center justify-center gap-3 shadow-lg ${
                    loading || !region || !marketPlace
                      ? 'bg-gray-600 text-white/60 cursor-not-allowed'
                       : 'bg-blue-600 text-white hover:bg-blue-500 transform hover:scale-[1.02] active:scale-[0.98]'
                   }`}
                 >
                   <div className="relative flex items-center gap-3">
                     {loading ? (
                       <Loader2 className="w-6 h-6 animate-spin" />
                     ) : (
                       <>
                         <Package className="w-6 h-6" />
                         <span>Connect to Amazon</span>
                         <ArrowRight className="w-5 h-5 group-hover:translate-x-1 transition-all duration-300" />
                       </>
                     )}
                   </div>
                </motion.button>

                {/* Trust indicators */}
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.9 }}
                  className="text-center space-y-2"
                >
                  <div className="flex items-center justify-center gap-4 text-sm text-white/60">
                     <div className="flex items-center gap-1">
                       <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                       <span>Secure Connection</span>
                     </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
                      <span>24hr Setup</span>
                    </div>
                  </div>
                  <p className="text-xs text-white/50">
                    Your Amazon data is processed securely and never stored permanently
                  </p>
                </motion.div>
              </form>
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default AmazonConnect;