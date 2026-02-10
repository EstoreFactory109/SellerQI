import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {LayoutDashboard,BadgeAlert, ClipboardPlus,Clock8,Settings,ChartLine,LaptopMinimalCheck, ChevronDown, ChevronRight, X, Calendar, Target, DollarSign, Search, Lock, Package, LogOut} from 'lucide-react'
import { logout } from '../../redux/slices/authSlice.js'
import { clearCogsData } from '../../redux/slices/cogsSlice.js'
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import BeatLoader from "react-spinners/BeatLoader";
import { useSelector,useDispatch } from 'react-redux';
import {setPosition} from '../../redux/slices/MobileMenuSlice.js'
import { AnimatePresence, motion } from "framer-motion";

const LeftNavSection = () => {

    const dispatch = useDispatch();
    const navigate=useNavigate();
    const location = useLocation();
    const [loader,setLoader]=useState(false)
    const [issuesDropdownOpen, setIssuesDropdownOpen] = useState(false);
    const [settingsDropdownOpen, setSettingsDropdownOpen] = useState(false);
    const [sponsoredAdsDropdownOpen, setSponsoredAdsDropdownOpen] = useState(false);

    const position = useSelector(state => state.MobileMenu.position);
    
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
            if(response.status===200){
                localStorage.removeItem('isAuth');
                dispatch(logout());
                dispatch(clearCogsData());
                setLoader(false)
                navigate('/login');
            }
        } catch (error) {
            setLoader(false)
            console.log(error);
        }
    }


    return (
        <>
            {/* Mobile Menu Backdrop */}
            {position === "0%" && (
                <div 
                    className="fixed inset-0 bg-black bg-opacity-50 z-[98] lg:hidden transition-opacity duration-300"
                    onClick={() => dispatch(setPosition("-100%"))}
                />
            )}
            
            {/* Mobile Menu */}
            <aside className="h-screen w-2/5 lg:w-1/5 shadow-xl border-r border-gray-200/80 font-roboto bg-gradient-to-b from-white to-gray-50/30 block lg:hidden fixed z-[99] transition-all duration-300 ease-in-out backdrop-blur-sm " style={{ left: position }}>
            {/* Logo Section */}
            <div className="w-full px-4 py-8 flex-shrink-0">
                <div className="flex items-center justify-between">
                    <img 
                        src="https://res.cloudinary.com/ddoa960le/image/upload/v1749063777/MainLogo_1_uhcg6o.png"
                        alt="Seller QI Logo"
                        loading="lazy"
                        className="h-7 w-auto object-contain transition-transform duration-300 hover:scale-105"
                        width="120"
                        height="28"
                    />
                    <button
                        onClick={() => dispatch(setPosition("-100%"))}
                        className="p-2 rounded-lg hover:bg-gray-100 active:bg-gray-200 transition-colors duration-200 touch-manipulation"
                        aria-label="Close mobile menu"
                    >
                        <X className="w-5 h-5 text-gray-600" />
                    </button>
                </div>
            </div>

            {/* Navigation Section */}
            <div className="w-full overflow-y-auto flex-1 scrollbar-hide">
                <div className="px-3 py-4">
                    <div className="mb-6">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 px-2">Navigation</p>
                        <div className="space-y-1">
                            {/* Dashboard - For PRO/AGENCY users and expired trial users */}
                            {(!isLiteUser || isPremiumLocked) && (
                                <NavLink
                                    to="/seller-central-checker/dashboard"
                                    className={({ isActive }) =>
                                        `group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs transition-all duration-300 ${
                                            isActive
                                                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25 transform scale-[1.02]'
                                                : 'text-gray-700 hover:bg-white hover:shadow-md hover:shadow-gray-200/50 hover:text-blue-600 hover:scale-[1.01]'
                                        }`
                                    }
                                >
                                    {({ isActive }) => (
                                        <>
                                            <div className={`p-1 rounded-lg transition-colors duration-300 ${
                                                isActive ? 'bg-white/20' : 'bg-blue-50 group-hover:bg-blue-100'
                                            }`}>
                                                <LayoutDashboard className={`w-3.5 h-3.5 transition-colors duration-300 ${
                                                    isActive ? 'text-white' : 'text-blue-600'
                                                }`}/>
                                            </div>
                                            <span className="font-medium flex-1">Dashboard</span>
                                            {isPremiumLocked && (
                                                <Lock className="w-3 h-3 text-amber-500" />
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
                                        `group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs transition-all duration-300 ${
                                            isActive
                                                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25 transform scale-[1.02]'
                                                : 'text-gray-700 hover:bg-white hover:shadow-md hover:shadow-gray-200/50 hover:text-blue-600 hover:scale-[1.01]'
                                        }`
                                    }
                                >
                                    {({ isActive }) => (
                                        <>
                                            <div className={`p-1 rounded-lg transition-colors duration-300 ${
                                                isActive ? 'bg-white/20' : 'bg-cyan-50 group-hover:bg-cyan-100'
                                            }`}>
                                                <Package className={`w-3.5 h-3.5 transition-colors duration-300 ${
                                                    isActive ? 'text-white' : 'text-cyan-600'
                                                }`}/>
                                            </div>
                                            <span className="font-medium flex-1">Your Products</span>
                                            {isPremiumLocked && (
                                                <Lock className="w-3 h-3 text-amber-500" />
                                            )}
                                        </>
                                    )}
                                </NavLink>
                            )}

                            {/* Issues with Dropdown - For PRO/AGENCY users and expired trial users */}
                            {(!isLiteUser || isPremiumLocked) && (
                                <div className="space-y-1">
                                <div
                                    className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs cursor-pointer transition-all duration-300 ${
                                        isIssuesPage || location.pathname === '/seller-central-checker/issues-by-product'
                                            ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25 transform scale-[1.02]'
                                            : 'text-gray-700 hover:bg-white hover:shadow-md hover:shadow-gray-200/50 hover:text-blue-600 hover:scale-[1.01]'
                                    }`}
                                    onClick={handleIssuesClick}
                                >
                                    <div className={`p-1 rounded-lg transition-colors duration-300 ${
                                        isIssuesPage || location.pathname === '/seller-central-checker/issues-by-product' 
                                            ? 'bg-white/20' 
                                            : 'bg-orange-50 group-hover:bg-orange-100'
                                    }`}>
                                        <BadgeAlert className={`w-3.5 h-3.5 transition-colors duration-300 ${
                                            isIssuesPage || location.pathname === '/seller-central-checker/issues-by-product' 
                                                ? 'text-white' 
                                                : 'text-orange-600'
                                        }`}/>
                                    </div>
                                    <span className="font-medium flex-1">Issues</span>
                                    {isPremiumLocked && (
                                        <Lock className="w-3 h-3 text-amber-500 mr-1" />
                                    )}
                                    <motion.div
                                        animate={{ rotate: issuesDropdownOpen ? 90 : 0 }}
                                        transition={{ duration: 0.2, ease: "easeInOut" }}
                                    >
                                        <ChevronRight className="w-3 h-3 opacity-70"/>
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
                                            className="ml-5 space-y-1 overflow-hidden"
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
                                                        `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                            isIssuesPage && currentTab === 'category'
                                                                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                                : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                        }`
                                                    }
                                                >
                                                    <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
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
                                                        `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                            isActive
                                                                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                                : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                        }`
                                                    }
                                                >
                                                    <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
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
                                                        `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                            isIssuesPage && currentTab === 'account'
                                                                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                                : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                        }`
                                                    }
                                                >
                                                    <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
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
                                <div className="space-y-1">
                                <div
                                    className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs cursor-pointer transition-all duration-300 ${
                                        isSponsoredAdsPage
                                            ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25 transform scale-[1.02]'
                                            : 'text-gray-700 hover:bg-white hover:shadow-md hover:shadow-gray-200/50 hover:text-blue-600 hover:scale-[1.01]'
                                    }`}
                                    onClick={handleSponsoredAdsClick}
                                >
                                    <div className={`p-1 rounded-lg transition-colors duration-300 ${
                                        isSponsoredAdsPage 
                                            ? 'bg-white/20' 
                                            : 'bg-green-50 group-hover:bg-green-100'
                                    }`}>
                                        <LaptopMinimalCheck className={`w-3.5 h-3.5 transition-colors duration-300 ${
                                            isSponsoredAdsPage 
                                                ? 'text-white' 
                                                : 'text-green-600'
                                        }`}/>
                                    </div>
                                    <span className="font-medium flex-1">Sponsored Ads</span>
                                    {isPremiumLocked && (
                                        <Lock className="w-3 h-3 text-amber-500 mr-1" />
                                    )}
                                    <motion.div
                                        animate={{ rotate: sponsoredAdsDropdownOpen ? 90 : 0 }}
                                        transition={{ duration: 0.2, ease: "easeInOut" }}
                                    >
                                        <ChevronRight className="w-3 h-3 opacity-70"/>
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
                                            className="ml-5 space-y-1 overflow-hidden"
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
                                                        `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                            isActive
                                                                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                                : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                        }`
                                                    }
                                                >
                                                    <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
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
                                                        `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                            isActive
                                                                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                                : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                        }`
                                                    }
                                                >
                                                    <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
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
                                        `group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs transition-all duration-300 ${
                                            isActive
                                                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25 transform scale-[1.02]'
                                                : 'text-gray-700 hover:bg-white hover:shadow-md hover:shadow-gray-200/50 hover:text-blue-600 hover:scale-[1.01]'
                                        }`
                                    }
                                >
                                    {({ isActive }) => (
                                        <>
                                            <div className={`p-1 rounded-lg transition-colors duration-300 ${
                                                isActive ? 'bg-white/20' : 'bg-purple-50 group-hover:bg-purple-100'
                                            }`}>
                                                <ChartLine className={`w-3.5 h-3.5 transition-colors duration-300 ${
                                                    isActive ? 'text-white' : 'text-purple-600'
                                                }`}/>
                                            </div>
                                            <span className="font-medium flex-1">Profitibility</span>
                                            {isPremiumLocked && (
                                                <Lock className="w-3 h-3 text-amber-500" />
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
                                        `group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs transition-all duration-300 ${
                                            isActive
                                                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25 transform scale-[1.02]'
                                                : 'text-gray-700 hover:bg-white hover:shadow-md hover:shadow-gray-200/50 hover:text-blue-600 hover:scale-[1.01]'
                                        }`
                                    }
                                >
                                    {({ isActive }) => (
                                        <>
                                            <div className={`p-1 rounded-lg transition-colors duration-300 ${
                                                isActive ? 'bg-white/20' : 'bg-emerald-50 group-hover:bg-emerald-100'
                                            }`}>
                                                <DollarSign className={`w-3.5 h-3.5 transition-colors duration-300 ${
                                                    isActive ? 'text-white' : 'text-emerald-600'
                                                }`}/>
                                            </div>
                                            <span className="font-medium flex-1">Reimbursement</span>
                                            {isPremiumLocked && (
                                                <Lock className="w-3 h-3 text-amber-500" />
                                            )}
                                        </>
                                    )}
                                </NavLink>
                            )}

                            {/* Tasks - Available for ALL users including LITE */}
                            {<NavLink
                                to="/seller-central-checker/tasks"
                                className={({ isActive }) =>
                                    `group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs transition-all duration-300 ${
                                        isActive
                                            ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25 transform scale-[1.02]'
                                            : 'text-gray-700 hover:bg-white hover:shadow-md hover:shadow-gray-200/50 hover:text-blue-600 hover:scale-[1.01]'
                                    }`
                                }
                            >
                                {({ isActive }) => (
                                    <>
                                        <div className={`p-1 rounded-lg transition-colors duration-300 ${
                                            isActive ? 'bg-white/20' : 'bg-indigo-50 group-hover:bg-indigo-100'
                                        }`}>
                                            <ClipboardPlus className={`w-3.5 h-3.5 transition-colors duration-300 ${
                                                isActive ? 'text-white' : 'text-indigo-600'
                                            }`}/>
                                        </div>
                                        <span className="font-medium">Tasks</span>
                                    </>
                                )}
                                                    </NavLink>}

                            {/* Ecommerce Calendar - Available for ALL users including LITE - HIDDEN */}
                            {false && (
                                <NavLink
                                    to="/seller-central-checker/ecommerce-calendar"
                                    className={({ isActive }) =>
                                        `group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs transition-all duration-300 ${
                                            isActive
                                                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25 transform scale-[1.02]'
                                                : 'text-gray-700 hover:bg-white hover:shadow-md hover:shadow-gray-200/50 hover:text-blue-600 hover:scale-[1.01]'
                                        }`
                                    }
                                >
                                    {({ isActive }) => (
                                        <>
                                            <div className={`p-1 rounded-lg transition-colors duration-300 ${
                                                isActive ? 'bg-white/20' : 'bg-pink-50 group-hover:bg-pink-100'
                                            }`}>
                                                <Calendar className={`w-3.5 h-3.5 transition-colors duration-300 ${
                                                    isActive ? 'text-white' : 'text-pink-600'
                                                }`}/>
                                            </div>
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
                                        `group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs transition-all duration-300 ${
                                            isActive
                                                ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25 transform scale-[1.02]'
                                                : 'text-gray-700 hover:bg-white hover:shadow-md hover:shadow-gray-200/50 hover:text-blue-600 hover:scale-[1.01]'
                                        }`
                                    }
                                >
                                    {({ isActive }) => (
                                        <>
                                            <div className={`p-1 rounded-lg transition-colors duration-300 ${
                                                isActive ? 'bg-white/20' : 'bg-amber-50 group-hover:bg-amber-100'
                                            }`}>
                                                <Clock8 className={`w-3.5 h-3.5 transition-colors duration-300 ${
                                                    isActive ? 'text-white' : 'text-amber-600'
                                                }`}/>
                                            </div>
                                            <span className="font-medium flex-1">Accounts History</span>
                                            {isPremiumLocked && (
                                                <Lock className="w-3 h-3 text-amber-500" />
                                            )}
                                        </>
                                    )}
                                </NavLink>
                            )}
                        </div>
                    </div>

                    {/* Divider */}
                    <div className="h-px bg-gradient-to-r from-transparent via-gray-300 to-transparent my-6"></div>

                    {/* Book Consultation Button */}
                    <div className="mb-4">
                        <NavLink
                            to="/seller-central-checker/consultation"
                            className="group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs cursor-pointer transition-all duration-300 bg-gradient-to-r from-orange-400 to-amber-500 text-white shadow-lg shadow-orange-500/25 hover:shadow-xl hover:shadow-orange-500/40 hover:scale-[1.02] hover:from-orange-500 hover:to-amber-600 transform"
                        >
                            <div className="p-1 rounded-lg transition-colors duration-300 bg-white/20 group-hover:bg-white/30">
                                <Calendar className="w-3.5 h-3.5 transition-colors duration-300 text-white"/>
                            </div>
                            <span className="font-semibold flex-1">Need Help?</span>
                            <div className="w-1.5 h-1.5 bg-yellow-300 rounded-full animate-pulse"></div>
                        </NavLink>
                    </div>

                    {/* Settings Section */}
                    <div className="mb-6">
                        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-4 px-2">Settings</p>
                        
                        {/* Settings with Dropdown */}
                        <div className="space-y-1">
                            <div
                                className={`group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs cursor-pointer transition-all duration-300 ${
                                    isSettingsPage
                                        ? 'bg-gradient-to-r from-blue-600 to-blue-700 text-white shadow-lg shadow-blue-500/25 transform scale-[1.02]'
                                        : 'text-gray-700 hover:bg-white hover:shadow-md hover:shadow-gray-200/50 hover:text-blue-600 hover:scale-[1.01]'
                                }`}
                                onClick={handleSettingsClick}
                            >
                                <div className={`p-1 rounded-lg transition-colors duration-300 ${
                                    isSettingsPage ? 'bg-white/20' : 'bg-gray-50 group-hover:bg-gray-100'
                                }`}>
                                    <Settings className={`w-3.5 h-3.5 transition-colors duration-300 ${
                                        isSettingsPage ? 'text-white' : 'text-gray-600'
                                    }`}/>
                                </div>
                                <span className="font-medium flex-1">Settings</span>
                                <motion.div
                                    animate={{ rotate: settingsDropdownOpen ? 90 : 0 }}
                                    transition={{ duration: 0.2, ease: "easeInOut" }}
                                >
                                    <ChevronRight className="w-3 h-3 opacity-70"/>
                                </motion.div>
                            </div>
                            
                            <AnimatePresence>
                                {settingsDropdownOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: "auto" }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ 
                                            duration: 0.25, 
                                            ease: "easeInOut",
                                            opacity: { duration: 0.15 }
                                        }}
                                        className="ml-5 space-y-1 overflow-hidden"
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
                                                    `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                        isSettingsPage && currentSettingsTab === 'profile'
                                                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                            : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                    }`
                                                }
                                            >
                                                <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
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
                                                        `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                            isSettingsPage && currentSettingsTab === 'account-integration'
                                                                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                                : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                        }`
                                                    }
                                                >
                                                    <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
                                                    Account Integration
                                                </NavLink>
                                            </motion.div>
                                        )}
                                        
                                        {/* Plans & Billing - Available for non-AGENCY users */}
                                        {/* {!isAgencyUser && (
                                            <motion.div
                                                initial={{ y: -10, opacity: 0 }}
                                                animate={{ y: 0, opacity: 1 }}
                                                exit={{ y: -10, opacity: 0 }}
                                                transition={{ delay: 0.11, duration: 0.15 }}
                                            >
                                                <NavLink
                                                    to="/seller-central-checker/settings?tab=plans-billing"
                                                    className={() =>
                                                        `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                            isSettingsPage && currentSettingsTab === 'plans-billing'
                                                                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                                : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                        }`
                                                    }
                                                >
                                                    <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
                                                    Plans & Billing
                                                </NavLink>
                                            </motion.div>
                                        )} */}
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
                                                        `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                            isSettingsPage && currentSettingsTab === 'support'
                                                                ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                                : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                        }`
                                                    }
                                                >
                                                    <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
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
                                                    `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                        isSettingsPage && currentSettingsTab === 'plans-billing'
                                                            ? 'bg-gradient-to-r from-blue-500 to-blue-600 text-white shadow-md shadow-blue-500/25'
                                                            : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-blue-600'
                                                    }`
                                                }
                                            >
                                                <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
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
                                                    className="my-2"
                                                >
                                                    <div className="flex items-center gap-2 px-3 py-1">
                                                        <div className="h-px bg-gradient-to-r from-purple-200 to-purple-300 flex-1"></div>
                                                        <span className="text-[10px] font-semibold text-purple-600 uppercase tracking-wider">Admin</span>
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
                                                            `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                                isSettingsPage && currentSettingsTab === 'admin-user-profile'
                                                                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/25'
                                                                    : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-purple-600'
                                                            }`
                                                        }
                                                    >
                                                        <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
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
                                                            `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                                isSettingsPage && currentSettingsTab === 'admin-account-integration'
                                                                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/25'
                                                                    : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-purple-600'
                                                            }`
                                                        }
                                                    >
                                                        <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
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
                                                            `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                                isSettingsPage && currentSettingsTab === 'admin-plans-billing'
                                                                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/25'
                                                                    : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-purple-600'
                                                            }`
                                                        }
                                                    >
                                                        <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
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
                                                            `flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all duration-300 ${
                                                                isSettingsPage && currentSettingsTab === 'admin-support'
                                                                    ? 'bg-gradient-to-r from-purple-500 to-purple-600 text-white shadow-md shadow-purple-500/25'
                                                                    : 'text-gray-600 hover:bg-white hover:shadow-sm hover:text-purple-600'
                                                            }`
                                                        }
                                                    >
                                                        <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
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
                </div>
            </div>

            {/* Logout Section */}
            <div className="px-4 py-3 border-t border-gray-200/50 bg-gradient-to-r from-gray-50/50 to-white/50 flex-shrink-0">
                <button 
                    className='group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs transition-all duration-300 text-red-600 hover:bg-red-50 hover:shadow-md hover:shadow-red-200/50 hover:scale-[1.01] w-full'
                    onClick={(e)=>logoutUser(e)}
                >
                    <div className="p-1 rounded-lg bg-red-50 group-hover:bg-red-100 transition-colors duration-300">
                        <LogOut className="w-3.5 h-3.5 text-red-600 opacity-80" />
                    </div>
                    <span className="font-medium">Log Out</span>
                    {loader && <BeatLoader color="#dc2626" size={6} />}
                </button>
            </div>
        </aside>
        </>
    );
};

export default LeftNavSection;
