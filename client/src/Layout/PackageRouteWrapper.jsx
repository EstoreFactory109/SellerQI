import React, { useMemo } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import UpgradeRequiredOverlay from '../Components/TrialExpiredOverlay/UpgradeRequiredOverlay';

const PackageRouteWrapper = ({ children }) => {
  const user = useSelector((state) => state.Auth.user);
  const navigate = useNavigate();
  const location = useLocation();

  // Check if super admin is accessing this account
  const isSuperAdminAccess = useMemo(() => {
    const isAdminLoggedIn = localStorage.getItem('isAdminAuth') === 'true';
    const adminAccessType = localStorage.getItem('adminAccessType');
    return isAdminLoggedIn && adminAccessType === 'superAdmin';
  }, []);

  // Check if user has a paid plan (PRO or AGENCY)
  const hasPaidPlan = useMemo(() => {
    return user?.packageType === 'PRO' || user?.packageType === 'AGENCY';
  }, [user?.packageType]);

  // Check if user's trial has expired
  const isTrialExpired = useMemo(() => {
    if (!user?.trialEndsDate) return false;
    const now = new Date();
    const trialEnd = new Date(user.trialEndsDate);
    return now >= trialEnd;
  }, [user?.trialEndsDate]);

  // Check if user was downgraded from trial to LITE
  const wasDowngradedFromTrial = useMemo(() => {
    return user?.packageType === 'LITE' && 
           user?.isInTrialPeriod === false && 
           user?.trialEndsDate !== null && 
           user?.trialEndsDate !== undefined;
  }, [user?.packageType, user?.isInTrialPeriod, user?.trialEndsDate]);

  // Check if user chose LITE plan (never had trial)
  const choseLitePlan = useMemo(() => {
    return user?.packageType === 'LITE' && 
           !user?.isInTrialPeriod && 
           (user?.trialEndsDate === null || user?.trialEndsDate === undefined);
  }, [user?.packageType, user?.isInTrialPeriod, user?.trialEndsDate]);

  // Define routes that DON'T need upgrade overlay (free for all users)
  const freeRoutes = [
    '/seller-central-checker/settings',
    '/seller-central-checker/consultation'
  ];

  // Check if current path is a restricted route (all routes except free ones)
  const isRestrictedRoute = useMemo(() => {
    const currentPath = location.pathname;
    // If it's a free route, it's not restricted
    if (freeRoutes.some(route => currentPath.startsWith(route))) {
      return false;
    }
    // All other seller-central-checker routes are restricted for LITE users
    return currentPath.startsWith('/seller-central-checker/');
  }, [location.pathname]);

  // Determine if user needs to upgrade (any LITE user - expired trial, downgraded, or chose LITE)
  const needsUpgrade = useMemo(() => {
    if (hasPaidPlan) return false;
    if (isSuperAdminAccess) return false;
    // Any user on LITE plan needs upgrade to access restricted routes
    return user?.packageType === 'LITE';
  }, [hasPaidPlan, isSuperAdminAccess, user?.packageType]);

  // Should show the upgrade overlay (blur)?
  const shouldShowOverlay = needsUpgrade && isRestrictedRoute;

  // Handle redirect from base route only
  React.useEffect(() => {
    if (!user) return;

    // Always redirect from base route to dashboard
    // LITE users will see the upgrade overlay on dashboard
    if (location.pathname === '/seller-central-checker') {
      navigate('/seller-central-checker/dashboard', { replace: true });
    }
  }, [user, location.pathname, navigate]);

  // Debug logging
  React.useEffect(() => {
    console.log('🔍 PackageRouteWrapper:', {
      pathname: location.pathname,
      isRestrictedRoute,
      needsUpgrade,
      shouldShowOverlay,
      isSuperAdminAccess,
      hasPaidPlan,
      isTrialExpired,
      wasDowngradedFromTrial,
      choseLitePlan,
      packageType: user?.packageType
    });
  }, [location.pathname, isRestrictedRoute, needsUpgrade, shouldShowOverlay]);

  // Render
  if (shouldShowOverlay) {
  return (
      <UpgradeRequiredOverlay>
      {children}
      </UpgradeRequiredOverlay>
    );
  }
      
  return <>{children}</>;
};

export default PackageRouteWrapper;
