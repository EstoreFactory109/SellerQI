import React, { useEffect, useState, useRef, useCallback } from "react";
import { motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useDispatch } from "react-redux";
import { setDashboardInfo } from '../redux/slices/DashboardSlice.js'
import { setHistoryInfo } from '../redux/slices/HistorySlice.js'
import { setAllAccounts } from '../redux/slices/AllAccountsSlice.js'
import { setProfitabilityErrorDetails, setSponsoredAdsErrorDetails } from '../redux/slices/errorsSlice.js'
import { addBrand } from '../redux/slices/authSlice.js'
import { createDefaultDashboardData, isEmptyDashboardData } from '../utils/defaultDataStructure.js'
import axiosInstance from '../config/axios.config.js'

// Animated DNA Helix Loader
const HelixLoader = () => {
    const dots = Array.from({ length: 12 }, (_, i) => i);
    return (
        <div className="relative w-24 h-24">
            {dots.map((i) => (
            <motion.div
                    key={i}
                    className="absolute w-3 h-3 rounded-full shadow-md"
                    style={{
                        left: '50%',
                        top: '50%',
                        background: i % 2 === 0 ? '#6366f1' : '#a5b4fc',
                    }}
                    animate={{
                        x: [
                            Math.cos((i / 12) * Math.PI * 2) * 30,
                            Math.cos((i / 12) * Math.PI * 2 + Math.PI) * 30,
                            Math.cos((i / 12) * Math.PI * 2) * 30,
                        ],
                        y: [
                            Math.sin((i / 12) * Math.PI * 2) * 15 - 4,
                            Math.sin((i / 12) * Math.PI * 2 + Math.PI) * 15 - 4,
                            Math.sin((i / 12) * Math.PI * 2) * 15 - 4,
                        ],
                    scale: [1, 1.2, 1],
                        opacity: [0.7, 1, 0.7],
                }}
                transition={{ 
                        duration: 2,
                    repeat: Infinity,
                        ease: "easeInOut",
                        delay: i * 0.1,
                }}
            />
            ))}
            {/* Center glow */}
            <motion.div
                className="absolute inset-0 m-auto w-12 h-12 rounded-full bg-gradient-to-br from-indigo-300/40 to-purple-300/40 blur-xl"
                animate={{ 
                    scale: [1, 1.3, 1],
                    opacity: [0.4, 0.7, 0.4],
                }}
                transition={{ 
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                }}
            />
        </div>
    );
};

// Floating particles background
const FloatingParticles = () => {
    const particles = Array.from({ length: 20 }, (_, i) => ({
        id: i,
        size: Math.random() * 6 + 3,
        x: Math.random() * 100,
        y: Math.random() * 100,
        duration: Math.random() * 20 + 15,
        delay: Math.random() * 5,
    }));

    return (
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
            {particles.map((p) => (
            <motion.div
                    key={p.id}
                    className="absolute rounded-full bg-indigo-500/10"
                    style={{
                        width: p.size,
                        height: p.size,
                        left: `${p.x}%`,
                        top: `${p.y}%`,
                    }}
                animate={{ 
                        y: [0, -80, 0],
                        x: [0, Math.random() * 30 - 15, 0],
                        opacity: [0, 0.4, 0],
                }}
                transition={{ 
                        duration: p.duration,
                    repeat: Infinity,
                        delay: p.delay,
                    ease: "easeInOut",
                }}
            />
            ))}
        </div>
    );
};

const AnalysingAccount = () => {
    const [timeElapsed, setTimeElapsed] = useState(0);
    const [jobStatus, setJobStatus] = useState('initializing'); // initializing, queued, processing, completed, failed
    const [jobId, setJobId] = useState(null);
    const [progress, setProgress] = useState(0);
    const [errorMessage, setErrorMessage] = useState(null);
    const pollingRef = useRef(null);
    const navigate = useNavigate();
    const dispatch = useDispatch();

    // Fetch dashboard data and navigate
    const fetchDashboardAndNavigate = useCallback(async () => {
        let dashboardData = null;
            let hasAnyData = false;

        try {
            console.log("=== AnalysingAccount: Fetching dashboard data ===");
                    const response = await axiosInstance.get('/api/pagewise/dashboard');
                    
                    if (response && response.status === 200) {
                        dashboardData = response.data?.data?.dashboardData;
                        console.log("Pre-calculated dashboard data received:", dashboardData);
                            
                        if (!dashboardData || isEmptyDashboardData(dashboardData)) {
                                console.log("⚠️ Account has no data available - will show zero data instead of error");
                            dashboardData = dashboardData || createDefaultDashboardData();
                                hasAnyData = false;
                            } else {
                                console.log("✅ Account has data available");
                                hasAnyData = true;
                            }
                            
                            dispatch(setDashboardInfo(dashboardData));
                        
                        if (dashboardData.Brand) {
                            dispatch(addBrand(dashboardData.Brand));
                        }
                        
                        if (dashboardData.AllSellerAccounts && dashboardData.AllSellerAccounts.length > 0) {
                            dispatch(setAllAccounts(dashboardData.AllSellerAccounts));
                        }
                            
                            if (dashboardData.totalProfitabilityErrors !== undefined) {
                                dispatch(setProfitabilityErrorDetails({
                                    totalErrors: dashboardData.totalProfitabilityErrors || 0,
                                    errorDetails: dashboardData.profitabilityErrorDetails || []
                                }));
                            }
                            if (dashboardData.totalSponsoredAdsErrors !== undefined) {
                                dispatch(setSponsoredAdsErrorDetails({
                                    totalErrors: dashboardData.totalSponsoredAdsErrors || 0,
                                    errorDetails: dashboardData.sponsoredAdsErrorDetails || []
                                }));
                        }
                    } else {
                    dashboardData = createDefaultDashboardData();
                    dispatch(setDashboardInfo(dashboardData));
                }

            // Fetch history if we have data
                if (dashboardData && hasAnyData) {
                    try {
                        const historyResponse = await axiosInstance.get('/app/accountHistory/getAccountHistory');
                        if (historyResponse && historyResponse.status === 200) {
                            dispatch(setHistoryInfo(historyResponse.data.data));
                        }
                    } catch (historyError) {
                        console.error("❌ History fetch failed:", historyError);
                    }
                }

                console.log("✅ Navigating to dashboard...");
                navigate("/seller-central-checker/dashboard");

            } catch (error) {
            console.error("❌ Error fetching dashboard data:", error);
                
                if (!dashboardData) {
                    dashboardData = createDefaultDashboardData();
                    dispatch(setDashboardInfo(dashboardData));
                }
                
                if (error.response?.status === 401) {
                    navigate("/");
                } else {
                    navigate("/seller-central-checker/dashboard");
                }
            }
    }, [dispatch, navigate]);

    // Poll job status
    const pollJobStatus = useCallback(async (jobIdToPoll) => {
        try {
            const response = await axiosInstance.get(`/api/integration/status/${jobIdToPoll}`);
            
            if (response.status === 200) {
                const { status, progress: jobProgress } = response.data.data;
                
                console.log(`[AnalysingAccount] Job status: ${status}, progress: ${jobProgress}`);
                
                setProgress(jobProgress || 0);
                
                // Handle various status values (BullMQ states + DB states)
                const normalizedStatus = status?.toLowerCase();
                
                switch (normalizedStatus) {
                    case 'waiting':
                    case 'delayed':
                    case 'pending':
                        setJobStatus('queued');
                        break;
                    case 'active':
                    case 'running':
                        setJobStatus('processing');
                        break;
                    case 'completed':
                        console.log('[AnalysingAccount] Job completed! Fetching dashboard...');
                        setJobStatus('completed');
                        setProgress(100);
                        // Stop polling
                        if (pollingRef.current) {
                            clearInterval(pollingRef.current);
                            pollingRef.current = null;
                        }
                        // Fetch dashboard data and navigate
                        await fetchDashboardAndNavigate();
                        break;
                    case 'failed':
                        console.log('[AnalysingAccount] Job failed:', response.data.data.error);
                        setJobStatus('failed');
                        setErrorMessage(response.data.data.error || 'Integration failed');
                        // Stop polling
                        if (pollingRef.current) {
                            clearInterval(pollingRef.current);
                            pollingRef.current = null;
                        }
                        break;
                    case 'not_found':
                        // Job might have been removed from queue after completion
                        // Check if this is a recently completed job
                        console.log('[AnalysingAccount] Job not found in queue, might be completed');
                        // Try to fetch dashboard anyway if we were at high progress
                        if (progress >= 90) {
                            console.log('[AnalysingAccount] High progress detected, assuming completed');
                            setJobStatus('completed');
                            setProgress(100);
                            if (pollingRef.current) {
                                clearInterval(pollingRef.current);
                                pollingRef.current = null;
                            }
                            await fetchDashboardAndNavigate();
                        }
                        break;
                    default:
                        console.log(`[AnalysingAccount] Unknown status: ${status}`);
                        setJobStatus('processing');
                }
            }
        } catch (error) {
            console.error("Error polling job status:", error);
            // Don't stop polling on error, just log it
        }
    }, [fetchDashboardAndNavigate, progress]);

    // Start polling
    const startPolling = useCallback((jobIdToPoll) => {
        // Clear any existing polling
        if (pollingRef.current) {
            clearInterval(pollingRef.current);
        }
        
        // Poll immediately
        pollJobStatus(jobIdToPoll);
        
        // Then poll every 3 seconds
        pollingRef.current = setInterval(() => {
            pollJobStatus(jobIdToPoll);
        }, 3000);
    }, [pollJobStatus]);

    // Trigger integration job
    const triggerIntegrationJob = useCallback(async () => {
        try {
            setJobStatus('initializing');
            
            // First check if there's an active job
            const activeResponse = await axiosInstance.get('/api/integration/active');
            
            if (activeResponse.status === 200 && activeResponse.data.data.hasActiveJob) {
                // Job already exists, start polling
                const existingJobId = activeResponse.data.data.jobId;
                const existingStatus = activeResponse.data.data.status?.toLowerCase();
                setJobId(existingJobId);
                
                // If job is already completed, redirect immediately
                if (existingStatus === 'completed') {
                    console.log('[AnalysingAccount] Active job already completed, redirecting...');
                    setJobStatus('completed');
                    setProgress(100);
                    await fetchDashboardAndNavigate();
                    return;
                }
                
                setJobStatus(existingStatus === 'waiting' ? 'queued' : 'processing');
                startPolling(existingJobId);
                return;
            }

            // No active job, trigger new one
            const response = await axiosInstance.post('/api/integration/trigger');
            
            if (response.status === 202 || response.status === 200) {
                const { jobId: newJobId, status, isExisting } = response.data.data;
                const normalizedStatus = status?.toLowerCase();
                setJobId(newJobId);
                
                // If trigger returns a completed job, redirect immediately
                if (normalizedStatus === 'completed') {
                    console.log('[AnalysingAccount] Trigger returned completed job, redirecting...');
                    setJobStatus('completed');
                    setProgress(100);
                    await fetchDashboardAndNavigate();
                    return;
                }
                
                setJobStatus(isExisting ? 'processing' : 'queued');
                startPolling(newJobId);
            }
        } catch (error) {
            console.error("Error triggering integration job:", error);
            setJobStatus('failed');
            setErrorMessage(error.response?.data?.message || 'Failed to start integration');
        }
    }, [startPolling, fetchDashboardAndNavigate]);

    useEffect(() => {
        // Update elapsed time every minute
        const timeInterval = setInterval(() => {
            setTimeElapsed((prev) => prev + 1);
        }, 60000); // 1 minute
        return () => clearInterval(timeInterval);
    }, []);

    // Trigger job on mount
    useEffect(() => {
        triggerIntegrationJob();
        
        // Cleanup polling on unmount
        return () => {
            if (pollingRef.current) {
                clearInterval(pollingRef.current);
            }
        };
    }, [triggerIntegrationJob]);

    // Format elapsed time
    const formatElapsedTime = (minutes) => {
        if (minutes < 60) {
            return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        }
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes > 0 ? `${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}` : ''}`;
    };

    // Get status message
    const getStatusMessage = () => {
        switch (jobStatus) {
            case 'initializing':
                return 'Starting analysis...';
            case 'queued':
                return 'Analysis queued and will start shortly...';
            case 'processing':
                return 'Deep analysis in progress...';
            case 'completed':
                return 'Analysis complete! Redirecting...';
            case 'failed':
                return `Analysis failed: ${errorMessage}`;
            default:
                return 'Processing...';
        }
    };

    return (
        <div className="h-screen w-full bg-gray-50 flex flex-col overflow-hidden relative">
            {/* Floating particles background */}
            <FloatingParticles />
            
            {/* Gradient mesh background - light theme */}
            <div className="absolute inset-0 overflow-hidden pointer-events-none z-0">
                <div className="absolute top-0 left-1/4 w-96 h-96 bg-indigo-100/60 rounded-full blur-3xl" />
                <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-purple-100/50 rounded-full blur-3xl" />
                <div className="absolute top-1/2 left-1/2 w-72 h-72 bg-blue-100/40 rounded-full blur-3xl -translate-x-1/2 -translate-y-1/2" />
            </div>

            {/* Main content - scrollable area */}
            <div className="flex-1 flex flex-col items-center justify-center px-6 py-4 relative z-10 overflow-y-auto">
                <div className="w-full max-w-4xl flex flex-col items-center gap-4">
                    {/* Loader */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.8 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.8, ease: "easeOut" }}
                        className="mb-2"
                    >
                        <HelixLoader />
                    </motion.div>

                    {/* Main Title */}
                    <motion.div
                        initial={{ opacity: 0, y: 20 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.2 }}
                        className="text-center mb-2"
                    >
                        <h1 className="text-3xl md:text-4xl font-bold text-gray-900 mb-1 tracking-tight">
                            Analysis in Progress
                        </h1>
                        <p className="text-gray-600 text-base md:text-lg max-w-xl mx-auto">
                            We're performing a deep analysis of your Amazon account
                        </p>
                    </motion.div>
                            
                    {/* Status Badge */}
                    <motion.div
                        initial={{ opacity: 0, scale: 0.9 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.5, delay: 0.4 }}
                        className="mb-2"
                    >
                        <span className={`inline-flex items-center gap-2 px-4 py-1.5 rounded-full text-xs font-medium ${
                            jobStatus === 'completed' ? 'bg-emerald-100 text-emerald-700 border border-emerald-200' :
                            jobStatus === 'failed' ? 'bg-red-100 text-red-700 border border-red-200' :
                            'bg-indigo-100 text-indigo-700 border border-indigo-200'
                        }`}>
                            <motion.span
                                className={`w-1.5 h-1.5 rounded-full ${
                                    jobStatus === 'completed' ? 'bg-emerald-500' :
                                    jobStatus === 'failed' ? 'bg-red-500' :
                                    'bg-indigo-500'
                                }`}
                                animate={{ opacity: [1, 0.4, 1] }}
                                transition={{ duration: 1.5, repeat: Infinity }}
                            />
                            {getStatusMessage()}
                        </span>
                    </motion.div>
                            
                    {/* Time elapsed */}
                    {timeElapsed > 0 && (
                        <motion.div
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            className="text-gray-500 text-xs mb-3"
                        >
                            Running for: {formatElapsedTime(timeElapsed)}
                        </motion.div>
                    )}

                    {/* Safe to close card */}
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.5 }}
                        className="w-full bg-white rounded-xl border border-gray-200 shadow-lg shadow-gray-200/50 p-5 mb-4"
                    >
                        <div className="flex items-start gap-4">
                            <div className="flex-shrink-0 w-12 h-12 bg-gradient-to-br from-emerald-400 to-teal-500 rounded-lg flex items-center justify-center shadow-md shadow-emerald-200">
                                <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                </svg>
                            </div>
                            <div className="flex-1">
                                <h3 className="text-lg font-semibold text-gray-900 mb-1.5">
                                    You can safely close this tab
                                </h3>
                                <p className="text-gray-600 text-sm leading-relaxed mb-3">
                                    Your analysis is running in the background and will continue even if you close this page. 
                                    We'll send you an <span className="text-gray-900 font-medium">email notification</span> when your comprehensive dashboard is ready.
                                </p>
                                <div className="flex items-center gap-2 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
                                    <svg className="w-4 h-4 text-indigo-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <span>Estimated completion time: <span className="text-gray-900 font-medium">60-90 minutes</span></span>
                                </div>
                            </div>
                        </div>
                    </motion.div>

                    {/* What's being analyzed */}
                    <motion.div
                        initial={{ opacity: 0, y: 30 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.6, delay: 0.7 }}
                        className="w-full mb-4"
                    >
                        <h4 className="text-center text-gray-400 text-xs font-medium uppercase tracking-wider mb-3">
                            Currently Analyzing
                        </h4>
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                            {[
                                { icon: "📊", label: "Sales Data" },
                                { icon: "📈", label: "PPC Campaigns" },
                                { icon: "💰", label: "Profitability" },
                                { icon: "📦", label: "Inventory" },
                                { icon: "🏆", label: "Rankings" },
                                { icon: "🛡️", label: "Account Health" },
                            ].map((item, index) => (
                                <motion.div
                                    key={item.label}
                                    initial={{ opacity: 0, y: 20 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ duration: 0.4, delay: 0.8 + index * 0.1 }}
                                    className="bg-white rounded-lg p-2.5 text-center border border-gray-200 shadow-sm hover:border-indigo-300 hover:shadow-md transition-all"
                                >
                                    <motion.span 
                                        className="text-xl block mb-1"
                                        animate={{ scale: [1, 1.1, 1] }}
                                        transition={{ duration: 2, repeat: Infinity, delay: index * 0.3 }}
                                    >
                                        {item.icon}
                                    </motion.span>
                                    <span className="text-[10px] text-gray-600 font-medium leading-tight">{item.label}</span>
                                </motion.div>
                            ))}
                        </div>
                    </motion.div>
                </div>
            </div>
                            
            {/* Bottom section with resources - fixed at bottom */}
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 1 }}
                className="relative z-10 border-t border-gray-200 bg-white flex-shrink-0"
            >
                <div className="max-w-5xl mx-auto px-6 py-4">
                    <p className="text-center text-gray-600 text-xs font-medium mb-3">
                        While you wait, explore how SellerQI helps Amazon sellers succeed
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-3">
                        <a
                            href="https://www.sellerqi.com/use-cases"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-center gap-2 px-4 py-2 bg-white hover:bg-indigo-50 rounded-full border-2 border-gray-200 hover:border-indigo-400 transition-all shadow-sm hover:shadow-md"
                        >
                            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <span className="text-xs font-medium text-gray-700 group-hover:text-indigo-700 transition-colors">Use Cases</span>
                            <svg className="w-3 h-3 text-gray-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                        <a
                            href="https://www.sellerqi.com/case-study/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-center gap-2 px-4 py-2 bg-white hover:bg-indigo-50 rounded-full border-2 border-gray-200 hover:border-indigo-400 transition-all shadow-sm hover:shadow-md"
                        >
                            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                            </svg>
                            <span className="text-xs font-medium text-gray-700 group-hover:text-indigo-700 transition-colors">Case Studies</span>
                            <svg className="w-3 h-3 text-gray-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                        <a
                            href="https://www.sellerqi.com/blog/"
                            target="_blank"
                            rel="noopener noreferrer"
                            className="group flex items-center gap-2 px-4 py-2 bg-white hover:bg-indigo-50 rounded-full border-2 border-gray-200 hover:border-indigo-400 transition-all shadow-sm hover:shadow-md"
                        >
                            <svg className="w-4 h-4 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                            </svg>
                            <span className="text-xs font-medium text-gray-700 group-hover:text-indigo-700 transition-colors">Blog</span>
                            <svg className="w-3 h-3 text-gray-400 group-hover:text-indigo-500 transition-colors" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                            </svg>
                        </a>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default AnalysingAccount;
