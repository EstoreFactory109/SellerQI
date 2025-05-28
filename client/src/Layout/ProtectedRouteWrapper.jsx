import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import { loginSuccess } from "../redux/slices/authSlice.js";
import { updateImageLink } from "../redux/slices/profileImage.js";
import { setDashboardInfo } from '../redux/slices/DashboardSlice.js';
import { setHistoryInfo } from '../redux/slices/HistorySlice.js';
import { setAllAccounts } from '../redux/slices/AllAccountsSlice.js';
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
      try {
        const response = await axiosInstance.get('/app/analyse/getData');

        // Check if component is still mounted
        if (!isMountedRef.current) return;

        let dashboardData = null;

        if (response?.status !== 200) {
          navigate(`/error/${response?.status}`);
          return;
        }

        dispatch(setAllAccounts(response.data.data.AllSellerAccounts));
        dashboardData = analyseData(response.data.data).dashboardData;
        dispatch(setDashboardInfo(dashboardData));

        const historyResponse = await axiosInstance.get('/app/accountHistory/getAccountHistory');

        // Check if component is still mounted
        if (!isMountedRef.current) return;

        if (historyResponse?.status === 200 && historyResponse.data?.data && dashboardData) {
          const historyList = historyResponse.data.data;
          
          // Add safety check for empty history list
          if (historyList.length === 0) {
            dispatch(setHistoryInfo([]));
            return;
          }
          
          const currentDate = new Date();
          const lastExpireDate = new Date(historyList[historyList.length - 1].expireDate);

          if (currentDate > lastExpireDate) {
            const expireDate = new Date();
            expireDate.setDate(currentDate.getDate() + 7);

            const newHistory = {
              Date: currentDate,
              HealthScore: dashboardData.accountHealthPercentage.Percentage,
              TotalProducts: dashboardData.TotalProduct.length,
              ProductsWithIssues: dashboardData.productWiseError.length,
              TotalNumberOfIssues:
                dashboardData.TotalRankingerrors +
                dashboardData.totalErrorInConversion +
                dashboardData.totalErrorInAccount,
              expireDate: expireDate
            };

            const updateRes = await axiosInstance.post(
              '/app/accountHistory/addAccountHistory',
              newHistory
            );

            if (isMountedRef.current && updateRes?.status === 200 && updateRes.data?.data) {
              dispatch(setHistoryInfo(updateRes.data.data));
            }
          } else {
            dispatch(setHistoryInfo(historyList));
          }
        }
      } catch (error) {
        console.error("❌ Data fetch failed:", error);
        if (isMountedRef.current) {
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
