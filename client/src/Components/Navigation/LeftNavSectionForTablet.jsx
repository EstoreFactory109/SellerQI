import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {LayoutDashboard,BadgeAlert, ClipboardPlus,Clock8,Settings,ChartLine,LaptopMinimalCheck, ChevronRight, X, Calendar, DollarSign, Lock, Package, LogOut, Bot, BarChart3} from 'lucide-react'
import { logout } from '../../redux/slices/authSlice.js'
import { clearCogsData } from '../../redux/slices/cogsSlice.js'
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import BeatLoader from "react-spinners/BeatLoader";
import { useSelector,useDispatch } from 'react-redux';
import {setPosition} from '../../redux/slices/MobileMenuSlice.js'
import { AnimatePresence, motion } from "framer-motion";
import NavSearch from './NavSearch.jsx';
import { COLORS } from '../Shared/index.js';

// Same category-grouped nav item pattern as the desktop sidebar (LeftNavSection.jsx),
// duplicated here since this component already duplicates the desktop nav's logic
// for its own mobile-drawer chrome (backdrop, close button, slide position).
const NavItem = ({ to, icon: Icon, label, isActive: isActiveOverride, locked, onClick, expanded, onNavigate }) => {
    const content = ({ isActive: linkActive }) => {
        const isActive = isActiveOverride !== undefined ? isActiveOverride : linkActive;
        return (
            <>
                <Icon className="w-4 h-4 flex-shrink-0" style={{ color: isActive ? COLORS.accent : COLORS.textMuted }} />
                <span className="flex-1 truncate">{label}</span>
                {locked && <Lock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: COLORS.watch }} />}
                {expanded !== undefined && (
                    <motion.div animate={{ rotate: expanded ? 90 : 0 }} transition={{ duration: 0.2, ease: "easeInOut" }} className="flex items-center justify-center flex-shrink-0">
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
            <div className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl font-medium text-xs cursor-pointer transition-colors" style={baseStyle({ isActive })} onClick={onClick}>
                {content({ isActive })}
            </div>
        );
    }

    return (
        <NavLink to={to} onClick={onNavigate} className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl font-medium text-xs transition-colors" style={baseStyle}>
            {content}
        </NavLink>
    );
};

const NavGroupLabel = ({ children }) => (
    <div className="text-[11px] font-semibold uppercase tracking-wider px-2 py-1.5" style={{ color: COLORS.textMuted, letterSpacing: '0.09em' }}>
        {children}
    </div>
);

const dropdownItemClass = "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors";

const LeftNavSection = () => {

    const dispatch = useDispatch();
    const navigate=useNavigate();
    const location = useLocation();
    const [loader,setLoader]=useState(false)
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

    // Check if agency admin is logged in and viewing a client
    const isAdminLoggedIn = localStorage.getItem('isAdminAuth') === 'true';
    const adminAccessType = localStorage.getItem('adminAccessType');
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

    const closeMenu = () => dispatch(setPosition("-100%"));
    const dropdownItemStyle = (isActive) => ({
        background: isActive ? 'rgba(59,130,246,.14)' : 'transparent',
        color: isActive ? COLORS.accent : COLORS.textMuted,
    });

    return (
        <>
            {/* Mobile Menu Backdrop */}
            {position === "0%" && (
                <div
                    className="fixed inset-0 bg-black bg-opacity-50 z-[98] lg:hidden transition-opacity duration-300"
                    onClick={closeMenu}
                />
            )}

            {/* Mobile Menu */}
            <aside
                className="h-screen w-2/5 lg:w-1/5 shadow-xl block lg:hidden fixed z-[99] transition-all duration-300 ease-in-out flex flex-col"
                style={{ left: position, background: COLORS.bgBase, borderRight: `1px solid ${COLORS.border}` }}
            >
            {/* Logo Section - unchanged */}
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
                        onClick={closeMenu}
                        className="p-2 rounded-lg transition-colors duration-200 touch-manipulation"
                        style={{ color: COLORS.textSecondary }}
                        aria-label="Close mobile menu"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>
            </div>

            {/* Search Section - unchanged */}
            <NavSearch
                variant="dark"
                isPremiumLocked={isPremiumLocked}
                onNavigate={closeMenu}
            />

            {/* Navigation Section - grouped into categories */}
            <div className="w-full overflow-y-auto flex-1 scrollbar-hide min-h-0">
                <div className="px-3 py-4 flex flex-col gap-4">

                    {/* Overview */}
                    <div>
                        <NavGroupLabel>Overview</NavGroupLabel>
                        <div className="space-y-1">
                            {(!isLiteUser || isPremiumLocked) && (
                                <NavItem to="/seller-central-checker/dashboard" icon={LayoutDashboard} label="Dashboard" locked={isPremiumLocked} onNavigate={closeMenu} />
                            )}
                            {(!isLiteUser || isPremiumLocked) && (
                                <NavItem to="/seller-central-checker/qmate" icon={Bot} label="Amazon Copilot" locked={isPremiumLocked} onNavigate={closeMenu} />
                            )}
                        </div>
                    </div>

                    {/* Optimize */}
                    <div>
                        <NavGroupLabel>Optimize</NavGroupLabel>
                        <div className="space-y-1">
                            {(!isLiteUser || isPremiumLocked) && (
                                <NavItem to="/seller-central-checker/your-products" icon={Package} label="Your Products" locked={isPremiumLocked} onNavigate={closeMenu} />
                            )}
                            <NavItem to="/seller-central-checker/pre-analysis" icon={BarChart3} label="Listing Analyzer" onNavigate={closeMenu} />

                            {/* Sponsored Ads with Dropdown */}
                            {(!isLiteUser || isPremiumLocked) && (
                                <div className="space-y-1">
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
                                                className="ml-5 space-y-1 overflow-hidden"
                                            >
                                                <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.15, duration: 0.2 }}>
                                                    <NavLink to="/seller-central-checker/ppc-dashboard" onClick={closeMenu} className={dropdownItemClass} style={({ isActive }) => dropdownItemStyle(isActive)}>
                                                        <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
                                                        Campaign Audit
                                                    </NavLink>
                                                </motion.div>
                                                <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.175, duration: 0.2 }}>
                                                    <NavLink to="/seller-central-checker/keyword-analysis" onClick={closeMenu} className={dropdownItemClass} style={({ isActive }) => dropdownItemStyle(isActive)}>
                                                        <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
                                                        Keyword Opportunities
                                                    </NavLink>
                                                </motion.div>
                                            </motion.div>
                                        )}
                                    </AnimatePresence>
                                </div>
                            )}

                            {(!isLiteUser || isPremiumLocked) && (
                                <NavItem to="/seller-central-checker/tasks" icon={ClipboardPlus} label="Tasks" locked={isPremiumLocked} onNavigate={closeMenu} />
                            )}
                        </div>
                    </div>

                    {/* Money & Health */}
                    <div>
                        <NavGroupLabel>Money &amp; Health</NavGroupLabel>
                        <div className="space-y-1">
                            {(!isLiteUser || isPremiumLocked) && (
                                <NavItem to="/seller-central-checker/profitibility-dashboard" icon={ChartLine} label="Profitibility" locked={isPremiumLocked} onNavigate={closeMenu} />
                            )}
                            {(!isLiteUser || isPremiumLocked) && (
                                <NavItem to="/seller-central-checker/reimbursement-dashboard" icon={DollarSign} label="Reimbursement" locked={isPremiumLocked} onNavigate={closeMenu} />
                            )}
                            {(!isLiteUser || isPremiumLocked) && (
                                <NavItem
                                    to="/seller-central-checker/issues?tab=account"
                                    icon={BadgeAlert}
                                    label="Account Issues"
                                    isActive={isIssuesPage && currentTab === 'account'}
                                    locked={isPremiumLocked}
                                    onNavigate={closeMenu}
                                />
                            )}
                        </div>
                    </div>

                    {/* Ecommerce Calendar - Available for ALL users including LITE - HIDDEN */}
                    {false && (
                        <NavItem to="/seller-central-checker/ecommerce-calendar" icon={Calendar} label="Ecommerce Calendar" onNavigate={closeMenu} />
                    )}

                    {/* History */}
                    <div>
                        <NavGroupLabel>History</NavGroupLabel>
                        <div className="space-y-1">
                            {(!isLiteUser || isPremiumLocked) && (
                                <NavItem to="/seller-central-checker/account-history" icon={Clock8} label="Accounts History" locked={isPremiumLocked} onNavigate={closeMenu} />
                            )}
                        </div>
                    </div>
                </div>

                {/* Book Consultation Button - Hidden for agency admin viewing client (kept as its own orange CTA accent) */}
                {!isAgencyAdminViewingClient && (
                <div className="px-3 mb-4">
                    <NavLink
                        to="/seller-central-checker/consultation"
                        onClick={closeMenu}
                        className="group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs cursor-pointer transition-all duration-300 border-2 border-orange-400 text-orange-400 hover:bg-gradient-to-r hover:from-orange-400 hover:to-amber-500 hover:text-black"
                    >
                        <Calendar className="w-3.5 h-3.5 flex-shrink-0 text-orange-400 group-hover:text-black transition-colors duration-300" />
                        <span className="font-semibold flex-1">Need Help?</span>
                        <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse group-hover:bg-yellow-300 transition-colors duration-300"></div>
                    </NavLink>
                </div>
                )}

                {/* Settings Section - Hidden for agency admin viewing client */}
                {!isAgencyAdminViewingClient && (
                <div className="px-3 mb-4">
                    <NavGroupLabel>Settings</NavGroupLabel>

                    {/* Settings with Dropdown */}
                    <div className="space-y-1">
                        <NavItem icon={Settings} label="Settings" isActive={isSettingsPage} onClick={handleSettingsClick} expanded={settingsDropdownOpen} />

                        <AnimatePresence>
                            {settingsDropdownOpen && (
                                <motion.div
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: "auto" }}
                                    exit={{ opacity: 0, height: 0 }}
                                    transition={{ duration: 0.25, ease: "easeInOut", opacity: { duration: 0.15 } }}
                                    className="ml-5 space-y-1 overflow-hidden"
                                >
                                    <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.05, duration: 0.15 }}>
                                        <NavLink to="/seller-central-checker/settings?tab=profile" onClick={closeMenu} className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'profile')}>
                                            <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
                                            User Profile
                                        </NavLink>
                                    </motion.div>

                                    {/* Account Integration - Only for PRO users (not AGENCY) */}
                                    {!isLiteUser && !isAgencyUser && (
                                        <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.08, duration: 0.15 }}>
                                            <NavLink to="/seller-central-checker/settings?tab=account-integration" onClick={closeMenu} className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'account-integration')}>
                                                <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
                                                Account Integration
                                            </NavLink>
                                        </motion.div>
                                    )}

                                    {/* Support - Available for non-AGENCY users */}
                                    {!isAgencyUser && (
                                        <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.14, duration: 0.15 }}>
                                            <NavLink to="/seller-central-checker/settings?tab=support" onClick={closeMenu} className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'support')}>
                                                <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
                                                Support
                                            </NavLink>
                                        </motion.div>
                                    )}

                                    {/* Plans & Billing - Available for all users */}
                                    <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.17, duration: 0.15 }}>
                                        <NavLink to="/seller-central-checker/settings?tab=plans-billing" onClick={closeMenu} className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'plans-billing')}>
                                            <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
                                            Plans & Billing
                                        </NavLink>
                                    </motion.div>

                                    {/* Admin Section - Only for AGENCY users */}
                                    {isAgencyUser && (
                                        <>
                                            <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.17, duration: 0.15 }} className="my-2">
                                                <div className="flex items-center gap-2 px-3 py-1">
                                                    <div className="h-px flex-1" style={{ background: COLORS.border }}></div>
                                                    <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: COLORS.accent }}>Admin</span>
                                                    <div className="h-px flex-1" style={{ background: COLORS.border }}></div>
                                                </div>
                                            </motion.div>

                                            <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.20, duration: 0.15 }}>
                                                <NavLink to="/seller-central-checker/settings?tab=admin-user-profile" onClick={closeMenu} className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'admin-user-profile')}>
                                                    <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
                                                    Admin User Profile
                                                </NavLink>
                                            </motion.div>

                                            <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.24, duration: 0.15 }}>
                                                <NavLink to="/seller-central-checker/settings?tab=admin-account-integration" onClick={closeMenu} className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'admin-account-integration')}>
                                                    <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
                                                    Admin Integrations
                                                </NavLink>
                                            </motion.div>

                                            <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.26, duration: 0.15 }}>
                                                <NavLink to="/seller-central-checker/settings?tab=admin-plans-billing" onClick={closeMenu} className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'admin-plans-billing')}>
                                                    <div className="w-1 h-1 bg-current rounded-full opacity-60"></div>
                                                    Admin Billing
                                                </NavLink>
                                            </motion.div>

                                            <motion.div initial={{ y: -10, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: -10, opacity: 0 }} transition={{ delay: 0.28, duration: 0.15 }}>
                                                <NavLink to="/seller-central-checker/settings?tab=admin-support" onClick={closeMenu} className={dropdownItemClass} style={() => dropdownItemStyle(isSettingsPage && currentSettingsTab === 'admin-support')}>
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
                )}
            </div>

            {/* Logout Section - Hidden for agency admin viewing client */}
            {!isAgencyAdminViewingClient && (
            <div className="px-4 py-3 flex-shrink-0" style={{ borderTop: `1px solid ${COLORS.border}` }}>
                <button
                    className='group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs transition-colors w-full'
                    style={{ color: COLORS.fix }}
                    onClick={(e)=>logoutUser(e)}
                >
                    <LogOut className="w-3.5 h-3.5" style={{ color: COLORS.fix }} />
                    <span className="font-medium">Log Out</span>
                    {loader && <BeatLoader color={COLORS.fix} size={6} />}
                </button>
            </div>
            )}
        </aside>
        </>
    );
};

export default LeftNavSection;
