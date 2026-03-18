import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { loginSuccess, addBrand } from '../redux/slices/authSlice.js';
import { updateImageLink } from '../redux/slices/profileImage.js';
import { setAllAccounts } from '../redux/slices/AllAccountsSlice.js';
import { setCurrency } from '../redux/slices/currencySlice.js';
import { setDashboardInfo } from '../redux/slices/DashboardSlice.js';
import axiosInstance from '../config/axios.config.js';
import Loader from '../Components/Loader/Loader.jsx';
import { initDemoAxiosMock } from '../Pages/DemoSellerCentralChecker/demoAxiosMock.js';

const amazonMarketplaceCurrencies = {
  US: '$', CA: 'C$', MX: 'MX$', BR: 'R$',
  UK: '£', DE: '€', FR: '€', IT: '€', ES: '€', NL: '€', SE: 'kr', PL: 'zł', BE: '€', TR: '₺',
  SA: '﷼', AE: 'د.إ', EG: 'E£',
  IN: '₹', JP: '¥', SG: 'S$', AU: 'A$'
};

const ProtectedDemoRouteWrapper = ({ children }) => {
  const navigate = useNavigate();
  const dispatch = useDispatch();
  const [authChecked, setAuthChecked] = useState(false);
  const [navbarLoaded, setNavbarLoaded] = useState(false);
  const [showLoader, setShowLoader] = useState(true);
  const isMountedRef = useRef(true);
  const hasCheckedRef = useRef(false);

  useEffect(() => {
    return () => { isMountedRef.current = false; };
  }, []);

  useEffect(() => {
    if (hasCheckedRef.current) return;
    hasCheckedRef.current = true;

    const checkDemoAuth = async () => {
      try {
        const res = await axiosInstance.get('/app/demo/profile', { withCredentials: true });

        if (!isMountedRef.current) return;

        if (res.status === 200 && res.data?.data) {
          const userData = res.data.data;
          dispatch(loginSuccess(userData));
          dispatch(updateImageLink(userData.profilePic || ''));
          setAuthChecked(true);

          initDemoAxiosMock();

          try {
            const navRes = await axiosInstance.get('/api/pagewise/navbar');
            if (!isMountedRef.current) return;
            if (navRes.status === 200 && navRes.data?.data) {
              const navData = navRes.data.data;
              if (navData.Brand) dispatch(addBrand(navData.Brand));
              if (navData.Country) {
                const currency = amazonMarketplaceCurrencies[navData.Country] || '$';
                dispatch(setCurrency({ currency, country: navData.Country }));
                dispatch(setDashboardInfo({ Country: navData.Country, Region: navData.Region }));
              }
              if (navData.AllSellerAccounts?.length) {
                dispatch(setAllAccounts(navData.AllSellerAccounts));
              }
            }
          } catch {
            // navbar fetch failed — non-critical, continue
          }
          setNavbarLoaded(true);
        } else {
          localStorage.removeItem('sellerqi_demo_mode');
          navigate('/', { replace: true });
        }
      } catch {
        if (isMountedRef.current) {
          localStorage.removeItem('sellerqi_demo_mode');
          navigate('/', { replace: true });
        }
      }
    };

    checkDemoAuth();
  }, [dispatch, navigate]);

  useEffect(() => {
    if (authChecked && navbarLoaded) {
      const timer = setTimeout(() => {
        if (isMountedRef.current) setShowLoader(false);
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [authChecked, navbarLoaded]);

  return (
    <>
      <AnimatePresence>
        {showLoader && (
          <motion.div
            key="demo-loader"
            initial={{ y: 0 }}
            animate={{ y: 0 }}
            exit={{ y: '-100%', transition: { duration: 1, ease: 'easeInOut' } }}
            className="fixed top-0 left-0 w-full h-screen z-[9999] bg-[#1a1a1a] flex justify-center items-center"
          >
            <Loader />
          </motion.div>
        )}
      </AnimatePresence>
      {!showLoader && children}
    </>
  );
};

export default ProtectedDemoRouteWrapper;
