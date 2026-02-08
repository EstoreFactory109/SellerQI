import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import sellerQILogo from '../../assets/Logo/sellerQILogo.png';

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
        className="w-full h-[100vh] fixed z-[99] flex flex-col justify-center items-center bg-gradient-to-br from-surface-base via-surface-elevated to-surface-base text-content-primary"
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
      {/* Geometric Background Pattern - themed */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-32 h-32 border border-accent/20 transform rotate-45 rounded-lg" />
        <div className="absolute bottom-1/4 right-1/4 w-24 h-24 border border-accent-muted/20 transform rotate-12 rounded-lg" />
        <div className="absolute top-1/3 right-1/3 w-16 h-16 border border-accent/15 transform -rotate-45 rounded-lg" />
        
        {/* Floating hexagonal particles */}
        {[...Array(6)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute w-3 h-3 border border-accent/30"
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

      {/* Layered Card Stack Effect - themed surfaces */}
      <motion.div
        className="relative"
        variants={cardStackVariants}
        animate="animate"
      >
        {/* Background Cards - themed surfaces */}
        <div className="absolute inset-0 bg-surface-elevated/40 rounded-2xl border border-accent/20 transform rotate-1 scale-95 opacity-60" />
        <div className="absolute inset-0 bg-surface-elevated/40 rounded-2xl border border-accent-muted/20 transform -rotate-1 scale-97 opacity-80" />
        
                 {/* Main Content Card - themed */}
         <motion.div
           className="bg-surface rounded-2xl border border-border-dark shadow-2xl p-6 max-w-lg w-full mx-4 relative overflow-hidden backdrop-blur-sm"
           initial={{ scale: 0.8, opacity: 0, rotateY: -30 }}
           animate={{ scale: 1, opacity: 1, rotateY: 0 }}
           transition={{ duration: 1, ease: "easeOut", delay: 0.2 }}
         >
          {/* Animated Border Gradient - themed accent */}
          <div className="absolute inset-0 rounded-2xl p-[2px] bg-gradient-to-r from-accent via-accent-hover to-accent opacity-30">
            <div className="w-full h-full bg-surface rounded-2xl" />
          </div>

          {/* Holographic Corner Effects - themed accent */}
          <div className="absolute top-4 right-4 w-12 h-12 bg-gradient-to-br from-accent/15 to-transparent rounded-full blur-xl" />
          <div className="absolute bottom-4 left-4 w-16 h-16 bg-gradient-to-tr from-accent-hover/15 to-transparent rounded-full blur-xl" />

                 {/* Logo Section - themed */}
           <motion.div
             className="flex justify-center mb-6"
             initial={{ scale: 0, rotateY: 180 }}
             animate={{ scale: 1, rotateY: 0 }}
             transition={{ duration: 1.2, ease: "easeOut", delay: 0.5 }}
           >
                         <motion.div
               className="relative p-4 rounded-xl bg-gradient-to-br from-surface-base via-surface-elevated to-surface-base border border-accent/30 shadow-lg"
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
              <div className="absolute inset-2 bg-gradient-to-r from-accent/10 via-accent-hover/10 to-accent/10 rounded-xl blur-sm" />
              
              {/* Corner accent lines - themed */}
              <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 border-accent/50 rounded-tl" />
              <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 border-accent-hover/50 rounded-tr" />
              <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 border-accent-hover/50 rounded-bl" />
              <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-accent/50 rounded-br" />
            </motion.div>
          </motion.div>

                     {/* Hexagonal Loader System */}
           <div className="flex justify-center mb-6">
             <div className="relative w-32 h-32">
                             {/* Outer Hexagonal Frame - themed */}
               <motion.div
                 className="absolute inset-0 w-32 h-32 border-2 border-accent/30 rounded-xl"
                 style={{
                   clipPath: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
                 }}
                 variants={hexRotateVariants}
                 animate="animate"
               />
               
               {/* Middle Hexagon - themed accent */}
               <motion.div
                 className="absolute inset-3 w-26 h-26 bg-gradient-to-r from-accent/20 to-accent-hover/20 rounded-lg backdrop-blur-sm"
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

                              {/* Animated Loading Ring - themed accent */}
               <motion.div
                 className="absolute inset-6 w-20 h-20 border-4 border-transparent rounded-full"
                 style={{
                   background: `conic-gradient(from 0deg, transparent, ${
                     isDataReady ? '#10b981' : 'var(--accent)'
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
                   'bg-gradient-to-r from-accent to-accent-hover'
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

             {/* Central Hub - themed accent */}
              <motion.div
               className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-8 h-8 bg-gradient-to-br from-accent to-accent-hover rounded-lg shadow-2xl"
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

              {/* Orbital Elements - themed accent */}
              <motion.div
                className="absolute inset-0"
                variants={orbitVariants}
                animate="animate"
              >
                                 {[...Array(3)].map((_, i) => (
                   <div
                     key={i}
                     className="absolute w-2 h-2 bg-gradient-to-r from-accent to-accent-hover rounded-full shadow-lg"
                     style={{
                       left: "50%",
                       top: `${12 + i * 18}px`,
                       transformOrigin: `0 ${52 - i * 18}px`,
                     }}
                   />
                 ))}
              </motion.div>

                             {/* Pulse Waves - themed accent */}
               {[...Array(3)].map((_, i) => (
                 <motion.div
                   key={i}
                   className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 border-2 border-accent/25 rounded-full"
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
                     isDataReady ? 'bg-green-500' : 'bg-accent'
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
                 isComplete ? 'bg-emerald-500/20 text-emerald-300' :
                 isDataReady ? 'bg-green-500/20 text-green-300' : 
                 'bg-accent/20 text-accent'
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
                 <p className="text-content-secondary leading-relaxed">
                   Welcome to your personalized analytics dashboard
                 </p>
               </>
             ) : isDataReady ? (
               <>
                 <h2 className="text-2xl font-bold bg-gradient-to-r from-green-600 via-emerald-600 to-green-600 bg-clip-text text-transparent">
                   Completing Setup
                 </h2>
                 <p className="text-content-secondary leading-relaxed">
                   Data loaded • Finalizing dashboard preparation
                 </p>
               </>
             ) : showAccessText ? (
               <>
                 <h2 className="text-2xl font-bold bg-gradient-to-r from-accent via-accent-hover to-accent bg-clip-text text-transparent">
                   Loading Dashboard Data
                 </h2>
                 <p className="text-content-secondary leading-relaxed">
                   Fetching your latest analytics and insights
                 </p>
               </>
             ) : (
               <>
                 <h2 className="text-2xl font-bold bg-gradient-to-r from-accent-hover via-accent to-accent-hover bg-clip-text text-transparent">
                   Connecting to Services
                 </h2>
                 <p className="text-content-secondary leading-relaxed">
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
               { label: "Security", status: isComplete ? "Secure" : "Active", icon: "🛡️", cardClass: "p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 backdrop-blur-sm", labelClass: "font-bold text-emerald-400 text-sm", statusClass: "text-xs text-emerald-300 font-medium" },
               { label: "Data Loading", status: isComplete ? "Complete" : isDataReady ? "Ready" : "Loading", icon: isComplete ? "✅" : isDataReady ? "✅" : "📊", cardClass: isComplete ? "p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 backdrop-blur-sm" : isDataReady ? "p-3 rounded-lg bg-green-500/10 border border-green-500/30 backdrop-blur-sm" : "p-3 rounded-lg bg-accent/10 border border-accent/30 backdrop-blur-sm", labelClass: isComplete ? "font-bold text-emerald-400 text-sm" : isDataReady ? "font-bold text-green-400 text-sm" : "font-bold text-accent text-sm", statusClass: isComplete ? "text-xs text-emerald-300 font-medium" : isDataReady ? "text-xs text-green-300 font-medium" : "text-xs text-accent font-medium" },
               { label: "Dashboard", status: isComplete ? "Ready" : isDataReady ? "Preparing" : "Waiting", icon: isComplete ? "🚀" : isDataReady ? "⚙️" : "⏳", cardClass: isComplete ? "p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/30 backdrop-blur-sm" : isDataReady ? "p-3 rounded-lg bg-orange-500/10 border border-orange-500/30 backdrop-blur-sm" : "p-3 rounded-lg bg-border-muted/10 border border-border-muted backdrop-blur-sm", labelClass: isComplete ? "font-bold text-emerald-400 text-sm" : isDataReady ? "font-bold text-orange-400 text-sm" : "font-bold text-content-muted text-sm", statusClass: isComplete ? "text-xs text-emerald-300 font-medium" : isDataReady ? "text-xs text-orange-300 font-medium" : "text-xs text-content-muted font-medium" }
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
                className="w-1 bg-gradient-to-t from-accent to-accent-hover rounded-full"
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

             {/* Status Footer - themed surface */}
       <motion.div
         className="mt-4 px-4 py-2 bg-surface-elevated/90 backdrop-blur-sm rounded-full border border-border-dark shadow-lg"
         initial={{ opacity: 0, y: 20 }}
         animate={{ opacity: 1, y: 0 }}
         transition={{ delay: 2.5, duration: 0.6 }}
       >
                <div className="flex items-center gap-3 text-sm text-content-secondary">
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
