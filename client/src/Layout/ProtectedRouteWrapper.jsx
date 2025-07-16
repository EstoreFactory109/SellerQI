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
import { createDefaultDashboardData, isEmptyDashboardData } from '../utils/defaultDataStructure.js';
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

        console.log("=== ProtectedRouteWrapper: Data fetch response ===");
        console.log("Response status:", response?.status);
        console.log("Response data:", response?.data);

        // Handle different response scenarios gracefully
        if (response?.status === 200) {
          // Set available account and brand data if present
          if (response.data?.data?.AllSellerAccounts) {
            dispatch(setAllAccounts(response.data.data.AllSellerAccounts));
          }
          
          if (response.data?.data?.Brand) {
            dispatch(addBrand(response.data.data.Brand));
          }
          
          // Process dashboard data - analyseData will now handle empty data gracefully
          try {
            dashboardData = analyseData(response.data?.data || {}).dashboardData;
            
            // Check if we got empty data or actual data
            if (isEmptyDashboardData(dashboardData)) {
              console.log("⚠️ Account has no data available - showing zero data instead of error");
              hasAnyData = false; // This will be used for loader logic but not redirect
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
        } else if (response?.status && response.status !== 200) {
          console.warn(`⚠️ Non-200 response: ${response.status}`);
          // For accounts with no data, don't redirect to error page
          // Instead, provide empty data structure
          if (response.status === 404 || response.status === 204) {
            console.log("⚠️ Account not found or no content - providing empty data structure");
            dashboardData = createDefaultDashboardData();
            dispatch(setDashboardInfo(dashboardData));
            hasAnyData = false;
          } else if (response.status >= 500) {
            // Only redirect for server errors (not data availability issues)
            console.error("❌ Server error detected, redirecting to error page");
            navigate(`/error/${response.status}`);
            return;
          }
        } else {
          // No response or invalid response - provide empty data
          console.log("⚠️ No valid response - providing empty data structure");
          dashboardData = createDefaultDashboardData();
          dispatch(setDashboardInfo(dashboardData));
          hasAnyData = false;
        }

        // Try to fetch history data independently
        try {
          const historyResponse = await axiosInstance.get('/app/accountHistory/getAccountHistory');

          // Check if component is still mounted
          if (!isMountedRef.current) return;

          console.log("🔍 ACCOUNT HISTORY DATA FETCHED IN PROTECTEDROUTEWRAPPER:");
          console.log("Response Status:", historyResponse?.status);
          console.log("Account History Data:", historyResponse?.data?.data);

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

                const newHistory = {
                  Date: currentDate,
                  HealthScore: dashboardData.accountHealthPercentage?.Percentage || 0,
                  TotalProducts: dashboardData.TotalProduct?.length || 0,
                  ProductsWithIssues: dashboardData.productWiseError?.length || 0,
                  TotalNumberOfIssues: totalCalculatedIssues,
                  expireDate: expireDate
                };

                try {
                  const updateRes = await axiosInstance.post(
                    '/app/accountHistory/addAccountHistory',
                    newHistory
                  );

                  console.log("🔍 ACCOUNT HISTORY UPDATE IN PROTECTEDROUTEWRAPPER:");
                  console.log("New History Data Being Sent:", newHistory);
                  console.log("Update Response:", updateRes);
                  console.log("Updated Account History Data:", updateRes?.data?.data);

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

        // Don't redirect to error page for accounts with no data
        // The dashboard components will handle displaying zero data gracefully
        if (!dashboardData) {
          console.log("⚠️ No dashboard data structure available - creating default empty structure");
          dashboardData = createDefaultDashboardData();
          dispatch(setDashboardInfo(dashboardData));
        }

      } catch (error) {
        console.error("❌ Data fetch failed:", error);
        
        // Check if component is still mounted
        if (!isMountedRef.current) return;
        
        // Create default data structure instead of redirecting to error page
        // This ensures accounts with no data can still access the dashboard
        console.log("⚠️ Data fetch error - providing default empty data structure instead of error page");
        dashboardData = createDefaultDashboardData();
        dispatch(setDashboardInfo(dashboardData));
        hasAnyData = false;
        
        // Only redirect for critical authentication errors (not data availability)
        if (error.response?.status === 401) {
          console.error("❌ Authentication error, redirecting to login");
          navigate("/");
        }
      }
    };

    checkAuthAndFetchData();
  }, []); // Empty dependency array to run only once on mount

  // Hide loader when authentication is complete and we have dashboard data (even if empty)
  useEffect(() => {
    if (authChecked && info) {
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
