import React from 'react';
import { useParams } from 'react-router-dom';
import { Home, AlertTriangle } from 'lucide-react';
import { motion } from 'framer-motion';

const ErrorPage = () => {
  const { status } = useParams();

  // Unified error message for all status codes
  const errorMessage = "Something Went Wrong";

  return (
    <div className="min-h-screen w-full bg-[#1a1a1a] flex flex-col justify-center items-center p-4 overflow-hidden">
      {/* Main Content */}
      <motion.div
        className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-2xl p-8 lg:p-12 max-w-2xl w-full mx-4 text-center relative overflow-hidden"
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        {/* Content */}
        <div className="relative z-10">
          {/* Error Icon */}
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, duration: 0.5, type: "spring", stiffness: 200 }}
            className="mb-8"
          >
            <div className="w-24 h-24 mx-auto bg-gradient-to-br from-red-500/20 via-red-500/10 to-orange-500/20 rounded-full flex items-center justify-center shadow-lg border border-red-500/30">
              <AlertTriangle className="w-12 h-12 text-red-400" />
            </div>
          </motion.div>

          {/* Status Code */}
          <motion.h1
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3, duration: 0.6 }}
            className="text-6xl lg:text-8xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 via-purple-400 to-blue-500 mb-6"
          >
            {status}
          </motion.h1>

          {/* Error Message */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="mb-8"
          >
            <h2 className="text-2xl lg:text-3xl font-bold text-gray-100 mb-4">Oops!</h2>
            <p className="text-lg lg:text-xl text-gray-400 leading-relaxed max-w-md mx-auto">
              {errorMessage}
            </p>
          </motion.div>

          {/* Action Button */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.5, duration: 0.6 }}
            className="flex justify-center"
          >
            <a
              href="https://www.sellerqi.com"
              className="group flex items-center gap-3 px-8 py-4 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl font-semibold text-lg shadow-lg shadow-blue-500/25 hover:from-blue-500 hover:to-blue-600 hover:shadow-xl hover:shadow-blue-500/30 transition-all duration-300 hover:scale-105"
            >
              <Home className="w-5 h-5 transition-transform duration-300 group-hover:scale-110" />
              Go Home
            </a>
          </motion.div>

          {/* Help Text */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="mt-8 pt-6 border-t border-[#30363d]"
          >
            <p className="text-sm text-gray-500">
              If this problem persists, please contact our support team for assistance.
            </p>
          </motion.div>
        </div>
      </motion.div>

      {/* Logo/Branding */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.8, duration: 0.6 }}
        className="mt-8"
      >
        <img 
          src="https://res.cloudinary.com/ddoa960le/image/upload/v1752478546/Seller_QI_Logo___V1_1_t9s3kh.png"
          alt="Seller QI Logo"
          loading="lazy"
          className="h-8 w-auto object-contain opacity-60 transition-opacity duration-300 hover:opacity-80"
          width="120"
          height="32"
        />
      </motion.div>
    </div>
  );
};

export default ErrorPage;
