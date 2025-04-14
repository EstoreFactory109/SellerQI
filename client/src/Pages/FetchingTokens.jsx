import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import HashLoader from "react-spinners/HashLoader";
import axios from "axios";
import { useNavigate,useSearchParams } from "react-router-dom";

const FetchingTokens = () => {
  const [showAccessText, setShowAccessText] = useState(true);
 
  const navigate = useNavigate(); // Add useNavigate hook
  const [searcParams]=useSearchParams();

  useEffect(() => {
    // Toggle between "Getting Access..." and "Please Wait"
    const interval = setInterval(() => {
      setShowAccessText(prev => !prev);
    }, 2000); // Switch text every 2 seconds

    return () => clearInterval(interval); // Cleanup on unmount
  }, []);

  useEffect(()=>{
    const payload=searcParams.get("payload");
    (async()=>{
      try {
        const response=await axios.get(`${import.meta.env.VITE_BASE_URI}/app/token/generateSPAPITokens/${payload}`);
      if(response.status===200){
        navigate("/failure"); //Or some failure route.
        
      }
      } catch (error) {
        throw new error
      }
      
    })()
  })

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
            Getting Access...
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