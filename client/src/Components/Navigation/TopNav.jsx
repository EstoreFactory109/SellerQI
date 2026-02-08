import React, { useRef, useState, useEffect } from 'react'
import { useSelector, useDispatch } from 'react-redux'
import { setPosition } from '../../redux/slices/MobileMenuSlice.js'
import { markAsRead, markAllAsRead, setAlertsFromApi } from '../../redux/slices/notificationsSlice.js'
import { setCurrency } from '../../redux/slices/currencySlice.js'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion';
import { Building, Plus, ChevronRight, ChevronDown, Bell, User, Menu, ArrowLeftRight } from 'lucide-react'
import axios from 'axios'
import axiosInstance from '../../config/axios.config.js'
import { amazonMarketplaceCurrencies } from '../../utils/amazonAllowedCountries.js'

const TopNav = () => {
    const navigate = useNavigate()
    const marketplaces = {
        US: "United States",
        CA: "Canada",
        MX: "Mexico",
        BR: "Brazil",
        IE: "Ireland",
        UK: "United Kingdom",
        DE: "Germany",
        FR: "France",
        IT: "Italy",
        ES: "Spain",
        NL: "Netherlands",
        BE: "Belgium",
        SE: "Sweden",
        PL: "Poland",
        ZA: "South Africa",
        TR: "Turkey",
        SA: "Saudi Arabia",
        AE: "United Arab Emirates",
        EG: "Egypt",
        IN: "India",
        JP: "Japan",
        SG: "Singapore",
        AU: "Australia"
    };

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
    const loggedInAsUser = localStorage.getItem('loggedInAsUser');
    const profilepic = useSelector(state => state.profileImage?.imageLink)
    const dropdownRef = useRef(null)
    const notificationRef = useRef(null)
    console.log(sellerAccount)

    const switchAccount = async (country,region) => {
        try{
            setIsLoading(true);
            
            const data={
              
                country:country,
                region:region
            }
           console.log("switchAccount data: ",data)
            const response=await axios.post(`${import.meta.env.VITE_BASE_URI}/app/switch-account`,data,{withCredentials:true})
            if(response.status===200){
                window.location.href = "/seller-central-checker/dashboard";
            }
        }catch(error){
            console.log(error)
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

    const handleHamburger = () => {
        dispatch(setPosition("0%"))
    }

    const openDropDownfnc = () => {
        openDropDown === false ? setOpenDropDown(true) : setOpenDropDown(false)
        console.log(openDropDown)
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
            navigate('/seller-central-checker/notifications', { state: { markedViewedId: notification.id } }); // page shows it as viewed on load
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

    return (
        <nav className="w-full lg:w-[83vw] lg:h-[10vh] h-[8vh] flex items-center justify-between lg:justify-end p-10 lg:gap-7 gap-2 border-b border-[#30363d] bg-[#161b22] fixed top-0 z-50 lg:static">
            {/* Enhanced Mobile Hamburger Button */}
            <button 
                className="lg:hidden p-2 rounded-lg hover:bg-[#21262d] active:bg-[#30363d] transition-colors duration-200 touch-manipulation"
                onClick={handleHamburger}
                aria-label="Open mobile menu"
            >
                <Menu className="w-6 h-6 text-gray-300" />
            </button>
            <div className='flex items-center justify-end  lg:gap-7 gap-2 h-full'>
                <div className='fit-content relative' ref={dropdownRef}>
                    <div 
                        className={`group lg:px-6 lg:py-3 px-4 py-2 rounded-xl outline-none text-xs lg:text-sm flex justify-center items-center gap-3 min-w-[13rem] border cursor-pointer transition-all duration-300 ${
                            openDropDown 
                                ? 'bg-[#21262d] border-blue-500/50 ring-2 ring-blue-500/20' 
                                : 'bg-[#21262d] border-blue-500/40 hover:border-blue-500/60 hover:bg-[#1c2128]'
                        }`}
                        onClick={openDropDownfnc}
                    >
                        <div className="flex items-center gap-3 flex-1">
                            <Building className={`w-4 h-4 flex-shrink-0 transition-colors duration-300 ${
                                openDropDown ? 'text-blue-400' : 'text-blue-400 group-hover:text-blue-300'
                            }`} />
                            <div className="flex flex-col items-start">
                                <p className={`font-semibold transition-colors duration-200 ${
                                    openDropDown ? 'text-blue-400' : 'text-blue-400 group-hover:text-blue-300'
                                }`}>
                                    {truncateBrandName(user?.brand)}
                                </p>
                                <p className="text-xs text-blue-300 font-medium">
                                    {marketplaces[Country]}
                                </p>
                            </div>
                        </div>
                        <ChevronDown className={`w-4 h-4 flex-shrink-0 transition-all duration-300 ${
                            openDropDown 
                                ? 'text-blue-400 rotate-180' 
                                : 'text-blue-400 group-hover:text-blue-300 rotate-0'
                        }`} />
                    </div>
                    <AnimatePresence>
                        {openDropDown && (
                            <motion.div
                                initial={{ opacity: 0, scaleY: 0 }}
                                animate={{ opacity: 1, scaleY: 1 }}
                                exit={{ opacity: 0, scaleY: 0 }}
                                transition={{ duration: 0.25 }}
                                className="w-full absolute top-16 flex flex-col border border-[#30363d] rounded-2xl p-3 bg-[#21262d] origin-top z-[99] min-w-[16rem]"
                            >
                                {/* Show existing accounts if there are multiple accounts */}
                                {sellerAccount.length > 1 && sellerAccount
                                    .filter(elm => !(elm.country === Country && (elm.brand || "Brand Name") === (user?.brand || "Brand Name")))
                                    .map((elm, key) =>
                                    <motion.div
                                        key={key}
                                        initial={{ opacity: 0, x: -10 }}
                                        animate={{ opacity: 1, x: 0 }}
                                        transition={{ duration: 0.2, delay: key * 0.05 }}
                                        className="group min-w-[13rem] bg-[#161b22] hover:bg-[#21262d] cursor-pointer rounded-lg text-xs lg:text-sm p-3 border border-transparent hover:border-blue-500/40 transition-all duration-200"
                                        onClick={elm.userId ? () => switchAccount(elm.country, elm.region) : () => switchAccount(elm.country, elm.region)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <Building className="w-4 h-4 flex-shrink-0 text-gray-400 group-hover:text-blue-400 transition-colors duration-200" />
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-gray-200 group-hover:text-blue-400 transition-colors duration-200 truncate">
                                                    {truncateBrandName(elm.brand)}
                                                </p>
                                                <p className="text-xs text-gray-500 font-medium">
                                                    {marketplaces[elm.country]}
                                                </p>
                                            </div>
                                            <ChevronRight className="w-4 h-4 text-gray-500 group-hover:text-blue-400 opacity-0 group-hover:opacity-100 transition-all duration-200" />
                                        </div>
                                    </motion.div>
                                )}
                                
                                {/* Add New Account Option */}
                                {sellerAccount.length > 1 && (
                                    <div className="border-t border-[#30363d] my-1"></div>
                                )}
                                <motion.div
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.2, delay: sellerAccount.length * 0.05 }}
                                    className="group min-w-[13rem] bg-[#161b22] hover:bg-[#21262d] cursor-pointer rounded-lg text-xs lg:text-sm p-3 border border-dashed border-[#30363d] hover:border-green-500/50 transition-all duration-200"
                                    onClick={() => {
                                        setOpenDropDown(false);
                                        navigate('/seller-central-checker/settings?tab=account-integration');
                                    }}
                                >
                                    <div className="flex items-center gap-3">
                                        <Plus className="w-4 h-4 flex-shrink-0 text-gray-400 group-hover:text-green-400 transition-colors duration-200" />
                                        <div className="flex-1">
                                            <p className="font-semibold text-gray-300 group-hover:text-green-400 transition-colors duration-200">
                                                Add New Account
                                            </p>
                                            <p className="text-xs text-gray-500">
                                                Connect another marketplace
                                            </p>
                                        </div>
                                        <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-green-500 opacity-0 group-hover:opacity-100 transition-all duration-200" />
                                    </div>
                                </motion.div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                </div>
                
                {/* Switch Account Button - Only visible for Super Admin */}
                {isSuperAdmin && loggedInAsUser && (
                    <div className="relative mr-3">
                        <button
                            onClick={handleSwitchToAdmin}
                            className="group flex items-center gap-2 px-4 py-2 border-2 border-orange-500 text-orange-500 rounded-xl hover:bg-gradient-to-r hover:from-orange-500 hover:to-red-600 hover:text-white transition-all duration-300 hover:shadow-md text-sm font-medium"
                            title="Switch back to admin account"
                        >
                            <ArrowLeftRight className="w-4 h-4 text-orange-500 group-hover:text-white transition-colors duration-300" />
                            <span className="hidden lg:block">Switch Account</span>
                        </button>
                    </div>
                )}
                
                <div className="relative mr-3" ref={notificationRef}>
                    <div 
                        className={`group w-10 h-10 lg:w-11 lg:h-11 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-300 ${
                            openNotifications 
                                ? 'bg-gradient-to-br from-blue-500 to-indigo-600 ring-2 ring-blue-500/30' 
                                : 'bg-[#21262d] hover:bg-[#1c2128] border border-[#30363d]'
                        }`}
                        onClick={handleNotificationClick}
                    >
                        <Bell className={`w-5 h-5 transition-colors duration-300 ${
                            openNotifications ? 'text-white' : 'text-gray-400 group-hover:text-blue-400'
                        }`} />
                        {unreadCount > 0 && (
                            <div className='absolute -top-1 -right-1 bg-gradient-to-r from-red-500 to-red-600 text-white text-xs font-bold px-1.5 py-0.5 rounded-full shadow-sm min-w-[20px] text-center'>
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
                                className="absolute top-14 right-0 w-96 max-h-[500px] bg-[#21262d] border border-[#30363d] rounded-2xl origin-top z-[999] overflow-hidden"
                            >
                                {/* Header */}
                                <div className="p-5 border-b border-[#30363d] flex justify-between items-center bg-[#161b22]">
                                    <div className="flex items-center gap-3">
                                        <Bell className="w-5 h-5 flex-shrink-0 text-blue-400" />
                                        <div>
                                            <h3 className="font-bold text-gray-100">Notifications</h3>
                                            {unreadCount > 0 && (
                                                <p className="text-xs text-gray-500">{unreadCount} unread</p>
                                            )}
                                        </div>
                                    </div>
                                    {unreadCount > 0 && (
                                        <button
                                            onClick={handleMarkAllAsRead}
                                            className="text-xs font-medium text-blue-400 hover:text-blue-300 bg-blue-500/20 hover:bg-blue-500/30 px-3 py-1.5 rounded-lg transition-all duration-200"
                                        >
                                            Mark all read
                                        </button>
                                    )}
                                </div>

                                {/* Notifications List */}
                                <div className="max-h-80 overflow-y-auto">
                                    {notifications.length === 0 ? (
                                        <div className="p-8 text-center">
                                            <Bell className="w-12 h-12 text-gray-500 mx-auto mb-4" />
                                            <h4 className="font-semibold text-gray-300 mb-2">No notifications yet</h4>
                                            <p className="text-sm text-gray-500">You're all caught up! New notifications will appear here.</p>
                                        </div>
                                    ) : (
                                        notifications.slice(0, 10).map((notification, index) => (
                                            <motion.div
                                                key={notification.id}
                                                initial={{ opacity: 0, x: 20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ duration: 0.2, delay: index * 0.05 }}
                                                onClick={() => handleNotificationItemClick(notification)}
                                                className={`group p-4 mx-2 my-1 rounded-xl cursor-pointer transition-all duration-200 ${
                                                    !notification.isRead 
                                                        ? 'bg-blue-500/10 border border-blue-500/30 hover:border-blue-500/50' 
                                                        : 'hover:bg-[#161b22] border border-transparent hover:border-[#30363d]'
                                                }`}
                                            >
                                                <div className="flex gap-3">
                                                    <Bell className={`w-4 h-4 flex-shrink-0 transition-colors duration-200 ${
                                                        notification.type === 'alert'
                                                            ? (notification.alertType === 'ProductContentChange' ? 'text-amber-400' : notification.alertType === 'BuyBoxMissing' ? 'text-blue-400' : notification.alertType === 'APlusMissing' ? 'text-emerald-400' : 'text-red-400')
                                                            : notification.type === 'analysis_complete' 
                                                                ? 'text-green-400' 
                                                                : 'text-orange-400'
                                                    }`} />
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start mb-2">
                                                            <h4 className={`text-sm font-semibold leading-tight ${
                                                                !notification.isRead ? 'text-gray-100' : 'text-gray-300'
                                                            }`}>
                                                                {notification.type === 'alert' ? getAlertDropdownTitle(notification.alertType) : notification.title}
                                                            </h4>
                                                            <div className="flex items-center gap-2 ml-2">
                                                                {notification.type === 'issues_found' && notification.issueCount && (
                                                                    <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-medium rounded-full">
                                                                        {notification.issueCount}
                                                                    </span>
                                                                )}
                                                                {!notification.isRead && (
                                                                    <div className="w-2.5 h-2.5 bg-blue-500 rounded-full shadow-sm"></div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {notification.type === 'alert' ? (
                                                            <p className="text-xs text-gray-400 mb-2 leading-relaxed">
                                                                {notification.products?.length > 0
                                                                    ? `${notification.products.length} product${notification.products.length === 1 ? '' : 's'} affected`
                                                                    : (notification.message || 'Alert').slice(0, 50)}
                                                            </p>
                                                        ) : (
                                                            <p className="text-xs text-gray-400 mb-3 line-clamp-2 leading-relaxed">
                                                                {notification.message}
                                                            </p>
                                                        )}
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-xs text-gray-400 font-medium">
                                                                {formatTimestamp(notification.timestamp)}
                                                            </span>
                                                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                                                                notification.type === 'alert'
                                                                    ? (notification.alertType === 'ProductContentChange' ? 'bg-amber-100 text-amber-800 border border-amber-200' : notification.alertType === 'BuyBoxMissing' ? 'bg-blue-100 text-blue-700 border border-blue-200' : notification.alertType === 'APlusMissing' ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' : 'bg-red-100 text-red-700 border border-red-200')
                                                                    : notification.type === 'analysis_complete' 
                                                                        ? 'bg-green-100 text-green-700 border border-green-200' 
                                                                        : 'bg-orange-100 text-orange-700 border border-orange-200'
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
                                <div className="p-3 border-t border-[#30363d] bg-[#161b22] text-center">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setOpenNotifications(false);
                                            navigate('/seller-central-checker/notifications');
                                        }}
                                        className="text-sm font-medium text-blue-400 hover:text-blue-300 hover:underline"
                                    >
                                        See all
                                    </button>
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                <div 
                    className="group w-10 h-10 lg:w-11 lg:h-11 rounded-xl overflow-hidden cursor-pointer transition-all duration-300 hover:scale-105 border-2 border-[#30363d] hover:border-blue-500/50"
                    onClick={() => navigate('/seller-central-checker/settings')}
                >
                    {profilepic ? (
                        <img 
                            src={profilepic} 
                            alt="Profile" 
                            className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300" 
                        />
                    ) : (
                        <div className="w-full h-full bg-gradient-to-br from-gray-400 to-gray-500 group-hover:from-blue-500 group-hover:to-indigo-600 flex items-center justify-center transition-all duration-300">
                            <User className="w-5 h-5 text-white" />
                        </div>
                    )}
                </div>
            </div>

            {/* Loading Screen Overlay */}
            {isLoading && (
                <motion.div
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.2 }}
                    className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]"
                >
                    <div className="bg-[#21262d] rounded-lg p-8 flex flex-col items-center justify-center border border-[#30363d]">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-500 mb-4"></div>
                        <p className="text-gray-200 text-lg font-medium">Switching Account...</p>
                        <p className="text-gray-500 text-sm mt-2">Please wait</p>
                    </div>
                </motion.div>
            )}
        </nav>
    )
}

export default TopNav