import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { useDispatch, useSelector } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import { loginSuccess, addBrand } from "../redux/slices/authSlice.js";
import { updateImageLink } from "../redux/slices/profileImage.js";
import { setAllAccounts } from '../redux/slices/AllAccountsSlice.js';
import { setCurrency } from '../redux/slices/currencySlice.js';
import { setDashboardInfo } from '../redux/slices/DashboardSlice.js';
import axiosInstance from '../config/axios.config.js';
import { coordinatedAuthCheck } from '../utils/authCoordinator.js';
import Loader from '../Components/Loader/Loader.jsx';
import { isSpApiConnected, isAdsAccountConnected } from '../utils/spApiConnectionCheck.js';
import { hasPremiumAccess } from '../utils/subscriptionCheck.js';

// Map country codes to currency symbols
const amazonMarketplaceCurrencies = {
  US: "$", CA: "C$", MX: "MX$", BR: "R$",
  UK: "£", DE: "€", FR: "€", IT: "€", ES: "€", NL: "€", SE: "kr", PL: "zł", BE: "€", TR: "₺",
  SA: "﷼", AE: "د.إ", EG: "E£",
  IN: "₹", JP: "¥", SG: "S$", AU: "A$"
};

const ProtectedRouteWrapper = ({ children }) => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticating, setIsAuthenticating] = useState(false);
  const [navbarDataLoaded, setNavbarDataLoaded] = useState(false);
  const isMountedRef = useRef(true);
  const hasCheckedAuthRef = useRef(false);

  const userData = useSelector(state => state.Auth?.user);

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
        // Use coordinated auth check (will use cache if recent, otherwise fetch fresh)
        // Cache is cleared after login/logout, not on every route visit
        const result = await coordinatedAuthCheck();

        // Check if component is still mounted before proceeding
        if (!isMountedRef.current) return;

        if (result.isAuthenticated && result.user) {
          const userData = result.user;
         

          dispatch(updateImageLink(userData.profilePic));
          dispatch(loginSuccess(userData));
          
          // Check SP-API and Ads account connections, then subscription
          const hasPremium = hasPremiumAccess(userData);
          const spApiConnected = isSpApiConnected(userData);
          const adsAccountConnected = isAdsAccountConnected(userData);
          const isSuperAdmin = userData?.accessType === 'superAdmin';
          const isSuperAdminSession = userData?.isSuperAdminSession === true;
          const currentPath = window.location.pathname;
          const isDashboardRoute = currentPath.includes('/dashboard') || currentPath.includes('/seller-central-checker');
          
          console.log('ProtectedRouteWrapper: hasPremium:', hasPremium, 'spApiConnected:', spApiConnected, 'adsAccountConnected:', adsAccountConnected, 'isSuperAdmin:', isSuperAdmin, 'isSuperAdminSession:', isSuperAdminSession);
          
          // Flow: Super admins (or super admin sessions) always have access. For regular users, check both SP-API and Ads account
          // Only apply redirects if user is trying to access dashboard routes
          if (isDashboardRoute) {
            if (isSuperAdmin || isSuperAdminSession) {
              // Super admin or super admin session → always allow dashboard access
              console.log('ProtectedRouteWrapper: Super admin/session - allowing dashboard access');
              // Continue with normal flow
            } else if (spApiConnected && adsAccountConnected) {
              // Both SP-API and Ads account are connected → allow dashboard access
              console.log('ProtectedRouteWrapper: Both SP-API and Ads account connected - allowing dashboard access');
              // Continue with normal flow
            } else {
              // Either SP-API or Ads account is missing → redirect to connect-to-amazon
              if (!spApiConnected && !adsAccountConnected) {
                console.log('ProtectedRouteWrapper: Both SP-API and Ads account missing - redirecting to connect-to-amazon');
              } else if (!spApiConnected) {
                console.log('ProtectedRouteWrapper: SP-API missing - redirecting to connect-to-amazon');
              } else {
                console.log('ProtectedRouteWrapper: Ads account missing - redirecting to connect-to-amazon');
              }
              localStorage.setItem("isAuth", "true"); // Keep them logged in
              navigate("/connect-to-amazon", { replace: true });
              return;
            }
          }
          
          // All users with selected plans (LITE, PRO, AGENCY) can access dashboard
          // But with different feature restrictions based on their plan
          
          setAuthChecked(true);

          await fetchData(userData);

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

    const fetchData = async (freshUserData) => {
      try {
        // OPTIMIZED: Fetch only navbar data (user info, accounts, brand)
        // Individual pages will fetch their own data on mount
        const response = await axiosInstance.get('/api/pagewise/navbar');

        // Check if component is still mounted
        if (!isMountedRef.current) return;

        console.log("=== ProtectedRouteWrapper: Navbar data fetch response ===");
        console.log("Response status:", response?.status);

        if (response?.status === 200 && response.data?.data) {
          const navbarData = response.data.data;
          
          // Dispatch brand name if available
          if (navbarData.Brand) {
            dispatch(addBrand(navbarData.Brand));
          }
          
          // Dispatch country and currency for TopNav display
          if (navbarData.Country) {
            const currency = amazonMarketplaceCurrencies[navbarData.Country] || '$';
            dispatch(setCurrency({ currency, country: navbarData.Country }));
            
            // Also set minimal DashboardInfo for TopNav compatibility
            dispatch(setDashboardInfo({ 
              Country: navbarData.Country,
              Region: navbarData.Region
            }));
          }
          
          // Dispatch all seller accounts for account switching
          if (navbarData.AllSellerAccounts && navbarData.AllSellerAccounts.length > 0) {
            dispatch(setAllAccounts(navbarData.AllSellerAccounts));
          }
          
          console.log("✅ Navbar data loaded successfully", navbarData);
          setNavbarDataLoaded(true);
        } else {
          // Even if navbar data fails, allow user to proceed
          // Pages will fetch their own data
          console.warn("⚠️ Navbar data not available, proceeding anyway");
          setNavbarDataLoaded(true);
        }

      } catch (error) {
        console.error("❌ Navbar data fetch failed:", error);
        
        // Check if component is still mounted
        if (!isMountedRef.current) return;
        
        // Allow user to proceed even if navbar data fails
        // Pages will fetch their own data
        setNavbarDataLoaded(true);
        
        // Only redirect for critical authentication errors
        if (error.response?.status === 401) {
          console.error("❌ Authentication error, redirecting to login");
          navigate("/");
        }
      }
    };

    checkAuthAndFetchData();
  }, []); // Empty dependency array to run only once on mount

  // Hide loader when authentication is complete and navbar data is loaded
  useEffect(() => {
    if (authChecked && navbarDataLoaded) {
      const timer = setTimeout(() => {
        if (isMountedRef.current) {
          setShowLoader(false);
        }
      }, 300); // shorter delay since we're loading less data
      
      // Cleanup timeout on unmount
      return () => clearTimeout(timer);
    }
  }, [authChecked, navbarDataLoaded]);

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
            className="fixed top-0 left-0 w-full h-screen z-[9999] bg-[#1a1a1a] flex justify-center items-center"
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
