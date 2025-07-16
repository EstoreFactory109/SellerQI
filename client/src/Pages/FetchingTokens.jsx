import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import HashLoader from "react-spinners/HashLoader";
import { useNavigate, useSearchParams } from "react-router-dom";
import axiosInstance from "../config/axios.config";

const FetchingTokens = () => {
  const [showAccessText, setShowAccessText] = useState(true);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  // Extract 'code' and 'state' from URL
  const authCode = searchParams.get("code");
  const state = searchParams.get("state");

  useEffect(() => {
    // Toggle between "Getting Access..." and "Please Wait"
    const interval = setInterval(() => {
      setShowAccessText((prev) => !prev);
    }, 2000); // Switch text every 2 seconds

    return () => clearInterval(interval); // Cleanup on unmount
  }, []);

  useEffect(() => {
    const generateTokens = async () => {
      if (authCode && state) {
        try {
          console.log("Authorization Code (authCode):", authCode);
          console.log("State Parameter:", state);
          
          // Send the authorization code to the backend
          const response = await axiosInstance.post('/app/token/generateSPAPITokens', {
            authCode: authCode
          });
          
          if (response.status === 200) {
            console.log("Tokens generated successfully");
            // Navigate to dashboard or appropriate page after successful token generation
            navigate('/seller-central-checker/dashboard');
          }
        } catch (error) {
          console.error("Error generating tokens:", error);
          // Navigate to error page or show error message
          navigate('/error/500');
        }
      } else {
        // Redirect to failure route if codes are missing
        console.log("Failed to fetch tokens - missing authorization code or state");
        navigate('/error/400');
      }
    };

    generateTokens();
  }, [authCode, state, navigate]);

  return (
    <div className="w-full h-[100vh] flex flex-col justify-center items-center">
      <HashLoader color="#5c5e92" size={100} />

      {/* Animated Text Switching */}
      <div className="mt-4 text-center">
        {showAccessText ? (
          <motion.p
            key="access-text"
            className="text-lg font-semibold text-gray-800"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          >
            Generating Tokens...
          </motion.p>
        ) : (
          <motion.p
            key="wait-text"
            className="text-md text-gray-600"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.8 }}
          >
            Please Wait
          </motion.p>
        )}
      </div>
    </div>
  );
};

export default FetchingTokens;
