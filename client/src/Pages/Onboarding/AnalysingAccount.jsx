import React, { useEffect, useState, useCallback, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Lock,
  LayoutDashboard,
  Mail,
  CheckCircle2,
  ArrowRight,
  AlertCircle,
  TrendingUp,
  DollarSign,
  Receipt,
  Search,
  Unlock,
  Loader2,
  LogOut,
} from "lucide-react";
import axiosInstance from "../../config/axios.config.js";
import { coordinatedAuthCheck, clearAuthCache } from "../../utils/authCoordinator.js";
import { loginSuccess, logout } from "../../redux/slices/authSlice.js";
import OnboardingShell from "../../Components/Onboarding/OnboardingShell.jsx";
import { COLORS } from "../../Components/Shared/index.js";

// Matches the onboarding shell's inset panel shade.
const PANEL_BG = '#10141C';

// The real product surfaces the audit fills in, shown while the scan runs so the
// wait has some context. Icons only — no decorative fake charts.
const INNER_PAGES = [
  { title: "Dashboard", desc: "Sales, trends and account health at a glance", icon: LayoutDashboard },
  { title: "Issues", desc: "Catalog, listing and policy issues", icon: AlertCircle },
  { title: "Keywords", desc: "Keyword research for listings and PPC", icon: Search },
  { title: "Sponsored Ads", desc: "Campaign audit and wasted spend", icon: TrendingUp },
  { title: "Profitability", desc: "Margins, COGS and net profit", icon: DollarSign },
  { title: "Reimbursement", desc: "FBA claims and recovery", icon: Receipt },
];

// Polling interval in milliseconds (15 minutes)
const POLLING_INTERVAL = 15 * 60 * 1000;

const AnalysingAccount = () => {
  const user = useSelector((state) => state.Auth?.user);
  const navigate = useNavigate();
  const dispatch = useDispatch();
  
  // State for authentication
  const [isAuthChecking, setIsAuthChecking] = useState(true);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  
  // State for analysis status
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [isChecking, setIsChecking] = useState(true);
  const pollingIntervalRef = useRef(null);
  const hasCheckedAuthRef = useRef(false);

  // Check authentication on mount
  useEffect(() => {
    // Prevent multiple auth checks
    if (hasCheckedAuthRef.current) return;
    hasCheckedAuthRef.current = true;

    // Check if admin is logged in via admin-login page - redirect to manage-accounts
    const isAdminAuth = localStorage.getItem('isAdminAuth') === 'true';
    if (isAdminAuth) {
      navigate('/manage-accounts', { replace: true });
      return;
    }

    const checkAuth = async () => {
      try {
        const result = await coordinatedAuthCheck();
        
        if (result.isAuthenticated && result.user) {
          // Check if user is a super admin - redirect to manage-accounts
          const isSuperAdmin = result.user?.accessType === 'superAdmin';
          if (isSuperAdmin) {
            // Store accessType for future redirects
            localStorage.setItem('userAccessType', 'superAdmin');
            navigate('/manage-accounts', { replace: true });
            return;
          }
          
          setIsAuthenticated(true);
          // Update Redux state with user data
          dispatch(loginSuccess(result.user));
          localStorage.setItem('isAuth', 'true');
        } else {
          // Not authenticated, redirect to login
          localStorage.removeItem('isAuth');
          navigate('/', { replace: true });
        }
      } catch (error) {
        console.error('Auth check failed:', error);
        localStorage.removeItem('isAuth');
        navigate('/', { replace: true });
      } finally {
        setIsAuthChecking(false);
      }
    };

    checkAuth();
  }, [dispatch, navigate]);

  const firstName = user?.firstName || "there";
  const welcomeName = firstName !== "there" ? firstName : "there";

  // Dashboard is unlocked only when analysis is complete (no package check)
  const canAccessDashboard = analysisComplete;

  // Function to check analysis status
  const checkAnalysisStatus = useCallback(async () => {
    try {
      const response = await axiosInstance.get('/app/check-first-analysis-status');
      if (response.data?.data?.firstAnalysisDone) {
        setAnalysisComplete(true);
        // Clear the polling interval once analysis is complete
        if (pollingIntervalRef.current) {
          clearInterval(pollingIntervalRef.current);
          pollingIntervalRef.current = null;
        }
      }
    } catch (error) {
      console.error('Error checking analysis status:', error);
      // Don't stop polling on error, just log it
    } finally {
      setIsChecking(false);
    }
  }, []);

  // Check analysis status on mount and set up polling (only after authentication is confirmed)
  useEffect(() => {
    if (!isAuthenticated || isAuthChecking) return;

    // Initial check
    checkAnalysisStatus();

    // Set up polling every 15 minutes
    pollingIntervalRef.current = setInterval(() => {
      checkAnalysisStatus();
    }, POLLING_INTERVAL);

    // Cleanup on unmount
    return () => {
      if (pollingIntervalRef.current) {
        clearInterval(pollingIntervalRef.current);
      }
    };
  }, [checkAnalysisStatus, isAuthenticated, isAuthChecking]);

  // Handle dashboard navigation when analysis is complete
  const handleGoToDashboard = () => {
    navigate('/seller-central-checker/dashboard');
  };

  const handleLogout = async () => {
    try {
      await axiosInstance.get('/app/logout', { withCredentials: true });
    } catch (error) {
      console.error('Logout API:', error?.response?.status || error?.message);
    }
    clearAuthCache();
    localStorage.removeItem('isAuth');
    dispatch(logout());
    navigate('/', { replace: true });
  };

  // Show loading state while checking authentication
  if (isAuthChecking) {
    return (
      <div className="min-h-screen w-full flex items-center justify-center" style={{ background: COLORS.bgBase }}>
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 animate-spin" style={{ color: COLORS.accent }} />
          <p style={{ fontSize: 14, color: COLORS.textSecondary }}>Verifying authentication...</p>
        </div>
      </div>
    );
  }

  // Don't render anything if not authenticated (will redirect)
  if (!isAuthenticated) {
    return null;
  }

  return (
    <OnboardingShell currentStep={4} doneSteps={[1, 2, 3]} maxWidth="700px">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35 }}>
        {/* Status pill */}
        <div
          className="inline-flex items-center gap-2"
          style={{
            padding: '5px 11px',
            borderRadius: 999,
            background: analysisComplete ? 'rgba(34,197,94,.12)' : 'rgba(59,130,246,.12)',
            color: analysisComplete ? COLORS.good : '#7EA8F8',
            fontSize: 12,
            fontWeight: 600,
            marginBottom: 16,
          }}
        >
          {analysisComplete ? '✓ Setup complete' : 'Step 5 of 5 · Almost there'}
        </div>

        <h1 style={{ margin: '0 0 8px', fontSize: 27, lineHeight: '34px', fontWeight: 600, letterSpacing: '-0.025em', color: COLORS.textPrimary }}>
          {analysisComplete ? `You're all set, ${welcomeName}` : 'Auditing your account'}
        </h1>
        <p style={{ margin: '0 0 24px', fontSize: 14, lineHeight: '22px', color: COLORS.textSecondary, maxWidth: '62ch' }}>
          {analysisComplete
            ? 'Your first audit has finished and your dashboard is unlocked. Everything below is now populated with your own data.'
            : "We're pulling your catalog, orders, fees and ad data from Amazon and checking it for issues. You can close this tab — we'll email you the moment it's ready."}
        </p>

        {/* Scan status card */}
        <div style={{ border: `1px solid ${analysisComplete ? 'rgba(34,197,94,.25)' : COLORS.border}`, borderRadius: 14, background: COLORS.surface, padding: '22px 24px', marginBottom: 18 }}>
          {analysisComplete ? (
            <div className="flex items-center gap-3.5">
              <div
                className="flex-none flex items-center justify-center"
                style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(34,197,94,.14)' }}
              >
                <CheckCircle2 className="w-5 h-5" style={{ color: COLORS.good }} />
              </div>
              <div className="flex-1 min-w-0">
                <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary }}>First audit complete</div>
                <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
                  Your dashboard is unlocked and refreshes on its own from here.
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center gap-3.5" style={{ marginBottom: 18 }}>
                <div
                  className="flex-none animate-spin"
                  style={{ width: 26, height: 26, borderRadius: '50%', border: `3px solid ${COLORS.surfaceElevated}`, borderTopColor: COLORS.accent }}
                />
                <div className="flex-1 min-w-0">
                  <div style={{ fontSize: 15, fontWeight: 600, color: COLORS.textPrimary }}>
                    {isChecking ? 'Checking status…' : 'Scan in progress'}
                  </div>
                  <div style={{ fontSize: 13, color: COLORS.textSecondary, marginTop: 2 }}>
                    A first full audit can take up to 24 hours on a large catalog.
                  </div>
                </div>
              </div>

              {/* Indeterminate bar — the backend reports completion as a boolean, not a
                  percentage, so we deliberately don't show a fake progress figure. */}
              <div style={{ height: 6, borderRadius: 4, background: COLORS.surfaceElevated, overflow: 'hidden' }}>
                <motion.div
                  style={{ height: '100%', width: '38%', borderRadius: 4, background: COLORS.accent }}
                  animate={{ x: ['-100%', '340%'] }}
                  transition={{ duration: 1.9, repeat: Infinity, ease: 'easeInOut' }}
                />
              </div>
            </>
          )}
        </div>

        {/* Primary action */}
        <div className="flex items-center gap-3 flex-wrap" style={{ marginBottom: 14 }}>
          {canAccessDashboard ? (
            <button
              onClick={handleGoToDashboard}
              className="inline-flex items-center gap-2 transition-colors"
              style={{ padding: '14px 24px', border: 0, borderRadius: 10, background: COLORS.accent, color: '#061021', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}
              title="Go to your dashboard"
            >
              <Unlock className="w-4 h-4" />
              Open my dashboard
              <ArrowRight className="w-4 h-4" />
            </button>
          ) : (
            <>
              <span
                className="inline-flex items-center gap-2 select-none"
                style={{ padding: '14px 24px', borderRadius: 10, background: COLORS.surfaceElevated, color: COLORS.textMuted, fontSize: 15, fontWeight: 600, cursor: 'not-allowed' }}
                title="Unlocks when your analysis is ready"
              >
                <Lock className="w-4 h-4" />
                Open my dashboard
              </span>
              <span style={{ fontSize: 12, color: COLORS.textMuted }}>Unlocks as soon as the first audit lands</span>
            </>
          )}
        </div>

        {/* Email reassurance */}
        <div
          className="flex items-center gap-3"
          style={{ padding: '14px 16px', border: `1px solid ${COLORS.border}`, borderRadius: 11, background: PANEL_BG, marginBottom: 26 }}
        >
          <Mail className="w-4 h-4 flex-shrink-0" style={{ color: COLORS.good }} />
          <p style={{ margin: 0, fontSize: 13, color: COLORS.textSecondary }}>
            {analysisComplete
              ? 'We emailed you a copy of the summary too.'
              : "You can safely close this tab — we'll email you when the audit is done."}
          </p>
        </div>

        {/* What the audit fills in */}
        <div style={{ marginBottom: 26 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, color: COLORS.textPrimary }}>
            {analysisComplete ? "What's waiting for you" : "What we're filling in"}
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2" style={{ gap: 10 }}>
            {INNER_PAGES.map((page) => (
              <div
                key={page.title}
                className="flex items-start gap-3"
                style={{ border: `1px solid ${COLORS.border}`, borderRadius: 11, background: COLORS.surface, padding: '13px 15px' }}
              >
                <page.icon className="w-4 h-4 flex-shrink-0" style={{ color: COLORS.textMuted, marginTop: 2 }} />
                <div className="min-w-0">
                  <div style={{ fontSize: 13, fontWeight: 600, color: COLORS.textPrimary }}>{page.title}</div>
                  <div style={{ fontSize: 12, lineHeight: '17px', color: COLORS.textMuted, marginTop: 2 }}>{page.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Help + log out */}
        <div
          className="flex items-center justify-between gap-3 flex-wrap"
          style={{ paddingTop: 20, borderTop: `1px solid ${COLORS.border}` }}
        >
          <p style={{ margin: 0, fontSize: 13, color: COLORS.textMuted }}>
            Need a hand? Visit our{' '}
            <a href="https://www.sellerqi.com" target="_blank" rel="noopener noreferrer" style={{ color: '#7EA8F8' }}>
              help center
            </a>
            {' '}or reach support from Settings.
          </p>
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 transition-colors"
            style={{ padding: '9px 14px', borderRadius: 9, border: `1px solid ${COLORS.border}`, background: 'transparent', color: COLORS.textSecondary, fontSize: 13, cursor: 'pointer' }}
          >
            <LogOut className="w-3.5 h-3.5" />
            Log out
          </button>
        </div>
      </motion.div>
    </OnboardingShell>
  );
};

export default AnalysingAccount;
