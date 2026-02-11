import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { LayoutDashboard, BadgeAlert, ClipboardPlus, Clock8, Settings, ChartLine, LaptopMinimalCheck, ChevronRight, Activity, Calendar, DollarSign, Lock, Package, BarChart3, LogOut, Bot } from 'lucide-react';
import { useDispatch, useSelector } from 'react-redux';
import { logout } from '../../redux/slices/authSlice.js'
import { clearCogsData } from '../../redux/slices/cogsSlice.js'
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import BeatLoader from "react-spinners/BeatLoader";
import { AnimatePresence, motion } from "framer-motion";
import sellerQILogo from '../../assets/Logo/sellerQILogo.png';

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
    const isAgencyUser = userPlan === 'AGENCY';
    
    // Check if user's trial has expired
    const isTrialExpired = () => {
        if (!user?.isInTrialPeriod || !user?.trialEndsDate) return false;
        const now = new Date();
        const trialEnd = new Date(user.trialEndsDate);
        return now >= trialEnd;
    };
    
    // Check if user was downgraded from trial to LITE
    const wasDowngradedFromTrial = () => {
        return user?.packageType === 'LITE' && 
               user?.isInTrialPeriod === false && 
               user?.trialEndsDate !== null && 
               user?.trialEndsDate !== undefined;
    };
    
    // Check if user chose LITE plan (never had trial)
    const choseLitePlan = () => {
        return user?.packageType === 'LITE' && 
               !user?.isInTrialPeriod && 
               (user?.trialEndsDate === null || user?.trialEndsDate === undefined);
    };
    
    // Determine if premium features should be locked (show but not accessible without upgrade)
    // Now ALL LITE users see the pages with lock icon - they can click and see blurred content
    const isPremiumLocked = userPlan === 'LITE';
    
    // No longer hiding pages - all LITE users can see and access pages (with blur overlay)
    const isLiteUser = false;
    
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

    // Responsive classes for menu items - compact sizing, dark theme
    const menuItemClass = "group flex items-center gap-2.5 px-2.5 py-2 rounded-lg font-medium text-sm transition-all duration-300";
    const activeMenuItemClass = "bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25 transform scale-[1.02]";
    const inactiveMenuItemClass = "text-gray-300 hover:bg-[#21262d] hover:text-blue-400 hover:scale-[1.01]";
    const iconClass = "w-4 h-4 flex-shrink-0 transition-colors duration-300";
    const iconInactiveClass = "text-gray-400 group-hover:text-blue-400";
    const iconActiveClass = "text-white";
    const dropdownItemClass = "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-all duration-300";

    return (
        <aside className="h-screen w-[240px] xl:w-[280px] flex-shrink-0 border-r border-[#30363d] font-roboto bg-[#161b22] hidden lg:flex lg:flex-col overflow-hidden">
            {/* Main Container - Top and Bottom Sections */}
            <div className="flex flex-col justify-between h-full min-h-0">
                {/* Top Section - Logo and Navigation */}
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    {/* Logo Section */}
                    <div className="w-full px-3 py-4 flex-shrink-0">
                        <div className="flex items-center justify-center">
                            <img 
                                src={sellerQILogo}
                                alt="Seller QI Logo"
                                loading="lazy"
                                className="h-6 w-auto max-w-full object-contain transition-transform duration-300 hover:scale-105"
                            />
                        </div>
                    </div>

                    {/* Navigation Section */}
                    <div className="flex-1 overflow-y-auto scrollbar-hide min-h-0 flex flex-col">
                    <div className="px-2 py-2">
                        <div className="mb-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1.5 px-2">Navigation</p>
                    <div className="space-y-0.5">
                        {/* Dashboard - For PRO/AGENCY users and expired trial users */}
                        {(!isLiteUser || isPremiumLocked) && (
                            <NavLink
                                to="/seller-central-checker/dashboard"
                                className={({ isActive }) =>
                                    `${menuItemClass} ${isActive ? activeMenuItemClass : inactiveMenuItemClass}`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <LayoutDashboard className={`${iconClass} ${isActive ? iconActiveClass : iconInactiveClass}`} />
                                        <span className="font-medium flex-1">Dashboard</span>
                                        {isPremiumLocked && (
                                            <Lock className="w-3.5 h-3.5 text-amber-500" />
                                        )}
                                    </>
                                )}
                            </NavLink>
                        )}

                        {/* Amazon Copilot - AI Assistant */}
                        {(!isLiteUser || isPremiumLocked) && (
                            <NavLink
                                to="/seller-central-checker/qmate"
                                className={({ isActive }) =>
                                    `${menuItemClass} ${isActive ? activeMenuItemClass : inactiveMenuItemClass}`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <Bot className={`${iconClass} ${isActive ? iconActiveClass : iconInactiveClass}`} />
                                        <span className="font-medium flex-1">Amazon Copilot</span>
                                        {isPremiumLocked && (
                                            <Lock className="w-3.5 h-3.5 text-amber-500" />
                                        )}
                                    </>
                                )}
                            </NavLink>
                        )}

                        {/* Your Products - For PRO/AGENCY users and expired trial users */}
                        {(!isLiteUser || isPremiumLocked) && (
                            <NavLink
                                to="/seller-central-checker/your-products"
                                className={({ isActive }) =>
                                    `${menuItemClass} ${isActive ? activeMenuItemClass : inactiveMenuItemClass}`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <Package className={`${iconClass} ${isActive ? iconActiveClass : iconInactiveClass}`} />
                                        <span className="font-medium flex-1">Your Products</span>
                                        {isPremiumLocked && (
                                            <Lock className="w-3.5 h-3.5 text-amber-500" />
                                        )}
                                    </>
                                )}
                            </NavLink>
                        )}

                        {/* Listing Analyzer - Available for ALL users */}
                        <NavLink
                            to="/seller-central-checker/pre-analysis"
                            className={({ isActive }) =>
                                `${menuItemClass} ${isActive ? activeMenuItemClass : inactiveMenuItemClass}`
                            }
                        >
                            {({ isActive }) => (
                                <>
                                    <BarChart3 className={`${iconClass} ${isActive ? iconActiveClass : iconInactiveClass}`} />
                                    <span className="font-medium flex-1">Listing Analyzer</span>
                                </>
                            )}
                        </NavLink>
                        
                        {/* Issues with Dropdown - For PRO/AGENCY users and expired trial users */}
                        {(!isLiteUser || isPremiumLocked) && (
                            <div className="space-y-0.5">
                            <div
                                className={`${menuItemClass} cursor-pointer ${
                                    isIssuesPage || location.pathname === '/seller-central-checker/issues-by-product'
                                        ? activeMenuItemClass
                                        : inactiveMenuItemClass
                                }`}
                                onClick={handleIssuesClick}
                            >
                                <BadgeAlert className={`${iconClass} ${
                                    isIssuesPage || location.pathname === '/seller-central-checker/issues-by-product' 
                                        ? iconActiveClass 
                                        : iconInactiveClass
                                }`} />
                                <span className="font-medium flex-1">Issues</span>
                                {isPremiumLocked && (
                                    <Lock className="w-3.5 h-3.5 text-amber-500 mr-1" />
                                )}
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
                                                            : 'text-gray-400 hover:bg-[#21262d] hover:text-blue-400'
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
                                                            : 'text-gray-400 hover:bg-[#21262d] hover:text-blue-400'
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
                                                            : 'text-gray-400 hover:bg-[#21262d] hover:text-blue-400'
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

                        {/* Sponsored Ads with Dropdown - For PRO/AGENCY users and expired trial users */}
                        {(!isLiteUser || isPremiumLocked) && (
                            <div className="space-y-0.5">
                            <div
                                className={`${menuItemClass} cursor-pointer ${
                                    isSponsoredAdsPage
                                        ? activeMenuItemClass
                                        : inactiveMenuItemClass
                                }`}
                                onClick={handleSponsoredAdsClick}
                            >
                                <LaptopMinimalCheck className={`${iconClass} ${
                                    isSponsoredAdsPage 
                                        ? iconActiveClass 
                                        : iconInactiveClass
                                }`} />
                                <span className="font-medium flex-1">Sponsored Ads</span>
                                {isPremiumLocked && (
                                    <Lock className="w-3.5 h-3.5 text-amber-500 mr-1" />
                                )}
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
                                                            : 'text-gray-400 hover:bg-[#21262d] hover:text-blue-400'
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
                                                            : 'text-gray-400 hover:bg-[#21262d] hover:text-blue-400'
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
                        
                        {/* Profitability Dashboard - For PRO/AGENCY users and expired trial users */}
                        {(!isLiteUser || isPremiumLocked) && (
                            <NavLink
                                to="/seller-central-checker/profitibility-dashboard"
                                className={({ isActive }) =>
                                    `${menuItemClass} ${isActive ? activeMenuItemClass : inactiveMenuItemClass}`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <ChartLine className={`${iconClass} ${isActive ? iconActiveClass : iconInactiveClass}`} />
                                        <span className="font-medium flex-1">Profitibility</span>
                                        {isPremiumLocked && (
                                            <Lock className="w-3.5 h-3.5 text-amber-500" />
                                        )}
                                    </>
                                )}
                            </NavLink>
                        )}

                        {/* Reimbursement Dashboard - For PRO/AGENCY users and expired trial users */}
                        {(!isLiteUser || isPremiumLocked) && (
                            <NavLink
                                to="/seller-central-checker/reimbursement-dashboard"
                                className={({ isActive }) =>
                                    `${menuItemClass} ${isActive ? activeMenuItemClass : inactiveMenuItemClass}`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <DollarSign className={`${iconClass} ${isActive ? iconActiveClass : iconInactiveClass}`} />
                                        <span className="font-medium flex-1">Reimbursement</span>
                                        {isPremiumLocked && (
                                            <Lock className="w-3.5 h-3.5 text-amber-500" />
                                        )}
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
                                    <ClipboardPlus className={`${iconClass} ${isActive ? iconActiveClass : iconInactiveClass}`} />
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
                                        <Calendar className={`${iconClass} ${isActive ? iconActiveClass : iconInactiveClass}`} />
                                        <span className="font-medium">Ecommerce Calendar</span>
                                    </>
                                )}
                            </NavLink>
                        )}

                        {/* Account History - For PRO/AGENCY users and expired trial users */}
                        {(!isLiteUser || isPremiumLocked) && (
                            <NavLink
                                to="/seller-central-checker/account-history"
                                className={({ isActive }) =>
                                    `${menuItemClass} ${isActive ? activeMenuItemClass : inactiveMenuItemClass}`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <Clock8 className={`${iconClass} ${isActive ? iconActiveClass : iconInactiveClass}`} />
                                        <span className="font-medium flex-1">Accounts History</span>
                                        {isPremiumLocked && (
                                            <Lock className="w-3.5 h-3.5 text-amber-500" />
                                        )}
                                    </>
                                )}
                            </NavLink>
                        )}

                        {/* User Logging - Only for Super Admins */}
                        {isSuperAdmin && (
                            <NavLink
                                to="/seller-central-checker/user-logging"
                                className={({ isActive }) =>
                                    `${menuItemClass} ${isActive ? 'bg-gradient-to-r from-red-600 to-red-700 text-white shadow-lg shadow-red-500/25 transform scale-[1.02]' : 'text-gray-300 hover:bg-[#21262d] hover:text-red-400 hover:scale-[1.01]'}`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <Activity className={`${iconClass} ${isActive ? 'text-white' : 'text-gray-400 group-hover:text-red-400'}`} />
                                        <span className="font-medium">User Logging</span>
                                        <div className="ml-auto">
                                            <span className="inline-flex items-center px-1 py-0.5 rounded-full text-xs font-medium bg-red-500/20 text-red-400 border border-red-500/40">
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
                <div className="flex-shrink-0 border-t border-[#30363d] bg-[#1a1a1a]">
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
                                <Settings className={`${iconClass} ${
                                    isSettingsPage ? iconActiveClass : iconInactiveClass
                                }`} />
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
                                                            : 'text-gray-400 hover:bg-[#21262d] hover:text-blue-400'
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
                                                                : 'text-gray-400 hover:bg-[#21262d] hover:text-blue-400'
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
                                                                : 'text-gray-400 hover:bg-[#21262d] hover:text-blue-400'
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
                                                            : 'text-gray-400 hover:bg-[#21262d] hover:text-blue-400'
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
                                                        <div className="h-px bg-gradient-to-r from-purple-500/30 to-purple-400/30 flex-1"></div>
                                                        <span className="text-xs font-semibold text-purple-400 uppercase tracking-wider">Admin</span>
                                                        <div className="h-px bg-gradient-to-r from-purple-400/30 to-purple-500/30 flex-1"></div>
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
                                                                    : 'text-gray-400 hover:bg-[#21262d] hover:text-purple-400'
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
                                                                    : 'text-gray-400 hover:bg-[#21262d] hover:text-purple-400'
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
                                                                    : 'text-gray-400 hover:bg-[#21262d] hover:text-purple-400'
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
                                                                    : 'text-gray-400 hover:bg-[#21262d] hover:text-purple-400'
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
                            className="group flex items-center gap-2 px-2.5 py-2 rounded-lg font-medium text-sm cursor-pointer transition-all duration-300 border-2 border-orange-400 text-orange-400 hover:bg-gradient-to-r hover:from-orange-400 hover:to-amber-500 hover:text-black hover:shadow-lg hover:shadow-orange-500/25 hover:scale-[1.02] transform"
                        >
                            <Calendar className="w-4 h-4 flex-shrink-0 text-orange-400 group-hover:text-black transition-colors duration-300" />
                            <span className="font-semibold flex-1">Need Help?</span>
                            <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse group-hover:bg-yellow-300 transition-colors duration-300"></div>
                        </NavLink>
                    </div>

                    {/* Logout Section */}
                    <div className="mt-2 pt-2 border-t border-[#30363d]">
                        <button 
                            className='group flex items-center gap-2 px-2.5 py-2 rounded-lg font-medium text-sm transition-all duration-300 text-red-400 hover:bg-red-500/20 hover:scale-[1.01] w-full'
                            onClick={(e)=>logoutUser(e)}
                        >
                            <LogOut className="w-4 h-4 flex-shrink-0 text-red-400 group-hover:text-red-300" />
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
