import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import { loginSuccess } from "../redux/slices/authSlice.js";
import { updateImageLink } from "../redux/slices/profileImage.js";
import { setDashboardInfo } from '../redux/slices/DashboardSlice.js';
import { setHistoryInfo } from '../redux/slices/HistorySlice.js';
import { setAllAccounts } from '../redux/slices/AllAccountsSlice.js';
import analyseData from '../operations/analyse.js';
import axios from "axios";
import Loader from '../Components/Loader/Loader.jsx';

const ProtectedRouteWrapper = ({ children }) => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [authChecked, setAuthChecked] = useState(false);

  const info = useSelector(state => state.Dashboard?.DashBoardInfo);

  const [showLoader, setShowLoader] = useState(true);

  useEffect(() => {
    const checkAuthAndFetchData = async () => {
      try {
        const response = await axios.get(
          `${import.meta.env.VITE_BASE_URI}/app/profile`,
          { withCredentials: true }
        );

        if (response?.status === 200 && response.data?.data) {
          const userData = response.data.data;

          dispatch(updateImageLink(userData.profilePic));
          dispatch(loginSuccess(userData));

          setAuthChecked(true);

          await fetchData(); 
        } else {
          navigate("/");
        }
      } catch (error) {
        console.error("❌ Auth check failed:", error);
        navigate("/");
      }
    };

    const fetchData = async () => {
      try {
        console.log("🟡 Fetching Dashboard & History Data...");

        const response = await axios.get(
          `${import.meta.env.VITE_BASE_URI}/app/analyse/getData`,
          { withCredentials: true }
        );

        let dashboardData = null;
        if (response?.status === 200 && response.data?.data) {
          dispatch(setAllAccounts(response.data.data.AllSellerAccounts));
          dashboardData = analyseData(response.data.data).dashboardData;
          dispatch(setDashboardInfo(dashboardData));
        }

        const historyResponse = await axios.get(
          `${import.meta.env.VITE_BASE_URI}/app/accountHistory/getAccountHistory`,
          { withCredentials: true }
        );

        if (historyResponse?.status === 200 && historyResponse.data?.data && dashboardData) {
          const historyList = historyResponse.data.data;
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

            const updateRes = await axios.post(
              `${import.meta.env.VITE_BASE_URI}/app/accountHistory/addAccountHistory`,
              newHistory,
              { withCredentials: true }
            );

            if (updateRes?.status === 200 && updateRes.data?.data) {
              dispatch(setHistoryInfo(updateRes.data.data));
            }
          } else {
            dispatch(setHistoryInfo(historyList));
          }
        }
      } catch (error) {
        console.error("❌ Error fetching dashboard/history:", error);
      }
    };

    checkAuthAndFetchData();
  }, [dispatch, navigate]);

  // Hide loader and show children immediately
  useEffect(() => {
    if (authChecked && info && Object.keys(info).length > 0) {
      setTimeout(() => {
        setShowLoader(false);
      }, 500); // optional small delay for better UX
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
