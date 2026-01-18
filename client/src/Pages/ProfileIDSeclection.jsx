import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Globe, ChevronLeft, ChevronRight, User, Check } from 'lucide-react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import axios from 'axios';
import axiosInstance from '../config/axios.config.js';
import { detectCountry } from '../utils/countryDetection.js';
import stripeService from '../services/stripeService.js';
import razorpayService from '../services/razorpayService.js';


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
        
        // Retry on certain errors (might be timing issue after redirect)
        const status = error.response?.status;
        if ((status === 400 || status === 404 || status === 401 || !status) && retryCount < 3) {
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

  // Navigate to payment based on country
  const navigateToPayment = async () => {
    try {
      // Detect user's country
      const country = await detectCountry();
      const isIndianUser = country === 'IN';
      
      console.log(`[ProfileIDSelection] Detected country: ${country}, navigating to payment...`);
      
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
      console.error('[ProfileIDSelection] Error navigating to payment:', error);
      setWaitingForAnalysis(false);
      // Don't block user - they can proceed manually
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
          console.log('[ProfileIDSelection] Triggering integration job...');
          setWaitingForAnalysis(true);
          
          let jobId = null;
          
          // First check if there's an active job
          const activeResponse = await axiosInstance.get('/api/integration/active');
          
          if (activeResponse.status === 200 && activeResponse.data.data.hasActiveJob) {
            // Job already exists
            jobId = activeResponse.data.data.jobId;
            const existingStatus = activeResponse.data.data.status?.toLowerCase();
            console.log('[ProfileIDSelection] Active job already exists:', existingStatus);
            
            // If already active or completed, proceed immediately
            if (existingStatus === 'active' || existingStatus === 'running' || existingStatus === 'completed') {
              setAnalysisStarted(true);
              await navigateToPayment();
              return;
            }
          } else {
            // No active job, trigger new one
            const triggerResponse = await axiosInstance.post('/api/integration/trigger');
            
            if (triggerResponse.status === 202 || triggerResponse.status === 200) {
              jobId = triggerResponse.data.data.jobId;
              console.log('[ProfileIDSelection] Integration job triggered successfully, jobId:', jobId);
            } else {
              throw new Error('Failed to trigger integration job');
            }
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
    <div className="min-h-screen bg-[#eeeeee] w-full p-6 overflow-y-auto">
      <div className="max-w-[1600px] mx-auto">
        {/* Show loader while data is being fetched */}
        {dataLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col items-center gap-4"
            >
              <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin"></div>
              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-900 mb-2">Loading Profile Data</h3>
                <p className="text-sm text-gray-600">Please wait while we fetch your profile information...</p>
              </div>
            </motion.div>
          </div>
        ) : (
          <>
            {/* Header Section */}
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mb-8"
            >
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                  <User className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">
                    Profile ID Selection
                  </h1>
                  <p className="text-sm text-gray-600 mt-1">
                    Select your Amazon marketplace profile ID and country
                  </p>
                </div>
              </div>
            </motion.div>

            {/* Waiting for Analysis Banner - Show when waiting for analysis to start */}
            {waitingForAnalysis && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="mb-6 bg-gradient-to-r from-yellow-50 to-orange-50 border border-yellow-200 rounded-xl p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-yellow-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <motion.div
                      className="w-5 h-5 border-2 border-yellow-600 border-t-transparent rounded-full"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-yellow-900 mb-1">
                      Starting Analysis...
                    </h3>
                    <p className="text-xs text-yellow-700">
                      Please wait while we start your account analysis. You will be redirected to payment setup shortly.
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Analysis Started Banner - Show when analysis has started */}
            {analysisStarted && !waitingForAnalysis && (
              <motion.div
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="mb-6 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-200 rounded-xl p-4 shadow-sm"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <motion.div
                      className="w-5 h-5 border-2 border-indigo-600 border-t-transparent rounded-full"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 1, repeat: Infinity, ease: "linear" }}
                    />
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-indigo-900 mb-1">
                      Analysis Started
                    </h3>
                    <p className="text-xs text-indigo-700">
                      Your account analysis is running in the background. Redirecting to payment setup...
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Search and Stats Section */}
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.05 }}
              className="bg-white rounded-2xl border border-gray-200 shadow-sm p-6 mb-6"
            >
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                {/* Search Input */}
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by name, profile ID, or country..."
                    className="pl-11 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full transition-all duration-200 shadow-sm hover:shadow-md"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                {/* Stats */}
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="text-sm text-gray-600">Total Profiles</div>
                    <div className="text-xl font-bold text-gray-900">{profileData.length}</div>
                  </div>
                  <div className="w-px h-12 bg-gray-200"></div>
                  <div className="text-center">
                    <div className="text-sm text-gray-600">Filtered Results</div>
                    <div className="text-xl font-bold text-indigo-600">{filteredProfiles.length}</div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Show message if no profiles found */}
            {profileData.length === 0 ? (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.1 }}
                className="bg-white rounded-2xl border border-gray-200 shadow-sm p-8 text-center"
              >
                <div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <User className="w-8 h-8 text-gray-400" />
                </div>
                <h3 className="text-lg font-semibold text-gray-900 mb-2">No Profiles Found</h3>
                <p className="text-gray-600 mb-4">
                  No profile data is available. This might be because your account setup is not complete or there was an error fetching data.
                </p>
                <button
                  onClick={() => window.location.reload()}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 font-medium"
                >
                  Retry
                </button>
              </motion.div>
            ) : (
              <>
                {/* Table Section */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.1 }}
                  className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden"
                >
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="bg-gradient-to-r from-gray-50 to-slate-50 border-b border-gray-200">
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            Name
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            Profile ID
                          </th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            Country
                          </th>
                          <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                            Action
                          </th>
                        </tr>
                      </thead>
                      <tbody className="bg-white divide-y divide-gray-100">
                        <AnimatePresence>
                          {paginatedProfiles.map((profile, index) => (
                            <motion.tr
                              key={profile.id}
                              initial={{ opacity: 0, y: 10 }}
                              animate={{ opacity: 1, y: 0 }}
                              exit={{ opacity: 0, y: -10 }}
                              transition={{ duration: 0.3, delay: index * 0.05 }}
                              className={`hover:bg-gray-50 transition-colors duration-200 cursor-pointer ${
                                selectedProfile?.id === profile.id ? 'bg-blue-50 border-l-4 border-blue-500' : ''
                              }`}
                              onClick={() => handleProfileSelect(profile)}
                            >
                                                            <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <div className="w-8 h-8 bg-gradient-to-br from-green-100 to-emerald-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <User className="w-4 h-4 text-green-600" />
                                  </div>
                                  <span className="text-sm font-medium text-gray-900">
                                    {String(profile.name || 'N/A')}
                                  </span>
                                </div>
                              </td>
                              
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <div className="w-8 h-8 bg-gradient-to-br from-blue-100 to-purple-100 rounded-lg flex items-center justify-center flex-shrink-0">
                                    <Globe className="w-4 h-4 text-blue-600" />
                                  </div>
                                  <div>
                                    <p className="text-sm font-medium text-gray-900 font-mono">
                                      {String(profile.profileId || 'N/A')}
                                    </p>
                                    <p className="text-xs text-gray-500">
                                      ID: {String(profile.id || 'N/A')}
                                    </p>
                                  </div>
                                </div>
                              </td>
                              
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <span className="text-lg">{getCountryFlag(String(profile.country || ''))}</span>
                                  <span className="text-sm font-medium text-gray-900">
                                    {String(profile.country || 'N/A')}
                                  </span>
                                </div>
                              </td>

                              <td className="px-6 py-4 text-center">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleProfileSelect(profile);
                                  }}
                                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${
                                    selectedProfile?.id === profile.id
                                      ? 'bg-blue-600 text-white shadow-md'
                                      : 'bg-gray-100 text-gray-700 hover:bg-blue-50 hover:text-blue-600'
                                  }`}
                                >
                                  {selectedProfile?.id === profile.id ? (
                                    <div className="flex items-center gap-1">
                                      <Check className="w-4 h-4" />
                                      Selected
                                    </div>
                                  ) : (
                                    'Select'
                                  )}
                                </button>
                              </td>
                            </motion.tr>
                          ))}
                        </AnimatePresence>
                      </tbody>
                    </table>
                  </div>

                  {/* Pagination */}
                  {totalPages > 1 && (
                    <div className="px-6 py-4 border-t border-gray-200 bg-gray-50">
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-700">
                          Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredProfiles.length)} of {filteredProfiles.length} results
                        </div>
                        
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                            disabled={currentPage === 1}
                            className="p-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                          >
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          
                          {getPaginationGroup().map(page => (
                            <button
                              key={page}
                              onClick={() => setCurrentPage(page)}
                              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${
                                currentPage === page
                                  ? 'bg-blue-600 text-white'
                                  : 'text-gray-700 hover:bg-gray-100'
                              }`}
                            >
                              {page}
                            </button>
                          ))}
                          
                          <button
                            onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                            disabled={currentPage === totalPages}
                            className="p-2 rounded-lg border border-gray-300 text-gray-500 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200"
                          >
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>

                {/* Selected Profile & Confirm Section */}
                {selectedProfile && (
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4 }}
                    className="mt-6 bg-gradient-to-r from-blue-50 to-indigo-50 rounded-2xl border border-blue-200 p-6"
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900 mb-2">Selected Profile</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-gray-600">Name:</span>
                            <p className="font-medium text-gray-900">{String(selectedProfile.name || 'N/A')}</p>
                          </div>
                          <div>
                            <span className="text-gray-600">Profile ID:</span>
                            <p className="font-medium text-gray-900 font-mono">{String(selectedProfile.profileId || 'N/A')}</p>
                          </div>
                          <div>
                            <span className="text-gray-600">Country:</span>
                            <p className="font-medium text-gray-900">{getCountryFlag(String(selectedProfile.country || ''))} {String(selectedProfile.country || 'N/A')}</p>
                          </div>
                        </div>
                      </div>
                      
                      <div className="flex gap-3">
                        <button 
                          onClick={handleConfirm}
                          disabled={loading}
                          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors duration-200 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                        >
                          {loading ? (
                            <>
                              <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                              Saving...
                            </>
                          ) : (
                            <>
                              <Check className="w-4 h-4" />
                              Confirm Selection
                            </>
                          )}
                        </button>
                        <button 
                          onClick={() => {
                            setSelectedProfile(null);
                            setProfileId('');
                            setCurrencyCode('');
                          }}
                          className="px-6 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors duration-200 font-medium"
                        >
                          Clear
                        </button>
                      </div>
                    </div>
                  </motion.div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ProfileIDSelection;
