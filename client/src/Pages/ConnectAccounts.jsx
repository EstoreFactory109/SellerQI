import React, { useState, useEffect, useRef } from 'react';
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
import { hasPremiumAccess } from '../utils/subscriptionCheck.js';
import { detectCountry } from '../utils/countryDetection.js';
import stripeService from '../services/stripeService.js';
import razorpayService from '../services/razorpayService.js';

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
  const [checkingSubscription, setCheckingSubscription] = useState(true);
  const [waitingForAnalysis, setWaitingForAnalysis] = useState(false);
  const pollingRef = useRef(null);
  const timeoutRef = useRef(null);
  
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const allAccounts = useSelector(state => state.AllAccounts?.AllAccounts) || [];
  const userData = useSelector(state => state.Auth?.user);
  const isAuthenticated = useSelector(state => state.Auth?.isAuthenticated) || localStorage.getItem('isAuth') === 'true';
  
  // Get country code and region from URL parameters
  const countryCode = searchParams.get('country') || searchParams.get('countryCode');
  const region = searchParams.get('region');
  const spApiConnectedFromUrl = searchParams.get('spApiConnected') === 'true';

  // Check authentication on mount - allow all authenticated users to proceed
  useEffect(() => {
    const checkAuth = async () => {
      // If not authenticated, redirect to login
      if (!isAuthenticated) {
        console.log('ConnectAccounts: Not authenticated - redirecting to login');
        navigate('/', { replace: true });
        return;
      }

      // Allow all authenticated users to proceed (skip pricing check)
      // New signups with LITE package can connect accounts first, then pay later
      console.log('ConnectAccounts: User authenticated - allowing access');
      setCheckingSubscription(false);
    };

    checkAuth();
  }, [isAuthenticated, navigate]);

  // Check SP-API connection status - ONLY run once on mount
  useEffect(() => {
    const checkSpApiConnection = async () => {
      // If SP-API connection status is passed via URL (from Account Integrations page),
      // use that directly to avoid unnecessary checks
      if (spApiConnectedFromUrl) {
        console.log('ConnectAccounts: SP-API connected status from URL parameter');
        setIsSpApiConnectedState(true);
        setIsSellerCentralConnected(true);
        setCheckingSpApi(false);
        return;
      }

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
      
      // Check SP-API status for the specific account (country/region) if provided
      if (countryCode && region && allAccounts && allAccounts.length > 0) {
        const specificAccount = allAccounts.find(
          acc => acc.country === countryCode && acc.region === region
        );
        if (specificAccount && specificAccount.SpAPIrefreshTokenStatus) {
          console.log('ConnectAccounts: SP-API connected for specific account from Redux');
          setIsSpApiConnectedState(true);
          setIsSellerCentralConnected(true);
          setCheckingSpApi(false);
          return;
        }
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
  }, [spApiConnectedFromUrl, countryCode, region]); // Include URL params in dependencies

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

  // Wait for integration job to start (status becomes 'active')
  const waitForJobToStart = async (jobId) => {
    return new Promise((resolve) => {
      const maxWaitTime = 30000; // 30 seconds max
      const pollInterval = 2000; // Check every 2 seconds
      const startTime = Date.now();
      
      const checkStatus = async () => {
        try {
          const statusResponse = await axiosInstance.get(`/api/integration/status/${jobId}`);
          const status = statusResponse.data.data.status?.toLowerCase();
          
          console.log(`[ConnectAccounts] Job status check: ${status}`);
          
          if (status === 'active' || status === 'running') {
            // Job started - clear polling and resolve
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            console.log('[ConnectAccounts] Job has started processing');
            resolve(true);
            return;
          }
          
          if (status === 'completed') {
            // Job done - clear and resolve
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            console.log('[ConnectAccounts] Job already completed');
            resolve(true);
            return;
          }
          
          if (status === 'failed') {
            // Job failed - clear and resolve (proceed anyway)
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            console.error('[ConnectAccounts] Job failed');
            resolve(true); // Proceed anyway
            return;
          }
          
          // Check timeout
          if (Date.now() - startTime >= maxWaitTime) {
            if (pollingRef.current) {
              clearInterval(pollingRef.current);
              pollingRef.current = null;
            }
            if (timeoutRef.current) {
              clearTimeout(timeoutRef.current);
              timeoutRef.current = null;
            }
            console.warn('[ConnectAccounts] Timeout waiting for job to start, proceeding anyway');
            resolve(true); // Proceed anyway
            return;
          }
        } catch (error) {
          console.error('[ConnectAccounts] Error checking job status:', error);
          // On error, proceed anyway (don't block user)
          if (pollingRef.current) {
            clearInterval(pollingRef.current);
            pollingRef.current = null;
          }
          if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
          }
          resolve(true);
        }
      };
      
      // Start polling
      pollingRef.current = setInterval(checkStatus, pollInterval);
      
      // Check immediately
      checkStatus();
      
      // Set timeout as backup
      timeoutRef.current = setTimeout(() => {
        if (pollingRef.current) {
          clearInterval(pollingRef.current);
          pollingRef.current = null;
        }
        resolve(true);
      }, maxWaitTime);
    });
  };

  // Navigate to payment based on country
  const navigateToPayment = async () => {
    try {
      // Debug: Log Redux userData
      console.log('[ConnectAccounts] navigateToPayment called');
      console.log('[ConnectAccounts] Redux userData:', userData);
      console.log('[ConnectAccounts] Redux userData details:', {
        packageType: userData?.packageType,
        subscriptionStatus: userData?.subscriptionStatus,
        isInTrialPeriod: userData?.isInTrialPeriod,
        trialEndsDate: userData?.trialEndsDate
      });
      
      // First check Redux state for premium access
      const hasPremiumFromRedux = hasPremiumAccess(userData);
      console.log('[ConnectAccounts] hasPremiumAccess(userData) result:', hasPremiumFromRedux);
      
      if (hasPremiumFromRedux) {
        console.log('[ConnectAccounts] User already has premium access (from Redux), skipping payment...');
        console.log('[ConnectAccounts] Navigating to /analyse-account...');
        setWaitingForAnalysis(false);
        navigate('/analyse-account');
        console.log('[ConnectAccounts] navigate() called successfully');
        return;
      }
      
      // Fetch fresh user data from API to ensure we have the latest subscription status
      // This handles cases where Redux state might be stale
      try {
        console.log('[ConnectAccounts] Fetching fresh user data to verify subscription status...');
        const profileResponse = await axiosInstance.get('/app/profile');
        console.log('[ConnectAccounts] Profile API response:', profileResponse);
        
        if (profileResponse?.status === 200 && profileResponse.data?.data) {
          const freshUserData = profileResponse.data.data;
          console.log('[ConnectAccounts] Fresh user data:', {
            packageType: freshUserData.packageType,
            subscriptionStatus: freshUserData.subscriptionStatus,
            isInTrialPeriod: freshUserData.isInTrialPeriod,
            trialEndsDate: freshUserData.trialEndsDate
          });
          
          // Check fresh data for premium access (PRO, AGENCY, or active trial)
          const hasPremiumFromApi = hasPremiumAccess(freshUserData);
          console.log('[ConnectAccounts] hasPremiumAccess(freshUserData) result:', hasPremiumFromApi);
          
          if (hasPremiumFromApi) {
            console.log('[ConnectAccounts] User already has premium access (from fresh API data), skipping payment...');
            console.log('[ConnectAccounts] Navigating to /analyse-account...');
            setWaitingForAnalysis(false);
            navigate('/analyse-account');
            console.log('[ConnectAccounts] navigate() called successfully');
            return;
          }
        } else {
          console.log('[ConnectAccounts] Profile API returned unexpected response:', profileResponse?.status);
        }
      } catch (profileError) {
        console.warn('[ConnectAccounts] Could not fetch fresh profile data, proceeding with Redux state:', profileError);
        // Continue with payment flow if we can't fetch fresh data
      }
      
      // Detect user's country
      const country = await detectCountry();
      const isIndianUser = country === 'IN';
      
      console.log(`[ConnectAccounts] Detected country: ${country}, navigating to payment...`);
      
      if (isIndianUser) {
        // India: Use Razorpay with 7-day trial
        setWaitingForAnalysis(false);
        await razorpayService.initiatePayment(
          'PRO',
          // Success callback
          (result) => {
            console.log('Razorpay trial started:', result);
            navigate(`/subscription-success?gateway=razorpay&isTrialing=true&isNewSignup=true`);
          },
          // Error callback
          (error) => {
            console.error('Razorpay trial failed:', error);
            if (error.message !== 'Payment cancelled by user') {
              alert(error.message || 'Failed to start free trial. Please try again.');
            }
            setWaitingForAnalysis(false);
          },
          7 // 7-day trial period
        );
      } else {
        // US/Other: Use Stripe checkout with 7-day trial
        setWaitingForAnalysis(false);
        await stripeService.createCheckoutSession('PRO', null, 7);
        // stripeService will handle the redirect to Stripe
      }
    } catch (error) {
      console.error('[ConnectAccounts] Error navigating to payment:', error);
      setWaitingForAnalysis(false);
      // Don't block user - they can proceed manually
    }
  };

  // Handle skip button click
  const handleSkip = async () => {
    if (!isSpApiConnectedState || checkingSpApi) {
      return; // Should not happen due to disabled state, but safety check
    }

    try {
      console.log('[ConnectAccounts] Skip clicked - triggering integration job...');
      setWaitingForAnalysis(true);
      
      let jobId = null;
      
      // First check if there's an active job
      const activeResponse = await axiosInstance.get('/api/integration/active');
      
      if (activeResponse.status === 200 && activeResponse.data.data.hasActiveJob) {
        // Job already exists
        jobId = activeResponse.data.data.jobId;
        const existingStatus = activeResponse.data.data.status?.toLowerCase();
        console.log('[ConnectAccounts] Active job already exists:', existingStatus);
        
        // If already active or completed, proceed immediately
        if (existingStatus === 'active' || existingStatus === 'running' || existingStatus === 'completed') {
          await navigateToPayment();
          return;
        }
      } else {
        // No active job, trigger new one
        const triggerResponse = await axiosInstance.post('/api/integration/trigger');
        
        if (triggerResponse.status === 202 || triggerResponse.status === 200) {
          jobId = triggerResponse.data.data.jobId;
          console.log('[ConnectAccounts] Integration job triggered successfully, jobId:', jobId);
        } else {
          throw new Error('Failed to trigger integration job');
        }
      }
      
      // Wait for job to start (status becomes 'active')
      if (jobId) {
        console.log('[ConnectAccounts] Waiting for job to start...');
        await waitForJobToStart(jobId);
        console.log('[ConnectAccounts] Job started, navigating to payment...');
        await navigateToPayment();
      } else {
        throw new Error('No job ID received');
      }
    } catch (error) {
      console.error('[ConnectAccounts] Error in skip flow:', error);
      setWaitingForAnalysis(false);
      // Don't block user - they can proceed manually
      alert('Analysis started but payment setup failed. You can continue and set up payment later.');
    }
  };

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  // Show loading state while checking subscription
  if (checkingSubscription) {
    return (
      <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin text-blue-400" />
          <p className="text-gray-400">Verifying subscription...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#1a1a1a] flex items-center justify-center">
      {/* Form Section */}
      <div className="relative w-full flex items-center justify-center px-4 py-4 lg:py-8">
        <div className="w-full max-w-lg">
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-xl p-6"
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
              <h1 className="text-xl lg:text-2xl font-bold text-gray-100 mb-2">
                Connect Your Accounts
              </h1>
              <p className="text-gray-400 text-sm">
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
                className="border border-[#30363d] rounded-xl p-6 hover:border-gray-500 hover:shadow-md transition-all duration-300"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-blue-700 rounded-lg flex items-center justify-center">
                    <Store className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-100">Amazon Seller Central</h3>
                    <p className="text-sm text-gray-400">Connect your seller account to access sales data, inventory, and performance metrics</p>
                  </div>
                </div>
                <button
                  onClick={handleConnectSellerCentral}
                  disabled={sellerCentralLoading || !marketplaceConfig || isSellerCentralConnected}
                  className={`w-full py-3 px-6 rounded-lg font-semibold transition-all duration-300 flex items-center justify-center gap-2 ${
                    isSellerCentralConnected
                      ? 'bg-green-600 text-white cursor-not-allowed'
                      : sellerCentralLoading || !marketplaceConfig
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-blue-600 to-blue-700 text-white hover:from-blue-500 hover:to-blue-600 shadow-lg shadow-blue-500/25 hover:shadow-xl hover:shadow-blue-500/30'
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
                className="border border-[#30363d] rounded-xl p-6 hover:border-gray-500 hover:shadow-md transition-all duration-300"
              >
                <div className="flex items-center gap-4 mb-4">
                  <div className="w-12 h-12 bg-gradient-to-r from-emerald-500 to-emerald-600 rounded-lg flex items-center justify-center">
                    <TrendingUp className="w-6 h-6 text-white" />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-lg font-semibold text-gray-100">Amazon Ads</h3>
                    <p className="text-sm text-gray-400">Connect your advertising account to optimize campaigns and track ad performance</p>
                    {!isSpApiConnectedState && !checkingSpApi && (
                      <p className="text-xs text-orange-400 mt-1 font-medium">
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
                      ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                      : 'bg-gradient-to-r from-emerald-500 to-emerald-600 text-white hover:from-emerald-600 hover:to-emerald-700 shadow-lg shadow-emerald-500/25 hover:shadow-xl hover:shadow-emerald-500/30'
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
              className="mt-6 p-4 bg-blue-500/10 rounded-xl border border-blue-500/40"
            >
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" />
                <div className="text-sm text-blue-300">
                  <p className="font-medium mb-1">Secure Connection</p>
                  <p className="text-blue-400">Your data is encrypted and securely stored. We connect directly to Amazon's secure systems and never store your login credentials.</p>
                </div>
              </div>
            </motion.div>

            {/* Waiting for Analysis Banner */}
            {waitingForAnalysis && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="bg-blue-500/10 border border-blue-500/40 rounded-xl p-4 text-center mt-4"
              >
                <div className="flex items-center justify-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin text-blue-400" />
                  <p className="text-blue-300 text-sm font-medium">
                    Starting analysis... Please wait
                  </p>
                </div>
              </motion.div>
            )}

            {/* Navigation Links */}
            <div className="flex items-center justify-start mt-6 pt-4 border-t border-[#30363d]">
              <button
                type="button"
                onClick={navigateToLogin}
                className="text-sm text-gray-400 hover:text-gray-300 font-medium hover:underline transition-colors"
              >
                Back to Login
              </button>
            </div>

            {/* Success Message */}
            <AnimatePresence>
              {successMessage && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-green-500/10 border border-green-500/40 rounded-xl p-4 text-center mt-4"
                >
                  <p className="text-green-300 text-sm">{successMessage}</p>
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
                  className="bg-red-500/10 border border-red-500/40 rounded-xl p-4 text-center mt-4"
                >
                  <p className="text-red-300 text-sm">{errorMessage}</p>
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