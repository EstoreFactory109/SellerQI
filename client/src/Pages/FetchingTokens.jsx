import React, { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import { useNavigate, useSearchParams } from "react-router-dom";
import axiosInstance from "../config/axios.config";
import sellerQILogo from '../assets/Logo/sellerQILogo.png';

const FetchingTokens = () => {
  const [showAccessText, setShowAccessText] = useState(true);
  const [error, setError] = useState(null);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const hasProcessed = useRef(false); // Prevent double processing

  // Extract 'code' and 'state' from URL
  const authCode = searchParams.get("spapi_oauth_code");
  const state = searchParams.get("state");
  const sellingPartnerId = searchParams.get("selling_partner_id"); // SP-API also returns this

  const amazonAdsAuthCode = searchParams.get("code");

  // Determine which service is being connected
  const isConnectingAds = localStorage.getItem('amazonAdsLoading') === 'true';

  useEffect(() => {
    // Toggle between different messages
    const interval = setInterval(() => {
      setShowAccessText((prev) => !prev);
    }, 2500);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const generateTokens = async () => {
      // Prevent double execution in React 18 StrictMode
      if (hasProcessed.current) return;
      
      if (!authCode || !sellingPartnerId) {
        console.error("Missing required parameters: authCode or state");
        setError("Invalid authorization response from Amazon");
        // Give user time to see the error before redirecting
        setTimeout(() => {
          navigate('/auth-error', { 
            state: { error: 'Missing authorization parameters' } 
          });
        }, 2000);
        return;
      }

      hasProcessed.current = true;

      try {
        console.log("Processing SP-API authorization callback...");
        console.log("Authorization Code:", authCode);
        console.log("State Parameter:", state);
        if (sellingPartnerId) {
          console.log("Selling Partner ID:", sellingPartnerId);
        }

        // Validate state parameter (should match what was sent initially)
        const storedState = sessionStorage.getItem('spapi_oauth_state');
        if (storedState && storedState !== state) {
          throw new Error('Invalid state parameter - possible CSRF attack');
        }
        
        // Clear the stored state after validation
        sessionStorage.removeItem('spapi_oauth_state');
        
        
        // Send the authorization code and state to the backend
        const response = await axiosInstance.post('/app/token/generateSPAPITokens', {
          authCode: authCode,
          sellingPartnerId: sellingPartnerId, // Include if available
        });
        
        if (response.status === 200 && response.data) {
          console.log("Tokens generated successfully");
          
          // Store any necessary data from the response
          // The API returns ApiResponse structure: { statusCode, data, message }
          // The data contains sellerCentral with sellerAccount array
          const sellerCentralData = response.data.data;
          if (sellerCentralData && sellerCentralData.sellerAccount && sellerCentralData.sellerAccount.length > 0) {
            const firstAccount = sellerCentralData.sellerAccount[0];
            if (firstAccount.selling_partner_id) {
              sessionStorage.setItem('sp_seller_id', firstAccount.selling_partner_id);
            }
          }
          
          // Set a flag to indicate SP-API connection was just completed
          sessionStorage.setItem('sp_api_just_connected', 'true');
          
          // Navigate to connect-accounts page
          navigate('/connect-accounts')
        }
      } catch (error) {
        console.error("Error generating tokens:", error);
        
        let errorMessage = "Failed to connect to Amazon Seller Central";
        let errorCode = 500;
        
        // Handle specific error cases
        if (error.response) {
          errorCode = error.response.status;
          
          // Extract message from ApiResponse structure
          const apiMessage = error.response.data?.message;
          
          switch (errorCode) {
            case 400:
              errorMessage = apiMessage || "Invalid authorization code or request parameters";
              break;
            case 401:
              errorMessage = apiMessage || "Authorization failed - please try again";
              break;
            case 403:
              errorMessage = apiMessage || "Access forbidden - check your permissions";
              break;
            case 404:
              errorMessage = apiMessage || "Account or configuration not found";
              break;
            case 409:
              errorMessage = apiMessage || "This seller account is already connected";
              break;
            case 422:
              errorMessage = apiMessage || "Invalid request parameters";
              break;
            case 429:
              errorMessage = apiMessage || "Too many requests - please try again later";
              break;
            case 500:
              errorMessage = apiMessage || "Server error during token generation";
              break;
            default:
              errorMessage = apiMessage || "Failed to connect to Amazon Seller Central";
          }
        } else if (error.message) {
          errorMessage = error.message;
        }
        
        setError(errorMessage);
       
        // Navigate to error page with context
        setTimeout(() => {
          navigate('/auth-error', {
            state: { 
              error: errorMessage,
              errorCode: errorCode,
              canRetry: errorCode !== 409 // Don't retry if already connected
            }
          });
        }, 2000);
        
      }
    };

   const generateAmazonAdsTokens = async () => {
      if (hasProcessed.current) return;
      
      if (!amazonAdsAuthCode) {
        console.error("Missing required parameters: authCode ");
        setError("Invalid authorization response from Amazon");
        // Give user time to see the error before redirecting
        setTimeout(() => {
          navigate('/auth-error', { 
            state: { error: 'Missing authorization parameters' } 
          });
        }, 2000);
        return;
      }

      hasProcessed.current = true;

      try {
        console.log("Processing Amazon Ads authorization callback...");
        console.log("Authorization Code:", amazonAdsAuthCode);
        

        // Step 1: Generate and save the ads tokens
        const response = await axiosInstance.post('/app/token/generateAdsTokens', {
          authCode: amazonAdsAuthCode,
        });

        console.log("Token generation response:", response);
        
        if (response.status === 200 && response.data) {
          console.log("Amazon Ads tokens generated and saved successfully");
          
          // Clear the amazonAdsLoading flag
          localStorage.removeItem('amazonAdsLoading');
          
          // Get the stored marketplace info to determine region
          const selectedMarketplace = JSON.parse(localStorage.getItem('selectedMarketplace') || '{}');
          const region = selectedMarketplace.region || 'NA';
          
          // Step 2: Pre-fetch the profile IDs before redirecting
          // This ensures data is loaded before the user sees the page
          console.log("Fetching profile IDs...");
          let profileData = null;
          
          try {
            const profileResponse = await axiosInstance.get('/app/profile/getProfileId');
            
            if (profileResponse.status === 200 && profileResponse.data) {
              const dataArray = profileResponse.data.data || profileResponse.data || [];
              
              if (Array.isArray(dataArray) && dataArray.length > 0) {
                profileData = dataArray.map((scope, index) => ({
                  id: `PF${String(index + 1).padStart(3, '0')}`,
                  profileId: String(scope.profileId || scope.profile_id || 'Unknown'),
                  name: String(scope.accountInfo?.name || scope.name || 'Unknown'),
                  currency: String(scope.currencyCode || 'Unknown'),
                  country: String(scope.countryCode || scope.country_code || scope.country || 'Unknown')
                }));
                console.log("Profile IDs fetched successfully:", profileData.length, "profiles");
              }
            }
          } catch (profileError) {
            console.warn("Could not pre-fetch profile IDs:", profileError);
            // Continue anyway - the profile selection page will retry
          }
          
          // Step 3: Navigate to profile selection page with pre-fetched data
          navigate(`/profile-selection?region=${region}`, {
            state: { profileData }
          });
        }
      } catch (error) {
        console.error("Error generating tokens:", error);
        
        let errorMessage = "Failed to connect to Amazon Ads";
        let errorCode = 500;
        
        // Handle specific error cases
        if (error.response) {
          errorCode = error.response.status;
          
          // Extract message from ApiResponse structure
          const apiMessage = error.response.data?.message;
          
          switch (errorCode) {
            case 400:
              errorMessage = apiMessage || "Invalid authorization code or request parameters";
              break;
            case 401:
              errorMessage = apiMessage || "Authorization failed - please try again";
              break;
            case 403:
              errorMessage = apiMessage || "Access forbidden - check your permissions";
              break;
            case 404:
              errorMessage = apiMessage || "Account or configuration not found";
              break;
            case 409:
              errorMessage = apiMessage || "This seller account is already connected";
              break;
            case 422:
              errorMessage = apiMessage || "Invalid request parameters";
              break;
            case 429:
              errorMessage = apiMessage || "Too many requests - please try again later";
              break;
            case 500:
              errorMessage = apiMessage || "Server error during ads token generation";
              break;
            default:
              errorMessage = apiMessage || "Failed to connect to Amazon Ads";
          }
        } else if (error.message) {
          errorMessage = error.message;
        }
        
        setError(errorMessage);
       
        // Navigate to error page with context
        setTimeout(() => {
          navigate('/auth-error', {
            state: { 
              error: errorMessage,
              errorCode: errorCode,
              canRetry: errorCode !== 409 // Don't retry if already connected
            }
          });
        }, 2000);
        
      }
    }

    // Check which OAuth flow we're processing based on localStorage flag
    if (localStorage.getItem('amazonAdsLoading') === 'true') {
      generateAmazonAdsTokens();
    } else {
      generateTokens();
    }
  }, [authCode, state, sellingPartnerId, navigate]);

  // Hexagonal rotation animation
  const hexRotateVariants = {
    animate: {
      rotate: [0, 120, 240, 360],
      transition: {
        duration: 6,
        repeat: Infinity,
        ease: "linear",
      },
    },
  };

  // Pulsing wave animation
  const waveVariants = {
    animate: {
      scale: [1, 2.5, 1],
      opacity: [0.8, 0, 0.8],
      transition: {
        duration: 3,
        repeat: Infinity,
        ease: "easeInOut",
      },
    },
  };

  // Floating orbit animation
  const orbitVariants = {
    animate: {
      rotate: 360,
      transition: {
        duration: 8,
        repeat: Infinity,
        ease: "linear",
      },
    },
  };

  // Card stacking animation
  const cardStackVariants = {
    animate: {
      y: [-2, 2, -2],
      rotateY: [0, 5, 0],
      transition: {
        duration: 4,
        repeat: Infinity,
        ease: "easeInOut",
      },
    },
  };

  return (
    <motion.div
      className="w-full h-[100vh] fixed z-[99] flex flex-col justify-center items-center bg-gradient-to-br from-[#1a1a1a] via-[#161b22] to-[#1a1a1a]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
    >
      {/* Geometric Background Pattern - dark */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-32 h-32 border border-blue-500/20 transform rotate-45 rounded-lg" />
        <div className="absolute bottom-1/4 right-1/4 w-24 h-24 border border-purple-500/20 transform rotate-12 rounded-lg" />
        <div className="absolute top-1/3 right-1/3 w-16 h-16 border border-blue-500/15 transform -rotate-45 rounded-lg" />
        
        {/* Floating hexagonal particles */}
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-3 h-3 border border-blue-400/30"
            style={{
              left: `${20 + Math.random() * 60}%`,
              top: `${20 + Math.random() * 60}%`,
              clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
            }}
            animate={{
              rotate: [0, 360],
              y: [0, -15, 0],
              opacity: [0.3, 0.7, 0.3],
            }}
            transition={{
              duration: 5 + Math.random() * 3,
              repeat: Infinity,
              delay: Math.random() * 2,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>

      {/* Layered Card Stack Effect */}
      <motion.div
        className="relative"
        variants={cardStackVariants}
        animate="animate"
      >
        {/* Background Cards - dark */}
        <div className="absolute inset-0 bg-blue-950/40 rounded-2xl border border-blue-500/20 transform rotate-1 scale-95 opacity-60" />
        <div className="absolute inset-0 bg-purple-950/40 rounded-2xl border border-purple-500/20 transform -rotate-1 scale-97 opacity-80" />
        
        {/* Main Content Card - dark */}
        <motion.div
          className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-2xl p-6 max-w-lg w-full mx-4 relative overflow-hidden backdrop-blur-sm"
          initial={{ scale: 0.8, opacity: 0, rotateY: -30 }}
          animate={{ scale: 1, opacity: 1, rotateY: 0 }}
          transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
        >
          {/* Animated Border Gradient - dark */}
          <div className="absolute inset-0 rounded-2xl p-[2px] bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 opacity-30">
            <div className="w-full h-full bg-[#161b22] rounded-2xl" />
          </div>

          {/* Holographic Corner Effects - dark */}
          <div className="absolute top-4 right-4 w-12 h-12 bg-gradient-to-br from-blue-400/15 to-transparent rounded-full blur-xl" />
          <div className="absolute bottom-4 left-4 w-16 h-16 bg-gradient-to-tr from-purple-400/15 to-transparent rounded-full blur-xl" />

          {/* Logo Section - dark */}
          <motion.div
            className="flex justify-center mb-6"
            initial={{ scale: 0, rotateY: 180 }}
            animate={{ scale: 1, rotateY: 0 }}
            transition={{ duration: 1.2, ease: "easeOut", delay: 0.5 }}
          >
            <motion.div
              className="relative p-4 rounded-xl bg-gradient-to-br from-blue-950/50 via-[#21262d] to-purple-950/50 border border-blue-500/30 shadow-lg"
              whileHover={{ scale: 1.05, rotateY: 15 }}
              animate={{
                boxShadow: [
                  "0 8px 20px rgba(59, 130, 246, 0.1)",
                  "0 12px 30px rgba(59, 130, 246, 0.15)",
                  "0 8px 20px rgba(59, 130, 246, 0.1)",
                ],
              }}
              transition={{
                boxShadow: { duration: 3, repeat: Infinity, ease: "easeInOut" },
              }}
            >
              <img 
                src={sellerQILogo}
                alt="Seller QI Logo"
                className="h-12 w-auto object-contain relative z-10"
              />
              
              {/* Holographic backdrop */}
              <div className="absolute inset-2 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-blue-500/10 rounded-xl blur-sm" />
              
              {/* Corner accent lines - dark */}
              <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 border-blue-400/50 rounded-tl" />
              <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 border-purple-400/50 rounded-tr" />
              <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 border-purple-400/50 rounded-bl" />
              <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-blue-400/50 rounded-br" />
            </motion.div>
          </motion.div>

          {/* Hexagonal Loader System */}
          <div className="flex justify-center mb-6">
            <div className="relative w-32 h-32">
              {/* Outer Hexagonal Frame - dark */}
              <motion.div
                className="absolute inset-0 w-32 h-32 border-2 border-blue-400/30 rounded-xl"
                style={{
                  clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
                }}
                variants={hexRotateVariants}
                animate="animate"
              />
              
              {/* Middle Hexagon */}
              <motion.div
                className="absolute inset-3 w-26 h-26 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-lg backdrop-blur-sm"
                style={{
                  clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
                }}
                variants={hexRotateVariants}
                animate="animate"
                transition={{
                  duration: 4,
                  repeat: Infinity,
                  ease: "linear",
                  direction: "reverse",
                }}
              />

              {/* Animated Loading Ring */}
              <motion.div
                className="absolute inset-6 w-20 h-20 border-4 border-transparent rounded-full"
                style={{
                  background: `conic-gradient(from 0deg, transparent, ${
                    error ? '#ef4444' : '#3b82f6'
                  }, transparent)`,
                }}
                animate={{
                  rotate: 360,
                }}
                transition={{
                  duration: error ? 1.5 : 2,
                  repeat: Infinity,
                  ease: "linear",
                }}
              />
              
              {/* Inner animated circle */}
              <motion.div
                className={`absolute inset-8 w-16 h-16 rounded-full ${
                  error 
                    ? 'bg-gradient-to-r from-red-400 to-red-500'
                    : 'bg-gradient-to-r from-blue-400 to-purple-500'
                }`}
                animate={{
                  scale: [1, 1.1, 1],
                  opacity: [0.8, 1, 0.8],
                }}
                transition={{
                  duration: 2,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />

              {/* Central Hub */}
              <motion.div
                className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-8 h-8 rounded-lg shadow-2xl ${
                  error 
                    ? 'bg-gradient-to-br from-red-500 to-red-600'
                    : 'bg-gradient-to-br from-blue-500 to-purple-600'
                }`}
                animate={{
                  rotateX: [0, 360],
                  rotateY: [0, 360],
                }}
                transition={{
                  duration: 8,
                  repeat: Infinity,
                  ease: "linear",
                }}
                style={{
                  boxShadow: error 
                    ? "0 0 20px rgba(239, 68, 68, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.3)"
                    : "0 0 20px rgba(59, 130, 246, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.3)",
                }}
              />

              {/* Orbital Elements */}
              <motion.div
                className="absolute inset-0"
                variants={orbitVariants}
                animate="animate"
              >
                {[...Array(3)].map((_, i) => (
                  <div
                    key={i}
                    className={`absolute w-2 h-2 rounded-full shadow-lg ${
                      error 
                        ? 'bg-gradient-to-r from-red-400 to-red-500'
                        : 'bg-gradient-to-r from-blue-400 to-purple-500'
                    }`}
                    style={{
                      left: "50%",
                      top: `${12 + i * 18}px`,
                      transformOrigin: `0 ${52 - i * 18}px`,
                    }}
                  />
                ))}
              </motion.div>

              {/* Pulse Waves - dark */}
              {[...Array(3)].map((_, i) => (
                <motion.div
                  key={i}
                  className={`absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 border-2 rounded-full ${
                    error ? 'border-red-400/25' : 'border-blue-400/25'
                  }`}
                  style={{
                    width: `${48 + i * 24}px`,
                    height: `${48 + i * 24}px`,
                  }}
                  variants={waveVariants}
                  animate="animate"
                  transition={{
                    delay: i * 0.5,
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }}
                />
              ))}
            </div>
          </div>

          {/* Animated Loading Steps */}
          <motion.div
            className="mb-6"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, ease: "easeOut", delay: 0.8 }}
          >
            <div className="flex justify-center items-center gap-4">
              {[...Array(5)].map((_, i) => (
                <motion.div
                  key={i}
                  className={`w-3 h-3 rounded-full ${
                    error ? 'bg-red-500' : 'bg-blue-500'
                  }`}
                  animate={{
                    scale: [1, 1.4, 1],
                    opacity: [0.5, 1, 0.5],
                  }}
                  transition={{
                    duration: 1.5,
                    repeat: Infinity,
                    delay: i * 0.2,
                    ease: "easeInOut",
                  }}
                />
              ))}
            </div>
            
            {/* Loading Steps Indicator */}
            <motion.div 
              className="flex justify-center mt-4"
              animate={{
                opacity: [0.7, 1, 0.7],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              <span className={`text-sm font-medium px-4 py-2 rounded-full ${
                error 
                  ? 'bg-red-500/20 text-red-300' 
                  : 'bg-blue-500/20 text-blue-300'
              }`}>
                {error ? 'Error' : 'Processing...'}
              </span>
            </motion.div>
          </motion.div>

          {/* Dynamic Text Content */}
          <div className="text-center mb-6">
            <motion.div
              key={showAccessText ? "loading" : "ready"}
              initial={{ opacity: 0, rotateX: -90 }}
              animate={{ opacity: 1, rotateX: 0 }}
              exit={{ opacity: 0, rotateX: 90 }}
              transition={{ duration: 0.6, ease: "easeOut" }}
              className="space-y-4"
            >
              {error ? (
                <>
                  <h2 className="text-2xl font-bold bg-gradient-to-r from-red-600 via-red-500 to-red-600 bg-clip-text text-transparent">
                    Connection Error
                  </h2>
                  <p className="text-gray-400 leading-relaxed">
                    {error}
                  </p>
                  <p className="text-sm text-gray-500 mt-2">
                    Redirecting...
                  </p>
                </>
              ) : showAccessText ? (
                <>
                  <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600 bg-clip-text text-transparent">
                    {isConnectingAds ? 'Connecting to Amazon Ads' : 'Connecting to Amazon Seller Central'}
                  </h2>
                  <p className="text-gray-400 leading-relaxed">
                    {isConnectingAds 
                      ? 'Securing your Amazon Ads account connection'
                      : 'Securing your Seller Central account connection'
                    }
                  </p>
                </>
              ) : (
                <>
                  <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-600 via-blue-600 to-purple-600 bg-clip-text text-transparent">
                    Establishing Secure Connection
                  </h2>
                  <p className="text-gray-400 leading-relaxed">
                    Please wait while we verify and secure your connection
                  </p>
                </>
              )}
            </motion.div>
          </div>

          {/* Enhanced Status Grid */}
          <motion.div
            className="grid grid-cols-3 gap-3 mb-6"
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 1.5, duration: 0.8, staggerChildren: 0.1 }}
          >
            {[
              { 
                label: "Security", 
                status: error ? "Failed" : "Active", 
                icon: error ? "⚠️" : "🛡️", 
                cardClass: error 
                  ? "p-3 rounded-lg bg-red-500/10 border border-red-500/30 backdrop-blur-sm" 
                  : "p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 backdrop-blur-sm", 
                labelClass: error 
                  ? "font-bold text-red-400 text-sm" 
                  : "font-bold text-emerald-400 text-sm", 
                statusClass: error 
                  ? "text-xs text-red-300 font-medium" 
                  : "text-xs text-emerald-300 font-medium" 
              },
              { 
                label: "Connection", 
                status: error ? "Error" : "Processing", 
                icon: error ? "❌" : "🔌", 
                cardClass: error 
                  ? "p-3 rounded-lg bg-red-500/10 border border-red-500/30 backdrop-blur-sm" 
                  : "p-3 rounded-lg bg-blue-500/10 border border-blue-500/30 backdrop-blur-sm", 
                labelClass: error 
                  ? "font-bold text-red-400 text-sm" 
                  : "font-bold text-blue-400 text-sm", 
                statusClass: error 
                  ? "text-xs text-red-300 font-medium" 
                  : "text-xs text-blue-300 font-medium" 
              },
              { 
                label: "Verification", 
                status: error ? "Failed" : "In Progress", 
                icon: error ? "⚠️" : "✅", 
                cardClass: error 
                  ? "p-3 rounded-lg bg-red-500/10 border border-red-500/30 backdrop-blur-sm" 
                  : "p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 backdrop-blur-sm", 
                labelClass: error 
                  ? "font-bold text-red-400 text-sm" 
                  : "font-bold text-orange-400 text-sm", 
                statusClass: error 
                  ? "text-xs text-red-300 font-medium" 
                  : "text-xs text-orange-300 font-medium" 
              }
            ].map((item, i) => (
              <motion.div
                key={item.label}
                className={item.cardClass}
                initial={{ scale: 0, rotateY: -90 }}
                animate={{ scale: 1, rotateY: 0 }}
                transition={{ delay: 1.7 + i * 0.1, duration: 0.5 }}
                whileHover={{ scale: 1.05, rotateY: 10 }}
              >
                <div className="text-center space-y-2">
                  <div className="text-2xl">{item.icon}</div>
                  <h4 className={item.labelClass}>{item.label}</h4>
                  <p className={item.statusClass}>{item.status}</p>
                </div>
              </motion.div>
            ))}
          </motion.div>

          {/* Rhythmic Loading Animation */}
          <motion.div
            className="flex justify-center gap-2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 2, duration: 0.4 }}
          >
            {[...Array(7)].map((_, i) => (
              <motion.div
                key={i}
                className={`w-1 rounded-full ${
                  error 
                    ? 'bg-gradient-to-t from-red-400 to-red-500'
                    : 'bg-gradient-to-t from-blue-400 to-purple-400'
                }`}
                style={{ height: `${12 + (i % 3) * 8}px` }}
                animate={{
                  scaleY: [0.5, 1.5, 0.5],
                  opacity: [0.3, 1, 0.3],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.1,
                }}
              />
            ))}
          </motion.div>
        </motion.div>
      </motion.div>

      {/* Status Footer */}
      <motion.div
        className="mt-4 px-4 py-2 bg-[#21262d]/90 backdrop-blur-sm rounded-full border border-[#30363d] shadow-lg"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 2.5, duration: 0.6 }}
      >
        <div className="flex items-center gap-3 text-sm text-gray-400">
          <motion.div 
            className={`w-2 h-2 rounded-full ${
              error ? 'bg-red-500' : 'bg-emerald-500'
            }`}
            animate={error ? 
              { scale: 1, opacity: 1 } : 
              { scale: [1, 1.3, 1], opacity: [0.7, 1, 0.7] }
            }
            transition={{ duration: 2, repeat: Infinity }}
          />
          <span className="font-medium">
            {error 
              ? "Connection failed • Redirecting to error page..." :
              isConnectingAds
                ? "Connecting Amazon Ads account • Please wait..."
                : "Connecting Seller Central account • Please wait..."
            }
          </span>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default FetchingTokens;

// Example of how to store state before redirecting to Amazon (in your auth initiation component):
/*
const initiateAmazonAuth = () => {
  // Generate a random state parameter for CSRF protection
  const state = crypto.randomUUID();
  sessionStorage.setItem('spapi_oauth_state', state);
  
  // Construct the Amazon authorization URL
  const authUrl = new URL('https://sellercentral.amazon.com/apps/authorize/consent');
  authUrl.searchParams.append('application_id', YOUR_APP_ID);
  authUrl.searchParams.append('state', state);
  authUrl.searchParams.append('redirect_uri', YOUR_REDIRECT_URI);
  
  // Redirect to Amazon
  window.location.href = authUrl.toString();
};
*/