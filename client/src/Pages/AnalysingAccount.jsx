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
                    console.warn("⚠️ SP API data fetch failed:", spApiError);
                    // Continue processing without SP API data
                }

                // Try to get analysis data
                try {
                    const response = await axios.get(
                        `${import.meta.env.VITE_BASE_URI}/app/analyse/getData`, { withCredentials: true }
                    );
                    
                    if (response && response.status === 200 && response.data?.data) {
                        console.log("✅ Raw API Response:", response.data.data);
                        hasAnyData = true;

                        // Process dashboard data with error handling
                        try {
                            dashboardData = analyseData(response.data.data).dashboardData;
                            console.log(dashboardData);
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
                            // Continue with partial data
                        }
                    } else {
                        console.warn("⚠️ Analysis data not available or invalid response");
                    }
                } catch (analysisError) {
                    console.error("❌ Analysis data fetch failed:", analysisError);
                }

                // Try to create account history only if we have dashboard data
                if (dashboardData) {
                    try {
                        const currentDate = new Date();
                        const expireDate = new Date();
                        expireDate.setDate(currentDate.getDate() + 7);
                        
                        const HistoryData = {
                            Date: currentDate,
                            HealthScore: dashboardData.accountHealthPercentage?.Percentage || 0,
                            TotalProducts: dashboardData.TotalProduct?.length || 0,
                            ProductsWithIssues: dashboardData.productWiseError?.length || 0,
                            TotalNumberOfIssues: 
                                (dashboardData.TotalRankingerrors || 0) + 
                                (dashboardData.totalErrorInConversion || 0) + 
                                (dashboardData.totalErrorInAccount || 0),
                            expireDate: expireDate
                        };

                        const CreateAccountHistory = await axios.post(
                            `${import.meta.env.VITE_BASE_URI}/app/accountHistory/addAccountHistory`, 
                            HistoryData, 
                            { withCredentials: true }
                        );

                        console.log(CreateAccountHistory);
                        if (CreateAccountHistory && CreateAccountHistory.status === 201) {
                            dispatch(setHistoryInfo(CreateAccountHistory.data.data));
                        }
                    } catch (historyError) {
                        console.error("❌ History creation failed:", historyError);
                        // Continue without history
                    }
                }

                // Navigate to dashboard even if some data is missing
                if (hasAnyData) {
                    navigate("/seller-central-checker/dashboard");
                } else {
                    console.error("❌ No data available, redirecting to error page");
                    navigate("/error/500");
                }

            } catch (error) {
                console.error("❌ Critical error while fetching data:", error);
                // Only redirect to error page if we have no data at all
                if (!hasAnyData) {
                    navigate("/error/500");
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
            </div>
        </div>
    );
};

export default AnalysingAccount;
