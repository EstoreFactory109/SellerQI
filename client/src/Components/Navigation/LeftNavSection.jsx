import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {LayoutDashboard,BadgeAlert, ClipboardPlus,Clock8,Settings,ChartLine,LaptopMinimalCheck, ChevronDown, ChevronRight, Activity, Calendar, Target, DollarSign, Search} from 'lucide-react'
import LogoutIcon from '../../assets/Icons/Logout.png';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../../redux/slices/authSlice.js'
import { clearCogsData } from '../../redux/slices/cogsSlice.js'
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import BeatLoader from "react-spinners/BeatLoader";
import { AnimatePresence, motion } from "framer-motion";

const LeftNavSection = () => {

    const dispatch = useDispatch();
    const navigate=useNavigate();
    const location = useLocation();
    const [loader,setLoader]=useState(false)
    const [issuesDropdownOpen, setIssuesDropdownOpen] = useState(false);
    const [settingsDropdownOpen, setSettingsDropdownOpen] = useState(false);
    const [sponsoredAdsDropdownOpen, setSponsoredAdsDropdownOpen] = useState(false);
    
    // Get user subscription plan from Redux store
    const user = useSelector((state) => state.Auth?.user);
    const userPlan = user?.packageType || 'LITE';
    const isLiteUser = userPlan === 'LITE';
    const isAgencyUser = userPlan === 'AGENCY';
    
    // Check for super admin access - server-side middleware will validate the actual token
    const isAdminLoggedIn = localStorage.getItem('isAdminAuth') === 'true';
    const adminAccessType = localStorage.getItem('adminAccessType');
    const isSuperAdmin = isAdminLoggedIn && adminAccessType === 'superAdmin';
    
    // Debug logging for super admin access
    console.log('🔍 Debug - User data:', {
        user: user,
        accessType: user?.accessType,
        packageType: user?.packageType,
        isAdminLoggedIn: isAdminLoggedIn,
        adminAccessType: adminAccessType,
        isSuperAdmin: isSuperAdmin,
        isLiteUser: isLiteUser,
        isAgencyUser: isAgencyUser
    });
    
    // Get current tab from URL search params
    const searchParams = new URLSearchParams(location.search);
    const currentTab = searchParams.get('tab') || 'category';
    const currentSettingsTab = searchParams.get('tab') || 'profile';
    const isIssuesPage = location.pathname === '/seller-central-checker/issues';
    const isSettingsPage = location.pathname === '/seller-central-checker/settings';
    const isPPCDashboardPage = location.pathname === '/seller-central-checker/ppc-dashboard';
    const isKeywordAnalysisPage = location.pathname === '/seller-central-checker/keyword-analysis';
    const isSponsoredAdsPage = isPPCDashboardPage || isKeywordAnalysisPage;
    
    // Keep dropdown open if we're on any issues-related page
    React.useEffect(() => {
        if (isIssuesPage || location.pathname === '/seller-central-checker/issues-by-product') {
            setIssuesDropdownOpen(true);
        }
    }, [isIssuesPage, location.pathname]);

    // Keep settings dropdown open if we're on settings page
    React.useEffect(() => {
        if (isSettingsPage) {
            setSettingsDropdownOpen(true);
        }
    }, [isSettingsPage]);

    // Keep sponsored ads dropdown open if we're on any sponsored ads-related page
    React.useEffect(() => {
        if (isSponsoredAdsPage) {
            setSponsoredAdsDropdownOpen(true);
        }
    }, [isSponsoredAdsPage]);

    // Handle Issues button click
    const handleIssuesClick = () => {
        if (!isIssuesPage) {
            // If not on issues page, navigate to category
            navigate('/seller-central-checker/issues?tab=category');
        }
        setIssuesDropdownOpen(!issuesDropdownOpen);
    };

    // Handle Settings button click
    const handleSettingsClick = () => {
        if (!isSettingsPage) {
            // If not on settings page, navigate to profile
            navigate('/seller-central-checker/settings?tab=profile');
        }
        setSettingsDropdownOpen(!settingsDropdownOpen);
    };

    // Handle Sponsored Ads button click
    const handleSponsoredAdsClick = () => {
        if (!isSponsoredAdsPage) {
            // If not on sponsored ads page, navigate to campaign audit
            navigate('/seller-central-checker/ppc-dashboard');
        }
        setSponsoredAdsDropdownOpen(!sponsoredAdsDropdownOpen);
    };
    
    const logoutUser=async(e)=>{
        e.preventDefault();
        setLoader(true)
        try {
            const response=await axios.get(`${import.meta.env.VITE_BASE_URI}/app/logout`, {withCredentials:true});
            if(response && response.status===200 ){
                console.log(response.data.message)
                dispatch(logout());
                dispatch(clearCogsData());
                localStorage.setItem("isAuth",false)
                setLoader(false)
                navigate('/')
            }
        } catch (error) {
            setLoader(false)
            throw new Error(error)
        }
    }

    // Responsive classes for menu items - compact sizing
    const menuItemClass = "group flex items-center gap-2 px-2.5 py-2 rounded-lg font-medium text-sm transition-all duration-300";
    const activeMenuItemClass = "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25 transform scale-[1.02]";
    const inactiveMenuItemClass = "text-gray-700 hover:bg-white hover:shadow-md hover:shadow-gray-200/50 hover:text-blue-600 hover:scale-[1.01]";
    const iconWrapperClass = "p-1 rounded-lg transition-colors duration-300";
    const iconClass = "w-4 h-4 transition-colors duration-300";
    const dropdownItemClass = "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-300";

    return (
        <aside className="h-screen w-[240px] xl:w-[280px] flex-shrink-0 shadow-xl border-r border-gray-200/80 font-roboto bg-gradient-to-b from-white to-gray-50/30 hidden lg:flex lg:flex-col backdrop-blur-sm overflow-hidden">
            {/* Main Container - Top and Bottom Sections */}
            <div className="flex flex-col justify-between h-full min-h-0">
                {/* Top Section - Logo and Navigation */}
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    {/* Logo Section */}
                    <div className="w-full px-3 py-6 border-b border-gray-200/50 flex-shrink-0">
                        <div className="flex items-center justify-center">
                            <img 
                                src="https://res.cloudinary.com/ddoa960le/image/upload/v1752478546/Seller_QI_Logo___V1_1_t9s3kh.png"
                                alt="Seller QI Logo"
                                loading="lazy"
                                className="h-6 w-auto object-contain transition-transform duration-300 hover:scale-105"
                                width="120"
                                height="32"
                            />
                        </div>
                    </div>

                    {/* Navigation Section */}
                    <div className="flex-1 overflow-y-auto scrollbar-hide min-h-0 flex flex-col">
                    <div className="px-2 py-2">
                        <div className="mb-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 px-2">Navigation</p>
                    <div className="space-y-0.5">
                        {/* Dashboard - Only for PRO/AGENCY users */}
                        {!isLiteUser && (
                            <NavLink
                                to="/seller-central-checker/dashboard"
                                className={({ isActive }) =>
                                    `${menuItemClass} ${isActive ? activeMenuItemClass : inactiveMenuItemClass}`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <div className={`${iconWrapperClass} ${isActive ? 'bg-white/20' : 'bg-blue-50 group-hover:bg-blue-100'}`}>
                                            <LayoutDashboard className={`${iconClass} ${isActive ? 'text-white' : 'text-blue-600'}`}/>
                                        </div>
                                        <span className="font-medium">Dashboard</span>
                                    </>
                                )}
                            </NavLink>
                        )}
                        
                        {/* Issues with Dropdown - Only for PRO/AGENCY users */}
                        {!isLiteUser && (
                            <div className="space-y-0.5">
                            <div
                                className={`${menuItemClass} cursor-pointer ${
                                    isIssuesPage || location.pathname === '/seller-central-checker/issues-by-product'
                                        ? activeMenuItemClass
                                        : inactiveMenuItemClass
                                }`}
                                onClick={handleIssuesClick}
                            >
                                <div className={`${iconWrapperClass} ${
                                    isIssuesPage || location.pathname === '/seller-central-checker/issues-by-product' 
                                        ? 'bg-white/20' 
                                        : 'bg-orange-50 group-hover:bg-orange-100'
                                }`}>
                                    <BadgeAlert className={`${iconClass} ${
                                        isIssuesPage || location.pathname === '/seller-central-checker/issues-by-product' 
                                            ? 'text-white' 
                                            : 'text-orange-600'
                                    }`}/>
                                </div>
                                <span className="font-medium flex-1">Issues</span>
                                <motion.div
                                    animate={{ rotate: issuesDropdownOpen ? 90 : 0 }}
                                    transition={{ duration: 0.3, ease: "easeInOut" }}
                                    className="flex items-center justify-center"
                                >
                                    <ChevronRight className={`${iconClass} opacity-70`}/>
                                </motion.div>
                            </div>
                            
                            <AnimatePresence>
                                {issuesDropdownOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: "auto" }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ 
                                            duration: 0.3, 
                                            ease: "easeInOut",
                                            opacity: { duration: 0.2 }
                                        }}
                                        className="ml-4 space-y-0.5 overflow-hidden"
                                    >
                                        <motion.div
                                            initial={{ y: -10, opacity: 0 }}
                                            animate={{ y: 0, opacity: 1 }}
                                            exit={{ y: -10, opacity: 0 }}
                                            transition={{ delay: 0.15, duration: 0.2 }}
                                        >
                                            <NavLink
                                                to="/seller-central-checker/issues?tab=category"
                                                className={() =>
                                                    `${dropdownItemClass} ${
                                                        isIssuesPage && currentTab === 'category'
                                                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                            : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                    }`
                                                }
                                            >
                                                <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-current rounded-full opacity-60"></div>
                                                Issues By Category
                                            </NavLink>
                                        </motion.div>
                                        <motion.div
                                            initial={{ y: -10, opacity: 0 }}
                                            animate={{ y: 0, opacity: 1 }}
                                            exit={{ y: -10, opacity: 0 }}
                                            transition={{ delay: 0.175, duration: 0.2 }}
                                        >
                                            <NavLink
                                                to="/seller-central-checker/issues-by-product"
                                                className={({ isActive }) =>
                                                    `${dropdownItemClass} ${
                                                        isActive
                                                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                            : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                    }`
                                                }
                                            >
                                                <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-current rounded-full opacity-60"></div>
                                                Issues By Product
                                            </NavLink>
                                        </motion.div>
                                        <motion.div
                                            initial={{ y: -10, opacity: 0 }}
                                            animate={{ y: 0, opacity: 1 }}
                                            exit={{ y: -10, opacity: 0 }}
                                            transition={{ delay: 0.2, duration: 0.2 }}
                                        >
                                            <NavLink
                                                to="/seller-central-checker/issues?tab=account"
                                                className={() =>
                                                    `${dropdownItemClass} ${
                                                        isIssuesPage && currentTab === 'account'
                                                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                            : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                    }`
                                                }
                                            >
                                                <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-current rounded-full opacity-60"></div>
                                                Account Issues
                                            </NavLink>
                                        </motion.div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        )}

                        {/* Sponsored Ads with Dropdown - Only for PRO/AGENCY users */}
                        {!isLiteUser && (
                            <div className="space-y-0.5">
                            <div
                                className={`${menuItemClass} cursor-pointer ${
                                    isSponsoredAdsPage
                                        ? activeMenuItemClass
                                        : inactiveMenuItemClass
                                }`}
                                onClick={handleSponsoredAdsClick}
                            >
                                <div className={`${iconWrapperClass} ${
                                    isSponsoredAdsPage 
                                        ? 'bg-white/20' 
                                        : 'bg-green-50 group-hover:bg-green-100'
                                }`}>
                                    <LaptopMinimalCheck className={`${iconClass} ${
                                        isSponsoredAdsPage 
                                            ? 'text-white' 
                                            : 'text-green-600'
                                    }`}/>
                                </div>
                                <span className="font-medium flex-1">Sponsored Ads</span>
                                <motion.div
                                    animate={{ rotate: sponsoredAdsDropdownOpen ? 90 : 0 }}
                                    transition={{ duration: 0.3, ease: "easeInOut" }}
                                    className="flex items-center justify-center"
                                >
                                    <ChevronRight className={`${iconClass} opacity-70`}/>
                                </motion.div>
                            </div>
                            
                            <AnimatePresence>
                                {sponsoredAdsDropdownOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: "auto" }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ 
                                            duration: 0.3, 
                                            ease: "easeInOut",
                                            opacity: { duration: 0.2 }
                                        }}
                                        className="ml-4 space-y-0.5 overflow-hidden"
                                    >
                                        <motion.div
                                            initial={{ y: -10, opacity: 0 }}
                                            animate={{ y: 0, opacity: 1 }}
                                            exit={{ y: -10, opacity: 0 }}
                                            transition={{ delay: 0.15, duration: 0.2 }}
                                        >
                                            <NavLink
                                                to="/seller-central-checker/ppc-dashboard"
                                                className={({ isActive }) =>
                                                    `${dropdownItemClass} ${
                                                        isActive
                                                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                            : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                    }`
                                                }
                                            >
                                                <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-current rounded-full opacity-60"></div>
                                                Campaign Audit
                                            </NavLink>
                                        </motion.div>
                                        <motion.div
                                            initial={{ y: -10, opacity: 0 }}
                                            animate={{ y: 0, opacity: 1 }}
                                            exit={{ y: -10, opacity: 0 }}
                                            transition={{ delay: 0.175, duration: 0.2 }}
                                        >
                                            <NavLink
                                                to="/seller-central-checker/keyword-analysis"
                                                className={({ isActive }) =>
                                                    `${dropdownItemClass} ${
                                                        isActive
                                                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                            : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                    }`
                                                }
                                            >
                                                <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-current rounded-full opacity-60"></div>
                                                Keyword Opportunities
                                            </NavLink>
                                        </motion.div>
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                        )}
                        
                        {/* Profitability Dashboard - Only for PRO/AGENCY users */}
                        {!isLiteUser && (
                            <NavLink
                                to="/seller-central-checker/profitibility-dashboard"
                                className={({ isActive }) =>
                                    `${menuItemClass} ${isActive ? activeMenuItemClass : inactiveMenuItemClass}`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <div className={`${iconWrapperClass} ${isActive ? 'bg-white/20' : 'bg-purple-50 group-hover:bg-purple-100'}`}>
                                            <ChartLine className={`${iconClass} ${isActive ? 'text-white' : 'text-purple-600'}`}/>
                                        </div>
                                        <span className="font-medium">Profitibility</span>
                                    </>
                                )}
                            </NavLink>
                        )}

                        {/* Reimbursement Dashboard - Only for PRO/AGENCY users */}
                        {!isLiteUser && (
                            <NavLink
                                to="/seller-central-checker/reimbursement-dashboard"
                                className={({ isActive }) =>
                                    `${menuItemClass} ${isActive ? activeMenuItemClass : inactiveMenuItemClass}`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <div className={`${iconWrapperClass} ${isActive ? 'bg-white/20' : 'bg-emerald-50 group-hover:bg-emerald-100'}`}>
                                            <DollarSign className={`${iconClass} ${isActive ? 'text-white' : 'text-emerald-600'}`}/>
                                        </div>
                                        <span className="font-medium">Reimbursement</span>
                                    </>
                                )}
                            </NavLink>
                        )}

                        {/* Tasks - Available for ALL users including LITE */}
                        <NavLink
                            to="/seller-central-checker/tasks"
                            className={({ isActive }) =>
                                `${menuItemClass} ${isActive ? activeMenuItemClass : inactiveMenuItemClass}`
                            }
                        >
                            {({ isActive }) => (
                                <>
                                    <div className={`${iconWrapperClass} ${isActive ? 'bg-white/20' : 'bg-indigo-50 group-hover:bg-indigo-100'}`}>
                                        <ClipboardPlus className={`${iconClass} ${isActive ? 'text-white' : 'text-indigo-600'}`}/>
                                    </div>
                                    <span className="font-medium">Tasks</span>
                                </>
                            )}
                        </NavLink>

                        {/* Ecommerce Calendar - Available for ALL users including LITE - HIDDEN */}
                        {false && (
                            <NavLink
                                to="/seller-central-checker/ecommerce-calendar"
                                className={({ isActive }) =>
                                    `${menuItemClass} ${isActive ? activeMenuItemClass : inactiveMenuItemClass}`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <div className={`${iconWrapperClass} ${isActive ? 'bg-white/20' : 'bg-pink-50 group-hover:bg-pink-100'}`}>
                                            <Calendar className={`${iconClass} ${isActive ? 'text-white' : 'text-pink-600'}`}/>
                                        </div>
                                        <span className="font-medium">Ecommerce Calendar</span>
                                    </>
                                )}
                            </NavLink>
                        )}

                        {/* Account History - Only for PRO/AGENCY users */}
                        {!isLiteUser && (
                            <NavLink
                                to="/seller-central-checker/account-history"
                                className={({ isActive }) =>
                                    `${menuItemClass} ${isActive ? activeMenuItemClass : inactiveMenuItemClass}`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <div className={`${iconWrapperClass} ${isActive ? 'bg-white/20' : 'bg-amber-50 group-hover:bg-amber-100'}`}>
                                            <Clock8 className={`${iconClass} ${isActive ? 'text-white' : 'text-amber-600'}`}/>
                                        </div>
                                        <span className="font-medium">Accounts History</span>
                                    </>
                                )}
                            </NavLink>
                        )}

                        {/* User Logging - Only for Super Admins */}
                        {isSuperAdmin && (
                            <NavLink
                                to="/seller-central-checker/user-logging"
                                className={({ isActive }) =>
                                    `${menuItemClass} ${isActive ? 'bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-500/25 transform scale-[1.02]' : 'text-gray-700 hover:bg-white hover:shadow-md hover:shadow-gray-200/50 hover:text-red-600 hover:scale-[1.01]'}`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <div className={`${iconWrapperClass} ${isActive ? 'bg-white/20' : 'bg-red-50 group-hover:bg-red-100'}`}>
                                            <Activity className={`${iconClass} ${isActive ? 'text-white' : 'text-red-600'}`}/>
                                        </div>
                                        <span className="font-medium">User Logging</span>
                                        <div className="ml-auto">
                                            <span className="inline-flex items-center px-1 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800 border border-red-200">
                                                ADMIN
                                            </span>
                                        </div>
                                    </>
                                )}
                            </NavLink>
                        )}
                    </div>
                </div>
            </div>
            </div>
                </div>

                {/* Bottom Section - Book a Call, Settings, and Logout */}
                <div className="flex-shrink-0 border-t border-gray-200/50 bg-gradient-to-r from-gray-50/50 to-white/50">
                <div className="px-2 py-2">
                    {/* Settings Section */}
                    <div className="mb-2">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 px-2">Settings</p>
                        
                        {/* Settings with Dropdown */}
                        <div className="space-y-0.5">
                            <div
                                className={`${menuItemClass} cursor-pointer ${
                                    isSettingsPage
                                        ? activeMenuItemClass
                                        : inactiveMenuItemClass
                                }`}
                                onClick={handleSettingsClick}
                            >
                                <div className={`${iconWrapperClass} ${
                                    isSettingsPage ? 'bg-white/20' : 'bg-gray-50 group-hover:bg-gray-100'
                                }`}>
                                    <Settings className={`${iconClass} ${
                                        isSettingsPage ? 'text-white' : 'text-gray-600'
                                    }`}/>
                                </div>
                                <span className="font-medium flex-1">Settings</span>
                                <motion.div
                                    animate={{ rotate: settingsDropdownOpen ? 90 : 0 }}
                                    transition={{ duration: 0.3, ease: "easeInOut" }}
                                    className="flex items-center justify-center"
                                >
                                    <ChevronRight className={`${iconClass} opacity-70`}/>
                                </motion.div>
                            </div>
                            
                            <AnimatePresence>
                                {settingsDropdownOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: "auto" }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ 
                                            duration: 0.3, 
                                            ease: "easeInOut",
                                            opacity: { duration: 0.2 }
                                        }}
                                        className="ml-4 space-y-0.5 overflow-hidden"
                                    >
                                        <motion.div
                                            initial={{ y: -10, opacity: 0 }}
                                            animate={{ y: 0, opacity: 1 }}
                                            exit={{ y: -10, opacity: 0 }}
                                            transition={{ delay: 0.05, duration: 0.15 }}
                                        >
                                            <NavLink
                                                to="/seller-central-checker/settings?tab=profile"
                                                className={() =>
                                                    `${dropdownItemClass} ${
                                                        isSettingsPage && currentSettingsTab === 'profile'
                                                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                            : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                    }`
                                                }
                                            >
                                                <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-current rounded-full opacity-60"></div>
                                                User Profile
                                            </NavLink>
                                        </motion.div>
                                        
                                        {/* Account Integration - Only for PRO users (not AGENCY) */}
                                        {!isLiteUser && !isAgencyUser && (
                                            <motion.div
                                                initial={{ y: -10, opacity: 0 }}
                                                animate={{ y: 0, opacity: 1 }}
                                                exit={{ y: -10, opacity: 0 }}
                                                transition={{ delay: 0.08, duration: 0.15 }}
                                            >
                                                <NavLink
                                                    to="/seller-central-checker/settings?tab=account-integration"
                                                    className={() =>
                                                        `${dropdownItemClass} ${
                                                            isSettingsPage && currentSettingsTab === 'account-integration'
                                                                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                                : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                        }`
                                                    }
                                                >
                                                    <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-current rounded-full opacity-60"></div>
                                                    Account Integration
                                                </NavLink>
                                            </motion.div>
                                        )}
                                        
                                        {/* Support - Available for non-AGENCY users */}
                                        {!isAgencyUser && (
                                            <motion.div
                                                initial={{ y: -10, opacity: 0 }}
                                                animate={{ y: 0, opacity: 1 }}
                                                exit={{ y: -10, opacity: 0 }}
                                                transition={{ delay: 0.14, duration: 0.15 }}
                                            >
                                                <NavLink
                                                    to="/seller-central-checker/settings?tab=support"
                                                    className={() =>
                                                        `${dropdownItemClass} ${
                                                            isSettingsPage && currentSettingsTab === 'support'
                                                                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                                : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                        }`
                                                    }
                                                >
                                                    <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-current rounded-full opacity-60"></div>
                                                    Support
                                                </NavLink>
                                            </motion.div>
                                        )}

                                        {/* Plans & Billing - Available for all users */}
                                        <motion.div
                                            initial={{ y: -10, opacity: 0 }}
                                            animate={{ y: 0, opacity: 1 }}
                                            exit={{ y: -10, opacity: 0 }}
                                            transition={{ delay: 0.17, duration: 0.15 }}
                                        >
                                            <NavLink
                                                to="/seller-central-checker/settings?tab=plans-billing"
                                                className={() =>
                                                    `${dropdownItemClass} ${
                                                        isSettingsPage && currentSettingsTab === 'plans-billing'
                                                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                            : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                    }`
                                                }
                                            >
                                                <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-current rounded-full opacity-60"></div>
                                                Plans & Billing
                                            </NavLink>
                                        </motion.div>

                                        {/* Admin Section - Only for AGENCY users */}
                                        {isAgencyUser && (
                                            <>
                                                {/* Admin Section Divider */}
                                                <motion.div
                                                    initial={{ y: -10, opacity: 0 }}
                                                    animate={{ y: 0, opacity: 1 }}
                                                    exit={{ y: -10, opacity: 0 }}
                                                    transition={{ delay: 0.17, duration: 0.15 }}
                                                    className="my-1.5"
                                                >
                                                    <div className="flex items-center gap-2 px-2.5 py-1">
                                                        <div className="h-px bg-gradient-to-r from-purple-200 to-purple-300 flex-1"></div>
                                                        <span className="text-xs font-semibold text-purple-600 uppercase tracking-wider">Admin</span>
                                                        <div className="h-px bg-gradient-to-r from-purple-300 to-purple-200 flex-1"></div>
                                                    </div>
                                                </motion.div>

                                                {/* Admin User Profile */}
                                                <motion.div
                                                    initial={{ y: -10, opacity: 0 }}
                                                    animate={{ y: 0, opacity: 1 }}
                                                    exit={{ y: -10, opacity: 0 }}
                                                    transition={{ delay: 0.20, duration: 0.15 }}
                                                >
                                                    <NavLink
                                                        to="/seller-central-checker/settings?tab=admin-user-profile"
                                                        className={() =>
                                                            `${dropdownItemClass} ${
                                                                isSettingsPage && currentSettingsTab === 'admin-user-profile'
                                                                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/25'
                                                                    : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-purple-600'
                                                            }`
                                                        }
                                                    >
                                                        <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-current rounded-full opacity-60"></div>
                                                        Admin User Profile
                                                    </NavLink>
                                                </motion.div>

                                                {/* Admin Account Integration */}
                                                <motion.div
                                                    initial={{ y: -10, opacity: 0 }}
                                                    animate={{ y: 0, opacity: 1 }}
                                                    exit={{ y: -10, opacity: 0 }}
                                                    transition={{ delay: 0.24, duration: 0.15 }}
                                                >
                                                    <NavLink
                                                        to="/seller-central-checker/settings?tab=admin-account-integration"
                                                        className={() =>
                                                            `${dropdownItemClass} ${
                                                                isSettingsPage && currentSettingsTab === 'admin-account-integration'
                                                                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/25'
                                                                    : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-purple-600'
                                                            }`
                                                        }
                                                    >
                                                        <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-current rounded-full opacity-60"></div>
                                                        Admin Integrations
                                                    </NavLink>
                                                </motion.div>

                                                {/* Admin Plans & Billing */}
                                                <motion.div
                                                    initial={{ y: -10, opacity: 0 }}
                                                    animate={{ y: 0, opacity: 1 }}
                                                    exit={{ y: -10, opacity: 0 }}
                                                    transition={{ delay: 0.26, duration: 0.15 }}
                                                >
                                                    <NavLink
                                                        to="/seller-central-checker/settings?tab=admin-plans-billing"
                                                        className={() =>
                                                            `${dropdownItemClass} ${
                                                                isSettingsPage && currentSettingsTab === 'admin-plans-billing'
                                                                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/25'
                                                                    : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-purple-600'
                                                            }`
                                                        }
                                                    >
                                                        <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-current rounded-full opacity-60"></div>
                                                        Admin Billing
                                                    </NavLink>
                                                </motion.div>

                                                {/* Admin Support */}
                                                <motion.div
                                                    initial={{ y: -10, opacity: 0 }}
                                                    animate={{ y: 0, opacity: 1 }}
                                                    exit={{ y: -10, opacity: 0 }}
                                                    transition={{ delay: 0.28, duration: 0.15 }}
                                                >
                                                    <NavLink
                                                        to="/seller-central-checker/settings?tab=admin-support"
                                                        className={() =>
                                                            `${dropdownItemClass} ${
                                                                isSettingsPage && currentSettingsTab === 'admin-support'
                                                                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/25'
                                                                    : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-purple-600'
                                                            }`
                                                        }
                                                    >
                                                        <div className="w-1 h-1 sm:w-1.5 sm:h-1.5 bg-current rounded-full opacity-60"></div>
                                                        Admin Support
                                                    </NavLink>
                                                </motion.div>
                                            </>
                                        )}
                                    </motion.div>
                                )}
                            </AnimatePresence>
                        </div>
                    </div>

                    {/* Book Consultation Button */}
                    <div className="mb-2">
                        <NavLink
                            to="/seller-central-checker/consultation"
                            className="group flex items-center gap-2 px-2.5 py-2 rounded-lg font-medium text-sm cursor-pointer transition-all duration-300 bg-gradient-to-r from-orange-400 to-amber-500 text-white shadow-lg shadow-orange-500/25 hover:shadow-xl hover:shadow-orange-500/40 hover:scale-[1.02] hover:from-orange-500 hover:to-amber-600 transform"
                        >
                            <div className="p-1 rounded-lg transition-colors duration-300 bg-white/20 group-hover:bg-white/30">
                                <Calendar className="w-4 h-4 text-white"/>
                            </div>
                            <span className="font-semibold flex-1">Need Help?</span>
                            <div className="w-1.5 h-1.5 bg-yellow-300 rounded-full animate-pulse"></div>
                        </NavLink>
                    </div>

                    {/* Logout Section */}
                    <div className="mt-2 pt-2 border-t border-gray-200/50">
                        <button 
                            className='group flex items-center gap-2 px-2.5 py-2 rounded-lg font-medium text-sm transition-all duration-300 text-red-600 hover:bg-red-50 hover:shadow-md hover:shadow-red-200/50 hover:scale-[1.01] w-full'
                            onClick={(e)=>logoutUser(e)}
                        >
                            <div className="p-1 rounded-lg bg-red-50 group-hover:bg-red-100 transition-colors duration-300">
                                <img src={LogoutIcon} alt="Logout" className="w-4 h-4 opacity-80" />
                            </div>
                            <span className="font-medium">Log Out</span>
                            {loader && <BeatLoader color="#dc2626" size={6} />}
                        </button>
                    </div>
                </div>
                </div>
            </div>
        </aside>
    );
};

export default LeftNavSection;
