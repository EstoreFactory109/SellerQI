import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDispatch } from "react-redux";
import { setDashboardInfo } from '../redux/slices/DashboardSlice.js'
import { setHistoryInfo } from '../redux/slices/HistorySlice.js'
import { setProfitabilityErrorDetails, setSponsoredAdsErrorDetails } from '../redux/slices/errorsSlice.js'
import analyseData from "../operations/analyse.js"
import { createDefaultDashboardData, isEmptyDashboardData } from '../utils/defaultDataStructure.js'

// Custom animated pulse loader for long processes
const PulseLoader = () => {
    return (
        <div className="relative w-20 h-20">
            {/* Outer ring */}
            <motion.div
                className="absolute inset-0 rounded-full border-4 border-white/30"
                animate={{ 
                    scale: [1, 1.2, 1],
                    opacity: [0.7, 0.3, 0.7]
                }}
                transition={{ 
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut"
                }}
            />
            {/* Middle ring */}
            <motion.div
                className="absolute inset-2 rounded-full border-4 border-white/50"
                animate={{ 
                    scale: [1, 1.15, 1],
                    opacity: [0.8, 0.4, 0.8]
                }}
                transition={{ 
                    duration: 2.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: 0.5
                }}
            />
            {/* Inner core */}
            <motion.div
                className="absolute inset-4 rounded-full bg-white/80"
                animate={{ 
                    scale: [1, 1.1, 1],
                    opacity: [1, 0.6, 1]
                }}
                transition={{ 
                    duration: 2,
                    repeat: Infinity,
                    ease: "easeInOut",
                    delay: 1
                }}
            />
            {/* Center dot */}
            <div className="absolute inset-6 rounded-full bg-white"></div>
        </div>
    );
};

const AnalysingAccount = () => {
    const [showAccessText, setShowAccessText] = useState(true);
    const [currentPhase, setCurrentPhase] = useState(0);
    const [timeElapsed, setTimeElapsed] = useState(0);
    const navigate = useNavigate();

    const dispatch = useDispatch();

    const analysisPhases = [
        {
            title: "Initializing Analysis",
            description: "Setting up your account analysis workspace...",
            estimatedDuration: "5-10 minutes"
        },
        {
            title: "Data Collection",
            description: "Gathering comprehensive account data from Amazon...",
            estimatedDuration: "15-25 minutes"
        },
        {
            title: "Performance Analysis",
            description: "Analyzing product performance and sales metrics...",
            estimatedDuration: "10-15 minutes"
        },
        {
            title: "Advertising Evaluation",
            description: "Deep-diving into sponsored ads performance...",
            estimatedDuration: "15-20 minutes"
        },
        {
            title: "Profitability Assessment",
            description: "Calculating margins, fees, and profit analysis...",
            estimatedDuration: "10-15 minutes"
        },
        {
            title: "Optimization Insights",
            description: "Generating personalized recommendations...",
            estimatedDuration: "5-10 minutes"
        }
    ];

    useEffect(() => {
        // Toggle between main message variations every 4 seconds
        const interval = setInterval(() => {
            setShowAccessText((prev) => !prev);
        }, 4000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        // Change phase every 12 minutes to simulate real progress
        const phaseInterval = setInterval(() => {
            setCurrentPhase((prev) => (prev + 1) % analysisPhases.length);
        }, 12 * 60 * 1000); // 12 minutes
        return () => clearInterval(phaseInterval);
    }, []);

    useEffect(() => {
        // Update elapsed time every minute
        const timeInterval = setInterval(() => {
            setTimeElapsed((prev) => prev + 1);
        }, 60000); // 1 minute
        return () => clearInterval(timeInterval);
    }, []);

    // Format elapsed time
    const formatElapsedTime = (minutes) => {
        if (minutes < 60) {
            return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        }
        const hours = Math.floor(minutes / 60);
        const remainingMinutes = minutes % 60;
        return `${hours} hour${hours !== 1 ? 's' : ''} ${remainingMinutes > 0 ? `${remainingMinutes} minute${remainingMinutes !== 1 ? 's' : ''}` : ''}`;
    };

    useEffect(() => {
        (async () => {
            let hasAnyData = false;
            let dashboardData = null;

            try {
                // Try to get SP API data, but don't fail if it's not available
                try {
                    const getSPAPIData = await axios.get(`${import.meta.env.VITE_BASE_URI}/app/info/getSpApiData`, { withCredentials: true });
                    
                    if (getSPAPIData && getSPAPIData.status !== 200) {
                        console.warn(`⚠️ SP API data not available: ${getSPAPIData.status}`);
                        // Only redirect to error page for critical server errors
                        if (getSPAPIData.status >= 500) {
                            navigate(`/error/${getSPAPIData.status}`);
                            return;
                        }
                    }
                } catch (spApiError) {
                    console.warn("⚠️ data fetch failed:", spApiError);
                    // Continue processing without SP API data
                }

                // Try to get analysis data
                try {
                    const response = await axios.get(
                        `${import.meta.env.VITE_BASE_URI}/app/analyse/getData`, { withCredentials: true }
                    );
                    
                    console.log("=== AnalysingAccount: Data fetch response ===");
                    console.log("Response status:", response?.status);
                    console.log("Response data:", response?.data);
                    
                    if (response && response.status === 200) {
                        // Process dashboard data - analyseData will handle empty data gracefully
                        try {
                            dashboardData = analyseData(response.data?.data || {}).dashboardData;
                            console.log("Dashboard data processed:", dashboardData);
                            
                            // Check if we got empty data or actual data
                            if (isEmptyDashboardData(dashboardData)) {
                                console.log("⚠️ Account has no data available - will show zero data instead of error");
                                hasAnyData = false;
                            } else {
                                console.log("✅ Account has data available");
                                hasAnyData = true;
                            }
                            
                            // Always dispatch the dashboard data (either real data or empty structure)
                            dispatch(setDashboardInfo(dashboardData));
                            
                            // Dispatch error details if available
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
                        } catch (analyseError) {
                            console.error("❌ Error processing dashboard data:", analyseError);
                            // Create default data structure if analysis fails
                            console.log("⚠️ Analysis failed - providing default empty data structure");
                            dashboardData = createDefaultDashboardData();
                            dispatch(setDashboardInfo(dashboardData));
                            hasAnyData = false;
                        }
                    } else if (response?.status === 404 || response?.status === 204) {
                        console.log("⚠️ Account not found or no content - providing empty data structure");
                        dashboardData = createDefaultDashboardData();
                        dispatch(setDashboardInfo(dashboardData));
                        hasAnyData = false;
                    } else {
                        console.warn("⚠️ Analysis data not available or invalid response");
                        dashboardData = createDefaultDashboardData();
                        dispatch(setDashboardInfo(dashboardData));
                        hasAnyData = false;
                    }
                } catch (analysisError) {
                    console.error("❌ Analysis data fetch failed:", analysisError);
                    // Create default data structure instead of failing
                    console.log("⚠️ Data fetch error - providing default empty data structure");
                    dashboardData = createDefaultDashboardData();
                    dispatch(setDashboardInfo(dashboardData));
                    hasAnyData = false;
                }

                // Try to create account history only if we have dashboard data
                if (dashboardData) {
                    try {
                        const currentDate = new Date();
                        const expireDate = new Date();
                        expireDate.setDate(currentDate.getDate() + 7);
                        
                        // Calculate total issues using EXACT SAME formula as Dashboard Total Issues box
                        // Source: Dashboard.jsx lines 143-149 - const totalIssues = (dashboardInfo?.totalProfitabilityErrors || 0) + ...
                        const profitabilityErrors = dashboardData.totalProfitabilityErrors || 0;
                        const sponsoredAdsErrors = dashboardData.totalSponsoredAdsErrors || 0;
                        const inventoryErrors = dashboardData.totalInventoryErrors || 0;
                        const rankingErrors = dashboardData.TotalRankingerrors || 0;
                        const conversionErrors = dashboardData.totalErrorInConversion || 0;
                        const accountErrors = dashboardData.totalErrorInAccount || 0;
                        
                        // IDENTICAL calculation to Dashboard's totalIssues
                        const totalCalculatedIssues = profitabilityErrors + sponsoredAdsErrors + inventoryErrors + 
                                                    rankingErrors + conversionErrors + accountErrors;

                        console.log("🔍 ACCOUNT HISTORY TOTAL ISSUES BREAKDOWN (DASHBOARD ORDER):");
                        console.log("  • Profitability Errors:", profitabilityErrors);
                        console.log("  • Sponsored Ads Errors:", sponsoredAdsErrors);
                        console.log("  • Inventory Errors:", inventoryErrors);
                        console.log("  • Ranking Errors:", rankingErrors);
                        console.log("  • Conversion Errors:", conversionErrors);
                        console.log("  • Account Errors:", accountErrors);
                        console.log("  • TOTAL ISSUES (MATCHES DASHBOARD):", totalCalculatedIssues);
                        
                        const HistoryData = {
                            Date: currentDate,
                            HealthScore: dashboardData.accountHealthPercentage?.Percentage || 0,
                            TotalProducts: dashboardData.TotalProduct?.length || 0,
                            ProductsWithIssues: dashboardData.productWiseError?.length || 0,
                            TotalNumberOfIssues: totalCalculatedIssues,
                            expireDate: expireDate
                        };

                        const CreateAccountHistory = await axios.post(
                            `${import.meta.env.VITE_BASE_URI}/app/accountHistory/addAccountHistory`, 
                            HistoryData, 
                            { withCredentials: true }
                        );

                        console.log("🔍 ACCOUNT HISTORY CREATION IN ANALYSINGACCOUNT:");
                        console.log("History Data Being Sent:", HistoryData);
                        console.log("Account History Creation Response:", CreateAccountHistory);
                        console.log("Account History Created Data:", CreateAccountHistory?.data?.data);
                        
                        if (CreateAccountHistory && CreateAccountHistory.status === 201) {
                            dispatch(setHistoryInfo(CreateAccountHistory.data.data));
                        }
                    } catch (historyError) {
                        console.error("❌ History creation failed:", historyError);
                        // Continue without history
                    }
                }

                // Always navigate to dashboard - it will handle displaying zero data gracefully
                console.log("✅ Navigating to dashboard...");
                navigate("/seller-central-checker/dashboard");

            } catch (error) {
                console.error("❌ Critical error while fetching data:", error);
                
                // Create default data structure and navigate to dashboard even on error
                // This ensures accounts with no data can still access the dashboard
                if (!dashboardData) {
                    console.log("⚠️ Critical error - providing default empty data structure");
                    dashboardData = createDefaultDashboardData();
                    dispatch(setDashboardInfo(dashboardData));
                }
                
                // Only redirect for authentication errors (not data availability)
                if (error.response?.status === 401) {
                    console.error("❌ Authentication error, redirecting to login");
                    navigate("/");
                } else {
                    console.log("✅ Navigating to dashboard with empty data after error");
                    navigate("/seller-central-checker/dashboard");
                }
            }
        })();
    }, []);

    return (
        <div className="min-h-screen w-full bg-gray-50/50 flex items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6 }}
                className="max-w-3xl w-full"
            >
                {/* Main Analysis Card */}
                <div className="bg-white rounded-xl border border-gray-200/80 shadow-lg overflow-hidden">
                    {/* Header with gradient */}
                    <div className="bg-gradient-to-r from-blue-600 to-indigo-600 p-8 text-white text-center">
                        <div className="flex items-center justify-center mb-6">
                            <PulseLoader />
                        </div>
                        
                        <motion.div
                            key={showAccessText ? "main" : "sub"}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.8 }}
                        >
                            {showAccessText ? (
                                <div>
                                    <h1 className="text-3xl font-bold mb-3">Deep Analysis in Progress</h1>
                                    <p className="text-blue-100 text-lg">Comprehensive account analysis is running in the background</p>
                                </div>
                            ) : (
                                <div>
                                    <h1 className="text-3xl font-bold mb-3">Processing Complete Dataset</h1>
                                    <p className="text-blue-100 text-lg">This process typically takes 60-90 minutes to complete</p>
                                </div>
                            )}
                        </motion.div>
                        
                        {/* Time Elapsed */}
                        {timeElapsed > 0 && (
                            <div className="mt-4 text-blue-200 text-sm">
                                Running for: {formatElapsedTime(timeElapsed)}
                            </div>
                        )}
                    </div>

                    {/* Content */}
                    <div className="p-8">
                        {/* PROMINENT Safe to Close Notice - MOVED TO TOP */}
                        <div className="mb-8 bg-green-50 border-2 border-green-300 rounded-xl p-6 shadow-sm">
                            <div className="flex items-start gap-4">
                                <div className="flex-shrink-0 w-12 h-12 bg-green-100 rounded-full flex items-center justify-center">
                                    <svg className="w-6 h-6 text-green-600" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <div className="flex-1">
                                    <h4 className="text-lg font-bold text-green-900 mb-2">
                                        ✅ Safe to Close This Tab
                                    </h4>
                                    <p className="text-green-800 leading-relaxed mb-3">
                                        <strong>Your analysis is running in the background and will continue even if you close this tab.</strong> 
                                        Feel free to close your browser and come back in 1-2 hours. We'll send you an email notification 
                                        when your comprehensive dashboard is ready.
                                    </p>
                                    <div className="text-sm text-green-700 bg-green-100 rounded-lg p-3">
                                        💡 <strong>Tip:</strong> Bookmark this page or save your login details to easily return later.
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Estimated Time Notice */}
                        <div className="mb-8 bg-amber-50 border border-amber-200 rounded-lg p-4">
                            <div className="flex items-start gap-3">
                                <div className="flex-shrink-0 w-8 h-8 bg-amber-100 rounded-full flex items-center justify-center">
                                    <svg className="w-5 h-5 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
                                    </svg>
                                </div>
                                <div className="flex-1">
                                    <h4 className="text-sm font-semibold text-amber-900 mb-1">
                                        Estimated Processing Time: 60-90 minutes
                                    </h4>
                                    <p className="text-sm text-amber-800 leading-relaxed">
                                        We're performing a comprehensive analysis of your entire Amazon account. This includes processing 
                                        historical data, performance metrics, and generating detailed insights.
                                    </p>
                                </div>
                            </div>
                        </div>

                        {/* Current Phase */}
                        <div className="mb-8">
                            <motion.div
                                key={currentPhase}
                                initial={{ opacity: 0, x: 20 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ duration: 0.5 }}
                                className="p-6 bg-blue-50 rounded-lg border border-blue-100"
                            >
                                <div className="flex items-start gap-4">
                                    <div className="flex-shrink-0 w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                                        <motion.div 
                                            className="w-3 h-3 bg-blue-600 rounded-full"
                                            animate={{ 
                                                scale: [1, 1.3, 1],
                                                opacity: [0.7, 1, 0.7]
                                            }}
                                            transition={{ 
                                                duration: 2,
                                                repeat: Infinity,
                                                ease: "easeInOut"
                                            }}
                                        />
                                    </div>
                                    <div className="flex-1">
                                        <h3 className="text-lg font-semibold text-blue-900 mb-2">
                                            Phase {currentPhase + 1}: {analysisPhases[currentPhase].title}
                                        </h3>
                                        <p className="text-blue-800 mb-2">{analysisPhases[currentPhase].description}</p>
                                        <div className="text-sm text-blue-600">
                                            Estimated duration: {analysisPhases[currentPhase].estimatedDuration}
                                        </div>
                                    </div>
                                </div>
                            </motion.div>
                        </div>

                        {/* Analysis Activity Indicator */}
                        <div className="mb-8">
                            <div className="flex justify-between items-center mb-6">
                                <h3 className="text-lg font-semibold text-gray-900">Analysis Phases</h3>
                                <span className="text-sm text-gray-600">Phase {currentPhase + 1} of {analysisPhases.length}</span>
                            </div>
                            
                            {/* Animated Dots Indicator */}
                            <div className="flex items-center justify-center gap-3 mb-4">
                                {analysisPhases.map((_, index) => (
                                    <motion.div
                                        key={index}
                                        className={`w-3 h-3 rounded-full ${
                                            index <= currentPhase 
                                                ? 'bg-blue-600' 
                                                : index === currentPhase + 1 
                                                    ? 'bg-blue-300' 
                                                    : 'bg-gray-300'
                                        }`}
                                        animate={
                                            index === currentPhase
                                                ? {
                                                    scale: [1, 1.3, 1],
                                                    opacity: [0.7, 1, 0.7]
                                                }
                                                : index === currentPhase + 1
                                                    ? {
                                                        scale: [1, 1.1, 1],
                                                        opacity: [0.5, 0.8, 0.5]
                                                    }
                                                    : {}
                                        }
                                        transition={{
                                            duration: 2,
                                            repeat: Infinity,
                                            ease: "easeInOut"
                                        }}
                                    />
                                ))}
                            </div>
                            
                            {/* Continuous Activity Wave */}
                            <div className="relative h-1 bg-gray-200 rounded-full overflow-hidden">
                                <motion.div
                                    className="absolute top-0 left-0 h-full w-20 bg-gradient-to-r from-transparent via-blue-500 to-transparent"
                                    animate={{
                                        x: [-80, 320]
                                    }}
                                    transition={{
                                        duration: 3,
                                        repeat: Infinity,
                                        ease: "easeInOut"
                                    }}
                                />
                            </div>
                            
                            <div className="mt-3 text-center text-sm text-gray-600">
                                Continuous background processing active
                            </div>
                        </div>



                        {/* What's Being Analyzed - Expanded */}
                        <div className="bg-gray-50 rounded-lg p-6">
                            <h4 className="text-lg font-semibold text-gray-900 mb-4">Comprehensive Analysis Includes:</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-gray-700">
                                <div className="flex items-start gap-3 p-3 bg-white rounded-lg">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                                    <div>
                                        <div className="font-medium text-gray-900">Product Performance</div>
                                        <div className="text-gray-600">Sales trends, ranking analysis, conversion rates</div>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 p-3 bg-white rounded-lg">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                                    <div>
                                        <div className="font-medium text-gray-900">Sponsored Ads Deep Dive</div>
                                        <div className="text-gray-600">Campaign optimization, keyword analysis, ACOS evaluation</div>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 p-3 bg-white rounded-lg">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                                    <div>
                                        <div className="font-medium text-gray-900">Profitability Assessment</div>
                                        <div className="text-gray-600">Margin analysis, fee calculations, profit optimization</div>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 p-3 bg-white rounded-lg">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                                    <div>
                                        <div className="font-medium text-gray-900">Inventory Intelligence</div>
                                        <div className="text-gray-600">Stock levels, restock recommendations, FBA analysis</div>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 p-3 bg-white rounded-lg">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                                    <div>
                                        <div className="font-medium text-gray-900">Market Position</div>
                                        <div className="text-gray-600">Competitive analysis, ranking opportunities</div>
                                    </div>
                                </div>
                                <div className="flex items-start gap-3 p-3 bg-white rounded-lg">
                                    <div className="w-2 h-2 bg-blue-500 rounded-full mt-2"></div>
                                    <div>
                                        <div className="font-medium text-gray-900">Account Health Score</div>
                                        <div className="text-gray-600">Overall performance metrics and recommendations</div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </motion.div>
        </div>
    );
};

export default AnalysingAccount;
