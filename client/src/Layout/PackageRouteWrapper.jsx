import React, { useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';

const PackageRouteWrapper = ({ children }) => {
  const user = useSelector((state) => state.Auth.user);
  const navigate = useNavigate();
  const location = useLocation();

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

    // If user has LITE package and is trying to access restricted content
    if (packageType === 'LITE' && isRestrictedRoute) {
      console.log(`LITE user tried to access restricted route: ${currentPath}`);
      console.log('Redirecting to ASIN Analyzer...');
      navigate('/seller-central-checker/asin-analyzer', { replace: true });
      return;
    }

    // If user has LITE package and is on the base seller-central-checker route, redirect to asin-analyzer
    if (packageType === 'LITE' && currentPath === '/seller-central-checker') {
      navigate('/seller-central-checker/asin-analyzer', { replace: true });
      return;
    }

  }, [user, location.pathname, navigate]);

  return children;
};

export default PackageRouteWrapper;