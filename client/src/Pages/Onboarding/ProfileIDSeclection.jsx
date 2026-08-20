import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Globe, ChevronLeft, ChevronRight, User, Check, Store } from 'lucide-react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { useSelector } from 'react-redux';
import axios from 'axios';
import axiosInstance from '../../config/axios.config.js';
import { detectCountry } from '../../utils/countryDetection.js';
import { hasPremiumAccess } from '../../utils/subscriptionCheck.js';
import stripeService from '../../services/stripeService.js';
import OnboardingShell from '../../Components/Onboarding/OnboardingShell.jsx';
import { COLORS } from '../../Components/Shared/index.js';

// Matches the onboarding shell's inset panel shade.
const PANEL_BG = '#10141C';


const ProfileIDSelection = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchParams] = useSearchParams();
  const [profileId, setProfileId] = useState('');
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [currencyCode, setCurrencyCode] = useState('');
  const [profileData, setProfileData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true); // Loading state for initial data fetch
  const [analysisStarted, setAnalysisStarted] = useState(false); // Track if analysis has started
  const [waitingForAnalysis, setWaitingForAnalysis] = useState(false); // Track if waiting for analysis to start
  
  const navigate = useNavigate();
  const location = useLocation();
  const pollingRef = useRef(null); // Ref for polling interval
  const timeoutRef = useRef(null); // Ref for timeout
  const userData = useSelector(state => state.Auth?.user); // Get user data for premium access check

  // Check if profile data was passed via navigation state (pre-fetched)
  const prefetchedProfileData = location.state?.profileData;
  
  const ITEMS_PER_PAGE = 10;

  const BASE_URIS = {
    'NA': 'https://advertising-api.amazon.com',
    'EU': 'https://advertising-api-eu.amazon.com',
    'FE': 'https://advertising-api-fe.amazon.com'
  };

  // Get region from URL parameters
  const region = searchParams.get('region') || 'NA'; // Default to NA if no region specified
  const selectedBaseUri = BASE_URIS[region] || BASE_URIS['NA']; // Fallback to NA if invalid region

  useEffect(() => {
    let isMounted = true;
    
    // If we have prefetched data from navigation state, use it immediately
    if (prefetchedProfileData && Array.isArray(prefetchedProfileData) && prefetchedProfileData.length > 0) {
      console.log('Using prefetched profile data:', prefetchedProfileData.length, 'profiles');
      setProfileData(prefetchedProfileData);
      setDataLoading(false);
      return;
    }
    
    const fetchProfileData = async (retryCount = 0) => {
      if (!isMounted) return;
      
      setDataLoading(true); // Start loading
      try {
        const response = await axios.get(`${import.meta.env.VITE_BASE_URI}/app/profile/getProfileId`, {
          withCredentials: true
        });
        
        if (!isMounted) return;
        
        console.log('API Response:', response);
        console.log('Response data:', response.data);
        
        if(response.status === 200 && response.data){
          // Check if response.data.data exists and is an array
          const dataArray = response.data.data || response.data || [];
          
          if(Array.isArray(dataArray) && dataArray.length > 0) {
            const profiles = dataArray.map((scope, index) => ({
              id: `PF${String(index + 1).padStart(3, '0')}`,
              profileId: String(scope.profileId || scope.profile_id || 'Unknown'),
              name: String(scope.accountInfo?.name || scope.name || 'Unknown'),
              currency: String(scope.currencyCode || 'Unknown'),
              country: String(scope.countryCode || scope.country_code || scope.country || 'Unknown')
            }));
            setProfileData(profiles);
            setDataLoading(false);
            console.log('Processed profiles:', profiles);
          } else {
            console.warn('No profile data found or data is not an array:', dataArray);
            // If no data and we haven't retried yet, try again after a short delay
            // This handles the race condition where tokens aren't saved yet
            if (retryCount < 3) {
              console.log(`Retrying fetch (attempt ${retryCount + 1}/3)...`);
              setTimeout(() => fetchProfileData(retryCount + 1), 1500);
              return;
            }
            setProfileData([]);
            setDataLoading(false);
          }
        } else {
          console.error('Invalid response status or no data:', response);
          if (retryCount < 3) {
            setTimeout(() => fetchProfileData(retryCount + 1), 1500);
            return;
          }
          setProfileData([]);
          setDataLoading(false);
        }
      } catch (error) {
        if (!isMounted) return;
        
        console.error('Error fetching profile data:', error);
        console.error('Error response:', error.response);

        const status = error.response?.status;

        // A 404 from getProfileId is a definitive "no advertising profiles for
        // this account" response (not a transient failure). Show the empty
        // state gracefully so the user gets the "Continue without a profile"
        // option — no retries, no fetch-failure alert.
        if (status === 404) {
          setProfileData([]);
          setDataLoading(false);
          return;
        }

        // Retry on other transient errors (might be timing issue after redirect)
        if ((status === 400 || status === 401 || !status) && retryCount < 3) {
          console.log(`Retrying fetch after error (attempt ${retryCount + 1}/3)...`);
          setTimeout(() => fetchProfileData(retryCount + 1), 1500);
          return;
        }

        setProfileData([]);
        setDataLoading(false);
        // Only show alert after all retries are exhausted
        if (retryCount >= 3) {
        alert('Failed to fetch profile data. Please try again.');
        }
      }
    };
    
    // Only fetch if no prefetched data available
    // Add a small delay before first fetch to ensure cookies are set after redirect
    const initialDelay = setTimeout(() => {
    fetchProfileData();
    }, 300);
    
    return () => {
      isMounted = false;
      clearTimeout(initialDelay);
    };
  }, [prefetchedProfileData]);

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
          
          console.log(`[ProfileIDSelection] Job status check: ${status}`);
          
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
            console.log('[ProfileIDSelection] Job has started processing');
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
            console.log('[ProfileIDSelection] Job already completed');
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
            console.error('[ProfileIDSelection] Job failed');
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
            console.warn('[ProfileIDSelection] Timeout waiting for job to start, proceeding anyway');
            resolve(true); // Proceed anyway
            return;
          }
        } catch (error) {
          console.error('[ProfileIDSelection] Error checking job status:', error);
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

  const navigateToPayment = async () => {
    try {
      // Debug: Log Redux userData
      console.log('[ProfileIDSelection] navigateToPayment called');
      console.log('[ProfileIDSelection] Redux userData:', userData);
      console.log('[ProfileIDSelection] Redux userData details:', {
        packageType: userData?.packageType,
        subscriptionStatus: userData?.subscriptionStatus,
        isInTrialPeriod: userData?.isInTrialPeriod,
        trialEndsDate: userData?.trialEndsDate
      });
      
      // First check Redux state for premium access
      const hasPremiumFromRedux = hasPremiumAccess(userData);
      console.log('[ProfileIDSelection] hasPremiumAccess(userData) result:', hasPremiumFromRedux);
      
      if (hasPremiumFromRedux) {
        console.log('[ProfileIDSelection] User already has premium access (from Redux), skipping payment...');
        setWaitingForAnalysis(false);
        navigate('/analyse-account');
        return;
      }
      
      // Fetch fresh user data from API to ensure we have the latest subscription status
      // This handles cases where Redux state might be stale
      let freshUserData = null;
      try {
        console.log('[ProfileIDSelection] Fetching fresh user data to verify subscription status...');
        const profileResponse = await axiosInstance.get('/app/profile');
        console.log('[ProfileIDSelection] Profile API response:', profileResponse);
        
        if (profileResponse?.status === 200 && profileResponse.data?.data) {
          freshUserData = profileResponse.data.data;
          console.log('[ProfileIDSelection] Fresh user data:', {
            packageType: freshUserData.packageType,
            subscriptionStatus: freshUserData.subscriptionStatus,
            isInTrialPeriod: freshUserData.isInTrialPeriod,
            trialEndsDate: freshUserData.trialEndsDate,
            servedTrial: freshUserData.servedTrial
          });
          
          // Check fresh data for premium access (PRO, AGENCY, or active trial)
          const hasPremiumFromApi = hasPremiumAccess(freshUserData);
          console.log('[ProfileIDSelection] hasPremiumAccess(freshUserData) result:', hasPremiumFromApi);
          
          if (hasPremiumFromApi) {
            console.log('[ProfileIDSelection] User already has premium access (from fresh API data), skipping payment...');
            console.log('[ProfileIDSelection] Navigating to /analyse-account...');
            setWaitingForAnalysis(false);
            navigate('/analyse-account');
            return;
          }
        } else {
          console.log('[ProfileIDSelection] Profile API returned unexpected response:', profileResponse?.status);
        }
      } catch (profileError) {
        console.warn('[ProfileIDSelection] Could not fetch fresh profile data, proceeding with Redux state:', profileError);
        // Continue with payment flow if we can't fetch fresh data
      }
      
      // Mirror server StripeController: trial only if not (servedTrial && status !== cancelled)
      const eligibilityUser = freshUserData || userData || {};
      const canStartTrial =
        !eligibilityUser.servedTrial || eligibilityUser.subscriptionStatus === 'cancelled';
      const trialDays = canStartTrial ? 7 : null;
      console.log('[ProfileIDSelection] Checkout trial eligibility:', { canStartTrial, trialDays });

      // Detect user's country
      const country = await detectCountry();
      const isIndianUser = country === 'IN';
      
      console.log(`[ProfileIDSelection] Detected country: ${country}, navigating to payment...`);
      
      // Stripe: trial when eligible, else paid PRO; INR for India when detected
      setWaitingForAnalysis(false);
      await stripeService.createCheckoutSession('PRO', null, trialDays, isIndianUser ? 'inr' : null);
    } catch (error) {
      console.error('[ProfileIDSelection] Error navigating to payment:', error);
      setWaitingForAnalysis(false);
      const msg =
        error?.response?.data?.message ||
        error?.message ||
        'Could not open payment. Please try again from Billing or contact support.';
      alert(msg);
    }
  };

  // Trigger the first-analysis integration job (reusing an in-progress one if
  // present), wait for it to start, then move the user on to payment /
  // analyse-account. Shared by both "confirm profile" and "continue without a
  // profile" so the analysis AND the trial/payment redirect happen the same way
  // in both cases. Behavior here is unchanged from the original saveProfileId.
  const startIntegrationAndProceed = async () => {
    console.log('[ProfileIDSelection] Triggering integration job...');
    setWaitingForAnalysis(true);

    let jobId = null;

    // First check if there's an active job (waiting/active/delayed - NOT completed)
    const activeResponse = await axiosInstance.get('/api/integration/active');

    if (activeResponse.status === 200 && activeResponse.data.data.hasActiveJob) {
      // Job exists - check if it's actually running or just completed
      jobId = activeResponse.data.data.jobId;
      const existingStatus = activeResponse.data.data.status?.toLowerCase();
      console.log('[ProfileIDSelection] Existing job found:', existingStatus);

      // Only skip triggering if job is actively running (not completed)
      // When user re-saves profile ID, they want a FRESH integration even if previous one completed
      if (existingStatus === 'active' || existingStatus === 'running' || existingStatus === 'waiting' || existingStatus === 'delayed') {
        console.log('[ProfileIDSelection] Job is currently in progress, reusing existing job');
        setAnalysisStarted(true);
        await navigateToPayment();
        return;
      }

      // If status is 'completed' or 'failed', trigger a NEW job
      // This handles the case where user disconnected and reconnected their accounts
      console.log('[ProfileIDSelection] Previous job was completed/failed, triggering fresh integration...');
    }

    // No active job OR previous job completed - trigger new one
    const triggerResponse = await axiosInstance.post('/api/integration/trigger');

    if (triggerResponse.status === 202 || triggerResponse.status === 200) {
      jobId = triggerResponse.data.data.jobId;
      console.log('[ProfileIDSelection] Integration job triggered successfully, jobId:', jobId);
    } else {
      throw new Error('Failed to trigger integration job');
    }

    // Wait for job to start (status becomes 'active')
    if (jobId) {
      console.log('[ProfileIDSelection] Waiting for job to start...');
      await waitForJobToStart(jobId);
      setAnalysisStarted(true);
      console.log('[ProfileIDSelection] Job started, navigating to payment...');
      await navigateToPayment();
    } else {
      throw new Error('No job ID received');
    }
  };

  const saveProfileId = async (profileId,currencyCode) => {
    setLoading(true);
    try {
      const response = await axios.post(`${import.meta.env.VITE_BASE_URI}/app/profile/saveProfileId`,
        {profileId,currencyCode},
        {withCredentials: true}
      );

      if(response.status === 200){
        alert("Profile ID saved successfully");
        setSelectedProfile(null);
        setProfileId('');
        setCurrencyCode('');

        // Trigger integration job and wait for it to start, then navigate to payment
        try {
          await startIntegrationAndProceed();
        } catch (error) {
          console.error('[ProfileIDSelection] Error in integration job flow:', error);
          setWaitingForAnalysis(false);
          // Don't block user - they can proceed manually
          alert('Analysis started but payment setup failed. You can continue and set up payment later.');
        }
      }
    } catch (error) {
      console.error('Error saving profile ID:', error);
      alert('Failed to save profile ID. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // For users with no advertising profile to select (e.g. the account has no
  // Amazon Ads profile yet). Lets them proceed without a ProfileId: the first
  // analysis still runs (PPC data simply stays empty) and they continue to the
  // trial / payment step, mirroring the Skip path on the connect page.
  const handleContinueWithoutProfile = async () => {
    setLoading(true);
    try {
      await startIntegrationAndProceed();
    } catch (error) {
      console.error('[ProfileIDSelection] Error continuing without profile:', error);
      setWaitingForAnalysis(false);
      alert('Could not start the analysis. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  const handleProfileSelect = (profile) => {
    setSelectedProfile(profile);
    setProfileId(String(profile.profileId || ''));
    setCurrencyCode(String(profile.currency || ''));
  };

  const handleConfirm = () => {
    if (profileId) {
      saveProfileId(profileId, currencyCode);
    }
  };

  // Filter profiles based on search query
  const filteredProfiles = useMemo(() => {
    if (!searchQuery.trim()) return profileData;
    
    const query = searchQuery.toLowerCase();
    return profileData.filter(profile => {
      // Safely convert to string and handle null/undefined values
      const profileId = String(profile.profileId || '').toLowerCase();
      const name = String(profile.name || '').toLowerCase();
      const country = String(profile.country || '').toLowerCase();
      
      return profileId.includes(query) || name.includes(query) || country.includes(query);
    });
  }, [searchQuery, profileData]);

  // Pagination logic
  const totalPages = Math.max(1, Math.ceil(filteredProfiles.length / ITEMS_PER_PAGE));
  const paginatedProfiles = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredProfiles.slice(start, start + ITEMS_PER_PAGE);
  }, [currentPage, filteredProfiles]);

  // Reset to first page when search changes
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery]);

  // Cleanup polling intervals on unmount
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

  const getPaginationGroup = () => {
    const group = [];
    const maxButtons = 5;

    if (totalPages <= maxButtons) {
      for (let i = 1; i <= totalPages; i++) group.push(i);
    } else {
      let startPage = Math.max(1, currentPage - 2);
      let endPage = Math.min(totalPages, currentPage + 2);

      if (currentPage <= 3) {
        startPage = 1;
        endPage = 5;
      } else if (currentPage >= totalPages - 2) {
        startPage = totalPages - 4;
        endPage = totalPages;
      }

      for (let i = startPage; i <= endPage; i++) group.push(i);
    }

    return group;
  };

  const getCountryFlag = (country) => {
    const flagMap = {
      'US': '🇺🇸', 'United States': '🇺🇸',
      'CA': '🇨🇦', 'Canada': '🇨🇦',
      'GB': '🇬🇧', 'UK': '🇬🇧', 'United Kingdom': '🇬🇧',
      'DE': '🇩🇪', 'Germany': '🇩🇪',
      'FR': '🇫🇷', 'France': '🇫🇷',
      'IT': '🇮🇹', 'Italy': '🇮🇹',
      'ES': '🇪🇸', 'Spain': '🇪🇸',
      'JP': '🇯🇵', 'Japan': '🇯🇵',
      'AU': '🇦🇺', 'Australia': '🇦🇺',
      'IN': '🇮🇳', 'India': '🇮🇳',
      'BR': '🇧🇷', 'Brazil': '🇧🇷',
      'MX': '🇲🇽', 'Mexico': '🇲🇽',
      'NL': '🇳🇱', 'Netherlands': '🇳🇱',
      'SE': '🇸🇪', 'Sweden': '🇸🇪',
      'PL': '🇵🇱', 'Poland': '🇵🇱',
    };
    return flagMap[country] || '🌍';
  };



  return (
    <OnboardingShell currentStep={3} doneSteps={[1, 2]} maxWidth="960px">
        {/* Show loader while data is being fetched */}
        {dataLoading ? (
          <div className="flex items-center justify-center" style={{ minHeight: '60vh' }}>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-4"
            >
              <div
                className="animate-spin"
                style={{ width: 46, height: 46, borderRadius: '50%', border: `3px solid ${COLORS.surfaceElevated}`, borderTopColor: COLORS.accent }}
              />
              <div className="text-center">
                <h3 style={{ margin: '0 0 6px', fontSize: 18, fontWeight: 600, color: COLORS.textPrimary }}>Loading your ad profiles</h3>
                <p style={{ margin: 0, fontSize: 14, color: COLORS.textSecondary }}>Amazon is sending over the profiles on your account…</p>
              </div>
            </motion.div>
          </div>
        ) : (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
            {/* Header Section */}
            <div style={{ marginBottom: 22 }}>
              <div
                className="inline-flex items-center gap-2"
                style={{ padding: '5px 11px', borderRadius: 999, background: 'rgba(59,130,246,.12)', color: '#7EA8F8', fontSize: 12, fontWeight: 600, marginBottom: 16 }}
              >
                Step 3 of 5 · Almost done
              </div>
              <h1 style={{ margin: '0 0 8px', fontSize: 27, lineHeight: '34px', fontWeight: 600, letterSpacing: '-0.025em', color: COLORS.textPrimary }}>
                Pick your ads profile
              </h1>
              <p style={{ margin: 0, fontSize: 14, lineHeight: '22px', color: COLORS.textSecondary, maxWidth: '62ch' }}>
                Amazon Ads is connected. One account can hold several advertising profiles — choose the one whose campaigns you want audited.
              </p>
            </div>

            {/* Waiting for Analysis Banner - Show when waiting for analysis to start */}
            {waitingForAnalysis && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-3"
                style={{ marginBottom: 16, padding: 14, borderRadius: 11, background: 'rgba(245,166,35,.1)', border: '1px solid rgba(245,166,35,.35)' }}
              >
                <motion.div
                  className="flex-shrink-0"
                  style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${COLORS.watch}`, borderTopColor: 'transparent' }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                />
                <div className="flex-1">
                  <h3 style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: COLORS.watch }}>Starting analysis…</h3>
                  <p style={{ margin: 0, fontSize: 12, color: COLORS.textSecondary }}>
                    Hang on while the scan kicks off — we&rsquo;ll take you to the plan step next.
                  </p>
                </div>
              </motion.div>
            )}

            {/* Analysis Started Banner - Show when analysis has started */}
            {analysisStarted && !waitingForAnalysis && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="flex items-center gap-3"
                style={{ marginBottom: 16, padding: 14, borderRadius: 11, background: 'rgba(59,130,246,.1)', border: '1px solid rgba(59,130,246,.4)' }}
              >
                <motion.div
                  className="flex-shrink-0"
                  style={{ width: 18, height: 18, borderRadius: '50%', border: `2px solid ${COLORS.accent}`, borderTopColor: 'transparent' }}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                />
                <div className="flex-1">
                  <h3 style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 600, color: '#7EA8F8' }}>Analysis started</h3>
                  <p style={{ margin: 0, fontSize: 12, color: COLORS.textSecondary }}>
                    The scan is running in the background. Taking you to the plan step…
                  </p>
                </div>
              </motion.div>
            )}

            {/* Search and count */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between" style={{ gap: 12, marginBottom: 14 }}>
              <div className="relative flex-1" style={{ maxWidth: 380 }}>
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4" style={{ color: COLORS.textMuted }} />
                <input
                  type="text"
                  placeholder="Search by name, profile ID, or country…"
                  className="w-full outline-none transition-colors"
                  style={{ padding: '9px 12px 9px 36px', border: `1px solid ${COLORS.border}`, background: COLORS.surface, color: COLORS.textPrimary, borderRadius: 9, fontSize: 13 }}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={(e) => e.target.style.borderColor = COLORS.accent}
                  onBlur={(e) => e.target.style.borderColor = COLORS.border}
                />
              </div>
              <div style={{ fontSize: 13, color: COLORS.textSecondary }}>
                {searchQuery.trim()
                  ? <>{filteredProfiles.length} of {profileData.length} profiles</>
                  : <>{profileData.length} profile{profileData.length === 1 ? '' : 's'} found</>}
              </div>
            </div>

            {/* Show message if no profiles found */}
            {profileData.length === 0 ? (
              <div
                className="text-center"
                style={{ border: `1px solid ${COLORS.border}`, borderRadius: 13, background: COLORS.surface, padding: '40px 28px' }}
              >
                <div
                  className="mx-auto flex items-center justify-center"
                  style={{ width: 40, height: 40, borderRadius: 11, background: 'rgba(245,166,35,.14)', marginBottom: 14 }}
                >
                  <User className="w-5 h-5" style={{ color: COLORS.watch }} />
                </div>
                <h3 style={{ margin: '0 0 8px', fontSize: 17, fontWeight: 600, color: COLORS.textPrimary }}>No ads profiles on this account</h3>
                <p style={{ margin: '0 auto 18px', maxWidth: '62ch', fontSize: 13, lineHeight: '20px', color: COLORS.textSecondary }}>
                  Amazon didn&rsquo;t return an advertising profile for this marketplace, which usually means Amazon Ads isn&rsquo;t set up there yet. You can retry, or carry on without one — the audit still runs, but PPC data stays unavailable until a profile is connected.
                </p>
                <div className="flex items-center justify-center gap-3 flex-wrap">
                  <button
                    onClick={() => window.location.reload()}
                    disabled={loading || waitingForAnalysis}
                    className="transition-colors"
                    style={{
                      padding: '11px 18px', border: `1px solid ${COLORS.border}`, borderRadius: 9, background: PANEL_BG,
                      color: COLORS.textPrimary, fontSize: 13, fontWeight: 500,
                      cursor: (loading || waitingForAnalysis) ? 'not-allowed' : 'pointer',
                      opacity: (loading || waitingForAnalysis) ? 0.5 : 1,
                    }}
                  >
                    Retry
                  </button>
                  <button
                    onClick={handleContinueWithoutProfile}
                    disabled={loading || waitingForAnalysis}
                    className="inline-flex items-center justify-center gap-2 transition-colors"
                    style={{
                      padding: '11px 18px', border: 0, borderRadius: 9,
                      background: (loading || waitingForAnalysis) ? COLORS.surfaceElevated : COLORS.accent,
                      color: (loading || waitingForAnalysis) ? COLORS.textMuted : '#061021',
                      fontSize: 13, fontWeight: 600,
                      cursor: (loading || waitingForAnalysis) ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {(loading || waitingForAnalysis) ? (
                      <>
                        <div className="animate-spin" style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${COLORS.textMuted}`, borderTopColor: 'transparent' }} />
                        Starting…
                      </>
                    ) : (
                      'Continue without a profile'
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <>
                {/* Table Section */}
                <div style={{ border: `1px solid ${COLORS.border}`, borderRadius: 13, background: COLORS.surface, overflow: 'hidden' }}>
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr style={{ background: COLORS.surfaceElevated, borderBottom: `1px solid ${COLORS.border}` }}>
                          <th className="px-5 py-3 text-left" style={{ fontSize: 11, fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                            Brand Name
                          </th>
                          <th className="px-5 py-3 text-left" style={{ fontSize: 11, fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                            Profile ID
                          </th>
                          <th className="px-5 py-3 text-left" style={{ fontSize: 11, fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                            Country
                          </th>
                          <th className="px-5 py-3 text-center" style={{ fontSize: 11, fontWeight: 600, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '.06em' }}>
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        <AnimatePresence>
                          {paginatedProfiles.map((profile, index) => {
                            const isSelected = selectedProfile?.id === profile.id;
                            return (
                              <motion.tr
                                key={profile.id}
                                initial={{ opacity: 0, y: 10 }}
                                animate={{ opacity: 1, y: 0 }}
                                exit={{ opacity: 0, y: -10 }}
                                transition={{ duration: 0.3, delay: index * 0.05 }}
                                className="transition-colors cursor-pointer"
                                style={{
                                  borderBottom: `1px solid ${COLORS.border}`,
                                  background: isSelected ? 'rgba(59,130,246,.10)' : 'transparent',
                                }}
                                onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = '#1A202B'; }}
                                onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = 'transparent'; }}
                                onClick={() => handleProfileSelect(profile)}
                              >
                                <td className="px-5 py-4">
                                  <div className="flex items-center gap-2">
                                    <Store className="w-4 h-4 flex-shrink-0" style={{ color: COLORS.textMuted }} />
                                    <span style={{ fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>
                                      {String(profile.name || 'N/A')}
                                    </span>
                                  </div>
                                </td>

                                <td className="px-5 py-4">
                                  <div className="flex items-center gap-2.5">
                                    <Globe className="w-4 h-4 flex-shrink-0" style={{ color: COLORS.textMuted }} />
                                    <div>
                                      <p className="font-mono" style={{ margin: 0, fontSize: 13, color: COLORS.textPrimary, fontVariantNumeric: 'tabular-nums' }}>
                                        {String(profile.profileId || 'N/A')}
                                      </p>
                                      <p style={{ margin: '2px 0 0', fontSize: 11, color: COLORS.textMuted }}>
                                        ID: {String(profile.id || 'N/A')}
                                      </p>
                                    </div>
                                  </div>
                                </td>

                                <td className="px-5 py-4">
                                  <div className="flex items-center gap-2">
                                    <span style={{ fontSize: 16 }}>{getCountryFlag(String(profile.country || ''))}</span>
                                    <span style={{ fontSize: 13, color: COLORS.textSecondary }}>
                                      {String(profile.country || 'N/A')}
                                    </span>
                                  </div>
                                </td>

                                <td className="px-5 py-4 text-center">
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      handleProfileSelect(profile);
                                    }}
                                    className="inline-flex items-center justify-center gap-1.5 transition-colors"
                                    style={{
                                      padding: '7px 14px',
                                      borderRadius: 8,
                                      fontSize: 12,
                                      fontWeight: 600,
                                      background: isSelected ? COLORS.accent : 'transparent',
                                      color: isSelected ? '#061021' : COLORS.textSecondary,
                                      border: `1px solid ${isSelected ? COLORS.accent : COLORS.border}`,
                                    }}
                                  >
                                    {isSelected ? (
                                      <>
                                        <Check className="w-3.5 h-3.5" />
                                        Selected
                                      </>
                                    ) : (
                                      'Select'
                                    )}
                                  </button>
                                </td>
                              </motion.tr>
                            );
                          })}
                        </AnimatePresence>
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="px-5 py-3" style={{ borderTop: `1px solid ${COLORS.border}`, background: COLORS.surfaceElevated }}>
                      <div className="flex items-center justify-between flex-wrap gap-3">
                        <div style={{ fontSize: 12, color: COLORS.textSecondary }}>
                          Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1}–{Math.min(currentPage * ITEMS_PER_PAGE, filteredProfiles.length)} of {filteredProfiles.length}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="transition-colors"
                            style={{
                              padding: 7, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: 'transparent',
                              color: COLORS.textSecondary, opacity: currentPage === 1 ? 0.4 : 1,
                              cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>

                          {getPaginationGroup().map(page => (
                            <button
                              key={page}
                              onClick={() => setCurrentPage(page)}
                              className="transition-colors"
                              style={{
                                padding: '6px 11px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                                background: currentPage === page ? COLORS.accent : 'transparent',
                                color: currentPage === page ? '#061021' : COLORS.textSecondary,
                                border: `1px solid ${currentPage === page ? COLORS.accent : 'transparent'}`,
                              }}
                            >
                              {page}
                            </button>
                          ))}

                          <button
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className="transition-colors"
                            style={{
                              padding: 7, borderRadius: 8, border: `1px solid ${COLORS.border}`, background: 'transparent',
                              color: COLORS.textSecondary, opacity: currentPage === totalPages ? 0.4 : 1,
                              cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                            }}
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Selected Profile & Confirm Section */}
                {selectedProfile && (
                  <motion.div
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.3 }}
                    style={{ marginTop: 16, border: '1px solid rgba(59,130,246,.4)', borderRadius: 13, background: 'rgba(59,130,246,.06)', padding: 20 }}
                  >
                    <div className="flex items-center justify-between flex-wrap" style={{ gap: 20 }}>
                      <div className="min-w-0">
                        <h3 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600, color: COLORS.textPrimary }}>Selected profile</h3>
                        <div className="grid grid-cols-1 sm:grid-cols-3" style={{ gap: 16 }}>
                          <div>
                            <span style={{ fontSize: 12, color: COLORS.textMuted }}>Brand name</span>
                            <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 500, color: COLORS.textPrimary }}>{String(selectedProfile.name || 'N/A')}</p>
                          </div>
                          <div>
                            <span style={{ fontSize: 12, color: COLORS.textMuted }}>Profile ID</span>
                            <p className="font-mono" style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 500, color: COLORS.textPrimary }}>{String(selectedProfile.profileId || 'N/A')}</p>
                          </div>
                          <div>
                            <span style={{ fontSize: 12, color: COLORS.textMuted }}>Country</span>
                            <p style={{ margin: '2px 0 0', fontSize: 13, fontWeight: 500, color: COLORS.textPrimary }}>
                              {getCountryFlag(String(selectedProfile.country || ''))} {String(selectedProfile.country || 'N/A')}
                            </p>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-3 flex-none">
                        <button
                          onClick={handleConfirm}
                          disabled={loading}
                          className="inline-flex items-center justify-center gap-2 transition-colors"
                          style={{
                            padding: '11px 18px', border: 0, borderRadius: 9,
                            background: loading ? COLORS.surfaceElevated : COLORS.accent,
                            color: loading ? COLORS.textMuted : '#061021',
                            fontSize: 13, fontWeight: 600,
                            cursor: loading ? 'not-allowed' : 'pointer',
                          }}
                        >
                          {loading ? (
                            <>
                              <div className="animate-spin" style={{ width: 14, height: 14, borderRadius: '50%', border: `2px solid ${COLORS.textMuted}`, borderTopColor: 'transparent' }} />
                              Saving…
                            </>
                          ) : (
                            <>
                              <Check className="w-4 h-4" />
                              Confirm and continue
                            </>
                          )}
                        </button>
                        <button
                          onClick={() => {
                            setSelectedProfile(null);
                            setProfileId('');
                            setCurrencyCode('');
                          }}
                          className="transition-colors"
                          style={{
                            padding: '11px 16px', border: `1px solid ${COLORS.border}`, borderRadius: 9,
                            background: 'transparent', color: COLORS.textSecondary, fontSize: 13, cursor: 'pointer',
                          }}
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </>
            )}
          </motion.div>
        )}
    </OnboardingShell>
  );
};

export default ProfileIDSelection;
