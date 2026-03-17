import React from 'react';
import { Routes, Route } from 'react-router-dom';

import Signup from './Pages/Auth/SignUp.jsx';
import Login from './Pages/Auth/Login.jsx';
import EmailVerification from './Pages/Auth/EmailVerification.jsx';
import ConnectToAmazon from './Pages/Onboarding/ConnectToAmazon.jsx';
import FetchingTokens from './Pages/Auth/FetchingTokens.jsx';
import AnalysingAccount from './Pages/Onboarding/AnalysingAccount.jsx';
import ProtectedAuthRouteWrapper from './Layout/ProtectedAuthRouteWrapper.jsx';
import MainLayout from './Layout/MainPagesLayout.jsx';
import DashBoard from './Pages/Dashboard/Dashboard.jsx';
import Issues from './Pages/Issues/Issues.jsx';
import AccountHistory from './Pages/Account/Account.jsx';
import Settings from './Pages/Account/Settings.jsx';
import ProductDetails from './Pages/Products/ProductDetails.jsx';
import IssuesByProduct from './Pages/Issues/IssuesByProduct.jsx';
import Error from './Pages/Error/error.jsx';
import ProtectedRouteWrapper from './Layout/ProtectedRouteWrapper.jsx';
import PackageRouteWrapper from './Layout/PackageRouteWrapper.jsx';
import { Outlet } from 'react-router-dom';
import { Navigate } from 'react-router-dom';
import ProfitibilityDashboard from './Pages/Dashboard/ProfitibilityDashboard.jsx';
import RecentOrders from './Pages/Dashboard/RecentOrders.jsx';
import PPCDashboard from './Pages/Dashboard/PPCDashboard.jsx';
import KeywordAnalysisDashboard from './Pages/Dashboard/KeywordAnalysisDashboard.jsx';
import EmailVerificationForNewPassword from './Pages/Auth/EmailVerificationForNewPassword.jsx';
import ResetPassword from './Pages/Auth/ResetPassword.jsx';
import Home from './Pages/Static/Home.jsx';
import Pricing from './Pages/Static/Pricing.jsx';
import PrivacyPolicy from './Pages/Static/PrivacyPolicy.jsx';
import ContactUs from './Pages/Static/Contact.jsx';
import Terms from './Pages/Static/Terms.jsx';
import LoadingPage from './Pages/Static/LoadingPage.jsx';
import ResultsPage from './Pages/Static/ResultsPage.jsx';
import RefundPolicy from './Pages/Static/RefundPolicy.jsx';
import SubscriptionSuccess from './Pages/Payment/SubscriptionSuccess.jsx';
import AboutUs from './Pages/Static/AboutUs.jsx';
import HowItWorks from './Pages/Static/HowItWorks.jsx';
import PromotionsPage from './Pages/Marketing/PromotionsPage.jsx';
import Advertisement from './Pages/Marketing/advertisement.jsx';
import QMate from './Pages/Tools/QMate.jsx';
import Features from './Pages/Marketing/features.jsx';
import InventoryManagement from './Pages/Marketing/inventoryManagement.jsx';
import GoogleInfoPage from './Pages/Auth/GoogleInfoPage.jsx';
import ConnectAccounts from './Pages/Onboarding/ConnectAccounts.jsx';
import ProfileIDSelection from './Pages/Onboarding/ProfileIDSeclection.jsx';
import PaymentCancel from './Pages/Payment/PaymentCancel.jsx';
import PaymentFailed from './Pages/Payment/PaymentFailed.jsx';
import AdminLogin from './Pages/Auth/AdminLogin.jsx';
import AgencySignUp from './Pages/Agency/AgencySignUp.jsx';
import AgencyLogin from './Pages/Agency/AgencyLogin.jsx';
import ManageAgencyUsersLayout from './Layout/ManageAgencyUsersLayout.jsx';
import ManageAgencyUsers from './Pages/Agency/ManageAgencyUsers.jsx';
import AgencySettings from './Pages/Agency/AgencySettings.jsx';
import AgencyClientLayout from './Layout/AgencyClientLayout.jsx';
import AgencyClientConnectToAmazon from './Pages/Agency/Client/AgencyClientConnectToAmazon.jsx';
import AgencyClientConnectAccounts from './Pages/Agency/Client/AgencyClientConnectAccounts.jsx';
import AgencyClientProfileSelection from './Pages/Agency/Client/AgencyClientProfileSelection.jsx';
import AgencyAnalysingAccount from './Pages/Agency/Client/AgencyAnalysingAccount.jsx';
import ManageAccountsLayout from './Layout/ManageAccountsLayout.jsx';
import ManageAccounts from './Pages/Account/ManageAccounts.jsx';
import AdminSubscription from './Pages/Admin/Subscription.jsx';
import AdminEmailLogs from './Pages/Admin/EmailLogs.jsx';
import AdminPaymentLogs from './Pages/Admin/PaymentLogs.jsx';
import AdminTicketMessages from './Pages/Admin/TicketMessages.jsx';
import AdminUserLogs from './Pages/Admin/UserLogs.jsx';
import AdminUserLogDetails from './Pages/Admin/UserLogDetails.jsx';
import UserLogging from './Pages/Tools/UserLogging.jsx';
import CalendlyWidget from './Pages/Tools/consultation.jsx';
import Tasks from './Pages/Tools/Tasks.jsx';
import EcommerceHolidaysCalendar from './Pages/Tools/EventCalender.jsx';
import ReimbursementDashboard from './Pages/Dashboard/ReimbursementDashboard.jsx';
import YourProducts from './Pages/Products/YourProducts.jsx';
import PreAnalysis from './Pages/Products/PreAnalysis.jsx';
import NotificationsPage from './Pages/Notifications/NotificationsPage.jsx';
import NotificationDetailsPage from './Pages/Notifications/NotificationDetailsPage.jsx';
import AuthError from './Pages/Auth/AuthError.jsx';
import UnsubscribeAlerts from './Pages/Notifications/UnsubscribeAlerts.jsx';

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
        <Route path='/agency-sign-up' element={<AgencySignUp />} />
        <Route path='/agency-login' element={<AgencyLogin />} />
        <Route path='/manage-agency-users' element={<ManageAgencyUsersLayout />}>
          <Route index element={<ManageAgencyUsers />} />
          <Route path='settings' element={<AgencySettings />} />
          <Route path='consultation' element={<CalendlyWidget />} />
        </Route>
        <Route path='/agency/:agencyName/client/:clientId' element={<AgencyClientLayout />}>
          <Route index element={<Navigate to="connect-to-amazon" replace />} />
          <Route path='connect-to-amazon' element={<AgencyClientConnectToAmazon />} />
          <Route path='connect-accounts' element={<AgencyClientConnectAccounts />} />
          <Route path='profile-selection' element={<AgencyClientProfileSelection />} />
        </Route>
        <Route path='/agency-analysing-account' element={<AgencyAnalysingAccount />} />
        <Route path='/manage-accounts' element={<ManageAccountsLayout />}>
          <Route index element={<ManageAccounts />} />
          <Route path='subscription' element={<AdminSubscription />} />
          <Route path='logs/email' element={<AdminEmailLogs />} />
          <Route path='logs/payment' element={<AdminPaymentLogs />} />
          <Route path='logs/user' element={<AdminUserLogs />} />
          <Route path='logs/user/:userId' element={<AdminUserLogDetails />} />
          <Route path='ticket-messages' element={<AdminTicketMessages />} />
        </Route>
        <Route path='/verify-email' element={<EmailVerification />} />
        <Route path='/unsubscribe-alerts' element={<UnsubscribeAlerts />} />
        <Route path='/connect-to-amazon' element={<ConnectToAmazon />} />
        <Route path='/connect-accounts' element={<ConnectAccounts />} />
        <Route path='/auth/callback' element={<FetchingTokens />} />
        <Route path='/analyse-account' element={<AnalysingAccount />} />
        <Route path='/reset-password/:code' element={<ResetPassword />} />
       <Route path='/pricing' element={<Pricing />} />
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
          <Route path='/auth-error' element={<AuthError />} />

          <Route path='/seller-central-checker' element={
            <PackageRouteWrapper>
              <MainLayout />
            </PackageRouteWrapper>
          }>

            <Route path='dashboard' element={<DashBoard />} />
            <Route path='recent-orders' element={<RecentOrders />} />
            <Route path='qmate' element={<QMate />} />
            <Route path='profitibility-dashboard' element={<ProfitibilityDashboard />} />
            <Route path='ppc-dashboard' element={<PPCDashboard />} />
            <Route path='keyword-analysis' element={<KeywordAnalysisDashboard />} />
            <Route path='issues' element={<Issues />} />
            <Route path='issues-by-product' element={<IssuesByProduct />} />
            <Route path='account-history' element={<AccountHistory />} />
            <Route path='settings' element={<Settings />} />
            <Route path='reimbursement-dashboard' element={<ReimbursementDashboard />} />
            <Route path='your-products' element={<YourProducts />} />
            <Route path='pre-analysis' element={<PreAnalysis />} />
            <Route path='tasks' element={<Tasks />} />
            <Route path='ecommerce-calendar' element={<EcommerceHolidaysCalendar />} />
            <Route path='notifications' element={<NotificationsPage />} />
            <Route path='notification-details/:id' element={<NotificationDetailsPage />} />
            <Route path='user-logging' element={<UserLogging />} />
            <Route path='consultation' element={<CalendlyWidget />} />
            {/* Product detail (ASIN) - must be last so fixed paths are matched first */}
            <Route path=':asin' element={<ProductDetails />} />
          </Route>
        </Route>
        <Route path='/error/:status' element={<Error />} />
        <Route path='*' element={<Navigate to="/error/404" />} />
      </Routes>

    </>
  );
};

export default App;
