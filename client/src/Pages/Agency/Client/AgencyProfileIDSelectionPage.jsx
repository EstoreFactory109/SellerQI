import React, { useState, useMemo, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Globe, ChevronLeft, ChevronRight, User, Check, Store } from 'lucide-react';
import { useSearchParams, useLocation } from 'react-router-dom';
import axios from 'axios';
import axiosInstance from '../../../config/axios.config.js';

const ITEMS_PER_PAGE = 10;

const BASE_URIS = {
  'NA': 'https://advertising-api.amazon.com',
  'EU': 'https://advertising-api-eu.amazon.com',
  'FE': 'https://advertising-api-fe.amazon.com'
};

const FLAG_MAP = {
  'US': '\u{1F1FA}\u{1F1F8}', 'United States': '\u{1F1FA}\u{1F1F8}',
  'CA': '\u{1F1E8}\u{1F1E6}', 'Canada': '\u{1F1E8}\u{1F1E6}',
  'GB': '\u{1F1EC}\u{1F1E7}', 'UK': '\u{1F1EC}\u{1F1E7}', 'United Kingdom': '\u{1F1EC}\u{1F1E7}',
  'DE': '\u{1F1E9}\u{1F1EA}', 'Germany': '\u{1F1E9}\u{1F1EA}',
  'FR': '\u{1F1EB}\u{1F1F7}', 'France': '\u{1F1EB}\u{1F1F7}',
  'IT': '\u{1F1EE}\u{1F1F9}', 'Italy': '\u{1F1EE}\u{1F1F9}',
  'ES': '\u{1F1EA}\u{1F1F8}', 'Spain': '\u{1F1EA}\u{1F1F8}',
  'JP': '\u{1F1EF}\u{1F1F5}', 'Japan': '\u{1F1EF}\u{1F1F5}',
  'AU': '\u{1F1E6}\u{1F1FA}', 'Australia': '\u{1F1E6}\u{1F1FA}',
  'IN': '\u{1F1EE}\u{1F1F3}', 'India': '\u{1F1EE}\u{1F1F3}',
  'BR': '\u{1F1E7}\u{1F1F7}', 'Brazil': '\u{1F1E7}\u{1F1F7}',
  'MX': '\u{1F1F2}\u{1F1FD}', 'Mexico': '\u{1F1F2}\u{1F1FD}',
  'NL': '\u{1F1F3}\u{1F1F1}', 'Netherlands': '\u{1F1F3}\u{1F1F1}',
  'SE': '\u{1F1F8}\u{1F1EA}', 'Sweden': '\u{1F1F8}\u{1F1EA}',
  'PL': '\u{1F1F5}\u{1F1F1}', 'Poland': '\u{1F1F5}\u{1F1F1}',
};

const getCountryFlag = (country) => FLAG_MAP[country] || '\u{1F30D}';

const AgencyProfileIDSelectionPage = () => {
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [searchParams] = useSearchParams();
  const [profileId, setProfileId] = useState('');
  const [selectedProfile, setSelectedProfile] = useState(null);
  const [currencyCode, setCurrencyCode] = useState('');
  const [profileData, setProfileData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [analysisStarted, setAnalysisStarted] = useState(false);
  const [waitingForAnalysis, setWaitingForAnalysis] = useState(false);

  const location = useLocation();
  const pollingRef = useRef(null);
  const timeoutRef = useRef(null);

  const prefetchedProfileData = location.state?.profileData;
  const region = searchParams.get('region') || 'NA';

  // ── Fetch profile data ───────────────────────────────────────────────────────
  useEffect(() => {
    let isMounted = true;

    if (prefetchedProfileData && Array.isArray(prefetchedProfileData) && prefetchedProfileData.length > 0) {
      setProfileData(prefetchedProfileData);
      setDataLoading(false);
      return;
    }

    const fetchProfileData = async (retryCount = 0) => {
      if (!isMounted) return;
      setDataLoading(true);
      try {
        const response = await axios.get(`${import.meta.env.VITE_BASE_URI}/app/profile/getProfileId`, {
          withCredentials: true
        });

        if (!isMounted) return;

        if (response.status === 200 && response.data) {
          const dataArray = response.data.data || response.data || [];
          if (Array.isArray(dataArray) && dataArray.length > 0) {
            const profiles = dataArray.map((scope, index) => ({
              id: `PF${String(index + 1).padStart(3, '0')}`,
              profileId: String(scope.profileId || scope.profile_id || 'Unknown'),
              name: String(scope.accountInfo?.name || scope.name || 'Unknown'),
              currency: String(scope.currencyCode || 'Unknown'),
              country: String(scope.countryCode || scope.country_code || scope.country || 'Unknown')
            }));
            setProfileData(profiles);
            setDataLoading(false);
            return;
          }
        }

        if (retryCount < 3) {
          setTimeout(() => fetchProfileData(retryCount + 1), 1500);
          return;
        }
        setProfileData([]);
        setDataLoading(false);
      } catch (error) {
        if (!isMounted) return;
        const status = error.response?.status;
        if ((status === 400 || status === 404 || status === 401 || !status) && retryCount < 3) {
          setTimeout(() => fetchProfileData(retryCount + 1), 1500);
          return;
        }
        setProfileData([]);
        setDataLoading(false);
        if (retryCount >= 3) {
          alert('Failed to fetch profile data. Please try again.');
        }
      }
    };

    const initialDelay = setTimeout(() => { fetchProfileData(); }, 300);
    return () => { isMounted = false; clearTimeout(initialDelay); };
  }, [prefetchedProfileData]);

  // ── Wait for integration job to start ────────────────────────────────────────
  const waitForJobToStart = async (jobId) => {
    return new Promise((resolve) => {
      const maxWaitTime = 30000;
      const pollInterval = 2000;
      const startTime = Date.now();

      const checkStatus = async () => {
        try {
          const statusResponse = await axiosInstance.get(`/api/integration/status/${jobId}`);
          const status = statusResponse.data.data.status?.toLowerCase();

          if (['active', 'running', 'completed', 'failed'].includes(status) || Date.now() - startTime >= maxWaitTime) {
            if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
            if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
            resolve(true);
            return;
          }
        } catch {
          if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
          if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
          resolve(true);
        }
      };

      pollingRef.current = setInterval(checkStatus, pollInterval);
      checkStatus();
      timeoutRef.current = setTimeout(() => {
        if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
        resolve(true);
      }, maxWaitTime);
    });
  };

  useEffect(() => {
    return () => {
      if (pollingRef.current) { clearInterval(pollingRef.current); pollingRef.current = null; }
      if (timeoutRef.current) { clearTimeout(timeoutRef.current); timeoutRef.current = null; }
    };
  }, []);

  // ── Save profile + trigger integration + redirect ────────────────────────────
  const saveProfileId = async (pid, currency) => {
    setLoading(true);
    try {
      const response = await axios.post(
        `${import.meta.env.VITE_BASE_URI}/app/profile/saveProfileId`,
        { profileId: pid, currencyCode: currency },
        { withCredentials: true }
      );

      if (response.status === 200) {
        alert('Profile ID saved successfully');
        setSelectedProfile(null);
        setProfileId('');
        setCurrencyCode('');

        setWaitingForAnalysis(true);
        try {
          const activeResponse = await axiosInstance.get('/api/integration/active');
          let jobId = null;

          if (activeResponse.status === 200 && activeResponse.data.data.hasActiveJob) {
            const existingStatus = activeResponse.data.data.status?.toLowerCase();
            if (['active', 'running', 'waiting', 'delayed'].includes(existingStatus)) {
              console.log('[AgencyProfileID] Job already in progress');
              setWaitingForAnalysis(false);
              window.location.href = '/manage-agency-users';
              return;
            }
          }

          const triggerResponse = await axiosInstance.post('/api/integration/trigger');
          if (triggerResponse.status === 202 || triggerResponse.status === 200) {
            jobId = triggerResponse.data.data.jobId;
            console.log('[AgencyProfileID] Integration triggered, jobId:', jobId);
          }

          if (jobId) {
            await waitForJobToStart(jobId);
            setAnalysisStarted(true);
            console.log('[AgencyProfileID] Analysis started, redirecting to manage-agency-users');
          }
        } catch (integrationError) {
          console.warn('[AgencyProfileID] Integration trigger failed (non-blocking):', integrationError.message);
        }

        setWaitingForAnalysis(false);
        window.location.href = '/manage-agency-users';
      }
    } catch (error) {
      console.error('Error saving profile ID:', error);
      alert('Failed to save profile ID. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // ── Handlers ─────────────────────────────────────────────────────────────────
  const handleProfileSelect = (profile) => {
    setSelectedProfile(profile);
    setProfileId(String(profile.profileId || ''));
    setCurrencyCode(String(profile.currency || ''));
  };

  const handleConfirm = () => {
    if (profileId) saveProfileId(profileId, currencyCode);
  };

  // ── Filtering + pagination ───────────────────────────────────────────────────
  const filteredProfiles = useMemo(() => {
    if (!searchQuery.trim()) return profileData;
    const query = searchQuery.toLowerCase();
    return profileData.filter(p =>
      String(p.profileId || '').toLowerCase().includes(query) ||
      String(p.name || '').toLowerCase().includes(query) ||
      String(p.country || '').toLowerCase().includes(query)
    );
  }, [searchQuery, profileData]);

  const totalPages = Math.max(1, Math.ceil(filteredProfiles.length / ITEMS_PER_PAGE));
  const paginatedProfiles = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return filteredProfiles.slice(start, start + ITEMS_PER_PAGE);
  }, [currentPage, filteredProfiles]);

  useEffect(() => { setCurrentPage(1); }, [searchQuery]);

  const getPaginationGroup = () => {
    const group = [];
    const maxButtons = 5;
    if (totalPages <= maxButtons) {
      for (let i = 1; i <= totalPages; i++) group.push(i);
    } else {
      let startPage = Math.max(1, currentPage - 2);
      let endPage = Math.min(totalPages, currentPage + 2);
      if (currentPage <= 3) { startPage = 1; endPage = 5; }
      else if (currentPage >= totalPages - 2) { startPage = totalPages - 4; endPage = totalPages; }
      for (let i = startPage; i <= endPage; i++) group.push(i);
    }
    return group;
  };

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-[#1a1a1a] w-full p-6 overflow-y-auto">
      <div className="max-w-[1600px] mx-auto">
        {dataLoading ? (
          <div className="flex items-center justify-center min-h-[60vh]">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin"></div>
              <div className="text-center">
                <h3 className="text-lg font-semibold text-gray-100 mb-2">Loading Profile Data</h3>
                <p className="text-sm text-gray-400">Please wait while we fetch your profile information...</p>
              </div>
            </motion.div>
          </div>
        ) : (
          <>
            {/* Header */}
            <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6 }} className="mb-8">
              <div className="flex items-center gap-3 mb-2">
                <User className="w-5 h-5 text-blue-400" />
                <div>
                  <h1 className="text-2xl lg:text-3xl font-bold text-gray-100">Profile ID Selection</h1>
                  <p className="text-sm text-gray-400 mt-1">Select your Amazon marketplace profile ID and country</p>
                </div>
              </div>
            </motion.div>

            {/* Waiting banner */}
            {waitingForAnalysis && (
              <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
                className="mb-6 bg-yellow-500/10 border border-yellow-500/40 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <motion.div className="w-5 h-5 border-2 border-yellow-400 border-t-transparent rounded-full flex-shrink-0"
                    animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-yellow-300 mb-1">Starting Analysis...</h3>
                    <p className="text-xs text-yellow-400">Please wait while we start the account analysis. You will be redirected shortly.</p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Analysis started banner */}
            {analysisStarted && !waitingForAnalysis && (
              <motion.div initial={{ opacity: 0, y: -20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
                className="mb-6 bg-blue-500/10 border border-blue-500/40 rounded-xl p-4 shadow-sm">
                <div className="flex items-center gap-3">
                  <motion.div className="w-5 h-5 border-2 border-blue-400 border-t-transparent rounded-full flex-shrink-0"
                    animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: "linear" }} />
                  <div className="flex-1">
                    <h3 className="text-sm font-semibold text-blue-300 mb-1">Analysis Started</h3>
                    <p className="text-xs text-blue-400">Account analysis is running in the background. Redirecting...</p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* Search + stats */}
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.05 }}
              className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-sm p-6 mb-6">
              <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                <div className="relative flex-1 max-w-md">
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input type="text" placeholder="Search by name, profile ID, or country..."
                    className="pl-11 pr-4 py-2.5 border border-[#30363d] bg-[#21262d] text-gray-100 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full transition-all duration-200 shadow-sm hover:shadow-md placeholder-gray-500"
                    value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
                </div>
                <div className="flex items-center gap-6">
                  <div className="text-center">
                    <div className="text-sm text-gray-400">Total Profiles</div>
                    <div className="text-xl font-bold text-gray-100">{profileData.length}</div>
                  </div>
                  <div className="w-px h-12 bg-[#30363d]"></div>
                  <div className="text-center">
                    <div className="text-sm text-gray-400">Filtered Results</div>
                    <div className="text-xl font-bold text-blue-400">{filteredProfiles.length}</div>
                  </div>
                </div>
              </div>
            </motion.div>

            {/* Empty state */}
            {profileData.length === 0 ? (
              <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}
                className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-sm p-8 text-center">
                <User className="w-8 h-8 text-gray-500 mx-auto mb-4" />
                <h3 className="text-lg font-semibold text-gray-100 mb-2">No Profiles Found</h3>
                <p className="text-gray-400 mb-4">No profile data is available. This might be because your account setup is not complete or there was an error fetching data.</p>
                <button onClick={() => window.location.reload()}
                  className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors duration-200 font-medium shadow-lg shadow-blue-500/25">
                  Retry
                </button>
              </motion.div>
            ) : (
              <>
                {/* Table */}
                <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, delay: 0.1 }}
                  className="bg-[#161b22] rounded-2xl border border-[#30363d] shadow-sm overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="min-w-full">
                      <thead>
                        <tr className="bg-[#21262d] border-b border-[#30363d]">
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Brand Name</th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Profile ID</th>
                          <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">Country</th>
                          <th className="px-6 py-4 text-center text-xs font-semibold text-gray-300 uppercase tracking-wider">Action</th>
                        </tr>
                      </thead>
                      <tbody className="bg-[#161b22] divide-y divide-[#30363d]">
                        <AnimatePresence>
                          {paginatedProfiles.map((profile, index) => (
                            <motion.tr key={profile.id}
                              initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}
                              transition={{ duration: 0.3, delay: index * 0.05 }}
                              className={`hover:bg-[#21262d] transition-colors duration-200 cursor-pointer ${selectedProfile?.id === profile.id ? 'bg-blue-500/10 border-l-4 border-blue-500' : ''}`}
                              onClick={() => handleProfileSelect(profile)}>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <Store className="w-4 h-4 text-green-400 flex-shrink-0" />
                                  <span className="text-sm font-medium text-gray-100">{String(profile.name || 'N/A')}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-3">
                                  <Globe className="w-4 h-4 text-blue-400 flex-shrink-0" />
                                  <div>
                                    <p className="text-sm font-medium text-gray-100 font-mono">{String(profile.profileId || 'N/A')}</p>
                                    <p className="text-xs text-gray-500">ID: {String(profile.id || 'N/A')}</p>
                                  </div>
                                </div>
                              </td>
                              <td className="px-6 py-4">
                                <div className="flex items-center gap-2">
                                  <span className="text-lg">{getCountryFlag(String(profile.country || ''))}</span>
                                  <span className="text-sm font-medium text-gray-100">{String(profile.country || 'N/A')}</span>
                                </div>
                              </td>
                              <td className="px-6 py-4 text-center">
                                <button onClick={(e) => { e.stopPropagation(); handleProfileSelect(profile); }}
                                  className={`px-4 py-2 rounded-lg text-sm font-medium transition-all duration-200 ${selectedProfile?.id === profile.id ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25' : 'bg-[#21262d] text-gray-300 hover:bg-blue-500/10 hover:text-blue-400 border border-[#30363d]'}`}>
                                  {selectedProfile?.id === profile.id ? (
                                    <div className="flex items-center gap-1"><Check className="w-4 h-4" />Selected</div>
                                  ) : 'Select'}
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
                    <div className="px-6 py-4 border-t border-[#30363d] bg-[#21262d]">
                      <div className="flex items-center justify-between">
                        <div className="text-sm text-gray-400">
                          Showing {((currentPage - 1) * ITEMS_PER_PAGE) + 1} to {Math.min(currentPage * ITEMS_PER_PAGE, filteredProfiles.length)} of {filteredProfiles.length} results
                        </div>
                        <div className="flex items-center gap-2">
                          <button onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))} disabled={currentPage === 1}
                            className="p-2 rounded-lg border border-[#30363d] text-gray-400 hover:bg-[#161b22] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200">
                            <ChevronLeft className="w-4 h-4" />
                          </button>
                          {getPaginationGroup().map(page => (
                            <button key={page} onClick={() => setCurrentPage(page)}
                              className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-200 ${currentPage === page ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25' : 'text-gray-300 hover:bg-[#161b22]'}`}>
                              {page}
                            </button>
                          ))}
                          <button onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))} disabled={currentPage === totalPages}
                            className="p-2 rounded-lg border border-[#30363d] text-gray-400 hover:bg-[#161b22] disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-200">
                            <ChevronRight className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </motion.div>

                {/* Selected profile confirm */}
                {selectedProfile && (
                  <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
                    className="mt-6 bg-blue-500/10 rounded-2xl border border-blue-500/40 p-6">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-lg font-semibold text-gray-100 mb-2">Selected Profile</h3>
                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 text-sm">
                          <div>
                            <span className="text-gray-400">Brand Name:</span>
                            <p className="font-medium text-gray-100">{String(selectedProfile.name || 'N/A')}</p>
                          </div>
                          <div>
                            <span className="text-gray-400">Profile ID:</span>
                            <p className="font-medium text-gray-100 font-mono">{String(selectedProfile.profileId || 'N/A')}</p>
                          </div>
                          <div>
                            <span className="text-gray-400">Country:</span>
                            <p className="font-medium text-gray-100">{getCountryFlag(String(selectedProfile.country || ''))} {String(selectedProfile.country || 'N/A')}</p>
                          </div>
                        </div>
                      </div>
                      <div className="flex gap-3">
                        <button onClick={handleConfirm} disabled={loading}
                          className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-colors duration-200 font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 shadow-lg shadow-blue-500/25">
                          {loading ? (
                            <><div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>Saving...</>
                          ) : (
                            <><Check className="w-4 h-4" />Confirm Selection</>
                          )}
                        </button>
                        <button onClick={() => { setSelectedProfile(null); setProfileId(''); setCurrencyCode(''); }}
                          className="px-6 py-2 bg-[#21262d] text-gray-300 rounded-lg hover:bg-[#1c2128] transition-colors duration-200 font-medium border border-[#30363d]">
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

export default AgencyProfileIDSelectionPage;
