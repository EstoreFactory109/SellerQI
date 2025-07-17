import React, { useEffect, useState } from "react";
import { motion } from "framer-motion";
import RingLoader from "react-spinners/RingLoader";
import axios from "axios";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useDispatch } from "react-redux";
import { setDashboardInfo } from '../redux/slices/DashboardSlice.js'
import { setHistoryInfo } from '../redux/slices/HistorySlice.js'
import { setProfitabilityErrorDetails, setSponsoredAdsErrorDetails } from '../redux/slices/errorsSlice.js'
import analyseData from "../operations/analyse.js"
import { createDefaultDashboardData, isEmptyDashboardData } from '../utils/defaultDataStructure.js'


const AnalysingAccount = () => {
    const [showAccessText, setShowAccessText] = useState(true);
    const navigate = useNavigate();

    const dispatch = useDispatch();

    useEffect(() => {
        // Toggle between "Analysing..." and "Please Wait"
        const interval = setInterval(() => {
            setShowAccessText((prev) => !prev);
        }, 2000);
        return () => clearInterval(interval);
    }, []);

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
        <div className="w-full h-[100vh] flex flex-col justify-center items-center">
            <RingLoader color="#5c5e92" size={100} />
            <div className="mt-4 text-center">
                {showAccessText ? (
                    <motion.p
                        key="access-text"
                        className="text-lg font-semibold text-gray-800"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.8 }}
                    >
                        Analysing Your Account...
                    </motion.p>
                ) : (
                    <motion.p
                        key="wait-text"
                        className="text-md text-gray-600"
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        transition={{ duration: 0.8 }}
                    >
                        Please Wait
                    </motion.p>
                )}
            </div>//div
        </div>
    );
};

export default AnalysingAccount;
