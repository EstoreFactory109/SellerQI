import React, { useRef, useState, useEffect } from 'react'
import Notification from '../../assets/Icons/notification.png'
import hamburger from '../../assets/Icons/hamburger.png'
import { useSelector, useDispatch } from 'react-redux'
import { setPosition } from '../../redux/slices/MobileMenuSlice.js'
import { markAsRead, markAllAsRead } from '../../redux/slices/notificationsSlice.js'
import ProfileIcon from '../../assets/Icons/ProfileIcon.jpg'
import Arrow from '../../assets/Icons/Arrow.png'
import { useNavigate } from 'react-router-dom'
import { AnimatePresence, motion } from 'framer-motion';
import { Building, Plus, ChevronRight, Bell, User, Menu, ArrowLeftRight } from 'lucide-react'
import axios from 'axios'

const TopNav = () => {
    const navigate = useNavigate()
    const marketplaces = {
        US: "United States",
        CA: "Canada",
        MX: "Mexico",
        BR: "Brazil",
        UK: "United Kingdom",
        DE: "Germany",
        FR: "France",
        IT: "Italy",
        ES: "Spain",
        NL: "Netherlands",
        BE: "Belgium",
        SE: "Sweden",
        PL: "Poland",
        TR: "Turkey",
        SA: "Saudi Arabia",
        AE: "United Arab Emirates",
        EG: "Egypt",
        ZA: "South Africa",
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


    const user = useSelector((state) => state.Auth?.user);
    const Country = useSelector((state) => state.Dashboard?.DashBoardInfo?.Country);
    const sellerAccount = useSelector(state => state.AllAccounts?.AllAccounts) || []
    const notifications = useSelector(state => state.notifications?.notifications) || []
    const unreadCount = useSelector(state => state.notifications?.unreadCount) || 0
    const [openDropDown, setOpenDropDown] = useState(false);
    const [openNotifications, setOpenNotifications] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const dispatch = useDispatch();
    
    // Check if super admin is logged in
    const isAdminLoggedIn = localStorage.getItem('isAdminAuth') === 'true';
    const adminAccessType = localStorage.getItem('adminAccessType');
    const isSuperAdmin = isAdminLoggedIn && adminAccessType === 'superAdmin';
    const loggedInAsUser = localStorage.getItem('loggedInAsUser');
    const profilepic = useSelector(state => state.profileImage?.imageLink)
    const dropdownRef = useRef(null)
    const notificationRef = useRef(null)
    console.log(sellerAccount)

    const switchAccount = async (userId="",country,region) => {
        try{
            setIsLoading(true);
            const data={
                userId:userId,
                country:country,
                region:region
            }
           
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

    // Handle notification item click
    const handleNotificationItemClick = (notificationId) => {
        dispatch(markAsRead(notificationId));
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

    return (
        <nav className="w-full lg:w-[83vw] lg:h-[10vh] h-[8vh] flex items-center justify-between lg:justify-end p-10 lg:gap-7 gap-2 shadow-md bg-white border-b-[1px] border-gray-200 fixed top-0 z-50 lg:static">
            {/* Enhanced Mobile Hamburger Button */}
            <button 
                className="lg:hidden p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors duration-200 touch-manipulation"
                onClick={handleHamburger}
                aria-label="Open mobile menu"
            >
                <Menu className="w-6 h-6 text-gray-700" />
            </button>
            <div className='flex items-center justify-end  lg:gap-7 gap-2 h-full'>
                <div className='fit-content relative' ref={dropdownRef}>
                    <div 
                        className={`group lg:px-6 lg:py-3 px-4 py-2 rounded-xl outline-none text-xs lg:text-sm flex justify-center items-center gap-3 min-w-[13rem] border cursor-pointer transition-all duration-300 shadow-sm ${
                            openDropDown 
                                ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border-blue-400 shadow-lg ring-2 ring-blue-100' 
                                : 'bg-white border-gray-200 hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 hover:border-blue-300 hover:shadow-md'
                        }`}
                        onClick={openDropDownfnc}
                    >
                        <div className="flex items-center gap-3 flex-1">
                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center transition-all duration-300 ${
                                openDropDown 
                                    ? 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-md' 
                                    : 'bg-gradient-to-br from-green-500 to-emerald-600 shadow-sm'
                            }`}>
                                <Building className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex flex-col items-start">
                                <p className={`font-semibold transition-colors duration-200 ${
                                    openDropDown ? 'text-blue-700' : 'text-gray-800 group-hover:text-gray-900'
                                }`}>
                                    {truncateBrandName(user?.brand)}
                                </p>
                                <p className="text-xs text-gray-500 font-medium">
                                    {marketplaces[Country]}
                                </p>
                            </div>
                        </div>
                        <div className={`p-1.5 rounded-lg transition-all duration-300 ${
                            openDropDown 
                                ? 'bg-blue-100 text-blue-600' 
                                : 'bg-gray-100 text-gray-500 group-hover:bg-blue-100 group-hover:text-blue-600'
                        }`}>
                            <img 
                                src={Arrow} 
                                alt="" 
                                className={`w-3.5 h-2.5 transition-transform duration-300 ${
                                    openDropDown ? 'rotate-180' : 'rotate-0'
                                }`}
                            />
                        </div>
                    </div>
                    <AnimatePresence>
                        {openDropDown && (
                            <motion.div
                                initial={{ opacity: 0, scaleY: 0 }}
                                animate={{ opacity: 1, scaleY: 1 }}
                                exit={{ opacity: 0, scaleY: 0 }}
                                transition={{ duration: 0.25 }}
                                className="w-full absolute top-16 flex flex-col shadow-xl border border-gray-200/80 rounded-2xl p-3 bg-white/95 backdrop-blur-sm origin-top z-[99] min-w-[16rem]"
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
                                        className="group min-w-[13rem] bg-white hover:bg-gradient-to-r hover:from-blue-50 hover:to-indigo-50 cursor-pointer rounded-lg text-xs lg:text-sm p-3 border border-transparent hover:border-blue-200 transition-all duration-200 hover:shadow-sm"
                                        onClick={elm.userId ? () => switchAccount(elm.userId, elm.country, elm.region) : () => switchAccount(elm.country, elm.region)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="w-6 h-6 bg-gradient-to-br from-gray-400 to-gray-500 rounded-lg flex items-center justify-center flex-shrink-0">
                                                <Building className="w-3.5 h-3.5 text-white" />
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className="font-semibold text-gray-800 group-hover:text-blue-700 transition-colors duration-200 truncate">
                                                    {truncateBrandName(elm.brand)}
                                                </p>
                                                <p className="text-xs text-gray-500 font-medium">
                                                    {marketplaces[elm.country]}
                                                </p>
                                            </div>
                                            <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 opacity-0 group-hover:opacity-100 transition-all duration-200" />
                                        </div>
                                    </motion.div>
                                )}
                                
                                {/* Add New Account Option */}
                                {sellerAccount.length > 1 && (
                                    <div className="border-t border-gray-100 my-1"></div>
                                )}
                                <motion.div
                                    initial={{ opacity: 0, x: -10 }}
                                    animate={{ opacity: 1, x: 0 }}
                                    transition={{ duration: 0.2, delay: sellerAccount.length * 0.05 }}
                                    className="group min-w-[13rem] bg-white hover:bg-gradient-to-r hover:from-green-50 hover:to-emerald-50 cursor-pointer rounded-lg text-xs lg:text-sm p-3 border border-dashed border-gray-300 hover:border-green-300 transition-all duration-200 hover:shadow-sm"
                                    onClick={() => {
                                        setOpenDropDown(false);
                                        navigate('/seller-central-checker/settings?tab=account-integration');
                                    }}
                                >
                                    <div className="flex items-center gap-3">
                                        <div className="w-6 h-6 bg-gradient-to-br from-green-500 to-emerald-600 rounded-lg flex items-center justify-center flex-shrink-0">
                                            <Plus className="w-3.5 h-3.5 text-white" />
                                        </div>
                                        <div className="flex-1">
                                            <p className="font-semibold text-gray-700 group-hover:text-green-700 transition-colors duration-200">
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
                            className="group flex items-center gap-2 px-4 py-2 bg-gradient-to-r from-orange-500 to-red-600 text-white rounded-xl hover:from-orange-600 hover:to-red-700 transition-all duration-300 shadow-sm hover:shadow-md text-sm font-medium"
                            title="Switch back to admin account"
                        >
                            <ArrowLeftRight className="w-4 h-4" />
                            <span className="hidden lg:block">Switch Account</span>
                        </button>
                    </div>
                )}
                
                <div className="relative mr-3" ref={notificationRef}>
                    <div 
                        className={`group w-10 h-10 lg:w-11 lg:h-11 rounded-xl flex items-center justify-center cursor-pointer transition-all duration-300 ${
                            openNotifications 
                                ? 'bg-gradient-to-br from-blue-500 to-indigo-600 shadow-lg ring-2 ring-blue-100' 
                                : 'bg-gray-100 hover:bg-gradient-to-br hover:from-blue-50 hover:to-indigo-50 hover:shadow-md'
                        }`}
                        onClick={handleNotificationClick}
                    >
                        <Bell className={`w-5 h-5 transition-colors duration-300 ${
                            openNotifications ? 'text-white' : 'text-gray-600 group-hover:text-blue-600'
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
                                className="absolute top-14 right-0 w-96 max-h-[500px] bg-white/95 backdrop-blur-sm border border-gray-200/80 rounded-2xl shadow-xl origin-top z-[999] overflow-hidden"
                            >
                                {/* Header */}
                                <div className="p-5 border-b border-gray-100/60 flex justify-between items-center bg-gradient-to-r from-gray-50/50 to-blue-50/30">
                                    <div className="flex items-center gap-3">
                                        <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-indigo-600 rounded-lg flex items-center justify-center">
                                            <Bell className="w-4 h-4 text-white" />
                                        </div>
                                        <div>
                                            <h3 className="font-bold text-gray-900">Notifications</h3>
                                            {unreadCount > 0 && (
                                                <p className="text-xs text-gray-500">{unreadCount} unread</p>
                                            )}
                                        </div>
                                    </div>
                                    {unreadCount > 0 && (
                                        <button
                                            onClick={handleMarkAllAsRead}
                                            className="text-xs font-medium text-blue-600 hover:text-blue-800 bg-blue-50 hover:bg-blue-100 px-3 py-1.5 rounded-lg transition-all duration-200"
                                        >
                                            Mark all read
                                        </button>
                                    )}
                                </div>

                                {/* Notifications List */}
                                <div className="max-h-80 overflow-y-auto">
                                    {notifications.length === 0 ? (
                                        <div className="p-8 text-center">
                                            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                                                <Bell className="w-8 h-8 text-gray-400" />
                                            </div>
                                            <h4 className="font-semibold text-gray-700 mb-2">No notifications yet</h4>
                                            <p className="text-sm text-gray-500">You're all caught up! New notifications will appear here.</p>
                                        </div>
                                    ) : (
                                        notifications.slice(0, 10).map((notification, index) => (
                                            <motion.div
                                                key={notification.id}
                                                initial={{ opacity: 0, x: 20 }}
                                                animate={{ opacity: 1, x: 0 }}
                                                transition={{ duration: 0.2, delay: index * 0.05 }}
                                                onClick={() => handleNotificationItemClick(notification.id)}
                                                className={`group p-4 mx-2 my-1 rounded-xl cursor-pointer transition-all duration-200 hover:shadow-sm ${
                                                    !notification.isRead 
                                                        ? 'bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 hover:border-blue-200' 
                                                        : 'hover:bg-gray-50 border border-transparent hover:border-gray-100'
                                                }`}
                                            >
                                                <div className="flex gap-3">
                                                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
                                                        notification.type === 'analysis_complete' 
                                                            ? 'bg-gradient-to-br from-green-500 to-emerald-600' 
                                                            : 'bg-gradient-to-br from-orange-500 to-red-600'
                                                    }`}>
                                                        <Bell className="w-4 h-4 text-white" />
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex justify-between items-start mb-2">
                                                            <h4 className={`text-sm font-semibold leading-tight ${
                                                                !notification.isRead ? 'text-gray-900' : 'text-gray-700'
                                                            }`}>
                                                                {notification.title}
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
                                                        <p className="text-xs text-gray-600 mb-3 line-clamp-2 leading-relaxed">
                                                            {notification.message}
                                                        </p>
                                                        <div className="flex justify-between items-center">
                                                            <span className="text-xs text-gray-400 font-medium">
                                                                {formatTimestamp(notification.timestamp)}
                                                            </span>
                                                            <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${
                                                                notification.type === 'analysis_complete' 
                                                                    ? 'bg-green-100 text-green-700 border border-green-200' 
                                                                    : 'bg-orange-100 text-orange-700 border border-orange-200'
                                                            }`}>
                                                                {notification.type === 'analysis_complete' ? 'Analysis' : 'Issues'}
                                                            </span>
                                                        </div>
                                                    </div>
                                                </div>
                                            </motion.div>
                                        ))
                                    )}
                                </div>

                                {/* Footer */}
                                {notifications.length > 10 && (
                                    <div className="p-4 border-t border-gray-100/60 bg-gradient-to-r from-gray-50/30 to-blue-50/20 text-center">
                                        <p className="text-xs font-medium text-gray-600">
                                            Showing latest 10 of {notifications.length} notifications
                                        </p>
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                <div 
                    className="group w-10 h-10 lg:w-11 lg:h-11 rounded-xl overflow-hidden cursor-pointer transition-all duration-300 hover:shadow-lg hover:scale-105 border-2 border-gray-200 hover:border-blue-300"
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
                    <div className="bg-white rounded-lg p-8 flex flex-col items-center justify-center shadow-lg">
                        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[#333651] mb-4"></div>
                        <p className="text-gray-700 text-lg font-medium">Switching Account...</p>
                        <p className="text-gray-500 text-sm mt-2">Please wait</p>
                    </div>
                </motion.div>
            )}
        </nav>
    )
}

export default TopNav