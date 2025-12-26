import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { 
  Store, 
  TrendingUp, 
  ArrowRight,
  Loader2,
  CheckCircle,
  ExternalLink
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import axiosInstance from '../config/axios.config.js';
import { isSpApiConnected, isSpApiConnectedFromAccounts } from '../utils/spApiConnectionCheck.js';
import { clearAuthCache } from '../utils/authCoordinator.js';

// Marketplace configuration mapping
const MARKETPLACE_CONFIG = {
  // North America
  'US': { 
    sellerCentralUrl: 'https://sellercentral.amazon.com',
    adsUrl: 'https://advertising.amazon.com',
    region: 'NA'
  },
  'CA': { 
    sellerCentralUrl: 'https://sellercentral.amazon.ca',
    adsUrl: 'https://advertising.amazon.ca',
    region: 'NA'
  },
  'MX': { 
    sellerCentralUrl: 'https://sellercentral.amazon.com.mx',
    adsUrl: 'https://advertising.amazon.com.mx',
    region: 'NA'
  },
  'BR': { 
    sellerCentralUrl: 'https://sellercentral.amazon.com.br',
    adsUrl: 'https://advertising.amazon.com.br',
    region: 'NA'
  },
  
  // Europe
  'UK': { 
    sellerCentralUrl: 'https://sellercentral-europe.amazon.com',
    adsUrl: 'https://advertising.amazon.co.uk',
    region: 'EU'
  },
  'GB': {  // Alias for UK (ISO code)
    sellerCentralUrl: 'https://sellercentral-europe.amazon.com',
    adsUrl: 'https://advertising.amazon.co.uk',
    region: 'EU'
  },
  'IE': {  // Ireland
    sellerCentralUrl: 'https://sellercentral-europe.amazon.com',
    adsUrl: 'https://advertising.amazon.co.uk',
    region: 'EU'
  },
  'DE': { 
    sellerCentralUrl: 'https://sellercentral-europe.amazon.com',
    adsUrl: 'https://advertising.amazon.de',
    region: 'EU'
  },
  'FR': { 
    sellerCentralUrl: 'https://sellercentral-europe.amazon.com',
    adsUrl: 'https://advertising.amazon.fr',
    region: 'EU'
  },
  'IT': { 
    sellerCentralUrl: 'https://sellercentral-europe.amazon.com',
    adsUrl: 'https://advertising.amazon.it',
    region: 'EU'
  },
  'ES': { 
    sellerCentralUrl: 'https://sellercentral-europe.amazon.com',
    adsUrl: 'https://advertising.amazon.es',
    region: 'EU'
  },
  'NL': { 
    sellerCentralUrl: 'https://sellercentral.amazon.nl',
    adsUrl: 'https://advertising.amazon.nl',
    region: 'EU'
  },
  'SE': { 
    sellerCentralUrl: 'https://sellercentral.amazon.se',
    adsUrl: 'https://advertising.amazon.se',
    region: 'EU'
  },
  'PL': { 
    sellerCentralUrl: 'https://sellercentral.amazon.pl',
    adsUrl: 'https://advertising.amazon.pl',
    region: 'EU'
  },
  'BE': { 
    sellerCentralUrl: 'https://sellercentral.amazon.com.be',
    adsUrl: 'https://advertising.amazon.com.be',
    region: 'EU'
  },
  'EG': { 
    sellerCentralUrl: 'https://sellercentral.amazon.eg',
    adsUrl: 'https://advertising.amazon.eg',
    region: 'EU'
  },
  'TR': { 
    sellerCentralUrl: 'https://sellercentral.amazon.com.tr',
    adsUrl: 'https://advertising.amazon.com.tr',
    region: 'EU'
  },
  'SA': { 
    sellerCentralUrl: 'https://sellercentral.amazon.sa',
    adsUrl: 'https://advertising.amazon.sa',
    region: 'EU'
  },
  'AE': { 
    sellerCentralUrl: 'https://sellercentral.amazon.ae',
    adsUrl: 'https://advertising.amazon.ae',
    region: 'EU'
  },
  'IN': { 
    sellerCentralUrl: 'https://sellercentral.amazon.in',
    adsUrl: 'https://advertising.amazon.in',
    region: 'EU'
  },
  'ZA': { 
    sellerCentralUrl: 'https://sellercentral.amazon.co.za',
    adsUrl: 'https://advertising.amazon.co.za',
    region: 'EU'
  },
  
  // Far East
  'JP': { 
    sellerCentralUrl: 'https://sellercentral.amazon.co.jp',
    adsUrl: 'https://advertising.amazon.co.jp',
    region: 'FE'
  },
  'AU': { 
    sellerCentralUrl: 'https://sellercentral.amazon.com.au',
    adsUrl: 'https://advertising.amazon.com.au',
    region: 'FE'
  },
  'SG': { 
    sellerCentralUrl: 'https://sellercentral.amazon.sg',
    adsUrl: 'https://advertising.amazon.sg',
    region: 'FE'
  }
};

const ConnectAccounts = () => {
  const [sellerCentralLoading, setSellerCentralLoading] = useState(false);
  const [amazonAdsLoading, setAmazonAdsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const [marketplaceConfig, setMarketplaceConfig] = useState(null);
  const [isSellerCentralConnected, setIsSellerCentralConnected] = useState(false);
  const [isSpApiConnectedState, setIsSpApiConnectedState] = useState(false);
  const [checkingSpApi, setCheckingSpApi] = useState(true);
  
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const allAccounts = useSelector(state => state.AllAccounts?.AllAccounts) || [];
  const userData = useSelector(state => state.Auth?.user);
  
  // Get country code and region from URL parameters
  const countryCode = searchParams.get('country') || searchParams.get('countryCode');
  const region = searchParams.get('region');

  // Check SP-API connection status - ONLY run once on mount
  useEffect(() => {
    const checkSpApiConnection = async () => {
      // Check if we just came back from SP-API OAuth flow
      const justConnected = sessionStorage.getItem('sp_api_just_connected') === 'true';
      
      if (justConnected) {
        // Clear the flag
        sessionStorage.removeItem('sp_api_just_connected');
        
        // Fetch fresh profile data from API since we just connected
        try {
          const response = await axiosInstance.get('/app/profile');
          if (response?.status === 200 && response.data?.data) {
            const user = response.data.data;
            const connected = isSpApiConnected(user);
            setIsSpApiConnectedState(connected);
            if (connected) {
              setIsSellerCentralConnected(true);
              setSuccessMessage('Amazon Seller Central connected successfully!');
              // Clear success message after 5 seconds
              setTimeout(() => setSuccessMessage(''), 5000);
            }
          }
        } catch (error) {
          console.error('Error fetching profile after SP-API connection:', error);
        }
        setCheckingSpApi(false);
        return;
      }
      
      // Initial check from Redux state (no API call)
      if (allAccounts && allAccounts.length > 0) {
        const connected = isSpApiConnectedFromAccounts(allAccounts);
        setIsSpApiConnectedState(connected);
        if (connected) {
          setIsSellerCentralConnected(true);
        }
        setCheckingSpApi(false);
        return;
      }

      if (userData && userData.sellerCentral) {
        const connected = isSpApiConnected(userData);
        setIsSpApiConnectedState(connected);
        if (connected) {
          setIsSellerCentralConnected(true);
        }
        setCheckingSpApi(false);
        return;
      }

      // If no user data in Redux, make an API call to check
      // This handles cases where user refreshes the page or Redux state is stale
      try {
        const response = await axiosInstance.get('/app/profile');
        if (response?.status === 200 && response.data?.data) {
          const user = response.data.data;
          const connected = isSpApiConnected(user);
          setIsSpApiConnectedState(connected);
          if (connected) {
            setIsSellerCentralConnected(true);
          }
        } else {
          setIsSpApiConnectedState(false);
        }
      } catch (error) {
        console.error('Error checking SP-API connection status:', error);
        setIsSpApiConnectedState(false);
      }
      setCheckingSpApi(false);
    };
    
    checkSpApiConnection();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // Empty dependency - only run on mount

  // Update SP-API connection state if Redux state changes (after successful connection)
  useEffect(() => {
    // Skip on first render (handled by initial useEffect)
    if (checkingSpApi) return;
    
    if (allAccounts && allAccounts.length > 0) {
      const connected = isSpApiConnectedFromAccounts(allAccounts);
      setIsSpApiConnectedState(connected);
      if (connected) {
        setIsSellerCentralConnected(true);
      }
    } else if (userData && userData.sellerCentral) {
      const connected = isSpApiConnected(userData);
      setIsSpApiConnectedState(connected);
      if (connected) {
        setIsSellerCentralConnected(true);
      }
    }
  }, [allAccounts, userData, checkingSpApi]);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // Clear browser history - replace current entry so user can't go back
    window.history.replaceState(null, '', window.location.href);
    
    // Prevent back button navigation - always redirect back to connect-accounts if SP-API not connected
    const handlePopState = (e) => {
      // Check if SP-API is connected
      let spApiConnected = false;
      if (allAccounts && allAccounts.length > 0) {
        spApiConnected = isSpApiConnectedFromAccounts(allAccounts);
      } else if (userData && userData.sellerCentral) {
        spApiConnected = isSpApiConnected(userData);
      }
      
      // If SP-API is not connected, prevent navigation and stay on connect-accounts
      if (!spApiConnected) {
        // Push the current state again to prevent going back
        window.history.pushState(null, '', window.location.href);
        // Force navigation to connect-accounts if they somehow got away
        setTimeout(() => {
          if (!window.location.pathname.includes('/connect-accounts')) {
            navigate('/connect-accounts', { replace: true });
          }
        }, 0);
      }
    };
    
    // Add event listener to prevent back navigation
    window.addEventListener('popstate', handlePopState);
    
    // Set marketplace configuration based on country code or region
    if (countryCode && MARKETPLACE_CONFIG[countryCode.toUpperCase()]) {
      setMarketplaceConfig(MARKETPLACE_CONFIG[countryCode.toUpperCase()]);
    } else if (region) {
      // If only region is provided, default to main marketplace for that region
      const defaultMarketplace = getDefaultMarketplaceForRegion(region.toUpperCase());
      if (defaultMarketplace) {
        setMarketplaceConfig(defaultMarketplace);
      }
    } else {
      // Default to US if no parameters provided
      setMarketplaceConfig(MARKETPLACE_CONFIG['US']);
    }

    // Clear the sellerCentralLoading flag if it exists (cleanup from redirect)
    if (localStorage.getItem('sellerCentralLoading') === 'true') {
      localStorage.removeItem('sellerCentralLoading');
    }
    
    // Cleanup: remove event listener when component unmounts
    return () => {
      window.removeEventListener('popstate', handlePopState);
    };
  }, [countryCode, region, allAccounts, userData, navigate]);

  const getDefaultMarketplaceForRegion = (region) => {
    switch (region) {
      case 'NA':
        return MARKETPLACE_CONFIG['US'];
      case 'EU':
        return MARKETPLACE_CONFIG['GB'];
      case 'FE':
        return MARKETPLACE_CONFIG['JP'];
      default:
        return MARKETPLACE_CONFIG['US'];
    }
  };

  const handleConnectSellerCentral = async () => {
    if (!marketplaceConfig) {
      setErrorMessage('Marketplace configuration not found. Please check your region settings.');
      return;
    }

    setSellerCentralLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    localStorage.setItem('sellerCentralLoading', 'true');
    localStorage.setItem('amazonAdsLoading', 'false');
    // Store the marketplace info for later use
    localStorage.setItem('selectedMarketplace', JSON.stringify({
      countryCode: countryCode || 'US',
      region: marketplaceConfig.region,
      sellerCentralUrl: marketplaceConfig.sellerCentralUrl
    }));
  
    try {
      // Get the application ID from environment variable
      const applicationId = import.meta.env.VITE_APP_ID;
  
      if (!applicationId) {
        throw new Error('Application ID not configured. Please check environment variables.');
      }
  
      // Construct the Amazon authorization URL with dynamic marketplace
      const redirectUri = `${window.location.origin}/auth/callback`;
      const state = crypto.randomUUID();
      
      // Store state in sessionStorage for validation on callback
      sessionStorage.setItem('oauth_state', state);
  
      const amazonAuthUrl = new URL(`${marketplaceConfig.sellerCentralUrl}/apps/authorize/consent`);
      amazonAuthUrl.searchParams.append('application_id', applicationId);
      amazonAuthUrl.searchParams.append('redirect_uri', redirectUri);
      amazonAuthUrl.searchParams.append('state', state);
      
      // Add version=beta only if specified in environment or for testing
      if (import.meta.env.VITE_APP_BETA === 'true') {
        amazonAuthUrl.searchParams.append('version', 'beta');
      }
  
      setSuccessMessage(`Redirecting to Amazon Seller Central for ${countryCode || 'your region'}...`);
  
      // Redirect to Amazon authorization page
      setTimeout(() => {
        window.location.href = amazonAuthUrl.toString();
      }, 1000);
      
    } catch (error) {
      setSellerCentralLoading(false);
      setErrorMessage(error.message || 'Failed to connect to Seller Central. Please try again.');
      console.error('Amazon authorization error:', error);
    }
  };

  const handleConnectAmazonAds = async () => {
    if (!marketplaceConfig) {
      setErrorMessage('Marketplace configuration not found. Please check your region settings.');
      return;
    }

    setAmazonAdsLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    localStorage.setItem('sellerCentralLoading', 'false');
    localStorage.setItem('amazonAdsLoading', 'true');
    // Store the marketplace info for later use
    localStorage.setItem('selectedMarketplace', JSON.stringify({
      countryCode: countryCode || 'US',
      region: marketplaceConfig.region,
      adsUrl: marketplaceConfig.adsUrl
    }));
    
    try {
      // Get the ads client ID from environment variable
      const adsClientId = import.meta.env.VITE_ADS_CLIENT_ID || 'amzn1.application-oa2-client.cd1d81266e80444e97c6ae8795345d93';
  
      if (!adsClientId) {
        throw new Error('Ads Client ID not configured. Please check environment variables.');
      }
  
      // Construct the Amazon Ads authorization URL
      const redirectUri = `${window.location.origin}/auth/callback`;
      const state = crypto.randomUUID();
      
      // Store state in sessionStorage for validation on callback
      sessionStorage.setItem('oauth_state_ads', state);
  
      // Amazon Ads uses a different OAuth flow
      const amazonAdsAuthUrl = new URL('https://www.amazon.com/ap/oa');
      amazonAdsAuthUrl.searchParams.append('client_id', adsClientId);
      amazonAdsAuthUrl.searchParams.append('redirect_uri', redirectUri);
      amazonAdsAuthUrl.searchParams.append('response_type', 'code');
      amazonAdsAuthUrl.searchParams.append('scope', 'advertising::campaign_management');
      amazonAdsAuthUrl.searchParams.append('state', state);
      
      // Add marketplace-specific parameters if needed
      if (countryCode && countryCode !== 'US') {
        amazonAdsAuthUrl.searchParams.append('marketplace', countryCode);
      }
  
      setSuccessMessage(`Redirecting to Amazon Ads authorization for ${countryCode || 'your region'}...`);
  
      // Redirect to Amazon authorization page
      setTimeout(() => {
        window.location.href = amazonAdsAuthUrl.toString();
      }, 1000);
      
    } catch (error) {
      setAmazonAdsLoading(false);
      setErrorMessage(error.message || 'Failed to connect to Amazon Ads. Please try again.');
      console.error('Amazon Ads authorization error:', error);
    }
  };

  const navigateToLogin = async () => {
    try {
      // Call logout API to clear server-side session and cookies
      // The endpoint is GET /app/logout (requires authentication via cookies)
      // Must call this BEFORE clearing localStorage so auth middleware works
      await Promise.race([
        axiosInstance.get('/app/logout', { withCredentials: true }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Logout timeout')), 3000))
      ]);
      console.log('Logout API call successful');
    } catch (error) {
      // Log error but continue with logout process
      console.log('Logout API call result:', error.response?.status || error.message);
      // Continue with logout even if API call fails
    }
    
    // Clear local storage and auth cache AFTER API call
    localStorage.removeItem('isAuth');
    clearAuthCache();
    
    // Navigate to login page (home route)
    // Use React Router navigate with replace to prevent back navigation
    navigate('/', { replace: true });
  };

  const navigateToDashboard = () => {
    navigate('/seller-central-checker/dashboard');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 via-white to-white flex items-center justify-center">
      {/* Background Elements */}
      <div className="absolute inset-0 bg-grid-slate-100 [mask-image:linear-gradient(0deg,white,rgba(255,255,255,0.6))] dark:bg-grid-slate-700/25 dark:[mask-image:linear-gradient(0deg,rgba(255,255,255,0.1),rgba(255,255,255,0.5))]"></div>
      <div className="absolute top-10 right-10 w-72 h-72 bg-gray-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse"></div>
      <div className="absolute top-40 left-10 w-72 h-72 bg-emerald-200 rounded-full mix-blend-multiply filter blur-xl opacity-20 animate-pulse animation-delay-2000"></div>
      
      {/* Form Section */}
      <div className="relative w-full flex items-center justify-center px-4 py-4 lg:py-8">
        <div className="w-full max-w-lg">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="bg-white rounded-2xl border border-gray-200 shadow-xl p-6"
          >
            {/* Logo and Header */}
            <div className="text-center mb-6">
              <motion.div
                initial={{ opacity: 0, scale: 0.8 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.5, delay: 0.1 }}
                className="flex justify-center mb-4"
              >
                <img 
                  src="https://res.cloudinary.com/ddoa960le/image/upload/v1749657303/Seller_QI_Logo_Final_1_1_tfybls.png" 
                  alt="SellerQI Logo" 
                  className="h-10 w-auto"
                />
              </motion.div>
              <h1 className="text-xl lg:text-2xl font-bold text-gray-900 mb-2">
                Connect Your Accounts
              </h1>
              <p className="text-gray-600 text-sm">
                Connect your Amazon accounts to start optimizing your business
              </p>
              {/* Display current marketplace if available */}
              {marketplaceConfig && countryCode && (
                <p className="text-sm text-gray-500 mt-2">
                  Marketplace: {countryCode.toUpperCase()} ({marketplaceConfig.region})
                </p>
              )}
            </div>

            {/* Connection Options */}
            <div className="space-y-4">
              {/* Seller Central Connection */}
              <motion.div
                initial={{ opacity: 0, x: -20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.2 }}
                className="border border-gray-200 rounded-xl p-6 hover:border-gray-300 hover:shadow-md transition-all duration-300"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-[#3B4A6B] to-[#333651] rounded-lg flex items-center justify-center">
                    <Store className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">Amazon Seller Central</h3>
                    <p className="text-sm text-gray-600">Connect your seller account to access sales data, inventory, and performance metrics</p>
                  </div>
                </div>
                <button
                  onClick={handleConnectSellerCentral}
                  disabled={sellerCentralLoading || !marketplaceConfig || isSellerCentralConnected}
                  className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
                    isSellerCentralConnected
                      ? 'bg-green-600 text-white cursor-not-allowed'
                      : sellerCentralLoading || !marketplaceConfig
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      : 'bg-gradient-to-r from-[#3B4A6B] to-[#333651] text-white hover:from-[#2d3a52] hover:to-[#2a2e42] shadow-lg hover:shadow-xl'
                  }`}
                >
                  {isSellerCentralConnected ? (
                    <>
                      <CheckCircle className="w-5 h-5" />
                      Connected
                    </>
                  ) : sellerCentralLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Connect Seller Central
                      <ExternalLink className="w-5 h-5" />
                    </>
                  )}
                </button>
              </motion.div>

              {/* Amazon Ads Connection */}
              <motion.div
                initial={{ opacity: 0, x: 20 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.5, delay: 0.3 }}
                className="border border-gray-200 rounded-xl p-6 hover:border-gray-300 hover:shadow-md transition-all duration-300"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-lg flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-900">Amazon Ads</h3>
                    <p className="text-sm text-gray-600">Connect your advertising account to optimize campaigns and track ad performance</p>
                    {!isSpApiConnectedState && !checkingSpApi && (
                      <p className="text-xs text-orange-600 mt-1 font-medium">
                        ⚠️ Please connect Amazon Seller Central first
                      </p>
                    )}
                  </div>
                </div>
                <button
                  onClick={handleConnectAmazonAds}
                  disabled={amazonAdsLoading || !marketplaceConfig || !isSpApiConnectedState || checkingSpApi}
                  className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
                    amazonAdsLoading || !marketplaceConfig || !isSpApiConnectedState || checkingSpApi
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      : 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 shadow-lg hover:shadow-xl'
                  }`}
                >
                  {amazonAdsLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : checkingSpApi ? (
                    <>
                      <Loader2 className="w-5 h-5 animate-spin" />
                      Checking connection...
                    </>
                  ) : !isSpApiConnectedState ? (
                    <>
                      Connect SP-API First
                    </>
                  ) : (
                    <>
                      Connect Amazon Ads
                      <ExternalLink className="w-5 h-5" />
                    </>
                  )}
                </button>
              </motion.div>
            </div>

            {/* Info Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.5, delay: 0.4 }}
              className="mt-6 p-4 bg-blue-50 rounded-xl border border-blue-200"
            >
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-blue-600 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-800">
                  <p className="font-medium mb-1">Secure Connection</p>
                  <p className="text-blue-700">Your data is encrypted and securely stored. We use Amazon's official APIs and never store your login credentials.</p>
                </div>
              </div>
            </motion.div>

            {/* Navigation Links */}
            <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-200">
              <button
                type="button"
                onClick={navigateToLogin}
                className="text-sm text-gray-600 hover:text-gray-800 font-medium hover:underline transition-colors"
              >
                Back to Login
              </button>
              <button
                type="button"
                onClick={()=>navigate('/analyse-account')}
                disabled={!isSpApiConnectedState || checkingSpApi}
                className={`text-sm font-semibold transition-colors flex items-center gap-1 ${
                  !isSpApiConnectedState || checkingSpApi
                    ? 'text-gray-400 cursor-not-allowed'
                    : 'text-[#3B4A6B] hover:text-[#2d3a52] hover:underline'
                }`}
              >
                {checkingSpApi ? 'Checking...' : 'Skip for Now'}
                <ArrowRight className="w-4 h-4" />
              </button>
            </div>

            {/* Success Message */}
            <AnimatePresence>
              {successMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-green-50 border border-green-200 rounded-xl p-4 text-center mt-4"
                >
                  <p className="text-green-600 text-sm">{successMessage}</p>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Error Message */}
            <AnimatePresence>
              {errorMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-red-50 border border-red-200 rounded-xl p-4 text-center mt-4"
                >
                  <p className="text-red-600 text-sm">{errorMessage}</p>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default ConnectAccounts;