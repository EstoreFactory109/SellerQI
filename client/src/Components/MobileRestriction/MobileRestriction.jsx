import React from 'react';
import { motion } from 'framer-motion';
import { Monitor, Tablet, Smartphone } from 'lucide-react';

const MobileRestriction = () => {
  return (
    <div className="w-full h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50/30 flex flex-col justify-center items-center p-4 overflow-hidden">
      {/* Background Pattern */}
      <div className="absolute inset-0 overflow-hidden opacity-5">
        <div className="absolute -top-4 -left-4 w-72 h-72 bg-blue-400 rounded-full mix-blend-multiply filter blur-xl animate-pulse"></div>
        <div className="absolute -bottom-8 -right-4 w-72 h-72 bg-purple-400 rounded-full mix-blend-multiply filter blur-xl animate-pulse" style={{ animationDelay: '2s' }}></div>
      </div>

      {/* Main Content */}
      <motion.div
        className="bg-white rounded-2xl border border-gray-200 shadow-2xl p-8 max-w-md w-full mx-4 text-center relative overflow-hidden"
        initial={{ scale: 0.9, opacity: 0, y: 20 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: "easeOut" }}
      >
        {/* Subtle Gradient Overlay */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 rounded-t-2xl" />

        {/* Logo Section */}
        <motion.div
          className="flex justify-center mb-6"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 1, ease: "easeOut", delay: 0.3 }}
        >
          <div className="relative p-4 rounded-xl bg-gradient-to-br from-blue-50 to-purple-50 border border-blue-100 shadow-lg">
            <img 
              src="https://res.cloudinary.com/ddoa960le/image/upload/v1749063777/MainLogo_1_uhcg6o.png"
              alt="Seller QI Logo"
              className="h-12 w-auto object-contain"
            />
            <div className="absolute inset-0 bg-gradient-to-br from-blue-400/10 to-purple-400/10 rounded-xl blur-sm -z-10" />
          </div>
        </motion.div>

        {/* Device Icons */}
        <motion.div
          className="flex justify-center items-center gap-4 mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.5 }}
        >
          <div className="flex items-center gap-2">
            <div className="p-2 bg-red-100 rounded-lg">
              <Smartphone className="w-5 h-5 text-red-600" />
            </div>
            <span className="text-red-600 font-medium text-sm">Mobile</span>
          </div>
          
          <div className="w-8 h-0.5 bg-gray-300 rounded"></div>
          
          <div className="flex items-center gap-2">
            <div className="p-2 bg-green-100 rounded-lg">
              <Tablet className="w-5 h-5 text-green-600" />
            </div>
            <span className="text-green-600 font-medium text-sm">Tablet</span>
          </div>
          
          <div className="flex items-center gap-2">
            <div className="p-2 bg-green-100 rounded-lg">
              <Monitor className="w-5 h-5 text-green-600" />
            </div>
            <span className="text-green-600 font-medium text-sm">Desktop</span>
          </div>
        </motion.div>

        {/* Main Message */}
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.7 }}
        >
          <h1 className="text-2xl font-bold text-gray-900 mb-3">
            Desktop & Tablet Only
          </h1>
          <p className="text-gray-600 leading-relaxed mb-4">
            This application is optimized for larger screens. Please visit from a desktop or tablet for the best experience.
          </p>
          <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
            <p className="text-blue-800 text-sm font-medium">
              📱 Minimum screen width: 768px
            </p>
          </div>
        </motion.div>

        {/* Feature Benefits */}
        <motion.div
          className="mb-6"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 0.9 }}
        >
          <h3 className="text-sm font-semibold text-gray-700 mb-3 uppercase tracking-wider">
            Why Larger Screens?
          </h3>
          <div className="grid gap-2 text-left">
            {[
              "📊 Complex analytics dashboards",
              "📈 Detailed charts and reports", 
              "🎛️ Advanced data management tools",
              "💼 Professional workspace layout"
            ].map((feature, index) => (
              <motion.div
                key={index}
                className="flex items-center gap-2 text-sm text-gray-600 p-2 rounded-lg hover:bg-gray-50 transition-colors"
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 1 + index * 0.1 }}
              >
                <span>{feature}</span>
              </motion.div>
            ))}
          </div>
        </motion.div>

        {/* Action Suggestions */}
        <motion.div
          className="space-y-3"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, ease: "easeOut", delay: 1.3 }}
        >
          <div className="flex flex-col gap-2">
            <button 
              onClick={() => window.location.reload()} 
              className="w-full bg-gradient-to-r from-blue-600 to-purple-600 text-white py-3 px-4 rounded-lg font-medium hover:from-blue-700 hover:to-purple-700 transition-all duration-200 shadow-md hover:shadow-lg"
            >
              🔄 Refresh Page
            </button>
            <p className="text-xs text-gray-500">
              If you're on a tablet, try rotating to landscape mode
            </p>
          </div>
        </motion.div>
      </motion.div>

      {/* Footer */}
      <motion.div
        className="mt-8 text-center"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 1.5 }}
      >
        <p className="text-sm text-gray-500">
          Best viewed on desktop computers and tablets
        </p>
        <p className="text-xs text-gray-400 mt-1">
          For technical support, please contact our team
        </p>
      </motion.div>

      {/* Animated Background Elements */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden">
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-2 h-2 bg-blue-400/20 rounded-full"
            style={{
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
            }}
            animate={{
              y: [0, -20, 0],
              opacity: [0.2, 0.6, 0.2],
              scale: [0.5, 1, 0.5],
            }}
            transition={{
              duration: 4 + Math.random() * 2,
              repeat: Infinity,
              delay: Math.random() * 2,
              ease: "easeInOut",
            }}
          />
        ))}
      </div>
    </div>
  );
};

export default MobileRestriction; 