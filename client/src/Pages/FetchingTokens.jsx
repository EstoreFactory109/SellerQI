import React, { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import HashLoader from "react-spinners/HashLoader";
import { useNavigate, useSearchParams } from "react-router-dom";
import axiosInstance from "../config/axios.config";

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


  useEffect(() => {
    // Toggle between "Getting Access..." and "Please Wait"
    const interval = setInterval(() => {
      setShowAccessText((prev) => !prev);
    }, 2000);

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
          navigate('/seller-central-checker/auth-error', { 
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
          if (response.data.sellerId) {
            sessionStorage.setItem('sp_seller_id', response.data.sellerId);
          }
          
          // Navigate to dashboard with success message
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
          navigate('/seller-central-checker/auth-error', {
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
          navigate('/seller-central-checker/auth-error', { 
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
        

        // Validate state parameter (should match what was sent initially)
        
        
        // Send the authorization code and state to the backend
        const response = await axiosInstance.post('/app/token/generateAdsTokens', {
          authCode: amazonAdsAuthCode,
        });

        console.log(response)
        
        if (response.status === 200 && response.data) {
          console.log("Tokens generated successfully");
          
          // Store any necessary data from the response
          if (response.data.sellerId) {
            sessionStorage.setItem('sp_seller_id', response.data.sellerId);
          }
          
          // Get the stored marketplace info to determine region
          const selectedMarketplace = JSON.parse(localStorage.getItem('selectedMarketplace') || '{}');
          const region = selectedMarketplace.region || 'NA';
          
          // Navigate to profile selection page with region parameter
          navigate(`/profile-selection?region=${region}`)
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
          navigate('/seller-central-checker/auth-error', {
            state: { 
              error: errorMessage,
              errorCode: errorCode,
              canRetry: errorCode !== 409 // Don't retry if already connected
            }
          });
        }, 2000);
        
      }
    }

   // generateTokens();

    if (localStorage.getItem('amazonAdsLoading') === 'true') {
      generateAmazonAdsTokens();
    } else {
      generateTokens();
    }
    generateTokens();
  }, [authCode, state, sellingPartnerId, navigate]);

  return (
    <div className="w-full h-[100vh] flex flex-col justify-center items-center bg-gray-50">
      <div className="flex flex-col items-center">
        <HashLoader color="#5c5e92" size={100} />

        {/* Animated Text Switching */}
        <div className="mt-6 text-center h-16">
          {error ? (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-red-600"
            >
              <p className="text-lg font-semibold">{error}</p>
              <p className="text-sm mt-1">Redirecting...</p>
            </motion.div>
          ) : (
            <>
              {showAccessText ? (
                <motion.p
                  key="access-text"
                  className="text-lg font-semibold text-gray-800"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.5 }}
                >
                  Connecting to Amazon Seller Central...
                </motion.p>
              ) : (
                <motion.p
                  key="wait-text"
                  className="text-md text-gray-600"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  transition={{ duration: 0.5 }}
                >
                  Please wait while we secure your connection
                </motion.p>
              )}
            </>
          )}
        </div>
        
        {/* Progress indicator */}
        <div className="mt-8 w-64">
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <motion.div 
              className="bg-indigo-600 h-1.5 rounded-full"
              initial={{ width: "0%" }}
              animate={{ width: "70%" }}
              transition={{ duration: 3, ease: "easeInOut" }}
            />
          </div>
        </div>
      </div>
    </div>
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