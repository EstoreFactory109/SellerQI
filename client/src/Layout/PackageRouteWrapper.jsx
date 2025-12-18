import React, { useEffect, useState, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate, useLocation } from 'react-router-dom';
import TrialExpiredOverlay from '../Components/TrialExpiredOverlay/TrialExpiredOverlay';
import RecurringTrialPopup from '../Components/TrialExpiredOverlay/RecurringTrialPopup';
import { updatePackageType, updateTrialStatus } from '../redux/slices/authSlice';
import axiosInstance from '../config/axios.config';
import { loginSuccess } from '../redux/slices/authSlice';

const PackageRouteWrapper = ({ children }) => {
  const user = useSelector((state) => state.Auth.user);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const location = useLocation();
  const [showTrialExpiredOverlay, setShowTrialExpiredOverlay] = useState(false);
  const [showRecurringPopup, setShowRecurringPopup] = useState(false);
  const popupIntervalRef = useRef(null);
  const trialCheckIntervalRef = useRef(null);

  // Check if user's trial has expired (client-side check)
  const isTrialExpired = () => {
    if (!user?.isInTrialPeriod || !user?.trialEndsDate) return false;
    const now = new Date();
    const trialEnd = new Date(user.trialEndsDate);
    return now >= trialEnd;
  };

  // Check if user has a paid plan (PRO or AGENCY)
  const hasPaidPlan = () => {
    return user?.packageType === 'PRO' || user?.packageType === 'AGENCY';
  };

  // Check if user was downgraded from trial to LITE (should show popup)
  const wasDowngradedFromTrial = () => {
    // User is on LITE plan but was previously in trial period (has trialEndsDate)
    const result = user?.packageType === 'LITE' && 
           user?.isInTrialPeriod === false && 
           user?.trialEndsDate !== null && 
           user?.trialEndsDate !== undefined;
    
    console.log('🔍 wasDowngradedFromTrial check:', {
      packageType: user?.packageType,
      isInTrialPeriod: user?.isInTrialPeriod,
      trialEndsDate: user?.trialEndsDate,
      result
    });
    
    return result;
  };

  // Check if user chose LITE plan (should hide pages)
  const choseLitePlan = () => {
    // User is on LITE plan and was never in trial period (no trialEndsDate)
    return user?.packageType === 'LITE' && 
           !user?.isInTrialPeriod && 
           (user?.trialEndsDate === null || user?.trialEndsDate === undefined);
  };

  // Start recurring popup for trial expired users
  const startRecurringPopup = () => {
    if (popupIntervalRef.current) {
      clearInterval(popupIntervalRef.current);
    }
    
    console.log('🎯 Setting popup to show immediately');
    // Show popup immediately on page load
    setShowRecurringPopup(true);
    
    // Show popup every 10 minutes (600000 ms)
    popupIntervalRef.current = setInterval(() => {
      console.log('🎯 10 minute interval - showing popup again');
      setShowRecurringPopup(true);
    }, 600000);
  };

  // Stop recurring popup
  const stopRecurringPopup = () => {
    if (popupIntervalRef.current) {
      clearInterval(popupIntervalRef.current);
      popupIntervalRef.current = null;
    }
    setShowRecurringPopup(false);
  };

  // Check trial status with backend
  const checkTrialStatusWithBackend = async () => {
    try {
      const response = await axiosInstance.get('/app/check-trial-status');
      if (response.status === 200) {
        const trialData = response.data.data;
        const needsUpdate = trialData.trialExpired || 
                           trialData.packageType !== user?.packageType ||
                           trialData.isInTrialPeriod !== user?.isInTrialPeriod ||
                           (trialData.trialEndsDate && !user?.trialEndsDate);
        if (needsUpdate) {
          dispatch(updateTrialStatus({
            packageType: trialData.packageType,
            subscriptionStatus: trialData.subscriptionStatus,
            isInTrialPeriod: trialData.isInTrialPeriod,
            trialEndsDate: trialData.trialEndsDate
          }));
        }
      }
    } catch (error) {
      console.error('❌ Error checking trial status:', error);
    }
  };

  // Start trial status checking
  const startTrialStatusChecking = () => {
    if (trialCheckIntervalRef.current) {
      clearInterval(trialCheckIntervalRef.current);
    }
    
    // Check immediately
    checkTrialStatusWithBackend();
    
    // Check every 5 minutes (300000 ms)
    trialCheckIntervalRef.current = setInterval(() => {
      checkTrialStatusWithBackend();
    }, 300000);
  };

  // Stop trial status checking
  const stopTrialStatusChecking = () => {
    if (trialCheckIntervalRef.current) {
      clearInterval(trialCheckIntervalRef.current);
      trialCheckIntervalRef.current = null;
    }
  };

  useEffect(() => {
    if (!user) return;

    const currentPath = location.pathname;
    const packageType = user.packageType;

    // Start trial status checking for all authenticated users
    startTrialStatusChecking();

    // Define allowed routes for LITE users
    const liteAllowedRoutes = [
      '/seller-central-checker/tasks',
      '/seller-central-checker/ecommerce-calendar',
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

    // Handle trial expired users (currently in trial but expired)
    if (isTrialExpired() && !hasPaidPlan()) {
      // If on restricted route, show overlay and start recurring popup
      if (isRestrictedRoute) {
        setShowTrialExpiredOverlay(true);
        startRecurringPopup();
      } else {
        // If on allowed route, just start recurring popup (no overlay)
        setShowTrialExpiredOverlay(false);
        startRecurringPopup();
      }
      return;
    }

    // Handle users who were downgraded from trial to LITE (show popup only)
    if (wasDowngradedFromTrial()) {
      console.log('🎯 User was downgraded from trial - showing popup immediately');
      // Start recurring popup for users downgraded from trial
      startRecurringPopup();
      setShowTrialExpiredOverlay(false);
      return;
    }

    // Handle users who chose LITE plan (hide pages, redirect)
    if (choseLitePlan() && isRestrictedRoute) {
      navigate('/seller-central-checker/tasks', { replace: true });
      return;
    }

    // If user has LITE package and is on the base seller-central-checker route, redirect to tasks
    // But only if they chose LITE plan (not if they were downgraded from trial)
    if (choseLitePlan() && currentPath === '/seller-central-checker') {
      navigate('/seller-central-checker/tasks', { replace: true });
      return;
    }

    // Stop popup and hide overlay for all other cases
    stopRecurringPopup();
    setShowTrialExpiredOverlay(false);

  }, [user, location.pathname, navigate, dispatch]);

  // Cleanup intervals on unmount
  useEffect(() => {
    return () => {
      if (popupIntervalRef.current) {
        clearInterval(popupIntervalRef.current);
      }
      if (trialCheckIntervalRef.current) {
        clearInterval(trialCheckIntervalRef.current);
      }
    };
  }, []);

  const handleCloseRecurringPopup = () => {
    setShowRecurringPopup(false);
  };

  // Stop popup when user navigates to settings (likely to upgrade)
  useEffect(() => {
    if (location.pathname === '/seller-central-checker/settings') {
      stopRecurringPopup();
    }
  }, [location.pathname]);

  return (
    <>
      {children}
      
      {/* Trial Expired Overlay */}
      {showTrialExpiredOverlay && (
        <TrialExpiredOverlay />
      )}
      
      {/* Recurring Trial Popup */}
      {showRecurringPopup && (
        <RecurringTrialPopup isVisible={showRecurringPopup} onClose={handleCloseRecurringPopup} />
      )}
    </>
  );
};

export default PackageRouteWrapper;