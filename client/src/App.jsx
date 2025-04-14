import React, { useEffect, useState } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { Routes, Route, useLocation } from 'react-router-dom';
import axios from 'axios';

import Signup from './Pages/SignUp.jsx';
import Login from './Pages/Login.jsx';
import EmailVerification from './Pages/EmailVerification.jsx';
import ConnectToAmazon from './Pages/ConnectToAmazon.jsx';
import FetchingTokens from './Pages/FetchingTokens.jsx';
import AnalysingAccount from './Pages/AnalysingAccount.jsx';

import MainLayout from './Layout/MainPagesLayout.jsx';
import DashBoard from './Pages/Dashboard.jsx';
import Issues from './Pages/Issues.jsx';
import Reports from './Pages/Reports.jsx';
import AccountHistory from './Pages/Account.jsx';
import Settings from './Pages/Settings.jsx';
import IssuesByProducts from './Pages/IssuesByProduct.jsx'

import Loader from './Components/Loader/Loader.jsx';
import analyseData from './operations/analyse.js';
import { setDashboardInfo } from './redux/slices/DashboardSlice.js';
import { setHistoryInfo } from './redux/slices/HistorySlice.js';
import { loginSuccess } from './redux/slices/authSlice.js'

const App = () => {
  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  const dispatch = useDispatch();
  const location = useLocation();

  const isSellerCheckerRoute = location.pathname.startsWith('/seller-central-checker');

  const [showLoader, setShowLoader] = useState(isSellerCheckerRoute); // Start loader if on dashboard

  useEffect(() => {
    (async () => {
      try {
        const response = await axios.get(
          `${import.meta.env.VITE_BASE_URI}/app/profile`, { withCredentials: true }

        );

        if (response?.status === 200 && response.data?.data) {
          dispatch(loginSuccess(response.data.data));
        }
      } catch (error) {
        throw new Error(error)
      }
    })()

  }, []);

  useEffect(() => {
    const fetchData = async () => {
      try {

        const response = await axios.get(
          `${import.meta.env.VITE_BASE_URI}/app/analyse/getData`, { withCredentials: true }

        );


        let dashboardData = null;
        if (response?.status === 200 && response.data?.data) {
          dashboardData = analyseData(response.data.data).dashboardData;

          console.log(dashboardData)
          dispatch(setDashboardInfo(dashboardData));
        }

        const historyResponse = await axios.get(
          `${import.meta.env.VITE_BASE_URI}/app/accountHistory/getAccountHistory`,
          { withCredentials: true }
        );

        if (historyResponse?.status === 200 && historyResponse.data?.data) {

          const currentDate = new Date();
          const expireDate = new Date();
          expireDate.setDate(currentDate.getDate() + 7);

          if (currentDate > historyResponse.data.data[historyResponse.data.data.length - 1].expireDate) {
            const HistoryData = {
              Date: currentDate,
              HealthScore: dashboardData.accountHealthPercentage.Percentage,
              TotalProducts: dashboardData.TotalProduct.length,
              ProductsWithIssues: dashboardData.productWiseError.length,
              TotalNumberOfIssues: dashboardData.TotalRankingerrors + dashboardData.totalErrorInConversion + dashboardData.totalErrorInAccount,
              expireDate: expireDate
            }
            const UpdateHistory = await axios.post(
              `${import.meta.env.VITE_BASE_URI}/app/accountHistory/addAccountHistory`, HistoryData, { withCredentials: true }
            )


            if (UpdateHistory?.status === 200 && UpdateHistory.data?.data) {
      
              dispatch(setHistoryInfo(UpdateHistory.data.data));
            }
          } else {

            dispatch(setHistoryInfo(historyResponse.data.data));
          }


        }
        console.log(historyResponse.data)

      } catch (error) {
        console.error('❌ Error while fetching data:', error);
      }
    };

    // Only fetch if you're in the dashboard AND info is empty
    if (isSellerCheckerRoute && (!info || Object.keys(info).length === 0)) {
      fetchData();
    }
  }, [isSellerCheckerRoute, dispatch]);

  useEffect(() => {
    // Hide loader only when info is available
    if (isSellerCheckerRoute && info && Object.keys(info).length > 0) {
      setTimeout(() => setShowLoader(false), 1000); // Let slide-up happen
    }
  }, [info, isSellerCheckerRoute]);

  return (
    <>
      {/* Always render loader in dashboard section */}
      {isSellerCheckerRoute && <Loader isVisible={showLoader} />}

      {/* Block rendering seller routes until loader completes */}
      {(!isSellerCheckerRoute || !showLoader) && (
        <Routes>
          <Route path='/' element={<Login />} />
          <Route path='/sign-up' element={<Signup />} />
          <Route path='/verify-email' element={<EmailVerification />} />
          <Route path='/connect-to-amazon' element={<ConnectToAmazon />} />
          <Route path='/account-access' element={<FetchingTokens />} />
          <Route path='/analyse-account' element={<AnalysingAccount />} />


            <Route path='/seller-central-checker' element={<MainLayout />}>
              <Route path='dashboard' element={<DashBoard />} />
              <Route path='issues' element={<Issues />} />
              <Route path='issues/:asin' element={<IssuesByProducts />} />

              <Route path='reports' element={<Reports />} />
              <Route path='account-history' element={<AccountHistory />} />
              <Route path='settings' element={<Settings />} />
            </Route>
        </Routes>

      )}
    </>
  );
};

export default App;
