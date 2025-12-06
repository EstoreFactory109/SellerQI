import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion } from 'framer-motion';
import { Globe, MapPin, ChevronDown, ArrowRight, Loader2, Package, ShoppingCart, Zap } from 'lucide-react';
import axios from 'axios';

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
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-blue-50 flex items-center justify-center font-roboto relative overflow-hidden">
      
       {/* Background brand-themed elements */}
       <div className="absolute inset-0 overflow-hidden">
         <div className="absolute -top-32 -right-32 w-64 h-64 bg-gradient-to-br from-blue-200/30 to-violet-300/20 rounded-full blur-3xl"></div>
         <div className="absolute -bottom-32 -left-32 w-64 h-64 bg-gradient-to-br from-violet-200/30 to-pink-300/20 rounded-full blur-3xl"></div>
         <div className="absolute top-1/2 left-1/4 w-32 h-32 bg-gradient-to-br from-pink-200/20 to-blue-200/20 rounded-full blur-2xl"></div>
       </div>

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
              <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center shadow-lg border border-gray-200">
                <img 
                  src="/Logo.png"
                  alt="SellerQI Logo"
                  className="h-8 w-auto object-contain"
                />
              </div>
              <div>
                <h2 className="text-xl font-bold bg-gradient-to-r from-[#3B4A6B] to-violet-600 bg-clip-text text-transparent">
                  SellerQI
                </h2>
                <p className="text-sm text-gray-500">Amazon Analytics Platform</p>
              </div>
            </div>

            <div className="space-y-6">
              <h1 className="text-4xl lg:text-5xl font-bold text-gray-900 leading-tight">
                Connect to 
                <span className="bg-gradient-to-r from-[#3B4A6B] to-pink-600 bg-clip-text text-transparent"> Amazon</span>
              </h1>
              
              <p className="text-lg text-gray-600 leading-relaxed">
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
                    className="flex items-center space-x-4 p-4 bg-white/50 backdrop-blur-sm rounded-xl border border-white/30"
                  >
                    <div className="w-10 h-10 bg-gradient-to-br from-blue-100 to-violet-100 rounded-lg flex items-center justify-center">
                      <feature.icon className="w-5 h-5 text-[#3B4A6B]" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-gray-900">{feature.title}</h3>
                      <p className="text-sm text-gray-600">{feature.desc}</p>
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
            <div className="bg-white/90 backdrop-blur-sm rounded-3xl shadow-2xl border border-white/50 p-8 lg:p-10">
              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Header */}
                <div className="text-center space-y-4">
                  <motion.div
                    initial={{ scale: 0 }}
                    animate={{ scale: 1 }}
                    transition={{ delay: 0.5, type: "spring", stiffness: 200 }}
                    className="w-20 h-20 bg-white rounded-2xl flex items-center justify-center mx-auto shadow-lg border border-gray-200"
                  >
                    <img 
                      src="/Logo.png"
                      alt="SellerQI Logo"
                      className="h-12 w-auto object-contain"
                    />
                  </motion.div>
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900">Start Your Journey</h2>
                    <p className="text-gray-600">Select your Amazon marketplace to begin</p>
                  </div>
                </div>

                {/* Region Selection */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.6 }}
                  className="space-y-3"
                >
                   <label className="flex items-center gap-3 text-base font-semibold text-gray-800">
                     <div className="w-8 h-8 bg-gradient-to-br from-blue-100 to-violet-100 rounded-lg flex items-center justify-center">
                       <MapPin className="w-4 h-4 text-[#3B4A6B]" />
                     </div>
                     Select Your Region
                   </label>
                  <div className="relative">
                    <select
                      className="w-full px-5 py-4 bg-white border-2 border-gray-200 rounded-xl outline-none transition-all duration-300 focus:border-[#3B4A6B] focus:ring-4 focus:ring-blue-100 appearance-none text-base shadow-sm hover:shadow-md"
                      value={region}
                      onChange={handleRegionChange}
                      required
                    >
                      <option value="">-- Choose your region --</option>
                      <option value="NA">🇺🇸 North America</option>
                      <option value="EU">🇪🇺 Europe</option>
                      <option value="FE">🌏 Far East</option>
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                  </div>
                </motion.div>

                {/* Primary Marketplace Selection */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.7 }}
                  className="space-y-3"
                >
                   <label className="flex items-center gap-3 text-base font-semibold text-gray-800">
                     <div className="w-8 h-8 bg-gradient-to-br from-violet-100 to-pink-100 rounded-lg flex items-center justify-center">
                       <Globe className="w-4 h-4 text-violet-600" />
                     </div>
                     Primary Marketplace
                   </label>
                  <div className="relative">
                    <select
                      className={`w-full px-5 py-4 border-2 rounded-xl outline-none transition-all duration-300 appearance-none text-base shadow-sm ${
                        !region 
                          ? 'border-gray-200 bg-gray-50 text-gray-400 cursor-not-allowed' 
                          : 'bg-white border-gray-200 focus:border-[#3B4A6B] focus:ring-4 focus:ring-blue-100 hover:shadow-md'
                      }`}
                      value={marketPlace}
                      onChange={handleMarketPlaceChange}
                      disabled={!region}
                      required
                    >
                      <option value="">-- Choose your marketplace --</option>

                      {/* North America */}
                      {region === "NA" && (
                        <>
                          <option value="US">🇺🇸 United States</option>
                          <option value="CA">🇨🇦 Canada</option>
                          <option value="MX">🇲🇽 Mexico</option>
                          <option value="BR">🇧🇷 Brazil</option>
                        </>
                      )}

                      {/* Europe */}
                      {region === "EU" && (
                        <>
                          <option value="IE">🇮🇪 Ireland</option>
                          <option value="UK">🇬🇧 United Kingdom</option>
                          <option value="DE">🇩🇪 Germany</option>
                          <option value="FR">🇫🇷 France</option>
                          <option value="IT">🇮🇹 Italy</option>
                          <option value="ES">🇪🇸 Spain</option>
                          <option value="NL">🇳🇱 Netherlands</option>
                          <option value="BE">🇧🇪 Belgium</option>
                          <option value="SE">🇸🇪 Sweden</option>
                          <option value="PL">🇵🇱 Poland</option>
                          <option value="ZA">🇿🇦 South Africa</option>
                          <option value="TR">🇹🇷 Turkey</option>
                          <option value="SA">🇸🇦 Saudi Arabia</option>
                          <option value="AE">🇦🇪 United Arab Emirates</option>
                          <option value="EG">🇪🇬 Egypt</option>
                          <option value="IN">🇮🇳 India</option>
                        </>
                      )}

                      {/* Far East */}
                      {region === "FE" && (
                        <>
                          <option value="JP">🇯🇵 Japan</option>
                          <option value="SG">🇸🇬 Singapore</option>
                          <option value="AU">🇦🇺 Australia</option>
                        </>
                      )}
                    </select>
                    <ChevronDown className="absolute right-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-gray-400 pointer-events-none" />
                  </div>
                  
                  {/* Helper Text */}
                  {!region && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                       className="flex items-center gap-2 text-sm text-[#3B4A6B] bg-violet-50 p-3 rounded-lg"
                    >
                      <MapPin className="w-4 h-4" />
                      Please select a region first to see available marketplaces
                    </motion.div>
                  )}
                </motion.div>

                {/* Submit Button */}
                <motion.button
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.8 }}
                  type="submit"
                  disabled={loading || !region || !marketPlace}
                  className={`group relative w-full py-4 px-6 rounded-xl font-bold text-lg transition-all duration-300 flex items-center justify-center gap-3 shadow-lg ${
                    loading || !region || !marketPlace
                      ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                       : 'bg-[#3B4A6B] text-white hover:bg-[#2d3a52] transform hover:scale-[1.02] active:scale-[0.98] shadow-violet-200 hover:shadow-xl hover:shadow-violet-300'
                   }`}
                 >
                   <div className="absolute inset-0 bg-gradient-to-r from-violet-600 to-pink-600 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"></div>
                   <div className="relative flex items-center gap-3 group-hover:text-white transition-colors duration-300">
                     {loading ? (
                       <Loader2 className="w-6 h-6 animate-spin" />
                     ) : (
                       <>
                         <Package className="w-6 h-6 group-hover:text-white transition-colors duration-300" />
                         <span>Connect to Amazon</span>
                         <ArrowRight className="w-5 h-5 group-hover:translate-x-1 group-hover:text-white transition-all duration-300" />
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
                  <div className="flex items-center justify-center gap-4 text-sm text-gray-500">
                     <div className="flex items-center gap-1">
                       <div className="w-2 h-2 bg-violet-500 rounded-full animate-pulse"></div>
                       <span>Secure Connection</span>
                     </div>
                    <div className="flex items-center gap-1">
                      <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                      <span>24hr Setup</span>
                    </div>
                  </div>
                  <p className="text-xs text-gray-400">
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