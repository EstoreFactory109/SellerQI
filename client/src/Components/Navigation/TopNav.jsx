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
            <img src={hamburger} className='w-[1.5rem] lg:hidden' onClick={handleHamburger} />
            <div className='flex items-center justify-end  lg:gap-7 gap-2 h-full'>
                <div className='fit-content relative' ref={dropdownRef}>
                    <div className="lg:px-4 lg:py-1 rounded-md outline-none text-xs lg:text-base flex justify-center items-center gap-2 min-w-[13rem] border-2 border-gray-300 cursor-pointer bg-gray-50" onClick={openDropDownfnc}>
                        <p>{truncateBrandName(user?.brand)} | {marketplaces[Country]}</p>
                        <img src={Arrow} alt="" className='w-3 h-2 ' />
                    </div>
                    <AnimatePresence>
                        {openDropDown && (
                            <motion.div
                                initial={{ opacity: 0, scaleY: 0 }}
                                animate={{ opacity: 1, scaleY: 1 }}
                                exit={{ opacity: 0, scaleY: 0 }}
                                transition={{ duration: 0.25 }}
                                className="w-full absolute top-10 flex flex-col shadow-sm shadow-black p-1 bg-white origin-top z-[99] "
                            >
                                {/* Show existing accounts if there are multiple accounts */}
                                {sellerAccount.length > 1 && sellerAccount
                                    .filter(elm => !(elm.country === Country && (elm.brand || "Brand Name") === (user?.brand || "Brand Name")))
                                    .map((elm, key) =>
                                    <div
                                        key={key}
                                        className="min-w-[13rem] min-h-10 bg-white flex justify-start items-center hover:bg-[#333651] hover:text-white cursor-pointer rounded-md text-xs lg:text-base px-6 "
                                        onClick={elm.userId ? () => switchAccount(elm.userId, elm.country, elm.region) : () => switchAccount(elm.country, elm.region)}
                                    >
                                        {truncateBrandName(elm.brand)} | {marketplaces[elm.country]}
                                    </div>
                                )}
                                
                                {/* Add New Account Option */}
                                <div
                                    className="min-w-[13rem] min-h-10 bg-white flex justify-start items-center hover:bg-[#333651] hover:text-white cursor-pointer rounded-md text-xs lg:text-base px-6 border-t border-gray-200"
                                    onClick={() => {
                                        setOpenDropDown(false);
                                        navigate('/seller-central-checker/settings?tab=account-integration');
                                    }}
                                >
                                    + Add New Account
                                </div>
                            </motion.div>
                        )}
                    </AnimatePresence>

                </div>
                <div className="w-6 h-6 lg:w-7 lg:h-8 relative flex justify-center items-center mr-2" ref={notificationRef}>
                    <img 
                        src={Notification} 
                        alt="" 
                        className='w-[70%] h-[70%] cursor-pointer' 
                        onClick={handleNotificationClick}
                    />
                    {unreadCount > 0 && (
                        <p className='absolute text-white bg-[#b92533] text-[8px] lg:text-xs px-[3px] py-[0.5px] lg:px-[4px] rounded-full top-0 right-0'>
                            {unreadCount > 99 ? '99+' : unreadCount}
                        </p>
                    )}

                    {/* Notification Dropdown */}
                    <AnimatePresence>
                        {openNotifications && (
                            <motion.div
                                initial={{ opacity: 0, scaleY: 0 }}
                                animate={{ opacity: 1, scaleY: 1 }}
                                exit={{ opacity: 0, scaleY: 0 }}
                                transition={{ duration: 0.25 }}
                                className="absolute top-8 right-0 w-80 max-h-96 bg-white border border-gray-200 rounded-lg shadow-lg origin-top z-[999] overflow-hidden"
                            >
                                {/* Header */}
                                <div className="p-4 border-b border-gray-100 flex justify-between items-center">
                                    <h3 className="font-semibold text-gray-800">Notifications</h3>
                                    {unreadCount > 0 && (
                                        <button
                                            onClick={handleMarkAllAsRead}
                                            className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
                                        >
                                            Mark all as read
                                        </button>
                                    )}
                                </div>

                                {/* Notifications List */}
                                <div className="max-h-80 overflow-y-auto">
                                    {notifications.length === 0 ? (
                                        <div className="p-6 text-center text-gray-500">
                                            <img src={Notification} alt="" className="w-12 h-12 mx-auto mb-2 opacity-50" />
                                            <p>No notifications yet</p>
                                        </div>
                                    ) : (
                                        notifications.slice(0, 10).map((notification) => (
                                            <div
                                                key={notification.id}
                                                onClick={() => handleNotificationItemClick(notification.id)}
                                                className={`p-4 border-b border-gray-50 cursor-pointer hover:bg-gray-50 transition-colors ${
                                                    !notification.isRead ? 'bg-blue-50' : ''
                                                }`}
                                            >
                                                <div className="flex justify-between items-start mb-1">
                                                    <h4 className={`text-sm font-medium ${
                                                        !notification.isRead ? 'text-gray-900' : 'text-gray-700'
                                                    }`}>
                                                        {notification.title}
                                                    </h4>
                                                    <div className="flex items-center gap-2">
                                                        {notification.type === 'issues_found' && notification.issueCount && (
                                                            <span className="px-2 py-1 bg-red-100 text-red-600 text-xs rounded-full">
                                                                {notification.issueCount}
                                                            </span>
                                                        )}
                                                        {!notification.isRead && (
                                                            <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
                                                        )}
                                                    </div>
                                                </div>
                                                <p className="text-xs text-gray-600 mb-2 line-clamp-2">
                                                    {notification.message}
                                                </p>
                                                <div className="flex justify-between items-center">
                                                    <span className="text-xs text-gray-400">
                                                        {formatTimestamp(notification.timestamp)}
                                                    </span>
                                                    <span className={`text-xs px-2 py-1 rounded ${
                                                        notification.type === 'analysis_complete' 
                                                            ? 'bg-green-100 text-green-600' 
                                                            : 'bg-orange-100 text-orange-600'
                                                    }`}>
                                                        {notification.type === 'analysis_complete' ? 'Analysis' : 'Issues'}
                                                    </span>
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>

                                {/* Footer */}
                                {notifications.length > 10 && (
                                    <div className="p-3 border-t border-gray-100 text-center">
                                        <p className="text-xs text-gray-500">
                                            Showing latest 10 of {notifications.length} notifications
                                        </p>
                                    </div>
                                )}
                            </motion.div>
                        )}
                    </AnimatePresence>
                </div>
                <img src={profilepic || ProfileIcon} alt="" className="lg:w-8 lg:h-8 w-6 h-6 rounded-full border-2 border-gray-300 cursor-pointer" onClick={() => navigate('/seller-central-checker/settings')} />
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