import React, { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import TrialExpiredOverlay from '../Components/TrialExpiredOverlay/TrialExpiredOverlay';

const PackageRouteWrapper = ({ children }) => {
  const user = useSelector((state) => state.Auth.user);
  const navigate = useNavigate();
  const location = useLocation();
  const [showTrialExpiredOverlay, setShowTrialExpiredOverlay] = useState(false);

  // Check if user's trial has expired (client-side check)
  const isTrialExpired = () => {
    if (!user?.isInTrialPeriod || !user?.trialEndsDate) return false;
    const now = new Date();
    const trialEnd = new Date(user.trialEndsDate);
    return now >= trialEnd;
  };

  useEffect(() => {
    if (!user) return;

    const currentPath = location.pathname;
    const packageType = user.packageType;

    // Define allowed routes for LITE users
    const liteAllowedRoutes = [
      '/seller-central-checker/asin-analyzer',
      '/seller-central-checker/settings'
    ];

    // Define restricted routes for LITE users (routes that require paid plans)
    const restrictedRoutes = [
      '/seller-central-checker/dashboard',
      '/seller-central-checker/profitibility-dashboard', 
      '/seller-central-checker/ppc-dashboard',
      '/seller-central-checker/issues',
      '/seller-central-checker/issues-by-product',
      '/seller-central-checker/account-history'
    ];

    // Check if current path starts with any restricted route (for dynamic routes like /issues/:asin)
    const isRestrictedRoute = restrictedRoutes.some(route => 
      currentPath.startsWith(route)
    ) || currentPath.startsWith('/seller-central-checker/issues/');

    // Check if user's trial has expired and they're on a restricted route
    if (isTrialExpired() && isRestrictedRoute) {
      setShowTrialExpiredOverlay(true);
      return;
    } else {
      setShowTrialExpiredOverlay(false);
    }

    // If user has LITE package (not in trial) and is trying to access restricted content
    if (packageType === 'LITE' && !user?.isInTrialPeriod && isRestrictedRoute) {
      console.log(`LITE user tried to access restricted route: ${currentPath}`);
      console.log('Redirecting to ASIN Analyzer...');
      navigate('/seller-central-checker/asin-analyzer', { replace: true });
      return;
    }

    // If user has LITE package and is on the base seller-central-checker route, redirect to asin-analyzer
    if (packageType === 'LITE' && !user?.isInTrialPeriod && currentPath === '/seller-central-checker') {
      navigate('/seller-central-checker/asin-analyzer', { replace: true });
      return;
    }

  }, [user, location.pathname, navigate]);

  return (
    <div className="relative">
      <div className={showTrialExpiredOverlay ? 'filter blur-sm pointer-events-none' : ''}>
        {children}
      </div>
      {showTrialExpiredOverlay && <TrialExpiredOverlay />}
    </div>
  );
};

export default PackageRouteWrapper;