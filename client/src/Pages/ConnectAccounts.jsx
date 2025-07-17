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

// Region to Seller Central URL mapping
const SELLER_CENTRAL_URLS = {
  // North America
  'US': 'https://sellercentral.amazon.com',
  'CA': 'https://sellercentral.amazon.com',
  'MX': 'https://sellercentral.amazon.com.mx',
  'BR': 'https://sellercentral.amazon.com.br',
  
  // Europe
  'UK': 'https://sellercentral-europe.amazon.com',
  'GB': 'https://sellercentral-europe.amazon.com', // Alternative code for UK
  'DE': 'https://sellercentral-europe.amazon.com',
  'FR': 'https://sellercentral-europe.amazon.com',
  'IT': 'https://sellercentral-europe.amazon.com',
  'ES': 'https://sellercentral-europe.amazon.com',
  'IE': 'https://sellercentral-europe.amazon.com',
  'NL': 'https://sellercentral.amazon.nl',
  'BE': 'https://sellercentral.amazon.com.be',
  'SE': 'https://sellercentral.amazon.se',
  'PL': 'https://sellercentral.amazon.pl',
  'TR': 'https://sellercentral.amazon.com.tr',
  'AE': 'https://sellercentral.amazon.ae',
  'SA': 'https://sellercentral.amazon.sa',
  'EG': 'https://sellercentral.amazon.eg',
  'IN': 'https://sellercentral.amazon.in',
  'ZA': 'https://sellercentral.amazon.co.za',
  
  // Far East
  'JP': 'https://sellercentral.amazon.co.jp',
  'AU': 'https://sellercentral.amazon.com.au',
  'SG': 'https://sellercentral.amazon.sg'
};

// Region to Amazon Ads URL mapping
const AMAZON_ADS_URLS = {
  // North America
  'US': 'https://na.account.amazon.com',
  'CA': 'https://na.account.amazon.com',
  'MX': 'https://na.account.amazon.com',
  'BR': 'https://na.account.amazon.com',
  
  // Europe
  'UK': 'https://eu.account.amazon.com',
  'GB': 'https://eu.account.amazon.com',
  'DE': 'https://eu.account.amazon.com',
  'FR': 'https://eu.account.amazon.com',
  'IT': 'https://eu.account.amazon.com',
  'ES': 'https://eu.account.amazon.com',
  'IE': 'https://eu.account.amazon.com',
  'NL': 'https://eu.account.amazon.com',
  'BE': 'https://eu.account.amazon.com',
  'SE': 'https://eu.account.amazon.com',
  'PL': 'https://eu.account.amazon.com',
  'TR': 'https://eu.account.amazon.com',
  'AE': 'https://eu.account.amazon.com',
  'SA': 'https://eu.account.amazon.com',
  'EG': 'https://eu.account.amazon.com',
  'IN': 'https://eu.account.amazon.com',
  'ZA': 'https://eu.account.amazon.com',
  
  // Far East
  'JP': 'https://fe.account.amazon.com',
  'AU': 'https://fe.account.amazon.com',
  'SG': 'https://fe.account.amazon.com'
};

// Helper function to get region from country code
const getRegionFromCountry = (countryCode) => {
  const upperCountry = countryCode?.toUpperCase();
  
  // North America
  if (['US', 'CA', 'MX', 'BR'].includes(upperCountry)) return 'NA';
  
  // Far East
  if (['JP', 'AU', 'SG'].includes(upperCountry)) return 'FE';
  
  // Europe (default for all others)
  return 'EU';
};

const ConnectAccounts = () => {
  const [searchParams] = useSearchParams();
  const [sellerCentralLoading, setSellerCentralLoading] = useState(false);
  const [amazonAdsLoading, setAmazonAdsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');
  const navigate = useNavigate();

  // Get country code and region from URL params
  const countryCode = searchParams.get('country') || searchParams.get('countryCode') || 'US';
  const region = searchParams.get('region') || getRegionFromCountry(countryCode);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);

  const handleConnectSellerCentral = async () => {
    setSellerCentralLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    localStorage.setItem('sellerCentralLoading', 'true');
    localStorage.setItem('amazonAdsLoading', 'false');
    localStorage.setItem('amazonRegion', region);
    localStorage.setItem('amazonCountry', countryCode);
  
    try {
      // Get the application ID from environment variable
      const applicationId = import.meta.env.VITE_APP_ID;
  
      if (!applicationId) {
        throw new Error('Application ID not configured. Please check environment variables.');
      }

      // Get the appropriate Seller Central URL for the country
      const sellerCentralBaseUrl = SELLER_CENTRAL_URLS[countryCode.toUpperCase()] || SELLER_CENTRAL_URLS['US'];
  
      // Construct the Amazon authorization URL
      const redirectUri = `${window.location.origin}/auth/callback`;
      const state = JSON.stringify({
        random: crypto.randomUUID(),
        region: region,
        country: countryCode,
        type: 'seller_central'
      });
  
      const amazonAuthUrl = new URL(`${sellerCentralBaseUrl}/apps/authorize/consent`);
      amazonAuthUrl.searchParams.append('application_id', applicationId);
      amazonAuthUrl.searchParams.append('redirect_uri', redirectUri);
      amazonAuthUrl.searchParams.append('state', state);
      
      // Only add version=beta if in development
      if (import.meta.env.MODE === 'development') {
        amazonAuthUrl.searchParams.append('version', 'beta');
      }
  
      setSuccessMessage(`Redirecting to Amazon Seller Central (${countryCode.toUpperCase()}) authorization...`);
  
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
    setAmazonAdsLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    localStorage.setItem('sellerCentralLoading', 'false');
    localStorage.setItem('amazonAdsLoading', 'true');
    localStorage.setItem('amazonRegion', region);
    localStorage.setItem('amazonCountry', countryCode);
    
    try {
      // Get the ads client ID from environment variable
      const adsClientId = import.meta.env.VITE_AMAZON_ADS_CLIENT_ID || 'amzn1.application-oa2-client.cd1d81266e80444e97c6ae8795345d93';
  
      // Get the appropriate Amazon Ads URL for the country
      const amazonAdsBaseUrl = AMAZON_ADS_URLS[countryCode.toUpperCase()] || AMAZON_ADS_URLS['US'];
  
      // Construct the Amazon Ads authorization URL
      const redirectUri = `${window.location.origin}/auth/callback`;
      const state = JSON.stringify({
        random: crypto.randomUUID(),
        region: region,
        country: countryCode,
        type: 'amazon_ads'
      });
  
      const amazonAuthUrl = new URL(`${amazonAdsBaseUrl}/ap/oa`);
      amazonAuthUrl.searchParams.append('client_id', adsClientId);
      amazonAuthUrl.searchParams.append('redirect_uri', redirectUri);
      amazonAuthUrl.searchParams.append('response_type', 'code');
      amazonAuthUrl.searchParams.append('scope', 'advertising::campaign_management');
      amazonAuthUrl.searchParams.append('state', state);
  
      setSuccessMessage(`Redirecting to Amazon Ads (${countryCode.toUpperCase()}) authorization...`);
  
      // Redirect to Amazon authorization page
      setTimeout(() => {
        window.location.href = amazonAuthUrl.toString();
      }, 1000);
      
    } catch (error) {
      setAmazonAdsLoading(false);
      setErrorMessage(error.message || 'Failed to connect to Amazon Ads. Please try again.');
      console.error('Amazon Ads authorization error:', error);
    }
  };

  const navigateToLogin = () => {
    navigate('/log-in');
  };

  const navigateToDashboard = () => {
    navigate('/seller-central-checker/dashboard');
  };

  // Get display name for the region/country
  const getRegionDisplayName = () => {
    const countryNames = {
      'US': 'United States',
      'CA': 'Canada',
      'MX': 'Mexico',
      'BR': 'Brazil',
      'UK': 'United Kingdom',
      'GB': 'United Kingdom',
      'DE': 'Germany',
      'FR': 'France',
      'IT': 'Italy',
      'ES': 'Spain',
      'IE': 'Ireland',
      'NL': 'Netherlands',
      'BE': 'Belgium',
      'SE': 'Sweden',
      'PL': 'Poland',
      'TR': 'Turkey',
      'AE': 'UAE',
      'SA': 'Saudi Arabia',
      'EG': 'Egypt',
      'IN': 'India',
      'ZA': 'South Africa',
      'JP': 'Japan',
      'AU': 'Australia',
      'SG': 'Singapore'
    };
    return countryNames[countryCode.toUpperCase()] || countryCode.toUpperCase();
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
                Connect Your Amazon Accounts
              </h1>
              <p className="text-gray-600 text-sm mb-1">
                Connect your Amazon accounts to start optimizing your business
              </p>
              <p className="text-sm text-gray-500">
                Region: <span className="font-medium text-gray-700">{getRegionDisplayName()} ({region})</span>
              </p>
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
                  disabled={sellerCentralLoading}
                  className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
                    sellerCentralLoading
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      : 'bg-gradient-to-r from-[#3B4A6B] to-[#333651] text-white hover:from-[#2d3a52] hover:to-[#2a2e42] shadow-lg hover:shadow-xl'
                  }`}
                >
                  {sellerCentralLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Connect Seller Central ({countryCode.toUpperCase()})
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
                  </div>
                </div>
                <button
                  onClick={handleConnectAmazonAds}
                  disabled={amazonAdsLoading}
                  className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
                    amazonAdsLoading
                      ? 'bg-gray-400 text-gray-200 cursor-not-allowed'
                      : 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 shadow-lg hover:shadow-xl'
                  }`}
                >
                  {amazonAdsLoading ? (
                    <Loader2 className="w-5 h-5 animate-spin" />
                  ) : (
                    <>
                      Connect Amazon Ads ({countryCode.toUpperCase()})
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
                onClick={navigateToDashboard}
                className="text-sm text-[#3B4A6B] hover:text-[#2d3a52] font-semibold hover:underline transition-colors flex items-center gap-1"
              >
                Skip for Now
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

          {/* Region Selector (Optional) */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="mt-4 text-center"
          >
            <p className="text-sm text-gray-600">
              Wrong region? 
              <button
                onClick={() => {
                  const newCountry = prompt('Enter country code (e.g., US, UK, DE, JP):');
                  if (newCountry) {
                    const newRegion = getRegionFromCountry(newCountry);
                    navigate(`?country=${newCountry}&region=${newRegion}`);
                  }
                }}
                className="ml-1 text-[#3B4A6B] hover:text-[#2d3a52] font-medium underline"
              >
                Change Region
              </button>
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default ConnectAccounts;