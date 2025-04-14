import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import RingLoader from "react-spinners/RingLoader";

const Loader = ({ isVisible }) => {
  const [showAccessText, setShowAccessText] = useState(true);

  useEffect(() => {
    const interval = setInterval(() => {
      setShowAccessText((prev) => !prev);
    }, 2000);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.div
      className="w-full h-[100vh] fixed z-[99] flex flex-col justify-center items-center bg-white"
      initial={{ y: 0 }}
      animate={{ y: isVisible ? 0 : -1000 }}
      transition={{ duration: 1, ease: 'easeInOut' }}
    >
      <RingLoader color="#5c5e92" size={100} />
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
            Gearing up your dashboard...
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
    </motion.div>
  );
};

export default Loader;
