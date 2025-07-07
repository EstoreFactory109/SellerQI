import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import { loginSuccess,addBrand } from "../redux/slices/authSlice.js";
import { updateImageLink } from "../redux/slices/profileImage.js";
import { setDashboardInfo } from '../redux/slices/DashboardSlice.js';
import { setHistoryInfo } from '../redux/slices/HistorySlice.js';
import { setAllAccounts } from '../redux/slices/AllAccountsSlice.js';
import { setProfitabilityErrorDetails, setSponsoredAdsErrorDetails } from '../redux/slices/errorsSlice.js';
import analyseData from '../operations/analyse.js';
import axiosInstance from '../config/axios.config.js';
import Loader from '../Components/Loader/Loader.jsx';

const ProtectedRouteWrapper = ({ children }) => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const isMountedRef = useRef(true);
  const hasCheckedAuthRef = useRef(false);

  const info = useSelector(state => state.Dashboard?.DashBoardInfo);

  const [showLoader, setShowLoader] = useState(true);

  useEffect(() => {
    // Cleanup function to track if component is still mounted
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    // Prevent multiple simultaneous auth checks
    if (hasCheckedAuthRef.current || isAuthenticating) {
      return;
    }

    const checkAuthAndFetchData = async () => {
      // Mark that we've started checking auth
      hasCheckedAuthRef.current = true;
      setIsAuthenticating(true);

      try {
        const response = await axiosInstance.get('/app/profile');

        // Check if component is still mounted before proceeding
        if (!isMountedRef.current) return;

        if (response?.status === 200 && response.data?.data) {
          const userData = response.data.data;

          dispatch(updateImageLink(userData.profilePic));
          dispatch(loginSuccess(userData));
          
          setAuthChecked(true);

          await fetchData();

          localStorage.setItem("isAuth", "true");
        } else {
          // Clear any stale auth data
          localStorage.removeItem("isAuth");
          navigate("/");
        }
      } catch (error) {
        console.error("❌ Auth check failed:", error);
        
        // Check if component is still mounted before navigating
        if (!isMountedRef.current) return;
        
        // Clear any stale auth data
        localStorage.removeItem("isAuth");
        
        // Only navigate if we haven't already
        if (isMountedRef.current) {
          navigate("/");
        }
      } finally {
        if (isMountedRef.current) {
          setIsAuthenticating(false);
        }
      }
    };

    const fetchData = async () => {
      let hasAnyData = false;
      let dashboardData = null;

      try {
        const response = await axiosInstance.get('/app/analyse/getData');

        // Check if component is still mounted
        if (!isMountedRef.current) return;

        // Handle different response scenarios gracefully
        if (response?.status === 200 && response.data?.data) {
          hasAnyData = true;
          
          // Set available data even if some parts are missing
          if (response.data.data.AllSellerAccounts) {
            dispatch(setAllAccounts(response.data.data.AllSellerAccounts));
          }
          
          if (response.data.data.Brand) {
            dispatch(addBrand(response.data.data.Brand));
          }
          
          // Process dashboard data even if incomplete
          try {
            dashboardData = analyseData(response.data.data).dashboardData;
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
            // Still continue with partial data
          }
        } else if (response?.status && response.status !== 200) {
          console.warn(`⚠️ Non-200 response: ${response.status}`);
          // Only redirect to error page if it's a critical error and no data is available
          if (response.status >= 500 && !hasAnyData) {
            navigate(`/error/${response.status}`);
            return;
          }
        }

        // Try to fetch history data independently
        try {
          const historyResponse = await axiosInstance.get('/app/accountHistory/getAccountHistory');

          // Check if component is still mounted
          if (!isMountedRef.current) return;

          if (historyResponse?.status === 200 && historyResponse.data?.data) {
            const historyList = historyResponse.data.data || [];
            
            // Handle empty history list gracefully
            if (historyList.length === 0) {
              dispatch(setHistoryInfo([]));
            } else if (dashboardData) {
              // Only update history if we have dashboard data
              const currentDate = new Date();
              const lastExpireDate = new Date(historyList[historyList.length - 1].expireDate);

              if (currentDate > lastExpireDate) {
                const expireDate = new Date();
                expireDate.setDate(currentDate.getDate() + 7);

                const newHistory = {
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

                try {
                  const updateRes = await axiosInstance.post(
                    '/app/accountHistory/addAccountHistory',
                    newHistory
                  );

                  if (isMountedRef.current && updateRes?.status === 200 && updateRes.data?.data) {
                    dispatch(setHistoryInfo(updateRes.data.data));
                  } else {
                    // Use existing history if update fails
                    dispatch(setHistoryInfo(historyList));
                  }
                } catch (historyUpdateError) {
                  console.error("❌ History update failed:", historyUpdateError);
                  // Use existing history if update fails
                  dispatch(setHistoryInfo(historyList));
                }
              } else {
                dispatch(setHistoryInfo(historyList));
              }
            } else {
              // Use existing history even without dashboard data
              dispatch(setHistoryInfo(historyList));
            }
          }
        } catch (historyError) {
          console.error("❌ History fetch failed:", historyError);
          // Continue without history data
        }

        // Only redirect to error page if absolutely no data is available
        if (!hasAnyData && !dashboardData) {
          console.error("❌ No data available, redirecting to error page");
          navigate("/error/500");
        }

      } catch (error) {
        console.error("❌ Data fetch failed:", error);
        
        // Only redirect to error page if we have no data at all
        if (!hasAnyData && isMountedRef.current) {
          navigate("/error/500");
        }
      }
    };

    checkAuthAndFetchData();
  }, []); // Empty dependency array to run only once on mount

  // Hide loader and show children immediately
  useEffect(() => {
    if (authChecked && info && Object.keys(info).length > 0) {
      const timer = setTimeout(() => {
        if (isMountedRef.current) {
          setShowLoader(false);
        }
      }, 500); // optional small delay for better UX
      
      // Cleanup timeout on unmount
      return () => clearTimeout(timer);
    }
  }, [authChecked, info]);

  return (
    <>
      {/* Loader */}
      <AnimatePresence>
        {showLoader && (
          <motion.div
            key="loader"
            initial={{ y: 0 }}
            animate={{ y: 0 }}
            exit={{ y: "-100%", transition: { duration: 1, ease: "easeInOut" } }}
            className="fixed top-0 left-0 w-full h-screen z-[9999] bg-white flex justify-center items-center"
          >
            <Loader />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Real Page */}
      {!showLoader && children}
    </>
  );
};

export default ProtectedRouteWrapper;
