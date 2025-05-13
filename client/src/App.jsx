import React from 'react';
import { Routes, Route } from 'react-router-dom';

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
import IssuesByProducts from './Pages/IssuesByProduct.jsx';
import Error from './Pages/error.jsx';
import ProtectedRouteWrapper from './Layout/ProtectedRouteWrapper.jsx';
import { Outlet } from 'react-router-dom';

const App = () => {

  return (
    <>
     
        <Routes>
          <Route path='/' element={<Login />} />
          <Route path='/sign-up' element={<Signup />} />
          <Route path='/verify-email' element={<EmailVerification />} />
          <Route path='/connect-to-amazon' element={<ConnectToAmazon />} />
          <Route path='/account-access' element={<FetchingTokens />} />
          <Route path='/analyse-account' element={<AnalysingAccount />} />
          <Route
            element={
              <ProtectedRouteWrapper>
                <Outlet />
              </ProtectedRouteWrapper>
            }
          >
          <Route path='/seller-central-checker' element={<MainLayout />}>
          
            <Route path='dashboard' element={<DashBoard />} />
            <Route path='issues' element={<Issues />} />
            <Route path='issues/:asin' element={<IssuesByProducts />} />
            <Route path='reports' element={<Reports />} />
            <Route path='account-history' element={<AccountHistory />} />
            <Route path='settings' element={<Settings />} />
          </Route>
        </Route>
        <Route path='/error/:status' element={<Error />} />
        </Routes>
      
    </>
  );
};

export default App;
