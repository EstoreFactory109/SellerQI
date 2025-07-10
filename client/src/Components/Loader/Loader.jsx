import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";

/**
 * Advanced Futuristic Loader Component
 * 
 * Features:
 * - Beautiful animated loader with hexagonal rings and floating particles
 * - Changes animation speed and colors when data is ready
 * - Shows completion state before calling onComplete callback
 * - Smooth fade out transition
 * 
 * Usage:
 * const [showLoader, setShowLoader] = useState(true);
 * const [isDataReady, setIsDataReady] = useState(false);
 * 
 * // Your data loading logic
 * useEffect(() => {
 *   const loadData = async () => {
 *     try {
 *       await Promise.all([
 *         fetchUserData(),
 *         fetchAnalytics(),
 *         fetchReports()
 *       ]);
 *       setIsDataReady(true); // This triggers completion sequence
 *     } catch (error) {
 *       console.error('Data loading failed:', error);
 *     }
 *   };
 *   loadData();
 * }, []);
 * 
 * return showLoader ? 
 *   <Loader 
 *     isDataReady={isDataReady}
 *     onComplete={() => setShowLoader(false)} 
 *   /> : 
 *   <Dashboard />;
 */
const Loader = ({ onComplete, isDataReady = false }) => {
  const [showAccessText, setShowAccessText] = useState(true);
  const [isComplete, setIsComplete] = useState(false);
  const [shouldHide, setShouldHide] = useState(false);

  useEffect(() => {
    const textInterval = setInterval(() => {
      setShowAccessText((prev) => !prev);
    }, 2500);

    // Simple completion logic - complete when data is ready
    if (isDataReady && !isComplete) {
      // Wait a moment to show the "data ready" state, then complete
      const completeTimer = setTimeout(() => {
        setIsComplete(true);
        
        // Show completion state for 2 seconds, then hide
        const hideTimer = setTimeout(() => {
          setShouldHide(true);
          
          // Wait for fade out, then call onComplete
          const callbackTimer = setTimeout(() => {
            if (onComplete) onComplete();
          }, 800);
          
          return () => clearTimeout(callbackTimer);
        }, 2000);
        
        return () => clearTimeout(hideTimer);
      }, 1000);
      
      return () => {
        clearInterval(textInterval);
        clearTimeout(completeTimer);
      };
    }

    return () => {
      clearInterval(textInterval);
    };
  }, [isDataReady, isComplete, onComplete]);

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
        className="w-full h-[100vh] fixed z-[99] flex flex-col justify-center items-center bg-gradient-to-br from-slate-50 via-white to-blue-50/30"
        initial={{ opacity: 0 }}
        animate={{ 
          opacity: shouldHide ? 0 : 1,
          scale: shouldHide ? 0.95 : 1 
        }}
        transition={{ 
          duration: shouldHide ? 0.8 : 0.5,
          ease: shouldHide ? "easeInOut" : "easeOut" 
        }}
        style={{ pointerEvents: shouldHide ? 'none' : 'auto' }}
      >
      {/* Geometric Background Pattern */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-32 h-32 border border-blue-100/50 transform rotate-45 rounded-lg" />
        <div className="absolute bottom-1/4 right-1/4 w-24 h-24 border border-purple-100/50 transform rotate-12 rounded-lg" />
        <div className="absolute top-1/3 right-1/3 w-16 h-16 border border-blue-100/30 transform -rotate-45 rounded-lg" />
        
        {/* Floating hexagonal particles */}
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-3 h-3 border border-blue-300/40"
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
        {/* Background Cards */}
        <div className="absolute inset-0 bg-blue-50 rounded-2xl border border-blue-100 transform rotate-1 scale-95 opacity-60" />
        <div className="absolute inset-0 bg-purple-50 rounded-2xl border border-purple-100 transform -rotate-1 scale-97 opacity-80" />
        
                 {/* Main Content Card */}
         <motion.div
           className="bg-white rounded-2xl border border-gray-200 shadow-2xl p-6 max-w-lg w-full mx-4 relative overflow-hidden backdrop-blur-sm"
           initial={{ scale: 0.8, opacity: 0, rotateY: -30 }}
           animate={{ scale: 1, opacity: 1, rotateY: 0 }}
           transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
         >
          {/* Animated Border Gradient */}
          <div className="absolute inset-0 rounded-2xl p-[2px] bg-gradient-to-r from-blue-500 via-purple-500 to-blue-500 opacity-20">
            <div className="w-full h-full bg-white rounded-2xl" />
          </div>

          {/* Holographic Corner Effects */}
          <div className="absolute top-4 right-4 w-12 h-12 bg-gradient-to-br from-blue-400/20 to-transparent rounded-full blur-xl" />
          <div className="absolute bottom-4 left-4 w-16 h-16 bg-gradient-to-tr from-purple-400/20 to-transparent rounded-full blur-xl" />

                     {/* Logo Section with Advanced Effects */}
           <motion.div
             className="flex justify-center mb-6"
             initial={{ scale: 0, rotateY: 180 }}
             animate={{ scale: 1, rotateY: 0 }}
             transition={{ duration: 1.2, ease: "easeOut", delay: 0.5 }}
           >
                         <motion.div
               className="relative p-4 rounded-xl bg-gradient-to-br from-blue-50 via-white to-purple-50 border-2 border-blue-200/50 shadow-lg"
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
                 src="https://res.cloudinary.com/ddoa960le/image/upload/v1749063777/MainLogo_1_uhcg6o.png"
                 alt="Seller QI Logo"
                 className="h-12 w-auto object-contain relative z-10"
               />
              
              {/* Holographic backdrop */}
              <div className="absolute inset-2 bg-gradient-to-r from-blue-500/10 via-purple-500/10 to-blue-500/10 rounded-xl blur-sm" />
              
              {/* Corner accent lines */}
              <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 border-blue-400/60 rounded-tl" />
              <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 border-purple-400/60 rounded-tr" />
              <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 border-purple-400/60 rounded-bl" />
              <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-blue-400/60 rounded-br" />
            </motion.div>
          </motion.div>

                     {/* Hexagonal Loader System */}
           <div className="flex justify-center mb-6">
             <div className="relative w-32 h-32">
                             {/* Outer Hexagonal Frame */}
               <motion.div
                 className="absolute inset-0 w-32 h-32 border-2 border-blue-300/40 rounded-xl"
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
                     isDataReady ? '#10b981' : '#3b82f6'
                   }, transparent)`,
                 }}
                 animate={{
                   rotate: 360,
                 }}
                 transition={{
                   duration: isDataReady ? 0.8 : 2,
                   repeat: isComplete ? 0 : Infinity,
                   ease: "linear",
                 }}
               />
               
               {/* Inner animated circle */}
               <motion.div
                 className={`absolute inset-8 w-16 h-16 rounded-full ${
                   isComplete ? 'bg-gradient-to-r from-emerald-400 to-green-500' :
                   isDataReady ? 'bg-gradient-to-r from-green-400 to-emerald-500' :
                   'bg-gradient-to-r from-blue-400 to-purple-500'
                 }`}
                 animate={{
                   scale: [1, 1.1, 1],
                   opacity: [0.8, 1, 0.8],
                 }}
                 transition={{
                   duration: isDataReady ? 1 : 2,
                   repeat: Infinity,
                   ease: "easeInOut",
                 }}
               />

              {/* Central Hub */}
              <motion.div
                className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-gradient-to-br from-blue-500 to-purple-600 rounded-lg shadow-2xl"
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
                  boxShadow: "0 0 20px rgba(59, 130, 246, 0.5), inset 0 2px 4px rgba(255, 255, 255, 0.3)",
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
                     className="absolute w-2 h-2 bg-gradient-to-r from-blue-400 to-purple-500 rounded-full shadow-lg"
                     style={{
                       left: "50%",
                       top: `${12 + i * 18}px`,
                       transformOrigin: `0 ${52 - i * 18}px`,
                     }}
                   />
                 ))}
              </motion.div>

                             {/* Pulse Waves */}
               {[...Array(3)].map((_, i) => (
                 <motion.div
                   key={i}
                   className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 border-2 border-blue-400/20 rounded-full"
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
                     isComplete ? 'bg-emerald-500' :
                     isDataReady ? 'bg-green-500' : 'bg-blue-500'
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
                 isComplete ? 'bg-emerald-100 text-emerald-700' :
                 isDataReady ? 'bg-green-100 text-green-700' : 
                 'bg-blue-100 text-blue-700'
               }`}>
                 {isComplete ? 'Complete' : isDataReady ? 'Processing...' : 'Loading...'}
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
                           {isComplete ? (
               <>
                 <h2 className="text-2xl font-bold bg-gradient-to-r from-emerald-600 via-green-600 to-emerald-600 bg-clip-text text-transparent">
                   Dashboard Ready!
                 </h2>
                 <p className="text-gray-600 leading-relaxed">
                   Welcome to your personalized analytics dashboard
                 </p>
               </>
             ) : isDataReady ? (
               <>
                 <h2 className="text-2xl font-bold bg-gradient-to-r from-green-600 via-emerald-600 to-green-600 bg-clip-text text-transparent">
                   Completing Setup
                 </h2>
                 <p className="text-gray-600 leading-relaxed">
                   Data loaded • Finalizing dashboard preparation
                 </p>
               </>
             ) : showAccessText ? (
               <>
                 <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600 bg-clip-text text-transparent">
                   Loading Dashboard Data
                 </h2>
                 <p className="text-gray-600 leading-relaxed">
                   Fetching your latest analytics and insights
                 </p>
               </>
             ) : (
               <>
                 <h2 className="text-2xl font-bold bg-gradient-to-r from-purple-600 via-blue-600 to-purple-600 bg-clip-text text-transparent">
                   Connecting to Services
                 </h2>
                 <p className="text-gray-600 leading-relaxed">
                   Establishing secure connections and verifying access
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
                 status: isComplete ? "Secure" : "Active", 
                 color: isComplete ? "emerald" : "emerald", 
                 icon: "🛡️" 
               },
               { 
                 label: "Data Loading", 
                 status: isComplete ? "Complete" : isDataReady ? "Ready" : "Loading", 
                 color: isComplete ? "emerald" : isDataReady ? "green" : "blue", 
                 icon: isComplete ? "✅" : isDataReady ? "✅" : "📊" 
               },
               { 
                 label: "Dashboard", 
                 status: isComplete ? "Ready" : isDataReady ? "Preparing" : "Waiting", 
                 color: isComplete ? "emerald" : isDataReady ? "orange" : "gray", 
                 icon: isComplete ? "🚀" : isDataReady ? "⚙️" : "⏳" 
               }
             ].map((item, i) => (
                             <motion.div
                 key={item.label}
                 className={`p-3 rounded-lg bg-gradient-to-br from-${item.color}-50 to-${item.color}-100/50 border border-${item.color}-200/50 backdrop-blur-sm`}
                 initial={{ scale: 0, rotateY: -90 }}
                 animate={{ scale: 1, rotateY: 0 }}
                 transition={{ delay: 1.7 + i * 0.1, duration: 0.5 }}
                 whileHover={{ scale: 1.05, rotateY: 10 }}
               >
                <div className="text-center space-y-2">
                  <div className="text-2xl">{item.icon}</div>
                  <h4 className={`font-bold text-${item.color}-700 text-sm`}>
                    {item.label}
                  </h4>
                  <p className={`text-xs text-${item.color}-600 font-medium`}>
                    {item.status}
                  </p>
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
                className="w-1 bg-gradient-to-t from-blue-400 to-purple-500 rounded-full"
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
         className="mt-4 px-4 py-2 bg-white/80 backdrop-blur-sm rounded-full border border-gray-200 shadow-lg"
         initial={{ opacity: 0, y: 20 }}
         animate={{ opacity: 1, y: 0 }}
         transition={{ delay: 2.5, duration: 0.6 }}
       >
                 <div className="flex items-center gap-3 text-sm text-gray-600">
           <motion.div 
             className={`w-2 h-2 ${isComplete ? 'bg-green-500' : 'bg-emerald-500'} rounded-full`}
             animate={isComplete ? 
               { scale: 1, opacity: 1 } : 
               { scale: [1, 1.3, 1], opacity: [0.7, 1, 0.7] }
             }
             transition={{ duration: isComplete ? 0 : 2, repeat: isComplete ? 0 : Infinity }}
           />
           <span className="font-medium">
             {shouldHide ? 
               "Launching dashboard..." :
               isComplete ? 
                 "Setup complete • Welcome to your dashboard!" : 
                 isDataReady ?
                   "Data loaded • Preparing your experience..." :
                   "Loading your data • Please wait..."
             }
           </span>
         </div>
      </motion.div>
    </motion.div>
  );
};

export default Loader;
