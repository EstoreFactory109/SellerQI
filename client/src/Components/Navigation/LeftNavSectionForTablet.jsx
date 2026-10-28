import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import {LayoutDashboard,BadgeAlert, ClipboardPlus,Clock8,ChartLine,LaptopMinimalCheck, ChevronRight, X, Calendar, DollarSign, Lock, Package, LogOut, Bot, BarChart3, User, UserPlus, Link2, LifeBuoy, CreditCard, Building2, ListChecks, TrendingUp, FileText, MessageSquare, Receipt, Users, Settings} from 'lucide-react'
import useEsfPageAccess from '../../hooks/useEsfPageAccess.js';
import { logout } from '../../redux/slices/authSlice.js'
import { clearCogsData } from '../../redux/slices/cogsSlice.js'
import axios from 'axios';
import { useNavigate } from 'react-router-dom';
import BeatLoader from "react-spinners/BeatLoader";
import { useSelector,useDispatch } from 'react-redux';
import {setPosition} from '../../redux/slices/MobileMenuSlice.js'
import { AnimatePresence, motion } from "framer-motion";
import NavSearch from './NavSearch.jsx';
import { fetchAccountIssues, fetchYourProductsSummaryV3 } from '../../redux/slices/PageDataSlice.js';
import { fetchTasks } from '../../redux/slices/TasksSlice.js';
import stripeService from '../../services/stripeService';
import { COLORS } from '../Shared/index.js';

// "NW" from "Northwind Goods" - first letter of up to the first two words.
const getInitials = (name) => {
    if (!name) return '';
    return name.trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
};

const PLAN_LABELS = { LITE: 'Lite', PRO: 'Pro', AGENCY: 'Agency' };

// Same category-grouped nav item pattern as the desktop sidebar (LeftNavSection.jsx),
// duplicated here since this component already duplicates the desktop nav's logic
// for its own mobile-drawer chrome (backdrop, close button, slide position).
// The ESF page-permission key is the route segment, so a nav link carries its
// own key and no second mapping can drift out of sync with the server's list.
const pageKeyFromPath = (to) => {
    if (typeof to !== 'string') return null;
    const clean = to.split('?')[0];
    const segments = clean.split('/').filter(Boolean);
    return segments.length ? segments[segments.length - 1] : null;
};

const NavItem = ({ to, icon: Icon, label, isActive: isActiveOverride, locked, onClick, expanded, onNavigate, tag, count, countTone = 'fix' }) => {
    // Hidden when the ESF staff member driving this session is blocked from the
    // page. Non-ESF sessions and the owner always pass.
    const { isPageAllowed } = useEsfPageAccess();
    if (to && !isPageAllowed(pageKeyFromPath(to))) return null;

    const countStyle = countTone === 'watch'
        ? { background: 'rgba(245,166,35,.14)', color: COLORS.watch }
        : { background: 'rgba(239,68,68,.14)', color: COLORS.fix };
    const content = ({ isActive: linkActive }) => {
        const isActive = isActiveOverride !== undefined ? isActiveOverride : linkActive;
        return (
            <>
                <Icon className="w-4 h-4 flex-shrink-0" style={{ color: isActive ? COLORS.accent : COLORS.textMuted }} />
                <span className="flex-1 truncate">{label}</span>
                {locked && <Lock className="w-3.5 h-3.5 flex-shrink-0" style={{ color: COLORS.watch }} />}
                {/* Small pill tag, e.g. mock's "AI" badge beside Amazon Copilot */}
                {tag && (
                    <span
                        className="flex-shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded"
                        style={{ letterSpacing: '.04em', background: 'rgba(59,130,246,.16)', color: '#7EA8F8' }}
                    >
                        {tag}
                    </span>
                )}
                {/* Real count pill, e.g. Account Issues count */}
                {count != null && count > 0 && (
                    <span
                        className="flex-shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded-full"
                        style={countStyle}
                    >
                        {count}
                    </span>
                )}
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

// A group of pages behind one row (Your Growth Team, Account & Settings).
// The count pill shows on the row only while it is collapsed (open, it sits on the child itself).
const NavDropdown = ({ icon, label, open, onToggle, isActive, count, locked, children }) => (
    <div className="space-y-1">
        <NavItem icon={icon} label={label} isActive={isActive} locked={locked} count={open ? undefined : count} onClick={onToggle} expanded={open} />
        <AnimatePresence initial={false}>
            {open && (
                <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: "auto" }}
                    exit={{ opacity: 0, height: 0 }}
                    transition={{ duration: 0.25, ease: "easeInOut" }}
                    className="ml-3 pl-2 space-y-1 overflow-hidden"
                    style={{ borderLeft: `1px solid ${COLORS.border}` }}
                >
                    {children}
                </motion.div>
            )}
        </AnimatePresence>
    </div>
);

const dropdownItemClass = "flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-colors";

const LeftNavSection = () => {

    const dispatch = useDispatch();
    const navigate=useNavigate();
    const location = useLocation();
    const [loader,setLoader]=useState(false)

    const position = useSelector(state => state.MobileMenu.position);

    // Get user subscription plan from Redux store
    const user = useSelector((state) => state.Auth?.user);
    const { isPageAllowed } = useEsfPageAccess();
    // ESF-managed clients get extra internal pages that no other account sees.
    const isEsfClient = user?.isEsfClient === true;
    const userPlan = user?.packageType || 'LITE';
    const isAgencyUser = userPlan === 'AGENCY';

    // Real Account Issues count for the sidebar badge - same source Account.jsx uses.
    const legacyAccountInfo = useSelector((state) => state.Dashboard.DashBoardInfo);
    const accountIssuesState = useSelector((state) => state.pageData?.issuesPaginated?.account || { data: null, loading: false });
    const accountInfo = accountIssuesState.data || legacyAccountInfo;
    const accountIssuesCount = accountInfo?.totalAccountErrors || 0;

    React.useEffect(() => {
        if (!accountIssuesState.data && !accountIssuesState.loading) {
            dispatch(fetchAccountIssues());
        }
    }, [accountIssuesState.data, accountIssuesState.loading, dispatch]);

    // Real Your Products count for the sidebar badge - same summary Your Products page uses.
    const yourProductsSummaryState = useSelector((state) => state.pageData?.yourProductsV3?.summary || { data: null, loading: false });
    const yourProductsCount = yourProductsSummaryState.data?.totalProducts || 0;

    React.useEffect(() => {
        if (!yourProductsSummaryState.data && !yourProductsSummaryState.loading) {
            dispatch(fetchYourProductsSummaryV3());
        }
    }, [yourProductsSummaryState.data, yourProductsSummaryState.loading, dispatch]);

    // Real pending Tasks count for the sidebar badge - same tasks list the Tasks page uses.
    const tasksState = useSelector((state) => state.tasks || { tasks: [], loading: false, lastFetched: null });
    const pendingTasksCount = tasksState.tasks.filter(t => t.status !== 'completed').length;

    React.useEffect(() => {
        if (!tasksState.lastFetched && !tasksState.loading) {
            dispatch(fetchTasks());
        }
    }, [tasksState.lastFetched, tasksState.loading, dispatch]);

    // Real subscription renewal date for the bottom account box - fetched once locally.
    const [nextBillingDate, setNextBillingDate] = useState(null);
    React.useEffect(() => {
        stripeService.getSubscription()
            .then((sub) => setNextBillingDate(sub?.nextBillingDate || null))
            .catch(() => {});
    }, []);

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
    // ===== PAYMENT DISABLED - free PRO for all users (never lock nav items) =====
    const isPremiumLocked = false;
    // const isPremiumLocked = userPlan === 'LITE';

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
    // Two dropdown groups (Your Growth Team, Account & Settings), one open at a time (an accordion); the group holding the current page
    // opens by itself.
    const isGrowthTeamPage = location.pathname.includes('/client-dashboard') || location.pathname.includes('/estore-factory/');
    const groupForPath = isGrowthTeamPage ? 'growth' : isSettingsPage ? 'account' : null;
    const [openGroup, setOpenGroup] = useState(groupForPath);
    React.useEffect(() => {
        if (groupForPath) setOpenGroup(groupForPath);
    }, [groupForPath]);
    const toggleGroup = (group) => setOpenGroup((current) => (current === group ? null : group));

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

            {/* Mobile Menu - data-preserve-scroll keeps the route-change scroll reset
                (MainPagesLayout) from snapping the menu back to the top */}
            <aside
                data-preserve-scroll
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

                    {/* Main pages — no group headings */}
                    <div className="space-y-1">
                        {(!isLiteUser || isPremiumLocked) && (
                            <NavItem to="/seller-central-checker/dashboard" icon={LayoutDashboard} label="Dashboard" locked={isPremiumLocked} onNavigate={closeMenu} />
                        )}
                        {(!isLiteUser || isPremiumLocked) && (
                            <NavItem to="/seller-central-checker/your-products" icon={Package} label="Your Products" locked={isPremiumLocked} onNavigate={closeMenu} count={yourProductsCount} />
                        )}
                        {(!isLiteUser || isPremiumLocked) && (
                            <NavItem to="/seller-central-checker/tasks" icon={ClipboardPlus} label="Tasks" locked={isPremiumLocked} onNavigate={closeMenu} count={pendingTasksCount} countTone="watch" />
                        )}

                        {/* Money & Health pages — listed directly (no heading, no dropdown) */}
                            <NavItem to="/seller-central-checker/profitibility-dashboard" icon={ChartLine} label="Profitibility" locked={isPremiumLocked} onNavigate={closeMenu} />
                            <NavItem to="/seller-central-checker/reimbursement-dashboard" icon={DollarSign} label="Reimbursement" locked={isPremiumLocked} onNavigate={closeMenu} />
                            <NavItem
                                to="/seller-central-checker/issues?tab=account"
                                icon={BadgeAlert}
                                label="Account Issues"
                                isActive={isIssuesPage && currentTab === 'account'}
                                locked={isPremiumLocked}
                                onNavigate={closeMenu}
                                count={accountIssuesCount}
                            />
                            <NavItem to="/seller-central-checker/account-history" icon={Clock8} label="Accounts History" locked={isPremiumLocked} onNavigate={closeMenu} />

                        {/* Your Growth Team — Estore Factory-managed clients only */}
                        {isEsfClient && (
                            <NavDropdown icon={Users} label="Your Growth Team" open={openGroup === 'growth'} onToggle={() => toggleGroup('growth')} isActive={isGrowthTeamPage}>
                                <NavItem to="/seller-central-checker/client-dashboard" icon={Building2} label="Overview" onNavigate={closeMenu} />
                                <NavItem to="/seller-central-checker/estore-factory/status" icon={ListChecks} label="Status" onNavigate={closeMenu} />
                                <NavItem to="/seller-central-checker/estore-factory/untapped" icon={TrendingUp} label="Untapped" onNavigate={closeMenu} />
                                <NavItem to="/seller-central-checker/estore-factory/reports" icon={FileText} label="Reports" onNavigate={closeMenu} />
                                <NavItem to="/seller-central-checker/estore-factory/messages" icon={MessageSquare} label="Messages" onNavigate={closeMenu} />
                                <NavItem to="/seller-central-checker/estore-factory/billing" icon={Receipt} label="Billing" onNavigate={closeMenu} />
                            </NavDropdown>
                        )}

                        {/* A past Fix it buyer (back to a normal seller) keeps the record of the team's work. */}
                        {!isEsfClient && user?.fixItHistory === true && (
                            <NavItem to="/seller-central-checker/estore-factory/status" icon={ListChecks} label="Fix it history" onNavigate={closeMenu} />
                        )}

                        {/* Account & Settings — hidden for an agency admin viewing a client */}
                        {!isAgencyAdminViewingClient && (
                            <NavDropdown icon={Settings} label="Account & Settings" open={openGroup === 'account'} onToggle={() => toggleGroup('account')} isActive={isSettingsPage}>
                                <NavItem to="/seller-central-checker/settings?tab=profile" icon={User} label="User Profile" isActive={isSettingsPage && currentSettingsTab === 'profile'} onNavigate={closeMenu} />
                                <NavItem to="/seller-central-checker/settings?tab=members" icon={UserPlus} label="Add Member" isActive={isSettingsPage && currentSettingsTab === 'members'} onNavigate={closeMenu} />
                                {!isLiteUser && !isAgencyUser && (
                                    <NavItem to="/seller-central-checker/settings?tab=account-integration" icon={Link2} label="Account Integration" isActive={isSettingsPage && currentSettingsTab === 'account-integration'} onNavigate={closeMenu} />
                                )}
                                {!isAgencyUser && (
                                    <NavItem to="/seller-central-checker/settings?tab=support" icon={LifeBuoy} label="Support" isActive={isSettingsPage && currentSettingsTab === 'support'} onNavigate={closeMenu} />
                                )}
                                {/* Plans & Billing is hidden from the menu; the trial banner and upgrade prompts still link to it. */}
                                {isAgencyUser && (
                                    <>
                                        <div className="flex items-center gap-2 px-3 py-1 mt-1">
                                            <div className="h-px flex-1" style={{ background: COLORS.border }}></div>
                                            <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: COLORS.accent }}>Admin</span>
                                            <div className="h-px flex-1" style={{ background: COLORS.border }}></div>
                                        </div>
                                        <NavItem to="/seller-central-checker/settings?tab=admin-user-profile" icon={User} label="Admin User Profile" isActive={isSettingsPage && currentSettingsTab === 'admin-user-profile'} onNavigate={closeMenu} />
                                        <NavItem to="/seller-central-checker/settings?tab=admin-account-integration" icon={Link2} label="Admin Integrations" isActive={isSettingsPage && currentSettingsTab === 'admin-account-integration'} onNavigate={closeMenu} />
                                        <NavItem to="/seller-central-checker/settings?tab=admin-plans-billing" icon={CreditCard} label="Admin Billing" isActive={isSettingsPage && currentSettingsTab === 'admin-plans-billing'} onNavigate={closeMenu} />
                                        <NavItem to="/seller-central-checker/settings?tab=admin-support" icon={LifeBuoy} label="Admin Support" isActive={isSettingsPage && currentSettingsTab === 'admin-support'} onNavigate={closeMenu} />
                                    </>
                                )}
                            </NavDropdown>
                        )}
                    </div>

                    {/* Ecommerce Calendar - Available for ALL users including LITE - HIDDEN */}
                    {false && (
                        <NavItem to="/seller-central-checker/ecommerce-calendar" icon={Calendar} label="Ecommerce Calendar" onNavigate={closeMenu} />
                    )}

                </div>

            </div>

            {/* Pinned at the end of the menu: Need Help? and Log Out. Hidden for an agency admin viewing a client. */}
            {!isAgencyAdminViewingClient && (
            <div className="flex-shrink-0 px-3 pt-3 pb-2 flex flex-col gap-2" style={{ borderTop: `1px solid ${COLORS.border}` }}>
                <NavLink
                    to="/seller-central-checker/consultation"
                    onClick={closeMenu}
                    className="group flex items-center gap-2 px-3 py-2.5 rounded-xl font-medium text-xs cursor-pointer transition-all duration-300 border-2 border-orange-400 text-orange-400 hover:bg-gradient-to-r hover:from-orange-400 hover:to-amber-500 hover:text-black"
                >
                    <Calendar className="w-3.5 h-3.5 flex-shrink-0 text-orange-400 group-hover:text-black transition-colors duration-300" />
                    <span className="font-semibold flex-1">Need Help?</span>
                    <div className="w-1.5 h-1.5 bg-orange-400 rounded-full animate-pulse group-hover:bg-yellow-300 transition-colors duration-300"></div>
                </NavLink>
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

            {/* Account/plan identity box - pinned at the very bottom, unlike the nav above */}
            <div className="flex-shrink-0 flex items-center gap-2.5 px-4 py-3.5" style={{ borderTop: `1px solid ${COLORS.border}` }}>
                <div
                    className="w-[30px] h-[30px] rounded-lg flex-shrink-0 flex items-center justify-center text-xs font-semibold"
                    style={{ background: COLORS.surfaceElevated, border: `1px solid ${COLORS.border}`, color: COLORS.textSecondary }}
                >
                    {getInitials(user?.brand) || 'SQ'}
                </div>
                <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-medium truncate" style={{ color: COLORS.textPrimary }}>{user?.brand || 'Your Brand'}</div>
                    <div className="text-[11px]" style={{ color: COLORS.textMuted }}>
                        {PLAN_LABELS[userPlan] || userPlan}
                        {nextBillingDate && ` · renews ${new Date(nextBillingDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`}
                    </div>
                </div>
            </div>
        </aside>
        </>
    );
};

export default LeftNavSection;
