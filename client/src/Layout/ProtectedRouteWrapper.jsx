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
import { coordinatedAuthCheck } from '../utils/authCoordinator.js';
import Loader from '../Components/Loader/Loader.jsx';

const ProtectedRouteWrapper = ({ children }) => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const isMountedRef = useRef(true);
  const hasCheckedAuthRef = useRef(false);

  const info = useSelector(state => state.Dashboard?.DashBoardInfo);
  const userData = useSelector(state => state.Auth?.user);

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
        const result = await coordinatedAuthCheck();

        // Check if component is still mounted before proceeding
        if (!isMountedRef.current) return;

        if (result.isAuthenticated && result.user) {
          const userData = result.user;
         

          dispatch(updateImageLink(userData.profilePic));
          dispatch(loginSuccess(userData));
          
          // Check subscription status before allowing access to protected routes
          const hasSelectedPlan = userData.packageType; // User has selected any plan (including LITE)
          const subscriptionStatus = userData.subscriptionStatus;
          
          if (!hasSelectedPlan) {
            // User hasn't selected any plan, redirect to pricing
            localStorage.setItem("isAuth", "true"); // Keep them logged in
            navigate("/pricing");
            return;
          } else if (subscriptionStatus && ['inactive', 'cancelled', 'past_due'].includes(subscriptionStatus) && userData.packageType !== 'LITE') {
            // User has a paid plan but subscription is explicitly inactive, redirect to pricing
            // LITE users can access dashboard even with cancelled status since it's free
            localStorage.setItem("isAuth", "true"); // Keep them logged in
            navigate("/pricing");
            return;
          }
          
          // All users with selected plans (LITE, PRO, AGENCY) can access dashboard
          // But with different feature restrictions based on their plan
          
          setAuthChecked(true);

          await fetchData(userData);

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

    const fetchData = async (freshUserData) => {
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
            console.log("userData in ProtectedRouteWrapper: ", freshUserData)
            dashboardData = (await analyseData(response.data?.data || {}, freshUserData?.userId)).dashboardData;
            console.log("dashboardData: ",dashboardData)
            
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
            dispatch(setHistoryInfo(historyList));
          } else {
            dispatch(setHistoryInfo([]));
          }
        } catch (historyError) {
          console.error("❌ History fetch failed:", historyError);
          // Continue without history data
          dispatch(setHistoryInfo([]));
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
