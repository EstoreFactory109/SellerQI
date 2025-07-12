import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { CheckCircle, Shield, Database, Users } from "lucide-react";

const GoogleInfoPage = () => {
  const [currentStep, setCurrentStep] = useState(0);
  const [showDetails, setShowDetails] = useState(false);
  const [userInfo, setUserInfo] = useState(null);


  useEffect(() => {
    // Parse the URL for the query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const accessToken = urlParams.get('access_token');
    const idToken = urlParams.get('id_token');

    // If access token or id token is available, you can use it to get user details
    if (accessToken || idToken) {
      fetch(`https://www.googleapis.com/oauth2/v3/tokeninfo?id_token=${idToken}`)
        .then(response => response.json())
        .then(data => {
          const email = data.email;
          const firstname = data.name.split(" ")[0];
          const lastname = data.name.split(" ")[1];
          setUserInfo({ email, firstname, lastname });
        })
        .catch(error => console.error('Error fetching Google user data:', error));
    }
  }, []);


  // Simulate authentication steps
  useEffect(() => {
    const steps = [
      { delay: 1000, step: 0 },
      { delay: 2500, step: 1 },
      { delay: 4000, step: 2 },
      { delay: 5500, step: 3 },
    ];

    steps.forEach(({ delay, step }) => {
      setTimeout(() => setCurrentStep(step), delay);
    });

    // Show details after authentication complete
    setTimeout(() => setShowDetails(true), 6500);
  }, []);

  const authSteps = [
    {
      icon: Shield,
      label: "Authenticating",
      description: "Verifying Google credentials",
      color: "blue"
    },
    {
      icon: Users,
      label: "Retrieving Profile",
      description: "Fetching user information",
      color: "emerald"
    },
    {
      icon: Database,
      label: "Syncing Data",
      description: "Updating account details",
      color: "purple"
    },
    {
      icon: CheckCircle,
      label: "Complete",
      description: "Welcome to SellerQI!",
      color: "green"
    }
  ];

  // Floating particle animation
  const particleVariants = {
    animate: {
      y: [0, -20, 0],
      opacity: [0.3, 0.8, 0.3],
      scale: [1, 1.2, 1],
      rotate: [0, 180, 360],
      transition: {
        duration: 4,
        repeat: Infinity,
        ease: "easeInOut",
      },
    },
  };

  // Pulse wave animation
  const pulseVariants = {
    animate: {
      scale: [1, 2.5, 1],
      opacity: [0.6, 0, 0.6],
      transition: {
        duration: 3,
        repeat: Infinity,
        ease: "easeInOut",
      },
    },
  };

  const getStepColor = (index) => {
    if (index < currentStep) return "emerald";
    if (index === currentStep) return authSteps[index].color;
    return "gray";
  };

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('Processing Google authentication...');
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [searchParams] = useSearchParams();

  useEffect(() => {
    handleGoogleCallback();
  }, []);

  const handleGoogleCallback = async () => {
    try {
      // Check for various Google OAuth parameters
      const code = searchParams.get('code');
      const state = searchParams.get('state');
      const error = searchParams.get('error');
      const errorDescription = searchParams.get('error_description');

      if (error) {
        setError(`Google OAuth Error: ${error} - ${errorDescription || 'Unknown error'}`);
        setLoading(false);
        return;
      }

      if (code) {
        setStatus('Exchanging authorization code...');
        // Handle authorization code flow if implemented
        await handleAuthorizationCode(code, state);
      } else {
        // If no code, try the ID token flow fallback
        setStatus('Initializing Google sign-in...');
        await handleIdTokenFlow();
      }

    } catch (err) {
      console.error('Google auth callback error:', err);
      setError(err.message || 'Google authentication failed');
      setLoading(false);
    }
  };

  const handleAuthorizationCode = async (code, state) => {
    try {
      // This would be used if you implement server-side authorization code flow
      // For now, we'll redirect to the ID token flow
      setStatus('Code received, proceeding with authentication...');
      
      // You can implement server-side code exchange here if needed
      // For now, fall back to the existing ID token flow
      await handleIdTokenFlow();
      
    } catch (error) {
      throw new Error(`Failed to process authorization code: ${error.message}`);
    }
  };

  const handleIdTokenFlow = async () => {
    try {
      setStatus('Completing authentication...');
      
      // Determine if this is a signup or login flow
      const isSignUp = searchParams.get('signup') === 'true' || 
                       sessionStorage.getItem('googleAuthFlow') === 'signup';
      
      const response = isSignUp 
        ? await googleAuthService.handleGoogleSignUp()
        : await googleAuthService.handleGoogleSignIn();
      
      if (response.status === 200) {
        // Existing user login
        dispatch(loginSuccess(response.data));
        localStorage.setItem("isAuth", true);
        
        setStatus('Checking subscription status...');
        
        try {
          const subscriptionStatus = await stripeService.getSubscriptionStatus();
          
          if (subscriptionStatus.hasSubscription) {
            setStatus('Redirecting to dashboard...');
            setTimeout(() => {
              window.location.href = "/seller-central-checker/dashboard";
            }, 1000);
          } else {
            setStatus('Redirecting to pricing...');
            setTimeout(() => {
              navigate("/pricing");
            }, 1000);
          }
        } catch (error) {
          console.error('Error checking subscription status:', error);
          setStatus('Redirecting to pricing...');
          setTimeout(() => {
            navigate("/pricing");
          }, 1000);
        }
        
      } else if (response.status === 201) {
        // New user registration
        dispatch(loginSuccess(response.data));
        localStorage.setItem("isAuth", true);
        
        setStatus('Registration successful! Redirecting...');
        setTimeout(() => {
          navigate("/connect-to-amazon");
        }, 1000);
      }
      
      setLoading(false);
      
    } catch (error) {
      throw new Error(`Authentication failed: ${error.message}`);
    }
  };

  return (
    <motion.div
      className="w-full h-[100vh] fixed z-[99] flex flex-col justify-center items-center bg-gradient-to-br from-slate-50 via-white to-blue-50/30"
      initial={{ opacity: 0 }}
      animate={{ opacity: showDetails ? 0 : 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.8, ease: "easeInOut" }}
    >
      {/* Geometric Background Pattern */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute top-1/4 left-1/4 w-32 h-32 border border-blue-100/50 transform rotate-45 rounded-lg" />
        <div className="absolute bottom-1/4 right-1/4 w-24 h-24 border border-purple-100/50 transform rotate-12 rounded-lg" />
        <div className="absolute top-1/3 right-1/3 w-16 h-16 border border-blue-100/30 transform -rotate-45 rounded-lg" />
        
        {/* Floating Google-themed particles */}
        {[...Array(8)].map((_, i) => (
          <motion.div
            key={i}
            className={`absolute w-3 h-3 rounded-full ${
              i % 4 === 0 ? 'bg-blue-400/40' :
              i % 4 === 1 ? 'bg-red-400/40' :
              i % 4 === 2 ? 'bg-yellow-400/40' : 'bg-green-400/40'
            }`}
            style={{
              left: `${15 + Math.random() * 70}%`,
              top: `${15 + Math.random() * 70}%`,
            }}
            variants={particleVariants}
            animate="animate"
            transition={{
              delay: Math.random() * 2,
              duration: 3 + Math.random() * 2,
            }}
          />
        ))}
      </div>

      {/* Main Content Card */}
      <motion.div
        className="bg-white rounded-2xl border border-gray-200 shadow-2xl p-8 max-w-lg w-full mx-4 relative overflow-hidden backdrop-blur-sm"
        initial={{ scale: 0.8, opacity: 0, rotateY: -15 }}
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

        {/* Logo Section */}
        <motion.div
          className="flex justify-center mb-8"
          initial={{ scale: 0, rotateY: 180 }}
          animate={{ scale: 1, rotateY: 0 }}
          transition={{ duration: 1.2, ease: "easeOut", delay: 0.5 }}
        >
          <motion.div
            className="relative p-4 rounded-xl bg-gradient-to-br from-blue-50 via-white to-purple-50 border-2 border-blue-200/50 shadow-lg"
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
            
            {/* Corner accent lines */}
            <div className="absolute top-2 left-2 w-4 h-4 border-l-2 border-t-2 border-blue-400/60 rounded-tl" />
            <div className="absolute top-2 right-2 w-4 h-4 border-r-2 border-t-2 border-purple-400/60 rounded-tr" />
            <div className="absolute bottom-2 left-2 w-4 h-4 border-l-2 border-b-2 border-purple-400/60 rounded-bl" />
            <div className="absolute bottom-2 right-2 w-4 h-4 border-r-2 border-b-2 border-blue-400/60 rounded-br" />
          </motion.div>
        </motion.div>

        {/* Google Authentication Spinner */}
        <div className="flex justify-center mb-8">
          <div className="relative w-24 h-24">
            {/* Pulse Waves */}
            {[...Array(3)].map((_, i) => (
              <motion.div
                key={i}
                className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 border-2 border-blue-400/20 rounded-full"
                style={{
                  width: `${32 + i * 16}px`,
                  height: `${32 + i * 16}px`,
                }}
                variants={pulseVariants}
                animate="animate"
                transition={{
                  delay: i * 0.5,
                  duration: 3,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            ))}

            {/* Google-style Rotating Ring */}
            <motion.div
              className="absolute inset-2 border-4 border-transparent rounded-full"
              style={{
                background: `conic-gradient(from 0deg, #4285f4, #ea4335, #fbbc05, #34a853, #4285f4)`,
                maskImage: `conic-gradient(from 0deg, transparent, transparent, black)`,
                WebkitMaskImage: `conic-gradient(from 0deg, transparent, transparent, black)`,
              }}
              animate={{
                rotate: 360,
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "linear",
              }}
            />

            {/* Center Google Icon Area */}
            <motion.div
              className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center border-2 border-gray-100"
              animate={{
                scale: [1, 1.1, 1],
              }}
              transition={{
                duration: 2,
                repeat: Infinity,
                ease: "easeInOut",
              }}
            >
              <div className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-500 via-red-500 via-yellow-500 to-green-500">
                G
              </div>
            </motion.div>
          </div>
        </div>

        {/* Authentication Steps */}
        <motion.div
          className="mb-8"
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut", delay: 0.8 }}
        >
          <h2 className="text-2xl font-bold text-center mb-6 bg-gradient-to-r from-blue-600 via-purple-600 to-blue-600 bg-clip-text text-transparent">
            Setting Up Your Account
          </h2>
          
          <div className="space-y-4">
            {authSteps.map((step, index) => {
              const Icon = step.icon;
              const isActive = index === currentStep;
              const isComplete = index < currentStep;
              const colorClass = getStepColor(index);
              
              return (
                <motion.div
                  key={index}
                  className={`flex items-center space-x-4 p-3 rounded-xl transition-all duration-500 ${
                    isActive ? 'bg-blue-50 border-2 border-blue-200' : 
                    isComplete ? 'bg-emerald-50 border-2 border-emerald-200' : 
                    'bg-gray-50 border-2 border-gray-100'
                  }`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ 
                    opacity: 1, 
                    x: 0,
                    scale: isActive ? 1.02 : 1 
                  }}
                  transition={{ 
                    duration: 0.5, 
                    delay: 0.1 * index,
                    scale: { duration: 0.3 }
                  }}
                >
                  <motion.div
                    className={`w-8 h-8 rounded-full flex items-center justify-center ${
                      isComplete ? 'bg-emerald-500' :
                      isActive ? 'bg-blue-500' : 'bg-gray-300'
                    }`}
                    animate={isActive ? {
                      scale: [1, 1.2, 1],
                    } : {}}
                    transition={isActive ? {
                      duration: 1.5,
                      repeat: Infinity,
                      ease: "easeInOut"
                    } : {}}
                  >
                    {isComplete ? (
                      <CheckCircle className="w-5 h-5 text-white" />
                    ) : (
                      <Icon className={`w-5 h-5 ${isActive ? 'text-white' : 'text-gray-600'}`} />
                    )}
                  </motion.div>
                  
                  <div className="flex-1">
                    <h3 className={`font-semibold ${
                      isActive ? 'text-blue-700' :
                      isComplete ? 'text-emerald-700' : 'text-gray-600'
                    }`}>
                      {step.label}
                    </h3>
                    <p className={`text-sm ${
                      isActive ? 'text-blue-600' :
                      isComplete ? 'text-emerald-600' : 'text-gray-500'
                    }`}>
                      {step.description}
                    </p>
                  </div>
                  
                  {isActive && (
                    <motion.div
                      className="w-2 h-2 bg-blue-500 rounded-full"
                      animate={{
                        scale: [1, 1.5, 1],
                        opacity: [0.5, 1, 0.5],
                      }}
                      transition={{
                        duration: 1,
                        repeat: Infinity,
                        ease: "easeInOut"
                      }}
                    />
                  )}
                </motion.div>
              );
            })}
          </div>
        </motion.div>

        {/* Progress Indicator */}
        <motion.div
          className="mb-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 0.4 }}
        >
          <div className="flex justify-between items-center mb-2">
            <span className="text-sm font-medium text-gray-600">Progress</span>
            <span className="text-sm font-medium text-blue-600">
              {Math.min(currentStep + 1, authSteps.length)}/{authSteps.length}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2 overflow-hidden">
            <motion.div
              className="h-full bg-gradient-to-r from-blue-500 to-purple-500 rounded-full"
              initial={{ width: "0%" }}
              animate={{ 
                width: `${((currentStep + 1) / authSteps.length) * 100}%` 
              }}
              transition={{ duration: 0.8, ease: "easeOut" }}
            />
          </div>
        </motion.div>

        {/* Status Footer */}
        <motion.div
          className="text-center"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 2, duration: 0.6 }}
        >
          <div className="flex items-center justify-center gap-2 text-sm text-gray-600">
            <motion.div 
              className="w-2 h-2 bg-blue-500 rounded-full"
              animate={{ 
                scale: [1, 1.3, 1], 
                opacity: [0.7, 1, 0.7] 
              }}
              transition={{ 
                duration: 2, 
                repeat: Infinity 
              }}
            />
            <span className="font-medium">
              {currentStep < 3 ? 
                "Connecting with Google services..." :
                "Authentication successful!"
              }
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-2">
            This may take a few moments. Please don't close this window.
          </p>
        </motion.div>
      </motion.div>
    </motion.div>
  );
};

export default GoogleInfoPage;
