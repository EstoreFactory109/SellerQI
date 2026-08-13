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
import NavSearch from './NavSearch.jsx';
import { COLORS } from '../Shared/index.js';

// Set to true to show Recent Orders in the left nav
const SHOW_RECENT_ORDERS_NAV = true;

// Category-grouped nav item: flat background tint when active (matches the redesign
// mock's sidebar), muted/primary text swap, icon tinted to accent when active.
const NavItem = ({ to, icon: Icon, label, isActive: isActiveOverride, locked, onClick, badge, expanded }) => {
    const content = ({ isActive: linkActive }) => {
        const isActive = isActiveOverride !== undefined ? isActiveOverride : linkActive;
        return (
            <>
                <Icon className="w-4 h-4 flex-shrink-0" style={{ color: isActive ? COLORS.accent : COLORS.textMuted }} />
                <span className="flex-1 truncate">{label}</span>
                {locked && <Lock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: COLORS.watch }} />}
                {badge != null && (
                    <span
                        className="flex-shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={{ background: 'rgba(245,166,35,.14)', color: COLORS.watch }}
                    >
                        {badge}
                    </span>
                )}
                {expanded !== undefined && (
                    <motion.div
                        animate={{ rotate: expanded ? 90 : 0 }}
                        transition={{ duration: 0.3, ease: "easeInOut" }}
                        className="flex items-center justify-center flex-shrink-0"
                    >
                        <ChevronRight className="w-4 h-4" style={{ color: COLORS.textMuted, opacity: 0.7 }} />
                    </motion.div>
                )}
            </>
        );
    };

    const baseStyle = ({ isActive: linkActive }) => {
        const isActive = isActiveOverride !== undefined ? isActiveOverride : linkActive;
        return {
            background: isActive ? 'rgba(59,130,246,.14)' : 'transparent',
            color: isActive ? COLORS.textPrimary : COLORS.textSecondary,
        };
    };

    if (onClick) {
        const isActive = !!isActiveOverride;
        return (
            <div
                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg font-medium text-sm cursor-pointer transition-colors"
                style={baseStyle({ isActive })}
                onClick={onClick}
            >
                {content({ isActive })}
            </div>
        );
    }

    return (
        <NavLink to={to} className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg font-medium text-sm transition-colors" style={baseStyle}>
            {content}
        </NavLink>
    );
};

// Category section header - matches the mock's uppercase, letter-spaced, muted label.
const NavGroupLabel = ({ children }) => (
    <div className="text-[11px] font-semibold uppercase tracking-wider px-2.5 py-1.5" style={{ color: COLORS.textMuted, letterSpacing: '0.09em' }}>
        {children}
    </div>
);

const dropdownItemClass = "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-sm font-medium transition-colors";

const LeftNavSection = () => {

    const dispatch = useDispatch();
    const navigate=useNavigate();
    const location = useLocation();
    const [loader,setLoader]=useState(false)
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

    // Check if agency admin is logged in and viewing a client
    const isAgencyAdmin = isAdminLoggedIn && adminAccessType === 'enterpriseAdmin';
    const loggedInAsClient = localStorage.getItem('loggedInAsClient');
    // Agency admin viewing a client's dashboard (not on manage-agency-users page)
    // loggedInAsClient is now a JSON string (same pattern as loggedInAsUser)
    const isAgencyAdminViewingClient = isAgencyAdmin && loggedInAsClient;

    // Get current tab from URL search params
    const searchParams = new URLSearchParams(location.search);
    const currentTab = searchParams.get('tab') || 'category';
    const currentSettingsTab = searchParams.get('tab') || 'profile';
    const isIssuesPage = location.pathname === '/seller-central-checker/issues';
    const isSettingsPage = location.pathname === '/seller-central-checker/settings';
    const isPPCDashboardPage = location.pathname === '/seller-central-checker/ppc-dashboard';
    const isKeywordAnalysisPage = location.pathname === '/seller-central-checker/keyword-analysis';
    const isSponsoredAdsPage = isPPCDashboardPage || isKeywordAnalysisPage;
    const isIssuesSection = isIssuesPage || location.pathname === '/seller-central-checker/issues-by-product';

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

    const dropdownItemStyle = (isActive) => ({
        background: isActive ? 'rgba(59,130,246,.14)' : 'transparent',
        color: isActive ? COLORS.accent : COLORS.textMuted,
    });

    return (
        <aside className="h-screen w-[252px] flex-shrink-0 hidden lg:flex lg:flex-col overflow-hidden" style={{ borderRight: `1px solid ${COLORS.border}`, background: COLORS.bgBase }}>
            {/* Main Container - Top and Bottom Sections */}
            <div className="flex flex-col justify-between h-full min-h-0">
                {/* Top Section - Logo and Navigation */}
                <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
                    {/* Logo Section - unchanged */}
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

                    {/* Search Section - unchanged */}
                    <NavSearch variant="dark" isPremiumLocked={isPremiumLocked} />

                    {/* Navigation Section - grouped into categories */}
                    <div className="flex-1 overflow-y-auto scrollbar-hide min-h-0 flex flex-col">
                    <div className="px-2 py-2 flex flex-col gap-3.5">

                        {/* Overview */}
                        <div>
                            <NavGroupLabel>Overview</NavGroupLabel>
                            <div className="space-y-0.5">
                                {(!isLiteUser || isPremiumLocked) && (
                                    <NavItem to="/seller-central-checker/dashboard" icon={LayoutDashboard} label="Dashboard" locked={isPremiumLocked} />
                                )}
                                {(!isLiteUser || isPremiumLocked) && (
                                    <NavItem to="/seller-central-checker/qmate" icon={Bot} label="Amazon Copilot" locked={isPremiumLocked} />
                                )}
                            </div>
                        </div>

                        {/* Optimize */}
                        <div>
                            <NavGroupLabel>Optimize</NavGroupLabel>
                            <div className="space-y-0.5">
                                {(!isLiteUser || isPremiumLocked) && (
                                    <NavItem to="/seller-central-checker/your-products" icon={Package} label="Your Products" locked={isPremiumLocked} />
                                )}
                                <NavItem to="/seller-central-checker/pre-analysis" icon={BarChart3} label="Listing Analyzer" />

                                {/* Sponsored Ads with Dropdown */}
                                {(!isLiteUser || isPremiumLocked) && (
                                    <div className="space-y-0.5">
                                        <NavItem
                                            icon={LaptopMinimalCheck}
                                            label="Sponsored Ads"
                                            isActive={isSponsoredAdsPage}
                                            locked={isPremiumLocked}
                                            onClick={handleSponsoredAdsClick}
                                            expanded={sponsoredAdsDropdownOpen}
                                        />
                                        <AnimatePresence>
                                            {sponsoredAdsDropdownOpen && (
                                                <motion.div
                                                    initial={{ opacity: 0, height: 0 }}
                                                    animate={{ opacity: 1, height: "auto" }}
                                                    exit={{ opacity: 0, height: 0 }}
                                                    transition={{ duration: 0.3, ease: "easeInOut", opacity: { duration: 0.2 } }}
                                                    className="ml-4 space-y-0.5 overflow-hidden"
                                                >
                                                    <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.15, duration: 0.2 }}>
                                                        <NavLink to="/seller-central-checker/ppc-dashboard" className={dropdownItemClass} style={({ isActive }) => dropdownItemStyle(isActive)}>
                                                            <div className="w-1.5 h-1.5 bg-current rounded-full opacity-60"></div>
                                                            Campaign Audit
                                                        </NavLink>
                                                    </motion.div>
                                                    <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.175, duration: 0.2 }}>
                                                        <NavLink to="/seller-central-checker/keyword-analysis" className={dropdownItemClass} style={({ isActive }) => dropdownItemStyle(isActive)}>
                                                            <div className="w-1.5 h-1.5 bg-current rounded-full opacity-60"></div>
                                                            Keyword Opportunities
                                                        </NavLink>
                                                    </motion.div>
                                                </motion.div>
                                            )}
                                        </AnimatePresence>
                                    </div>
                                )}

                                {(!isLiteUser || isPremiumLocked) && (
                                    <NavItem to="/seller-central-checker/tasks" icon={ClipboardPlus} label="Tasks" locked={isPremiumLocked} />
                                )}
                            </div>
                        </div>

                        {/* Money & Health */}
                        <div>
                            <NavGroupLabel>Money &amp; Health</NavGroupLabel>
                            <div className="space-y-0.5">
                                {(!isLiteUser || isPremiumLocked) && (
                                    <NavItem to="/seller-central-checker/profitibility-dashboard" icon={ChartLine} label="Profitibility" locked={isPremiumLocked} />
                                )}
                                {(!isLiteUser || isPremiumLocked) && (
                                    <NavItem to="/seller-central-checker/reimbursement-dashboard" icon={DollarSign} label="Reimbursement" locked={isPremiumLocked} />
                                )}
                                {(!isLiteUser || isPremiumLocked) && (
                                    <NavItem
                                        to="/seller-central-checker/issues?tab=account"
                                        icon={BadgeAlert}
                                        label="Account Issues"
                                        isActive={isIssuesPage && currentTab === 'account'}
                                        locked={isPremiumLocked}
                                    />
                                )}
                                {SHOW_RECENT_ORDERS_NAV && (!isLiteUser || isPremiumLocked) && (
                                    <NavItem to="/seller-central-checker/review-request" icon={Clock8} label="Review Requests" locked={isPremiumLocked} />
                                )}
                            </div>
                        </div>

                        {/* Ecommerce Calendar - Available for ALL users including LITE - HIDDEN */}
                        {false && (
                            <NavLink
                                to="/seller-central-checker/ecommerce-calendar"
                                className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg font-medium text-sm transition-colors"
                            >
                                {({ isActive }) => (
                                    <>
                                        <Calendar className="w-4 h-4 flex-shrink-0" style={{ color: isActive ? COLORS.accent : COLORS.textMuted }} />
                                        <span className="font-medium">Ecommerce Calendar</span>
                                    </>
                                )}
                            </NavLink>
                        )}

                        {/* History */}
                        <div>
                            <NavGroupLabel>History</NavGroupLabel>
                            <div className="space-y-0.5">
                                {(!isLiteUser || isPremiumLocked) && (
                                    <NavItem to="/seller-central-checker/account-history" icon={Clock8} label="Accounts History" locked={isPremiumLocked} />
                                )}
                                {/* User Logging - Only for Super Admins */}
                                {isSuperAdmin && (
                                    <NavLink
                                        to="/seller-central-checker/user-logging"
                                        className="flex items-center gap-2.5 px-2.5 py-2 rounded-lg font-medium text-sm transition-colors"
                                        style={({ isActive }) => ({
                                            background: isActive ? 'rgba(239,68,68,.14)' : 'transparent',
                                            color: isActive ? COLORS.fix : COLORS.textSecondary,
                                        })}
                                    >
                                        {({ isActive }) => (
                                            <>
                                                <Activity className="w-4 h-4 flex-shrink-0" style={{ color: isActive ? COLORS.fix : COLORS.textMuted }} />
                                                <span className="flex-1">User Logging</span>
                                                <span
                                                    className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-semibold"
                                                    style={{ background: 'rgba(239,68,68,.14)', color: COLORS.fix, border: `1px solid ${COLORS.fix}40` }}
                                                >
                                                    ADMIN
                                                </span>
                                            </>
                                        )}
                                    </NavLink>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
                </div>

                {/* Bottom Section - Settings, Book a Call, and Logout */}
                <div className="flex-shrink-0" style={{ borderTop: `1px solid ${COLORS.border}`, background: COLORS.bgBase }}>
                <div className="px-2 py-2">
                    {/* Settings Section - Hidden for agency admin viewing client */}
                    {!isAgencyAdminViewingClient && (
                    <div className="mb-2">
                        <NavGroupLabel>Settings</NavGroupLabel>

                        {/* Settings with Dropdown */}
                        <div className="space-y-0.5">
                            <NavItem icon={Settings} label="Settings" isActive={isSettingsPage} onClick={handleSettingsClick} expanded={settingsDropdownOpen} />

                            <AnimatePresence>
                                {settingsDropdownOpen && (
                                    <motion.div
                                        initial={{ opacity: 0, height: 0 }}
                                        animate={{ opacity: 1, height: "auto" }}
                                        exit={{ opacity: 0, height: 0 }}
                                        transition={{ duration: 0.3, ease: "easeInOut", opacity: { duration: 0.2 } }}
                                        className="ml-4 space-y-0.5 overflow-hidden"
                                    >
                                        <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.05, duration: 0.15 }}>
                                            <NavLink to="/seller-central-checker/settings?tab=profile" className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'profile')}>
                                                <div className="w-1.5 h-1.5 bg-current rounded-full opacity-60"></div>
                                                User Profile
                                            </NavLink>
                                        </motion.div>

                                        {/* Account Integration - Only for PRO users (not AGENCY) */}
                                        {!isLiteUser && !isAgencyUser && (
                                            <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.08, duration: 0.15 }}>
                                                <NavLink to="/seller-central-checker/settings?tab=account-integration" className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'account-integration')}>
                                                    <div className="w-1.5 h-1.5 bg-current rounded-full opacity-60"></div>
                                                    Account Integration
                                                </NavLink>
                                            </motion.div>
                                        )}

                                        {/* Support - Available for non-AGENCY users */}
                                        {!isAgencyUser && (
                                            <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.14, duration: 0.15 }}>
                                                <NavLink to="/seller-central-checker/settings?tab=support" className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'support')}>
                                                    <div className="w-1.5 h-1.5 bg-current rounded-full opacity-60"></div>
                                                    Support
                                                </NavLink>
                                            </motion.div>
                                        )}

                                        {/* Plans & Billing - Available for all users */}
                                        <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.17, duration: 0.15 }}>
                                            <NavLink to="/seller-central-checker/settings?tab=plans-billing" className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'plans-billing')}>
                                                <div className="w-1.5 h-1.5 bg-current rounded-full opacity-60"></div>
                                                Plans & Billing
                                            </NavLink>
                                        </motion.div>

                                        {/* Admin Section - Only for AGENCY users */}
                                        {isAgencyUser && (
                                            <>
                                                <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.17, duration: 0.15 }} className="my-1.5">
                                                    <div className="flex items-center gap-2 px-2.5 py-1">
                                                        <div className="h-px flex-1" style={{ background: COLORS.border }}></div>
                                                        <span className="text-xs font-semibold uppercase tracking-wider" style={{ color: COLORS.accent }}>Admin</span>
                                                        <div className="h-px flex-1" style={{ background: COLORS.border }}></div>
                                                    </div>
                                                </motion.div>

                                                <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.20, duration: 0.15 }}>
                                                    <NavLink to="/seller-central-checker/settings?tab=admin-user-profile" className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'admin-user-profile')}>
                                                        <div className="w-1.5 h-1.5 bg-current rounded-full opacity-60"></div>
                                                        Admin User Profile
                                                    </NavLink>
                                                </motion.div>

                                                <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.24, duration: 0.15 }}>
                                                    <NavLink to="/seller-central-checker/settings?tab=admin-account-integration" className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'admin-account-integration')}>
                                                        <div className="w-1.5 h-1.5 bg-current rounded-full opacity-60"></div>
                                                        Admin Integrations
                                                    </NavLink>
                                                </motion.div>

                                                <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.26, duration: 0.15 }}>
                                                    <NavLink to="/seller-central-checker/settings?tab=admin-plans-billing" className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'admin-plans-billing')}>
                                                        <div className="w-1.5 h-1.5 bg-current rounded-full opacity-60"></div>
                                                        Admin Billing
                                                    </NavLink>
                                                </motion.div>

                                                <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.28, duration: 0.15 }}>
                                                    <NavLink to="/seller-central-checker/settings?tab=admin-support" className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'admin-support')}>
                                                        <div className="w-1.5 h-1.5 bg-current rounded-full opacity-60"></div>
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
                    )}

                    {/* Book Consultation Button - Hidden for agency admin viewing client (kept as its own orange CTA accent, not part of the neutral nav palette) */}
                    {!isAgencyAdminViewingClient && (
                    <div className="mb-2">
                        <NavLink
                            to="/seller-central-checker/consultation"
                            className="group flex items-center gap-2 px-2.5 py-2 rounded-lg font-medium text-sm cursor-pointer transition-all duration-300 border-2 border-orange-400 text-orange-400 hover:bg-gradient-to-r hover:from-orange-400 hover:to-amber-500 hover:text-black hover:shadow-lg hover:shadow-orange-500/25"
                        >
                            <Calendar className="w-4 h-4 flex-shrink-0 text-orange-400 group-hover:text-black transition-colors duration-300" />
                            <span className="font-semibold flex-1">Need Help?</span>
                            <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse group-hover:bg-yellow-300 transition-colors duration-300"></div>
                        </NavLink>
                    </div>
                    )}

                    {/* Logout Section - Hidden for agency admin viewing client */}
                    {!isAgencyAdminViewingClient && (
                    <div className="mt-2 pt-2" style={{ borderTop: `1px solid ${COLORS.border}` }}>
                        <button
                            className='group flex items-center gap-2 px-2.5 py-2 rounded-lg font-medium text-sm transition-colors w-full'
                            style={{ color: COLORS.fix }}
                            onClick={(e)=>logoutUser(e)}
                        >
                            <LogOut className="w-4 h-4 flex-shrink-0" style={{ color: COLORS.fix }} />
                            <span className="font-medium">Log Out</span>
                            {loader && <BeatLoader color={COLORS.fix} size={6} />}
                        </button>
                    </div>
                    )}
                </div>
                </div>
            </div>
        </aside>
    );
};

export default LeftNavSection;
