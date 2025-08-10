import React from 'react';
import { Routes, Route } from 'react-router-dom';

import Signup from './Pages/SignUp.jsx';
import Login from './Pages/Login.jsx';
import EmailVerification from './Pages/EmailVerification.jsx';
import ConnectToAmazon from './Pages/ConnectToAmazon.jsx';
import FetchingTokens from './Pages/FetchingTokens.jsx';
import AnalysingAccount from './Pages/AnalysingAccount.jsx';
import ProtectedAuthRouteWrapper from './Layout/ProtectedAuthRouteWrapper.jsx';
import MainLayout from './Layout/MainPagesLayout.jsx';
import DashBoard from './Pages/Dashboard.jsx';
import Issues from './Pages/Issues.jsx';
import AccountHistory from './Pages/Account.jsx';
import Settings from './Pages/Settings.jsx';
import IssuesByProducts from './Pages/IssuesPerProduct.jsx';
import IssuesByProduct from './Pages/IssuesByProduct.jsx';
import Error from './Pages/error.jsx';
import ProtectedRouteWrapper from './Layout/ProtectedRouteWrapper.jsx';
import PackageRouteWrapper from './Layout/PackageRouteWrapper.jsx';
import { Outlet } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import ProfitibilityDashboard from './Pages/ProfitibilityDashboard.jsx';
import PPCDashboard from './Pages/PPCDashboard.jsx';
import EmailVerificationForNewPassword from './Pages/EmailVerificationForNewPassword.jsx';
import ResetPassword from './Pages/ResetPassword.jsx';
import Home from './Pages/Home.jsx';
import Pricing from './Pages/Pricing.jsx';
import PrivacyPolicy from './Pages/PrivacyPolicy.jsx';
import ContactUs from './Pages/Contact.jsx';
import Terms from './Pages/Terms.jsx';
import LoadingPage from './Pages/LoadingPage.jsx';
import ResultsPage from './Pages/ResultsPage.jsx';
import RefundPolicy from './Pages/RefundPolicy.jsx';
import SubscriptionSuccess from './Pages/SubscriptionSuccess.jsx';
import ASINAnalyzer from './Pages/ASINAnalyzer.jsx';
import AboutUs from './Pages/AboutUs.jsx';
import HowItWorks from './Pages/HowItWorks.jsx';
import PromotionsPage from './Pages/PromotionsPage.jsx';
import Advertisement from './Pages/advertisement.jsx';
import Features from './Pages/features.jsx';
import InventoryManagement from './Pages/inventoryManagement.jsx';
import GoogleInfoPage from './Pages/GoogleInfoPage.jsx';
import ConnectAccounts from './Pages/ConnectAccounts.jsx';
import ProfileIDSelection from './Pages/ProfileIDSeclection.jsx';
import PaymentCancel from './Pages/PaymentCancel.jsx';
import PaymentFailed from './Pages/PaymentFailed.jsx';
import AgencyClientRegistration from './Pages/AgencyClientRegistration.jsx';
import AdminLogin from './Pages/AdminLogin.jsx';
import ManageAccounts from './Pages/ManageAccounts.jsx';

const App = () => {

  return (
    <>

      <Routes>
        <Route element={
          <ProtectedAuthRouteWrapper>
            <Outlet />
          </ProtectedAuthRouteWrapper>
        }>
         {/* <Route path='/' element={<Home />} /> */}
          <Route path='/sign-up' element={<Signup />} />
          <Route path='/' element={<Login />} />
          
          <Route path='/verify-email-for-password-reset' element={<EmailVerificationForNewPassword />} />
        </Route>
        <Route path='/admin-login' element={<AdminLogin />} />
          <Route path='/manage-accounts' element={<ManageAccounts />} />
        <Route path='/verify-email' element={<EmailVerification />} />
        <Route path='/connect-to-amazon' element={<ConnectToAmazon />} />
        <Route path='/connect-accounts' element={<ConnectAccounts />} />
        <Route path='/agency-client-registration' element={<AgencyClientRegistration />} />
        <Route path='/auth/callback' element={<FetchingTokens />} />
        <Route path='/analyse-account' element={<AnalysingAccount />} />
        <Route path='/reset-password/:code' element={<ResetPassword />} />
       {/* <Route path='/pricing' element={<Pricing />} /> */}
        {/* <Route path='/privacy-policy' element={<PrivacyPolicy />} /> */}
        {/* <Route path='/terms-of-use' element={<Terms />} /> */}
        {/* <Route path='/contact-us' element={<ContactUs />} /> */}
        {/* <Route path='/refund-policy' element={<RefundPolicy />} /> */}
        {/* <Route path='/loading' element={<LoadingPage />} /> */}
        <Route path='/results' element={<ResultsPage />} />
        <Route path='/subscription-success' element={<SubscriptionSuccess />} />
        <Route path='/payment-cancel' element={<PaymentCancel />} />
        <Route path='/payment-failed' element={<PaymentFailed />} />
        {/* <Route path='/about-us' element={<AboutUs />} /> */}
        {/* <Route path='/how-it-works' element={<HowItWorks />} /> */}
        {/* <Route path='/promotions' element={<PromotionsPage />} /> */}
        {/* <Route path='/advertisement' element={<Advertisement />} /> */}
        {/* <Route path='/features' element={<Features />} /> */}
        {/* <Route path='/inventory-management' element={<InventoryManagement />} /> */}
        {/* <Route path='/auth/info' element={<GoogleInfoPage />} /> */}
        <Route
          element={
            <ProtectedRouteWrapper>
              <Outlet />
            </ProtectedRouteWrapper>
          }
        >
          <Route path='/profile-selection' element={<ProfileIDSelection />} />

          <Route path='/seller-central-checker' element={
            <PackageRouteWrapper>
              <MainLayout />
            </PackageRouteWrapper>
          }>

            <Route path='dashboard' element={<DashBoard />} />
            <Route path='profitibility-dashboard' element={<ProfitibilityDashboard />} />
            <Route path='ppc-dashboard' element={<PPCDashboard />} />
            <Route path='issues' element={<Issues />} />
            <Route path='issues-by-product' element={<IssuesByProduct />} />
            <Route path='issues/:asin' element={<IssuesByProducts />} />
            <Route path='account-history' element={<AccountHistory />} />
            <Route path='settings' element={<Settings />} />
            <Route path='asin-analyzer' element={<ASINAnalyzer />} />
            
            
          </Route>
        </Route>
        <Route path='/error/:status' element={<Error />} />
        <Route path='*' element={<Navigate to="/error/404" />} />
      </Routes>

    </>
  );
};

export default App;
