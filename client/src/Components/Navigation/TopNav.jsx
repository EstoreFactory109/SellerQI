import React, { useRef, useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
import { useSelector, useDispatch } from 'react-redux'
import { setPosition } from '../../redux/slices/MobileMenuSlice.js'
import { markAsRead, markAllAsRead, setAlertsFromApi } from '../../redux/slices/notificationsSlice.js'
import { setCurrency } from '../../redux/slices/currencySlice.js'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion';
import { Building, Plus, ChevronRight, ChevronDown, Bell, User, Menu, ArrowLeftRight, Calendar, RefreshCw } from 'lucide-react'
import axios from 'axios'
import axiosInstance from '../../config/axios.config.js'
import { amazonMarketplaceCurrencies } from '../../utils/amazonAllowedCountries.js'
import Calender, { isClickInsideGaCalDropdown } from '../Calender/Calender.jsx'
import { useDashboardData } from '../../hooks/usePageData.js'

const DASHBOARD_ROUTES = ['/seller-central-checker/dashboard', '/seller-central-checker-demo/dashboard']

// Marketplace shown as flag + Amazon domain (e.g. "🇺🇸 Amazon.com") instead of the full country name.
const marketplaceMeta = {
    US: { flag: '🇺🇸', domain: 'Amazon.com' },
    CA: { flag: '🇨🇦', domain: 'Amazon.ca' },
    MX: { flag: '🇲🇽', domain: 'Amazon.com.mx' },
    BR: { flag: '🇧🇷', domain: 'Amazon.com.br' },
    IE: { flag: '🇮🇪', domain: 'Amazon.ie' },
    UK: { flag: '🇬🇧', domain: 'Amazon.co.uk' },
    DE: { flag: '🇩🇪', domain: 'Amazon.de' },
    FR: { flag: '🇫🇷', domain: 'Amazon.fr' },
    IT: { flag: '🇮🇹', domain: 'Amazon.it' },
    ES: { flag: '🇪🇸', domain: 'Amazon.es' },
    NL: { flag: '🇳🇱', domain: 'Amazon.nl' },
    BE: { flag: '🇧🇪', domain: 'Amazon.com.be' },
    SE: { flag: '🇸🇪', domain: 'Amazon.se' },
    PL: { flag: '🇵🇱', domain: 'Amazon.pl' },
    ZA: { flag: '🇿🇦', domain: 'Amazon.co.za' },
    TR: { flag: '🇹🇷', domain: 'Amazon.com.tr' },
    SA: { flag: '🇸🇦', domain: 'Amazon.sa' },
    AE: { flag: '🇦🇪', domain: 'Amazon.ae' },
    EG: { flag: '🇪🇬', domain: 'Amazon.eg' },
    IN: { flag: '🇮🇳', domain: 'Amazon.in' },
    JP: { flag: '🇯🇵', domain: 'Amazon.co.jp' },
    SG: { flag: '🇸🇬', domain: 'Amazon.sg' },
    AU: { flag: '🇦🇺', domain: 'Amazon.com.au' },
}

const MarketplaceLabel = ({ countryCode, textClassName = '' }) => {
    const meta = marketplaceMeta[countryCode]
    if (!meta) return <span className={textClassName}>{countryCode || 'Marketplace'}</span>
    return (
        <span className="inline-flex items-center gap-1.5">
            <span style={{ fontSize: '13px' }}>{meta.flag}</span>
            <span className={textClassName}>{meta.domain}</span>
        </span>
    )
}

const TopNav = () => {
    const navigate = useNavigate()
    const location = useLocation()
    const isDemoNotificationsContext = location.pathname.startsWith('/seller-central-checker-demo');
    const notificationsListPath = isDemoNotificationsContext
        ? '/seller-central-checker-demo/notifications'
        : '/seller-central-checker/notifications';
    // Helper function to truncate brand name to 10 characters including spaces
    const truncateBrandName = (brandName) => {
        const brand = brandName || "Brand Name";
        return brand.length > 10 ? brand.substring(0, 10) + "..." : brand;
    };

    const getAlertDropdownTitle = (alertType) => {
        if (alertType === 'ProductContentChange') return 'Content change detected';
        if (alertType === 'BuyBoxMissing') return 'Buy box missing';
        if (alertType === 'NegativeReviews') return 'Negative reviews detected';
        if (alertType === 'APlusMissing') return 'A+ content missing';
        return 'Alert';
    };


    const user = useSelector((state) => state.Auth?.user);
    const Country = useSelector((state) => state.Dashboard?.DashBoardInfo?.Country);
    const Currency = amazonMarketplaceCurrencies[Country];
   
    const sellerAccount = useSelector(state => state.AllAccounts?.AllAccounts) || []
    const notifications = useSelector(state => state.notifications?.notifications) || []
    const unreadCount = useSelector(state => state.notifications?.unreadCount) || 0
    const [openDropDown, setOpenDropDown] = useState(false);
    const [openNotifications, setOpenNotifications] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const dispatch = useDispatch();
    
    // Check if super admin is logged in - server-side middleware will validate the actual token
    const isAdminLoggedIn = localStorage.getItem('isAdminAuth') === 'true';
    const adminAccessType = localStorage.getItem('adminAccessType');
    const isSuperAdmin = isAdminLoggedIn && adminAccessType === 'superAdmin';
    const isAgencyAdmin = isAdminLoggedIn && adminAccessType === 'enterpriseAdmin';
    const loggedInAsUser = localStorage.getItem('loggedInAsUser');
    const loggedInAsClient = localStorage.getItem('loggedInAsClient');
    // Agency admin viewing a client's dashboard (not on manage-agency-users page)
    // loggedInAsClient is now a JSON string (same pattern as loggedInAsUser)
    const isAgencyAdminViewingClient = isAgencyAdmin && loggedInAsClient;
    const profilepic = useSelector(state => state.profileImage?.imageLink)
    const dropdownRef = useRef(null)
    const notificationRef = useRef(null)

    // Date-range control: always visible, beside the marketplace pill, on every page.
    // Dashboard.jsx used to render its own trigger + dropdown; moved up here per redesign.
    const isDashboardRoute = DASHBOARD_ROUTES.includes(location.pathname)
    const dashboardInfoForDates = useSelector(state => state.Dashboard?.DashBoardInfo)
    const [openCalender, setOpenCalender] = useState(false)
    const [selectedPeriod, setSelectedPeriod] = useState('Last 30 Days')
    const calenderRef = useRef(null)
    const calendarAnchorRef = useRef(null)

    // autoFetch=false: this hook must never trigger a dashboard data fetch on other pages —
    // it's only used here to reach the same refresh action Dashboard.jsx already dispatches.
    const {
        forceRefresh: refreshDashboard,
        loadingPhase1,
        loadingPhase2,
        loadingPhase3,
        loadingTop4,
    } = useDashboardData(false)
    const isRefreshingDashboard = loadingPhase1 || loadingPhase2 || loadingPhase3 || loadingTop4

    useEffect(() => {
        if (!dashboardInfoForDates?.startDate || !dashboardInfoForDates?.endDate) return

        const parseLocal = (dateString) => {
            const [year, month, day] = dateString.split('-').map(Number)
            return new Date(year, month - 1, day)
        }
        const formatDate = (date) => date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

        setSelectedPeriod(`${formatDate(parseLocal(dashboardInfoForDates.startDate))} - ${formatDate(parseLocal(dashboardInfoForDates.endDate))}`)
    }, [dashboardInfoForDates?.startDate, dashboardInfoForDates?.endDate, dashboardInfoForDates?.calendarMode])

    useEffect(() => {
        const handleClickOutsideCalendar = (event) => {
            if (isClickInsideGaCalDropdown(event.target)) return
            if (calenderRef.current && !calenderRef.current.contains(event.target)) {
                setOpenCalender(false)
            }
        }
        document.addEventListener('mousedown', handleClickOutsideCalendar)
        return () => document.removeEventListener('mousedown', handleClickOutsideCalendar)
    }, [])

    const switchAccount = async (country,region) => {
        try{
            setIsLoading(true);
            
            const data={
              
                country:country,
                region:region
            }
            const response=await axios.post(`${import.meta.env.VITE_BASE_URI}/app/switch-account`,data,{withCredentials:true})
            if(response.status===200){
                window.location.href = "/seller-central-checker/dashboard";
            }
        }catch(error){
            console.error(error)
            setIsLoading(false);
        }
    }

    const handleSwitchToAdmin = async () => {
        try {
            setIsLoading(true);
            
            // First logout the current logged-in user
            await axios.post(`${import.meta.env.VITE_BASE_URI}/app/logout`, {}, {
                withCredentials: true
            });
            
            // Clear the logged in as user data
            localStorage.removeItem('loggedInAsUser');
            localStorage.removeItem('isAuth');
            
            // Navigate back to manage accounts page
            window.location.href = '/manage-accounts';
        } catch (error) {
            console.error('Error during admin switch:', error);
            // Even if logout fails, clear local data and navigate
            localStorage.removeItem('loggedInAsUser');
            localStorage.removeItem('isAuth');
            window.location.href = '/manage-accounts';
        } finally {
            setIsLoading(false);
        }
    }

    const handleSwitchToAgencyClients = () => {
        // Clear the client context but keep agency admin context
        localStorage.removeItem('loggedInAsClient');
        // Navigate to agency manage clients page
        window.location.href = '/manage-agency-users';
    }

    const handleHamburger = () => {
        dispatch(setPosition("0%"))
    }

    const openDropDownfnc = () => {
        openDropDown === false ? setOpenDropDown(true) : setOpenDropDown(false)
    }

    // Helper function to format timestamp
    const formatTimestamp = (timestamp) => {
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now - date;
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    // Handle notification click
    const handleNotificationClick = () => {
        setOpenNotifications(!openNotifications);
    };

    // Handle notification item click: for alerts → navigate to notifications page + set viewed (dropdown and page stay in sync)
    const handleNotificationItemClick = (notification) => {
        if (notification.type === 'alert') {
            if (!notification.isRead && notification.alertId) {
                axiosInstance.patch(`/api/alerts/${notification.alertId}/viewed`).catch(() => {});
            }
            dispatch(markAsRead(notification.id)); // dropdown shows viewed colour immediately
            setOpenNotifications(false);
            navigate(notificationsListPath, { state: { markedViewedId: notification.id } }); // page shows it as viewed on load
            return;
        }
        dispatch(markAsRead(notification.id));
    };

    // Handle mark all as read
    const handleMarkAllAsRead = () => {
        dispatch(markAllAsRead());
    };

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setOpenDropDown(false);
            }
            if (notificationRef.current && !notificationRef.current.contains(event.target)) {
                setOpenNotifications(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [])

    // Fetch latest 10 alerts on first load (auth + location from cookies)
    useEffect(() => {
        let cancelled = false;
        const fetchLatestAlerts = async () => {
            try {
                const res = await axiosInstance.get('/api/alerts/latest', { params: { limit: 10 } });
                if (cancelled) return;
                const alerts = res.data?.data?.alerts;
                if (Array.isArray(alerts)) {
                    dispatch(setAlertsFromApi({ alerts }));
                }
            } catch (err) {
                // Non-fatal: leave notifications as-is (e.g. 401 when not logged in)
            }
        };
        fetchLatestAlerts();
        return () => { cancelled = true; };
    }, [dispatch]);

    // Dispatch currency to Redux whenever Country changes
    useEffect(() => {
        if (Country && Currency) {
            dispatch(setCurrency({
                currency: Currency,
                country: Country
            }));
        }
    }, [Country, Currency, dispatch])

    // -------- Breadcrumbs: full path (every segment) --------
    const pathname = location.pathname || ''
    const isDemoSellerCentralChecker = pathname.startsWith('/seller-central-checker-demo/')
    const staticSellerCheckerSegments = new Set([
        'dashboard',
        'qmate',
        'profitibility-dashboard',
        'ppc-dashboard',
        'keyword-analysis',
        'issues',
        'issues-by-product',
        'account-history',
        'settings',
        'reimbursement-dashboard',
        'your-products',
        'pre-analysis',
        'tasks',
        'ecommerce-calendar',
        'notifications',
        'notification-details',
        'user-logging',
        'consultation'
    ])

    let breadcrumbItems = []
    if (pathname.startsWith('/seller-central-checker')) {
        const fullPath = pathname.replace(/\/+$/, '')
        const segments = fullPath.split('/').filter(Boolean)

        if (segments.length >= 2) {
            const leaf = segments[segments.length - 1]
            if (segments.length === 2 && !staticSellerCheckerSegments.has(leaf)) {
                // Product details: your-products > ASIN
                breadcrumbItems = [
                    { label: 'your-products', path: '/seller-central-checker/your-products' },
                    { label: leaf }
                ]
            } else {
                // Complete trail: every segment, each linkable except the last
                segments.forEach((seg, i) => {
                    const pathSoFar = '/' + segments.slice(0, i + 1).join('/')
                    const isLast = i === segments.length - 1
                    breadcrumbItems.push({
                        label: seg,
                        path: isLast ? null : pathSoFar
                    })
                })
            }
        }
    }

    return (
        <nav className="w-full lg:h-14 h-[8vh] flex items-center justify-between px-4 lg:px-5 border-b border-[#252C3A] bg-[rgba(11,14,20,.86)] backdrop-blur-md fixed top-0 z-50 lg:static">
            {/* Enhanced Mobile Hamburger Button */}
            <button
                className="lg:hidden p-2 rounded-lg hover:bg-[#1C2230] active:bg-[#252C3A] transition-colors duration-200 touch-manipulation"
                onClick={handleHamburger}
                aria-label="Open mobile menu"
            >
                <Menu className="w-6 h-6 text-[#A5AEC0]" />
            </button>
            {/* Breadcrumb - desktop only (hidden per redesign; current path is no longer shown here)
            {breadcrumbItems.length > 0 && (
                <div className="hidden lg:flex items-center min-w-0 flex-1 mr-4">
                    <div className="flex items-center gap-0.5 px-3 py-1.5 rounded-lg bg-[#151A23] border border-[#252C3A]">
                        {breadcrumbItems.map((item, index) => (
                            <React.Fragment key={`${item.label}-${index}`}>
                                {index > 0 && (
                                    <ChevronRight className="w-3.5 h-3.5 text-[#6B7486] flex-shrink-0 mx-0.5" aria-hidden />
                                )}
                                {item.path ? (
                                    <button
                                        type="button"
                                        onClick={() => navigate(item.path)}
                                        title={item.label}
                                        className="text-xs text-[#A5AEC0] hover:text-[#7EA8F8] hover:bg-[#1C2230] px-1.5 py-0.5 rounded transition-colors duration-150 truncate max-w-[180px]"
                                    >
                                        {item.label}
                                    </button>
                                ) : (
                                    <span
                                        title={item.label}
                                        className="text-xs text-[#F5F7FA] font-medium px-1.5 py-0.5 truncate max-w-[220px]"
                                    >
                                        {item.label}
                                    </span>
                                )}
                            </React.Fragment>
                        ))}
                    </div>
                </div>
            )}
            */}

            <div className='flex-1 flex items-center justify-between gap-2 h-full'>
              <div className='flex items-center gap-2'>
                {/* Demo CTA: show only on /seller-central-checker-demo/* */}
                {isDemoSellerCentralChecker && (
                    <div className="relative">
                        <button
                            type="button"
                            onClick={() => navigate('/sign-up')}
                            className="group flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm cursor-pointer transition-colors duration-200 bg-[#3B82F6] text-[#061021] hover:bg-[#5A97F8]"
                            title="Start your free trial"
                        >
                            <span className="hidden lg:block">Start free trial</span>
                            <span className="lg:hidden">Free trial</span>
                        </button>
                    </div>
                )}

                {/* Switch Client Button - First for Agency Admin viewing client */}
                {isAgencyAdminViewingClient && (
                    <div className="relative">
                        <button
                            onClick={handleSwitchToAgencyClients}
                            className="group flex items-center gap-2 px-3 py-2 border border-[#3B82F6]/50 text-[#7EA8F8] rounded-lg hover:border-[#3B82F6] hover:bg-[#3B82F6]/10 transition-colors duration-200 text-sm font-medium"
                            title="Switch client or go to manage clients"
                        >
                            <ArrowLeftRight className="w-4 h-4 text-[#7EA8F8] transition-colors duration-200" />
                            <span className="hidden lg:block">Switch Client</span>
                        </button>
                    </div>
                )}

                <div className='fit-content relative' ref={dropdownRef}>
                    <div
                        className={`group px-3 py-2 rounded-lg outline-none text-[13px] flex justify-center items-center gap-2 border transition-colors duration-200 ${
                            isAgencyAdminViewingClient
                                ? 'bg-[#151A23] border-[#252C3A] cursor-default'
                                : openDropDown
                                    ? 'bg-[#151A23] border-[#3B4658] cursor-pointer'
                                    : 'bg-[#151A23] border-[#252C3A] hover:border-[#3B4658] cursor-pointer'
                        }`}
                        onClick={isAgencyAdminViewingClient ? undefined : openDropDownfnc}
                        role={isAgencyAdminViewingClient ? 'img' : 'button'}
                        aria-label={isAgencyAdminViewingClient ? 'Brand and marketplace (view only)' : 'Switch brand or account'}
                    >
                        <MarketplaceLabel countryCode={Country} textClassName="font-medium text-[#F5F7FA] whitespace-nowrap" />
                        {!isAgencyAdminViewingClient && (
                            <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 text-[#6B7486] transition-transform duration-200 ${
                                openDropDown ? 'rotate-180' : 'rotate-0'
                            }`} />
                        )}
                    </div>
                    <AnimatePresence>
                        {openDropDown && (
                            <motion.div
                                initial={{ opacity: 0, scaleY: 0 }}
                                animate={{ opacity: 1, scaleY: 1 }}
                                exit={{ opacity: 0, scaleY: 0 }}
                                transition={{ duration: 0.25 }}
                                className="w-full absolute top-11 flex flex-col border border-[#252C3A] rounded-[10px] p-2 bg-[#1C2230] origin-top z-[99] min-w-[16rem] shadow-xl"
                            >
                                {/* Current account: brand + marketplace */}
                                <div className="px-2 py-2">
                                    <p className="text-[10px] font-semibold uppercase tracking-wide text-[#6B7486] mb-1.5">Current account</p>
                                    <div className="flex items-center gap-3">
                                        <Building className="w-4 h-4 flex-shrink-0 text-[#7EA8F8]" />
                                        <div className="flex-1 min-w-0">
                                            <p className="font-semibold text-[#F5F7FA] truncate">{truncateBrandName(user?.brand)}</p>
                                            <MarketplaceLabel countryCode={Country} textClassName="text-xs text-[#A5AEC0]" />
                                        </div>
                                    </div>
                                </div>
                                <div className="border-t border-[#252C3A] my-1"></div>

                                {/* Show existing accounts if there are multiple accounts */}
                                {sellerAccount.length > 1 && sellerAccount
                                    .filter(elm => !(elm.country === Country && (elm.brand || "Brand Name") === (user?.brand || "Brand Name")))
                                    .map((elm, key) =>
                                    <motion.div
                                        key={key}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ duration: 0.2, delay: key * 0.05 }}
                                        className="group min-w-[13rem] bg-[#151A23] hover:bg-[#252C3A] cursor-pointer rounded-lg text-xs lg:text-sm p-3 border border-transparent hover:border-[#3B4658] transition-colors duration-200"
                                        onClick={elm.userId ? () => switchAccount(elm.country, elm.region) : () => switchAccount(elm.country, elm.region)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Building className="w-4 h-4 flex-shrink-0 text-[#6B7486] group-hover:text-[#7EA8F8] transition-colors duration-200" />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-[#F5F7FA] group-hover:text-[#7EA8F8] transition-colors duration-200 truncate">
                                                    {truncateBrandName(elm.brand)}
                                                </p>
                                                <MarketplaceLabel countryCode={elm.country} textClassName="text-xs text-[#6B7486] font-medium" />
                                            </div>
                                            <ChevronRight className="w-4 h-4 text-[#6B7486] group-hover:text-[#7EA8F8] opacity-0 group-hover:opacity-100 transition-all duration-200" />
                                        </div>
                                    </motion.div>
                                )}

                                {/* Add New Account Option - Hidden for agency admin viewing client */}
                                {!isAgencyAdminViewingClient && (
                                    <>
                                        {sellerAccount.length > 1 && (
                                            <div className="border-t border-[#252C3A] my-1"></div>
                                        )}
                                        <motion.div
                                            initial={{ opacity: 0, x: -10 }}
                                            animate={{ opacity: 1, x: 0 }}
                                            transition={{ duration: 0.2, delay: sellerAccount.length * 0.05 }}
                                            className="group min-w-[13rem] bg-[#151A23] hover:bg-[#252C3A] cursor-pointer rounded-lg text-xs lg:text-sm p-3 border border-dashed border-[#252C3A] hover:border-[#22C55E]/50 transition-colors duration-200"
                                            onClick={() => {
                                                setOpenDropDown(false);
                                                navigate('/seller-central-checker/settings?tab=account-integration');
                                            }}
                                        >
                                            <div className="flex items-center gap-3">
                                                <Plus className="w-4 h-4 flex-shrink-0 text-[#6B7486] group-hover:text-[#22C55E] transition-colors duration-200" />
                                                <div className="flex-1">
                                                    <p className="font-semibold text-[#A5AEC0] group-hover:text-[#22C55E] transition-colors duration-200">
                                                        Add New Account
                                                    </p>
                                                    <p className="text-xs text-[#6B7486]">
                                                        Connect another marketplace
                                                    </p>
                                                </div>
                                                <ChevronRight className="w-4 h-4 text-[#6B7486] group-hover:text-[#22C55E] opacity-0 group-hover:opacity-100 transition-all duration-200" />
                                            </div>
                                        </motion.div>
                                    </>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>

                </div>

                {/* Date range - always visible in the navbar, on every page. The underlying
                    startDate/endDate/calendarMode in Redux already drives filtering on
                    several pages (Dashboard, PPC, Profitability), not just this one. */}
                <div className="relative" ref={calenderRef}>
                    <button
                        ref={calendarAnchorRef}
                        onClick={() => setOpenCalender(!openCalender)}
                        className="flex items-center gap-2 px-3 py-2 rounded-lg outline-none text-[13px] border transition-colors duration-200 bg-[#151A23] border-[#252C3A] hover:border-[#3B4658]"
                    >
                        <Calendar className="w-3.5 h-3.5 text-[#6B7486]" />
                        <span className="font-medium text-[#F5F7FA] whitespace-nowrap">{selectedPeriod}</span>
                    </button>

                    {openCalender && (
                        <Calender
                            anchorRef={calendarAnchorRef}
                            setOpenCalender={setOpenCalender}
                            setSelectedPeriod={setSelectedPeriod}
                        />
                    )}
                </div>

                {/* Refresh - icon only, beside the date picker, Dashboard route only */}
                {isDashboardRoute && (
                    <button
                        type="button"
                        onClick={() => refreshDashboard()}
                        disabled={isRefreshingDashboard}
                        title="Reload all dashboard data (sales, health, charts, top products)"
                        aria-label="Refresh dashboard data"
                        className="w-8 h-8 rounded-lg flex items-center justify-center border border-[#252C3A] hover:border-[#3B4658] bg-[#151A23] transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 text-[#6B7486] ${isRefreshingDashboard ? 'animate-spin' : ''}`} />
                    </button>
                )}

                {/* Switch Account Button - Only visible for Super Admin */}
                {isSuperAdmin && loggedInAsUser && (
                    <div className="relative">
                        <button
                            onClick={handleSwitchToAdmin}
                            className="w-8 h-8 rounded-lg flex items-center justify-center border border-[#F5A623]/50 text-[#F5A623] hover:border-[#F5A623] hover:bg-[#F5A623]/10 transition-colors duration-200"
                            title="Switch back to admin account"
                            aria-label="Switch back to admin account"
                        >
                            <ArrowLeftRight className="w-4 h-4" />
                        </button>
                    </div>
                )}
              </div>

              <div className='flex items-center gap-2'>
                <div className="relative" ref={notificationRef}>
                    <div
                        className={`group w-8 h-8 rounded-lg flex items-center justify-center cursor-pointer transition-colors duration-200 border ${
                            openNotifications
                                ? 'bg-[#1C2230] border-[#3B4658]'
                                : 'bg-[#151A23] hover:border-[#3B4658] border-[#252C3A]'
                        }`}
                        onClick={handleNotificationClick}
                    >
                        <Bell className={`w-4 h-4 transition-colors duration-200 ${
                            openNotifications ? 'text-[#F5F7FA]' : 'text-[#A5AEC0] group-hover:text-[#F5F7FA]'
                        }`} />
                        {unreadCount > 0 && (
                            <div className='absolute -top-1 -right-1 bg-[#EF4444] text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full min-w-[16px] text-center leading-4'>
                                {unreadCount > 99 ? '99+' : unreadCount}
                            </div>
                        )}
                    </div>

                    {/* Notification Dropdown */}
                    <AnimatePresence>
                        {openNotifications && (
                            <motion.div
                                initial={{ opacity: 0, scaleY: 0 }}
                                animate={{ opacity: 1, scaleY: 1 }}
                                exit={{ opacity: 0, scaleY: 0 }}
                                transition={{ duration: 0.25 }}
                                className="absolute top-14 right-0 w-96 max-h-[500px] bg-[#1C2230] border border-[#252C3A] rounded-[10px] origin-top z-[999] overflow-hidden shadow-xl"
                            >
                                {/* Header */}
                                <div className="p-5 border-b border-[#252C3A] flex justify-between items-center bg-[#151A23]">
                                    <div className="flex items-center gap-3">
                                        <Bell className="w-5 h-5 flex-shrink-0 text-[#7EA8F8]" />
                                        <div>
                                            <h3 className="font-bold text-[#F5F7FA]">Notifications</h3>
                                            {unreadCount > 0 && (
                                                <p className="text-xs text-[#6B7486]">{unreadCount} unread</p>
                                            )}
                                        </div>
                                    </div>
                                    {unreadCount > 0 && (
                                        <button
                                            onClick={handleMarkAllAsRead}
                                            className="text-xs font-medium text-[#7EA8F8] hover:text-[#A9C4FB] bg-[#3B82F6]/15 hover:bg-[#3B82F6]/25 px-3 py-1.5 rounded-lg transition-colors duration-200"
                                        >
                                            Mark all read
                                        </button>
                                    )}
                                </div>

                                {/* Notifications List */}
                                <div className="max-h-80 overflow-y-auto">
                                    {notifications.length === 0 ? (
                                        <div className="p-8 text-center">
                                            <Bell className="w-12 h-12 text-[#6B7486] mx-auto mb-4" />
                                            <h4 className="font-semibold text-[#A5AEC0] mb-2">No notifications yet</h4>
                                            <p className="text-sm text-[#6B7486]">You're all caught up! New notifications will appear here.</p>
                                        </div>
                                    ) : (
                                        notifications.slice(0, 10).map((notification, index) => (
                                            <motion.div
                                                key={notification.id}
                                                initial={{ opacity: 0, x: 20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ duration: 0.2, delay: index * 0.05 }}
                                                onClick={() => handleNotificationItemClick(notification)}
                                                className={`group p-4 mx-2 my-1 rounded-lg cursor-pointer transition-colors duration-200 ${
                                                    !notification.isRead
                                                        ? 'bg-[#3B82F6]/10 border border-[#3B82F6]/30 hover:border-[#3B82F6]/50'
                                                        : 'hover:bg-[#151A23] border border-transparent hover:border-[#252C3A]'
                                                }`}
                                            >
                                                <div className="flex gap-3">
                                                    <Bell className={`w-4 h-4 flex-shrink-0 transition-colors duration-200 ${
                                                        notification.type === 'alert'
                                                            ? (notification.alertType === 'ProductContentChange' ? 'text-[#F5A623]' : notification.alertType === 'BuyBoxMissing' ? 'text-[#7EA8F8]' : notification.alertType === 'APlusMissing' ? 'text-[#22C55E]' : 'text-[#F87171]')
                                                            : notification.type === 'analysis_complete'
                                                                ? 'text-[#22C55E]'
                                                                : 'text-[#F5A623]'
                                                    }`} />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start mb-2">
                                                            <h4 className={`text-sm font-semibold leading-tight ${
                                                                !notification.isRead ? 'text-[#F5F7FA]' : 'text-[#A5AEC0]'
                                                            }`}>
                                                                {notification.type === 'alert' ? getAlertDropdownTitle(notification.alertType) : notification.title}
                                                            </h4>
                                                            <div className="flex items-center gap-2 ml-2">
                                                                {notification.type === 'issues_found' && notification.issueCount && (
                                                                    <span className="px-2 py-1 bg-[#EF4444]/15 text-[#F87171] text-xs font-medium rounded-full">
                                                                        {notification.issueCount}
                                                                    </span>
                                                                )}
                                                                {!notification.isRead && (
                                                                    <div className="w-2.5 h-2.5 bg-[#3B82F6] rounded-full"></div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {notification.type === 'alert' ? (
                                                            <p className="text-xs text-[#6B7486] mb-2 leading-relaxed">
                                                                {notification.products?.length > 0
                                                                    ? `${notification.products.length} product${notification.products.length === 1 ? '' : 's'} affected`
                                                                    : (notification.message || 'Alert').slice(0, 50)}
                                                            </p>
                                                        ) : (
                                                            <p className="text-xs text-[#6B7486] mb-3 line-clamp-2 leading-relaxed">
                                                                {notification.message}
                                                            </p>
                                                        )}
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-xs text-[#6B7486] font-medium">
                                                                {formatTimestamp(notification.timestamp)}
                                                            </span>
                                                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium border ${
                                                                notification.type === 'alert'
                                                                    ? (notification.alertType === 'ProductContentChange' ? 'bg-[#F5A623]/12 text-[#F5A623] border-[#F5A623]/25' : notification.alertType === 'BuyBoxMissing' ? 'bg-[#3B82F6]/12 text-[#7EA8F8] border-[#3B82F6]/25' : notification.alertType === 'APlusMissing' ? 'bg-[#22C55E]/12 text-[#22C55E] border-[#22C55E]/25' : 'bg-[#EF4444]/12 text-[#F87171] border-[#EF4444]/25')
                                                                    : notification.type === 'analysis_complete'
                                                                        ? 'bg-[#22C55E]/12 text-[#22C55E] border-[#22C55E]/25'
                                                                        : 'bg-[#F5A623]/12 text-[#F5A623] border-[#F5A623]/25'
                                                            }`}>
                                                                {notification.type === 'alert' ? (notification.alertType === 'ProductContentChange' ? 'Content' : notification.alertType === 'BuyBoxMissing' ? 'Buy box' : notification.alertType === 'APlusMissing' ? 'A+ missing' : 'Reviews') : notification.type === 'analysis_complete' ? 'Analysis' : 'Issues'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ))
                                    )}
                                </div>

                                {/* Footer: See all */}
                                <div className="p-3 border-t border-[#252C3A] bg-[#151A23] text-center">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setOpenNotifications(false);
                                            navigate(notificationsListPath);
                                        }}
                                        className="text-sm font-medium text-[#7EA8F8] hover:text-[#A9C4FB] hover:underline"
                                    >
                                        See all
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                {/* Profile Photo - Always visible; non-clickable for agency admin viewing client */}
                <div
                    className={`group w-8 h-8 rounded-lg overflow-hidden transition-colors duration-200 border border-[#252C3A] ${
                        isAgencyAdminViewingClient
                            ? 'cursor-default opacity-90'
                            : 'cursor-pointer hover:border-[#3B4658]'
                    }`}
                    onClick={isAgencyAdminViewingClient ? undefined : () => navigate('/seller-central-checker/settings')}
                    role={isAgencyAdminViewingClient ? 'img' : 'button'}
                    aria-label={isAgencyAdminViewingClient ? 'Profile (view only)' : 'Go to settings'}
                >
                    {profilepic ? (
                        <img
                            src={profilepic}
                            alt="Profile"
                            className="w-full h-full object-cover"
                        />
                    ) : (
                        <div className="w-full h-full bg-[#151A23] flex items-center justify-center">
                            <User className="w-4 h-4 text-[#A5AEC0]" />
                        </div>
                    )}
                </div>
              </div>
            </div>

            {/* Loading Screen Overlay — rendered via portal to document.body. The nav has
                backdrop-blur, which creates a new containing block for `position: fixed`
                descendants, so without the portal this centers inside the 56px nav bar
                instead of the viewport. Plain div (no framer-motion) to keep this path simple. */}
            {isLoading && createPortal(
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]">
                    <div className="bg-[#1C2230] rounded-[10px] p-8 flex flex-col items-center justify-center border border-[#252C3A]">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#3B82F6] mb-4"></div>
                        <p className="text-[#F5F7FA] text-lg font-medium">Switching Account...</p>
                        <p className="text-[#6B7486] text-sm mt-2">Please wait</p>
                    </div>
                </div>,
                document.body
            )}
        </nav>
    )
}

export default TopNav