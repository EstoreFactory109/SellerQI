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
            try {

                const getSPAPIData = await axios.get(`${import.meta.env.VITE_BASE_URI}/app/info/getSpApiData`, { withCredentials: true });

                if (!getSPAPIData && !getSPAPIData.status === 200) {
                    navigate(`/error/${getSPAPIData.status}`)
                }



                const response = await axios.get(
                    `${import.meta.env.VITE_BASE_URI}/app/analyse/getData`, { withCredentials: true }
                );
                let dashboardData = null;
                if (response && response.status === 200) {
                    console.log("✅ Raw API Response:", response.data.data);

                    dashboardData = analyseData(response.data.data).dashboardData;
                    console.log(dashboardData)
                    dispatch(setDashboardInfo(dashboardData));
                    
                    // Also dispatch error details to the errors slice
                    dispatch(setProfitabilityErrorDetails({
                        totalErrors: dashboardData.totalProfitabilityErrors,
                        errorDetails: dashboardData.profitabilityErrorDetails
                    }));
                    dispatch(setSponsoredAdsErrorDetails({
                        totalErrors: dashboardData.totalSponsoredAdsErrors,
                        errorDetails: dashboardData.sponsoredAdsErrorDetails
                    }));

                }


                const currentDate = new Date();
                const expireDate = new Date();
                expireDate.setDate(currentDate.getDate() + 7);
                const HistoryData = {
                    Date: currentDate,
                    HealthScore: dashboardData.accountHealthPercentage.Percentage,
                    TotalProducts: dashboardData.TotalProduct.length,
                    ProductsWithIssues: dashboardData.productWiseError.length,
                    TotalNumberOfIssues: dashboardData.TotalRankingerrors + dashboardData.totalErrorInConversion + dashboardData.totalErrorInAccount,
                    expireDate: expireDate
                }

                const CreateAccountHistory = await axios.post(`${import.meta.env.VITE_BASE_URI}/app/accountHistory/addAccountHistory`, HistoryData, { withCredentials: true });

                console.log(CreateAccountHistory);
                if (CreateAccountHistory && CreateAccountHistory.status === 201) {
                    dispatch(setHistoryInfo(CreateAccountHistory.data.data));
                }
                navigate("/seller-central-checker/dashboard");

            } catch (error) {
                console.log("❌ Error while fetching data:", error);
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
