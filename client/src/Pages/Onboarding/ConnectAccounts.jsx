import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Store,
  TrendingUp,
  Loader2,
  CheckCircle,
  ExternalLink
} from 'lucide-react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useSelector } from 'react-redux';
import axiosInstance from '../../config/axios.config.js';
import { isSpApiConnected, isSpApiConnectedFromAccounts } from '../../utils/spApiConnectionCheck.js';
import { clearAuthCache } from '../../utils/authCoordinator.js';
import { hasPremiumAccess } from '../../utils/subscriptionCheck.js';
import { detectCountry } from '../../utils/countryDetection.js';
import stripeService from '../../services/stripeService.js';
import { devLog, devWarn } from '../../utils/devLogger.js';
import OnboardingShell from '../../Components/Onboarding/OnboardingShell.jsx';
import { COLORS } from '../../Components/Shared/index.js';

// Matches the onboarding shell's inset panel shade.
const PANEL_BG = '#10141C';

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

// Amazon Ads LWA authorization base URL by region.
// Amazon exposes different OAuth hosts per region for the Ads API:
//   NA  -> https://www.amazon.com
//   EU  -> https://eu.account.amazon.com
//   FE  -> https://apac.account.amazon.com
// The /ap/oa path is the same on all of them.
const ADS_OAUTH_BASE_BY_REGION = {
  NA: 'https://www.amazon.com',
  EU: 'https://eu.account.amazon.com',
  FE: 'https://apac.account.amazon.com',
};

const getAdsOAuthBaseUrl = (region) => {
  const key = (region || 'NA').toUpperCase();
  return ADS_OAUTH_BASE_BY_REGION[key] || ADS_OAUTH_BASE_BY_REGION.NA;
};

// `basePath`, when given, overrides the agency-derived client route prefix so
// other portals (e.g. the ESF staff portal) can reuse this flow unchanged.
const ConnectAccounts = ({ isAgencyContext = false, clientId = null, agencyName = '', basePath = '' }) => {
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

  const agencyBasePath = basePath
    || ((isAgencyContext && clientId && agencyName) ? `/agency/${encodeURIComponent(agencyName)}/client/${clientId}` : '');

  // Get country code and region from URL parameters. These drive the initial
  // UI display only — the actual redirect URL for Connect Seller Central /
  // Connect Amazon Ads is resolved on click via the /app/user-location
  // endpoint (see resolveUserMarketplace below).
  const countryCode = searchParams.get('country') || searchParams.get('countryCode');
  const region = searchParams.get('region');
  const spApiConnectedFromUrl = searchParams.get('spApiConnected') === 'true';

  // Check authentication on mount - allow all authenticated users to proceed
  useEffect(() => {
    const checkAuth = async () => {
      // If not authenticated, redirect to login
      if (!isAuthenticated) {
        devLog('ConnectAccounts: Not authenticated - redirecting to login');
        navigate('/', { replace: true });
        return;
      }

      // Allow all authenticated users to proceed (skip pricing check)
      // New signups with LITE package can connect accounts first, then pay later
      devLog('ConnectAccounts: User authenticated - allowing access');
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
        devLog('ConnectAccounts: SP-API connected status from URL parameter');
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
          devLog('ConnectAccounts: SP-API connected for specific account from Redux');
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
          if (!window.location.pathname.includes('connect-accounts')) {
            navigate(agencyBasePath ? `${agencyBasePath}/connect-accounts` : '/connect-accounts', { replace: true });
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

  // Resolve the user's marketplace (country + region + matching config entry)
  // right before redirecting to Amazon. The source of truth is the
  // standalone /app/user-location endpoint, which returns the country/region
  // stored on the logged-in user's seller account.
  //
  //   - Agency context is intentionally skipped — the agency owner is not
  //     connecting their own marketplace; the target client's marketplace
  //     is encoded in the URL by the agency flow, so we keep URL params
  //     as the source of truth there.
  //   - On any failure (endpoint unavailable, network error, unknown
  //     country) we fall back to the URL-derived marketplaceConfig so the
  //     existing flow never breaks.
  const resolveUserMarketplace = async () => {
    if (isAgencyContext) {
      if (marketplaceConfig && countryCode) {
        return {
          countryCode: countryCode.toUpperCase(),
          region: marketplaceConfig.region,
          config: marketplaceConfig,
        };
      }
      return null;
    }

    try {
      const response = await axiosInstance.get('/app/user-location');
      const data = response?.data?.data;
      if (response?.status === 200 && data && data.country && data.region) {
        const key = String(data.country).toUpperCase();
        const config = MARKETPLACE_CONFIG[key];
        if (config) {
          devLog('[ConnectAccounts] Resolved user location from API:', data);
          return {
            countryCode: key,
            region: data.region,
            config,
          };
        }
        devWarn(
          '[ConnectAccounts] API returned country not present in MARKETPLACE_CONFIG, falling back:',
          data
        );
      }
    } catch (error) {
      devWarn(
        '[ConnectAccounts] /app/user-location lookup failed, falling back to URL-derived marketplaceConfig:',
        error?.response?.status || error?.message
      );
    }

    if (marketplaceConfig) {
      return {
        countryCode: (countryCode || 'US').toUpperCase(),
        region: marketplaceConfig.region,
        config: marketplaceConfig,
      };
    }

    return null;
  };

  const handleConnectSellerCentral = async () => {
    setSellerCentralLoading(true);
    setErrorMessage('');
    setSuccessMessage('');

    // Fetch the user's current country/region before redirecting so the
    // Seller Central host is always correct for their marketplace.
    const resolved = await resolveUserMarketplace();
    if (!resolved) {
      setSellerCentralLoading(false);
      setErrorMessage('Could not determine your marketplace. Please refresh the page and try again.');
      return;
    }

    const {
      countryCode: resolvedCountry,
      region: resolvedRegion,
      config: resolvedConfig,
    } = resolved;

    localStorage.setItem('sellerCentralLoading', 'true');
    localStorage.setItem('amazonAdsLoading', 'false');
    // Store the marketplace info for later use
    localStorage.setItem('selectedMarketplace', JSON.stringify({
      countryCode: resolvedCountry,
      region: resolvedRegion,
      sellerCentralUrl: resolvedConfig.sellerCentralUrl
    }));

    if (isAgencyContext && clientId && agencyName) {
      localStorage.setItem('agencySpApiConnect', JSON.stringify({
        clientId,
        country: resolvedCountry,
        region: resolvedRegion,
        agencyName,
      }));
    } else {
      localStorage.removeItem('agencySpApiConnect');
    }

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

      const amazonAuthUrl = new URL(`${resolvedConfig.sellerCentralUrl}/apps/authorize/consent`);
      amazonAuthUrl.searchParams.append('application_id', applicationId);
      amazonAuthUrl.searchParams.append('redirect_uri', redirectUri);
      amazonAuthUrl.searchParams.append('state', state);

      // Add version=beta only if specified in environment or for testing
      if (import.meta.env.VITE_APP_BETA === 'true') {
        amazonAuthUrl.searchParams.append('version', 'beta');
      }

      setSuccessMessage(`Redirecting to Amazon Seller Central for ${resolvedCountry}...`);

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

    // Fetch the user's current country/region before redirecting so the
    // Amazon Ads LWA host matches their region (NA / EU / FE).
    const resolved = await resolveUserMarketplace();
    if (!resolved) {
      setAmazonAdsLoading(false);
      setErrorMessage('Could not determine your marketplace. Please refresh the page and try again.');
      return;
    }

    const {
      countryCode: resolvedCountry,
      region: resolvedRegion,
      config: resolvedConfig,
    } = resolved;

    localStorage.setItem('sellerCentralLoading', 'false');
    localStorage.setItem('amazonAdsLoading', 'true');
    // Store the marketplace info for later use
    localStorage.setItem('selectedMarketplace', JSON.stringify({
      countryCode: resolvedCountry,
      region: resolvedRegion,
      adsUrl: resolvedConfig.adsUrl
    }));

    // Store agency context so the OAuth callback can use the agency-safe endpoint
    if (isAgencyContext && clientId) {
      localStorage.setItem('agencyAdsConnect', JSON.stringify({
        clientId,
        country: resolvedCountry,
        region: resolvedRegion,
        agencyName,
      }));
    } else {
      localStorage.removeItem('agencyAdsConnect');
    }

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

      // Amazon Ads uses a different OAuth flow.
      // Pick the LWA authorization host by region (NA/EU/FE), mirroring SP-API's
      // region-based base URL selection so EU and FE sellers are not forced to
      // authenticate against the NA host.
      const adsOAuthBase = getAdsOAuthBaseUrl(resolvedRegion);
      const amazonAdsAuthUrl = new URL(`${adsOAuthBase}/ap/oa`);
      amazonAdsAuthUrl.searchParams.append('client_id', adsClientId);
      amazonAdsAuthUrl.searchParams.append('redirect_uri', redirectUri);
      amazonAdsAuthUrl.searchParams.append('response_type', 'code');
      amazonAdsAuthUrl.searchParams.append('scope', 'advertising::campaign_management');
      amazonAdsAuthUrl.searchParams.append('state', state);

      // Add marketplace-specific parameters if needed
      if (resolvedCountry && resolvedCountry !== 'US') {
        amazonAdsAuthUrl.searchParams.append('marketplace', resolvedCountry);
      }

      setSuccessMessage(`Redirecting to Amazon Ads authorization for ${resolvedCountry}...`);

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
      devLog('Logout API call successful');
    } catch (error) {
      // Log error but continue with logout process
      devLog('Logout API call result:', error.response?.status || error.message);
      // Continue with logout even if API call fails
    }
    
    // Clear local storage and auth cache AFTER API call
    localStorage.removeItem('isAuth');
    clearAuthCache();
    
    // Navigate to login page (home route) or agency clients list
    navigate(agencyBasePath ? '/manage-agency-users' : '/', { replace: true });
  };

  const navigateToDashboard = () => {
    navigate(agencyBasePath ? '/manage-agency-users' : '/seller-central-checker/dashboard');
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
          
          devLog(`[ConnectAccounts] Job status check: ${status}`);
          
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
            devLog('[ConnectAccounts] Job has started processing');
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
            devLog('[ConnectAccounts] Job already completed');
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
            devWarn('[ConnectAccounts] Timeout waiting for job to start, proceeding anyway');
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

  // Navigate to payment based on country (or skip payment for agency context)
  const navigateToPayment = async () => {
    try {
      // For agency context, skip payment entirely and go to profile selection
      // Agency clients are managed by the agency owner, no individual payment required
      if (isAgencyContext) {
        devLog('[ConnectAccounts] Agency context detected - skipping payment, navigating to profile selection');
        setWaitingForAnalysis(false);
        navigate(`${agencyBasePath}/profile-selection?region=${region || 'NA'}`);
        return;
      }
      
      // Debug: Log Redux userData
      devLog('[ConnectAccounts] navigateToPayment called');
      devLog('[ConnectAccounts] Redux userData:', userData);
      devLog('[ConnectAccounts] Redux userData details:', {
        packageType: userData?.packageType,
        subscriptionStatus: userData?.subscriptionStatus,
        isInTrialPeriod: userData?.isInTrialPeriod,
        trialEndsDate: userData?.trialEndsDate
      });
      
      // First check Redux state for premium access
      const hasPremiumFromRedux = hasPremiumAccess(userData);
      devLog('[ConnectAccounts] hasPremiumAccess(userData) result:', hasPremiumFromRedux);
      
      if (hasPremiumFromRedux) {
        devLog('[ConnectAccounts] User already has premium access (from Redux), skipping payment...');
        setWaitingForAnalysis(false);
        navigate('/analyse-account');
        return;
      }
      
      // Fetch fresh user data from API to ensure we have the latest subscription status
      // This handles cases where Redux state might be stale
      let freshUserData = null;
      try {
        devLog('[ConnectAccounts] Fetching fresh user data to verify subscription status...');
        const profileResponse = await axiosInstance.get('/app/profile');
        devLog('[ConnectAccounts] Profile API response:', profileResponse);
        
        if (profileResponse?.status === 200 && profileResponse.data?.data) {
          freshUserData = profileResponse.data.data;
          devLog('[ConnectAccounts] Fresh user data:', {
            packageType: freshUserData.packageType,
            subscriptionStatus: freshUserData.subscriptionStatus,
            isInTrialPeriod: freshUserData.isInTrialPeriod,
            trialEndsDate: freshUserData.trialEndsDate,
            servedTrial: freshUserData.servedTrial
          });
          
          // Check fresh data for premium access (PRO, AGENCY, or active trial)
          const hasPremiumFromApi = hasPremiumAccess(freshUserData);
          devLog('[ConnectAccounts] hasPremiumAccess(freshUserData) result:', hasPremiumFromApi);
          
          if (hasPremiumFromApi) {
            devLog('[ConnectAccounts] User already has premium access (from fresh API data), skipping payment...');
            setWaitingForAnalysis(false);
            navigate('/analyse-account');
            return;
          }
        } else {
          devLog('[ConnectAccounts] Profile API returned unexpected response:', profileResponse?.status);
        }
      } catch (profileError) {
        devWarn('[ConnectAccounts] Could not fetch fresh profile data, proceeding with Redux state:', profileError);
        // Continue with payment flow if we can't fetch fresh data
      }
      
      // Mirror server StripeController: trial only if not (servedTrial && status !== cancelled)
      const eligibilityUser = freshUserData || userData || {};
      const canStartTrial =
        !eligibilityUser.servedTrial || eligibilityUser.subscriptionStatus === 'cancelled';
      const trialDays = canStartTrial ? 7 : null;
      devLog('[ConnectAccounts] Checkout trial eligibility:', { canStartTrial, trialDays });

      // Detect user's country
      const country = await detectCountry();
      const isIndianUser = country === 'IN';
      
      devLog(`[ConnectAccounts] Detected country: ${country}, navigating to payment...`);
      
      // ===== PAYMENT DISABLED - free PRO for all users =====
      // Skip Stripe entirely and go straight to the analysis step.
      setWaitingForAnalysis(false);
      navigate('/analyse-account');
      // // Stripe: trial when eligible, else paid PRO; INR for India when detected
      // setWaitingForAnalysis(false);
      // await stripeService.createCheckoutSession('PRO', null, trialDays, isIndianUser ? 'inr' : null);
    } catch (error) {
      console.error('[ConnectAccounts] Error navigating to payment:', error);
      setWaitingForAnalysis(false);
      const msg =
        error?.response?.data?.message ||
        error?.message ||
        'Could not open payment. Please try again from Billing or contact support.';
      alert(msg);
    }
  };

  // Handle skip button click
  const handleSkip = async () => {
    if (!isSpApiConnectedState || checkingSpApi) {
      return; // Should not happen due to disabled state, but safety check
    }

    try {
      devLog('[ConnectAccounts] Skip clicked - triggering integration job...');
      setWaitingForAnalysis(true);
      
      let jobId = null;
      
      // First check if there's an active job
      const activeResponse = await axiosInstance.get('/api/integration/active');
      
      if (activeResponse.status === 200 && activeResponse.data.data.hasActiveJob) {
        // Job already exists
        jobId = activeResponse.data.data.jobId;
        const existingStatus = activeResponse.data.data.status?.toLowerCase();
        devLog('[ConnectAccounts] Active job already exists:', existingStatus);
        
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
          devLog('[ConnectAccounts] Integration job triggered successfully, jobId:', jobId);
        } else {
          throw new Error('Failed to trigger integration job');
        }
      }
      
      // Wait for job to start (status becomes 'active')
      if (jobId) {
        devLog('[ConnectAccounts] Waiting for job to start...');
        await waitForJobToStart(jobId);
        devLog('[ConnectAccounts] Job started, navigating to payment...');
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
      <div className="min-h-screen flex items-center justify-center" style={{ background: COLORS.bgBase }}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: COLORS.accent }} />
          <p style={{ color: COLORS.textSecondary }}>Verifying subscription...</p>
        </div>
      </div>
    );
  }

  // This page covers two wizard steps: Seller Central (2) until it's connected, then Amazon Ads (3).
  const onAdsStep = isSpApiConnectedState && !checkingSpApi;

  return (
    <OnboardingShell currentStep={onAdsStep ? 3 : 2} doneSteps={onAdsStep ? [1, 2] : [1]}>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        <div
          className="inline-flex items-center gap-2"
          style={{ padding: '5px 11px', borderRadius: 999, background: 'rgba(59,130,246,.12)', color: '#7EA8F8', fontSize: 12, fontWeight: 600, marginBottom: 16 }}
        >
          {onAdsStep ? 'Step 3 of 5 · About 40 seconds' : 'Step 2 of 5 · About 60 seconds'}
        </div>
        <h1 style={{ margin: '0 0 8px', fontSize: 27, lineHeight: '34px', fontWeight: 600, letterSpacing: '-0.025em', color: COLORS.textPrimary }}>
          {onAdsStep ? 'Connect Amazon Ads' : 'Connect your Amazon accounts'}
        </h1>
        <p style={{ margin: '0 0 22px', fontSize: 14, lineHeight: '22px', color: COLORS.textSecondary, maxWidth: '62ch' }}>
          {onAdsStep
            ? "Same one-click flow you just did, different Amazon service. Ad waste is where most sellers find their first real money — and it's the one thing we can't see through Seller Central."
            : 'Seller Central first, then Amazon Ads. Both use Amazon’s own consent screen, so you never hand us a password.'}
          {marketplaceConfig && countryCode && (
            <>
              {' '}Connecting <span style={{ color: COLORS.textPrimary, fontWeight: 500 }}>{countryCode.toUpperCase()}</span> ({marketplaceConfig.region}).
            </>
          )}
        </p>

        <div className="flex flex-col" style={{ gap: 12, marginBottom: 18 }}>
          {/* Seller Central Connection */}
          <div style={{ border: `1px solid ${isSellerCentralConnected ? 'rgba(34,197,94,.28)' : COLORS.border}`, borderRadius: 13, background: COLORS.surface, padding: 20 }}>
            <div className="flex items-start gap-3.5" style={{ marginBottom: 14 }}>
              <div
                className="flex-none flex items-center justify-center"
                style={{ width: 38, height: 38, borderRadius: 10, background: isSellerCentralConnected ? 'rgba(34,197,94,.14)' : 'rgba(59,130,246,.14)' }}
              >
                <Store className="w-5 h-5" style={{ color: isSellerCentralConnected ? COLORS.good : '#7EA8F8' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>Amazon Seller Central</h3>
                  <span
                    style={{
                      padding: '1px 6px', borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
                      background: 'rgba(239,68,68,.14)', color: '#F87171',
                    }}
                  >
                    Required
                  </span>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: '19px', color: COLORS.textSecondary }}>
                  Sales, inventory, listings, FBA fees and account health. Without it every screen stays empty.
                </p>
              </div>
            </div>
            <button
              onClick={handleConnectSellerCentral}
              disabled={sellerCentralLoading || !marketplaceConfig || isSellerCentralConnected}
              className="inline-flex items-center justify-center gap-2 transition-colors"
              style={{
                padding: '11px 18px',
                border: 0,
                borderRadius: 9,
                fontSize: 13,
                fontWeight: 600,
                background: isSellerCentralConnected ? 'rgba(34,197,94,.14)' : (sellerCentralLoading || !marketplaceConfig) ? COLORS.surfaceElevated : COLORS.accent,
                color: isSellerCentralConnected ? COLORS.good : (sellerCentralLoading || !marketplaceConfig) ? COLORS.textMuted : '#061021',
                cursor: (sellerCentralLoading || !marketplaceConfig || isSellerCentralConnected) ? 'default' : 'pointer',
              }}
            >
              {isSellerCentralConnected ? (
                <>
                  <CheckCircle className="w-4 h-4" />
                  Connected
                </>
              ) : sellerCentralLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Opening Amazon…
                </>
              ) : (
                <>
                  Connect Seller Central
                  <ExternalLink className="w-4 h-4" />
                </>
              )}
            </button>
          </div>

          {/* Amazon Ads Connection */}
          <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 13, background: COLORS.surface, padding: 20, opacity: isSpApiConnectedState || checkingSpApi ? 1 : 0.72 }}>
            <div className="flex items-start gap-3.5" style={{ marginBottom: 14 }}>
              <div
                className="flex-none flex items-center justify-center"
                style={{ width: 38, height: 38, borderRadius: 10, background: 'rgba(59,130,246,.14)' }}
              >
                <TrendingUp className="w-5 h-5" style={{ color: '#7EA8F8' }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary, margin: 0 }}>Amazon Ads</h3>
                  <span
                    style={{
                      padding: '1px 6px', borderRadius: 5, fontSize: 10, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase',
                      background: 'rgba(59,130,246,.14)', color: '#7EA8F8',
                    }}
                  >
                    Recommended
                  </span>
                </div>
                <p style={{ margin: '4px 0 0', fontSize: 13, lineHeight: '19px', color: COLORS.textSecondary }}>
                  Campaigns, keywords and search terms — where wasted spend hides.
                </p>
                {!isSpApiConnectedState && !checkingSpApi && (
                  <p style={{ margin: '6px 0 0', fontSize: 12, fontWeight: 500, color: COLORS.watch }}>
                    Connect Seller Central first — Amazon links the two accounts.
                  </p>
                )}
              </div>
            </div>

            {/* Real features that stay unavailable until Ads is connected */}
            <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 10, background: PANEL_BG, padding: '14px 16px', marginBottom: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: COLORS.textPrimary, marginBottom: 10 }}>What stays locked without it</div>
              <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: '8px 20px', fontSize: 13, lineHeight: '19px', color: COLORS.textSecondary }}>
                {['Wasted spend keywords', 'Campaign audit and ACoS', 'Keyword opportunities', 'True net profit (ads are a cost)'].map((f) => (
                  <div key={f} className="flex" style={{ gap: 9 }}>
                    <span style={{ color: '#4C5566' }}>✕</span>{f}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex items-center gap-3 flex-wrap">
              <button
                onClick={handleConnectAmazonAds}
                disabled={amazonAdsLoading || !marketplaceConfig || !isSpApiConnectedState || checkingSpApi}
                className="inline-flex items-center justify-center gap-2 transition-colors"
                style={{
                  padding: '11px 18px',
                  border: 0,
                  borderRadius: 9,
                  fontSize: 13,
                  fontWeight: 600,
                  background: (amazonAdsLoading || !marketplaceConfig || !isSpApiConnectedState || checkingSpApi) ? COLORS.surfaceElevated : COLORS.accent,
                  color: (amazonAdsLoading || !marketplaceConfig || !isSpApiConnectedState || checkingSpApi) ? COLORS.textMuted : '#061021',
                  cursor: (amazonAdsLoading || !marketplaceConfig || !isSpApiConnectedState || checkingSpApi) ? 'not-allowed' : 'pointer',
                }}
              >
                {amazonAdsLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Opening Amazon…
                  </>
                ) : checkingSpApi ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Checking connection…
                  </>
                ) : !isSpApiConnectedState ? (
                  'Connect Seller Central first'
                ) : (
                  <>
                    Connect Amazon Ads
                    <ExternalLink className="w-4 h-4" />
                  </>
                )}
              </button>

              {/* Skips the Ads step: starts the scan and moves on to the plan step.
                  Only available once Seller Central is in, matching handleSkip's own guard. */}
              {isSpApiConnectedState && !checkingSpApi && (
                <button
                  type="button"
                  onClick={handleSkip}
                  disabled={waitingForAnalysis || amazonAdsLoading}
                  className="transition-colors"
                  style={{
                    padding: '11px 16px',
                    border: `1px solid ${COLORS.border}`,
                    borderRadius: 9,
                    background: 'transparent',
                    color: COLORS.textMuted,
                    fontSize: 13,
                    cursor: (waitingForAnalysis || amazonAdsLoading) ? 'not-allowed' : 'pointer',
                  }}
                >
                  Skip — I don&rsquo;t run ads
                </button>
              )}
            </div>
          </div>
        </div>

        <div style={{ fontSize: 12, lineHeight: '18px', color: COLORS.textMuted }}>
          Amazon handles the sign-in on its own site — we never see or store your password, and you can revoke access from Seller Central at any time.
        </div>

        {/* Waiting for Analysis Banner */}
        {waitingForAnalysis && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex items-center justify-center gap-2"
            style={{ marginTop: 16, padding: 14, borderRadius: 11, background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.4)' }}
          >
            <Loader2 className="w-4 h-4 animate-spin" style={{ color: '#7EA8F8' }} />
            <p style={{ margin: 0, fontSize: 13, fontWeight: 500, color: '#7EA8F8' }}>Starting analysis… Please wait</p>
          </motion.div>
        )}

        {/* Success Message */}
        <AnimatePresence>
          {successMessage && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              style={{ marginTop: 16, padding: 14, borderRadius: 11, textAlign: 'center', background: 'rgba(34,197,94,.1)', border: '1px solid rgba(34,197,94,.4)' }}
            >
              <p style={{ margin: 0, fontSize: 13, color: COLORS.good }}>{successMessage}</p>
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
              style={{ marginTop: 16, padding: 14, borderRadius: 11, textAlign: 'center', background: 'rgba(239,68,68,.1)', border: '1px solid rgba(239,68,68,.4)' }}
            >
              <p style={{ margin: 0, fontSize: 13, color: '#F87171' }}>{errorMessage}</p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Navigation Links */}
        <div style={{ marginTop: 26, paddingTop: 20, borderTop: `1px solid ${COLORS.border}` }}>
          <button
            type="button"
            onClick={navigateToLogin}
            className="transition-colors hover:underline"
            style={{ fontSize: 13, color: COLORS.textMuted, background: 'transparent', border: 0, cursor: 'pointer' }}
          >
            Back to Login
          </button>
        </div>
      </motion.div>
    </OnboardingShell>
  );
};

export default ConnectAccounts;