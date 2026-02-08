import React, { useEffect, useState, useCallback, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { useNavigate, Link } from "react-router-dom";
import { motion } from "framer-motion";
import {
  Lock,
  LayoutDashboard,
  Mail,
  CheckCircle2,
  ArrowRight,
  BookOpen,
  FileText,
  BarChart3,
  AlertCircle,
  TrendingUp,
  DollarSign,
  Receipt,
  Search,
  Unlock,
  Loader2,
  LogOut,
} from "lucide-react";
import sellerQILogo from "../assets/Logo/sellerQILogo.png";
import axiosInstance from "../config/axios.config.js";
import { coordinatedAuthCheck, clearAuthCache } from "../utils/authCoordinator.js";
import { loginSuccess, logout } from "../redux/slices/authSlice.js";

// Vibrant palette
const COLORS = {
  cyan: "#22d3ee",
  blue: "#60a5fa",
  violet: "#a78bfa",
  emerald: "#34d399",
  amber: "#fbbf24",
  rose: "#fb7185",
  sky: "#38bdf8",
};

// Mini demo chart components (deco only) — solid colors
const MiniBarChart = ({ accent = COLORS.blue }) => (
  <div className="flex items-end gap-0.5 h-8">
    {[40, 65, 45, 80, 55, 70].map((h, i) => (
      <motion.div
        key={i}
        className="w-1.5 rounded-t opacity-90"
        style={{ backgroundColor: accent }}
        initial={{ height: 0 }}
        animate={{ height: `${h}%` }}
        transition={{ duration: 0.5, delay: 0.2 + i * 0.05 }}
      />
    ))}
  </div>
);
const MiniLineChart = () => (
  <svg viewBox="0 0 60 24" className="w-full h-8 text-[#34d399]" fill="none" stroke="currentColor" strokeWidth="1.8">
    <motion.path
      d="M 0 18 L 10 14 L 20 16 L 30 8 L 40 12 L 50 6 L 60 10"
      stroke="currentColor"
      initial={{ pathLength: 0 }}
      animate={{ pathLength: 1 }}
      transition={{ duration: 0.8, delay: 0.3 }}
    />
  </svg>
);
const MiniPieSlice = () => (
  <svg viewBox="0 0 32 32" className="w-8 h-8">
    <motion.circle cx="16" cy="16" r="14" fill="none" stroke={COLORS.violet} strokeWidth="3" strokeDasharray="44 88"
      initial={{ strokeDasharray: "0 88" }} animate={{ strokeDasharray: "44 88" }} transition={{ duration: 0.6, delay: 0.3 }} />
    <motion.circle cx="16" cy="16" r="14" fill="none" stroke={COLORS.emerald} strokeWidth="3" strokeDasharray="22 88" strokeDashoffset="-44"
      initial={{ strokeDasharray: "0 88" }} animate={{ strokeDasharray: "22 88" }} transition={{ duration: 0.5, delay: 0.5 }} />
  </svg>
);
const MiniAreaBars = ({ accent = COLORS.cyan }) => (
  <div className="flex items-end gap-1 h-8">
    {[70, 50, 85, 60, 90].map((h, i) => (
      <motion.div
        key={i}
        className="w-2 rounded-sm"
        style={{ backgroundColor: accent }}
        initial={{ height: 0 }}
        animate={{ height: `${h}%` }}
        transition={{ duration: 0.4, delay: 0.4 + i * 0.06 }}
      />
    ))}
  </div>
);

const ANALYZING_ITEMS = [
  { icon: "📊", label: "Sales", color: COLORS.emerald },
  { icon: "📈", label: "PPC", color: COLORS.blue },
  { icon: "💰", label: "Profit", color: COLORS.amber },
  { icon: "📦", label: "Inventory", color: COLORS.violet },
  { icon: "🏆", label: "Rankings", color: COLORS.rose },
  { icon: "🛡️", label: "Health", color: COLORS.cyan },
];

const INNER_PAGES = [
  { title: "Dashboard", desc: "Sales, trends & account health at a glance", icon: LayoutDashboard, chart: MiniBarChart, chartProps: { accent: COLORS.blue }, accent: COLORS.blue },
  { title: "Issues", desc: "Catalog, listing & policy issues", icon: AlertCircle, chart: MiniPieSlice, chartProps: {}, accent: COLORS.violet },
  { title: "Keywords", desc: "Keyword research and recommendations for listings & PPC", icon: Search, chart: MiniLineChart, chartProps: {}, accent: COLORS.emerald },
  { title: "PPC Dashboard", desc: "Sponsored ads performance", icon: TrendingUp, chart: MiniAreaBars, chartProps: { accent: COLORS.cyan }, accent: COLORS.cyan },
  { title: "Profitability", desc: "Margins, COGS & suggestions", icon: DollarSign, chart: MiniBarChart, chartProps: { accent: COLORS.amber }, accent: COLORS.amber },
  { title: "Reimbursement", desc: "FBA claims & recovery", icon: Receipt, chart: MiniAreaBars, chartProps: { accent: COLORS.rose }, accent: COLORS.rose },
];

const FOOTER_LINKS = [
  { href: "https://www.sellerqi.com/use-cases", label: "Use Cases", icon: BarChart3 },
  { href: "https://www.sellerqi.com/case-study/", label: "Case Studies", icon: FileText },
  { href: "https://www.sellerqi.com/blog/", label: "Blog", icon: BookOpen },
];

const WHATS_NEXT = [
  "Switch accounts or profiles from the top nav bar.",
  "Connect more marketplaces from Settings.",
  "Your dashboard shows sales, issues, keywords, and profitability.",
  "Use Reports and Reimbursement when data is available.",
];

const KEY_FEATURES = [
  { title: "Multi-marketplace", desc: "Connect US, UK, EU, and more from one account.", icon: "🌍" },
  { title: "Issue alerts", desc: "Catalog, listing, and policy issues in one place.", icon: "🔔" },
  { title: "Keyword analysis", desc: "Discover high-value keywords for listings and Sponsored Ads.", icon: "🔑" },
  { title: "Profitability", desc: "Margins, COGS, and FBA fees in one dashboard.", icon: "📊" },
];

const QUICK_TIPS = [
  "Use date range filters on the Dashboard to compare periods.",
  "Issues are grouped by category so you can fix the most impactful first.",
  "Reimbursement claims can be tracked from the Reimbursement page.",
];

const container = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.08 } } };
const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0 } };

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

    const checkAuth = async () => {
      try {
        const result = await coordinatedAuthCheck();
        
        if (result.isAuthenticated && result.user) {
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
      console.warn('Logout API:', error?.response?.status || error?.message);
    }
    clearAuthCache();
    localStorage.removeItem('isAuth');
    dispatch(logout());
    navigate('/', { replace: true });
  };

  // Show loading state while checking authentication
  if (isAuthChecking) {
    return (
      <div className="min-h-screen w-full bg-[#111827] flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <Loader2 className="w-8 h-8 text-[#22d3ee] animate-spin" />
          <p className="text-[#9ca3af] text-sm">Verifying authentication...</p>
        </div>
      </div>
    );
  }

  // Don't render anything if not authenticated (will redirect)
  if (!isAuthenticated) {
    return null;
  }

  return (
    <div className="min-h-screen w-full bg-[#111827] text-[#e6edf3] flex flex-col relative overflow-hidden">
      {/* Subtle background orbs — solid colors */}
      <div className="absolute inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] rounded-full bg-[#a78bfa]/10 blur-[140px]" />
        <div className="absolute bottom-0 left-0 w-[400px] h-[400px] rounded-full bg-[#22d3ee]/8 blur-[120px]" />
      </div>

      <div className="flex-1 w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-4 sm:py-5 relative z-10">
        {/* Logo + Logout */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="mb-1 flex items-center justify-between"
        >
          <img src={sellerQILogo} alt="SellerQI" className="h-8 w-auto" />
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium text-[#e6edf3] border border-[#30363d] bg-[#1f2937]/80 hover:bg-[#374151] hover:border-[#4b5563] transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Log out
          </button>
        </motion.div>

        {/* Hero */}
        <motion.div
          className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-6 mb-4"
          initial="hidden"
          animate="show"
          variants={container}
        >
          <div className="lg:col-span-7 flex flex-col justify-center w-full">
            <motion.p variants={item} className="text-[#9ca3af] text-xs font-medium uppercase tracking-wider mb-0.5">
              You're in
            </motion.p>
            <motion.h1
              variants={item}
              className="text-3xl sm:text-4xl font-bold mb-2 text-[#e6edf3]"
            >
              Welcome, {welcomeName}
            </motion.h1>
            <motion.p variants={item} className="text-[#8b949e] text-sm mb-4">
              Your SellerQI command center. Use the dashboard when it's ready.
            </motion.p>
            {!analysisComplete && (
              <motion.div
                variants={item}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl mb-4 border border-[#fbbf24]/50 bg-[#fbbf24]/15 text-[#fbbf24] text-sm font-medium"
              >
                <span className="font-semibold">Account Analysis may take up to 24 hours. Thank you for your patience.</span>
              </motion.div>
            )}
            <motion.div variants={item} className="flex flex-wrap items-center gap-3 mb-4">
              {canAccessDashboard ? (
                <>
                  <button
                    onClick={handleGoToDashboard}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#22d3ee] text-[#111827] border border-[#22d3ee] text-sm font-medium cursor-pointer select-none relative overflow-hidden hover:bg-[#06b6d4] transition-colors duration-200"
                    title="Go to your dashboard"
                  >
                    <Unlock className="w-4 h-4" />
                    <span>Go to Dashboard</span>
                    <LayoutDashboard className="w-4 h-4 opacity-80" />
                  </button>
                  <span className="text-[#34d399] text-xs font-medium">Analysis complete!</span>
                </>
              ) : (
                <>
                  <span
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#21262d] text-[#6e7681] border border-[#30363d] text-sm font-medium cursor-not-allowed select-none relative overflow-hidden"
                    title="Unlocks when your analysis is ready"
                  >
                    <span className="absolute inset-0 bg-[#22d3ee]/10 -translate-x-full animate-shimmer" style={{ animation: "shimmer 2.5s ease-in-out infinite" }} />
                    <Lock className="w-4 h-4 relative z-10" />
                    <span className="relative z-10">Go to Dashboard</span>
                    <LayoutDashboard className="w-4 h-4 opacity-60 relative z-10" />
                  </span>
                  <span className="text-[#6e7681] text-xs">
                    Unlocks when your analysis is ready
                  </span>
                </>
              )}
            </motion.div>
            <motion.div variants={item} className="flex flex-wrap items-center gap-2">
              <span className="text-[#6e7681] text-xs uppercase tracking-wider mr-1">Data we use:</span>
              {ANALYZING_ITEMS.map(({ label, icon, color }) => (
                <span
                  key={label}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs border"
                  style={{ backgroundColor: `${color}12`, borderColor: `${color}40`, color }}
                >
                  {icon} {label}
                </span>
              ))}
            </motion.div>
          </div>
          <motion.div
            variants={item}
            className="lg:col-span-5 flex flex-col justify-center"
          >
            <div className="rounded-2xl border-2 border-[#374151] bg-[#1f2937]/80 p-4 lg:p-5 w-full max-w-md">
              <h3 className="text-[#e6edf3] text-sm font-semibold mb-3 flex items-center gap-2">
                <span className="w-1 h-4 rounded-full bg-[#60a5fa]" />
                Your workspace
              </h3>
              <ul className="space-y-2 text-[#9ca3af] text-sm">
                <li className="flex items-start gap-2">
                  <span className="text-[#34d399] mt-0.5 flex-shrink-0">•</span>
                  <span>Dashboard, Issues, Keywords, PPC, Profitability, and Reimbursement in one place.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#34d399] mt-0.5 flex-shrink-0">•</span>
                  <span>Switch accounts or profiles from the top nav bar.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#34d399] mt-0.5 flex-shrink-0">•</span>
                  <span>Connect more marketplaces from Settings.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#34d399] mt-0.5 flex-shrink-0">•</span>
                  <span>Use date filters on the Dashboard to compare periods.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#34d399] mt-0.5 flex-shrink-0">•</span>
                  <span>Issues are grouped by category and by product for quick fixes.</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="text-[#34d399] mt-0.5 flex-shrink-0">•</span>
                  <span>Keyword analysis and PPC dashboards are in the left menu.</span>
                </li>
              </ul>
            </div>
          </motion.div>
        </motion.div>

        {/* Email card */}
        <motion.div
          className="mb-4"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.25 }}
        >
          {canAccessDashboard ? (
            <div className="rounded-xl border border-[#34d399]/50 bg-[#064e3b]/30 p-4 flex items-center gap-4 border-l-4 border-l-[#34d399]">
              <CheckCircle2 className="w-6 h-6 text-[#34d399] flex-shrink-0" />
              <div>
                <p className="text-[#e6edf3] font-medium">Your analysis is ready!</p>
                <p className="text-[#8b949e] text-sm mt-0.5">Your dashboard is now unlocked. Click the button above to explore your data.</p>
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-[#34d399]/30 bg-[#064e3b]/20 p-4 flex items-center gap-4 border-l-4 border-l-[#34d399]">
              <Mail className="w-6 h-6 text-[#34d399] flex-shrink-0" />
              <div>
                <p className="text-[#e6edf3] font-medium">You can close this tab</p>
                <p className="text-[#8b949e] text-sm mt-0.5">We'll email you when everything's ready. Your dashboard will unlock once the analysis is complete.</p>
              </div>
            </div>
          )}
        </motion.div>

        {/* Key features — 4 cards */}
        <motion.section
          className="mb-4"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 }}
        >
          <h2 className="text-[#e6edf3] text-sm font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-[#a78bfa]" />
            What you get with SellerQI
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {KEY_FEATURES.map((f, i) => (
              <div
                key={f.title}
                className="rounded-xl border border-[#374151] bg-[#1f2937]/80 p-3"
              >
                <span className="text-xl leading-none block mb-1.5">{f.icon}</span>
                <p className="text-[#e6edf3] text-sm font-medium mb-0.5">{f.title}</p>
                <p className="text-[#9ca3af] text-xs leading-snug">{f.desc}</p>
              </div>
            ))}
          </div>
        </motion.section>

        {/* Inside your command center */}
        <motion.section
          className="mb-4"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.35 }}
        >
          <h2 className="text-[#e6edf3] text-base font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-5 rounded-full bg-[#60a5fa]" />
            <span className="text-[#e6edf3]">Inside your command center</span>
          </h2>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {INNER_PAGES.map((page, i) => (
              <motion.div
                key={page.title}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: 0.4 + i * 0.05 }}
                whileHover={{ y: -2, transition: { duration: 0.2 } }}
                className="rounded-xl border-2 p-4 transition-all duration-300 group"
                style={{
                  borderColor: `${page.accent}30`,
                  backgroundColor: `${page.accent}08`,
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = `${page.accent}60`;
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = `${page.accent}30`;
                }}
              >
                <div className="flex items-start justify-between gap-2 mb-2">
                  <div className="flex items-center gap-2.5">
                    <page.icon className="w-5 h-5 flex-shrink-0" style={{ color: page.accent }} />
                    <span className="text-[#e6edf3] font-medium text-sm">{page.title}</span>
                  </div>
                  <div className="opacity-80 group-hover:opacity-100 transition-opacity">
                    {(() => {
                      const Chart = page.chart;
                      return <Chart {...(page.chartProps || {})} />;
                    })()}
                  </div>
                </div>
                <p className="text-[#9ca3af] text-xs leading-snug">{page.desc}</p>
              </motion.div>
            ))}
          </div>
        </motion.section>

        {/* Quick tips */}
        <motion.section
          className="mb-4"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.45 }}
        >
          <h2 className="text-[#e6edf3] text-sm font-semibold mb-3 flex items-center gap-2">
            <span className="w-1 h-4 rounded-full bg-[#fbbf24]" />
            Quick tips
          </h2>
          <div className="rounded-xl border border-[#374151] bg-[#1f2937]/80 p-4">
            <ul className="grid grid-cols-1 md:grid-cols-3 gap-3 text-[#9ca3af] text-sm">
              {QUICK_TIPS.map((tip, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-[#fbbf24] flex-shrink-0 mt-0.5">•</span>
                  <span>{tip}</span>
                </li>
              ))}
            </ul>
          </div>
        </motion.section>

        {/* What happens next + Explore */}
        <motion.div
          className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.5 }}
        >
          <div className="rounded-xl border-2 border-[#34d399]/30 bg-[#064e3b]/15 p-4">
            <h3 className="text-[#34d399] text-xs uppercase tracking-wider mb-3 flex items-center gap-2 font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              Getting started
            </h3>
            <ul className="space-y-2">
              {WHATS_NEXT.map((line, i) => (
                <li key={i} className="flex items-center gap-2.5 text-[#d1d5db] text-sm">
                  <span className="w-2 h-2 rounded-full bg-[#34d399] flex-shrink-0" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-xl border-2 border-[#60a5fa]/30 bg-[#1e3a5f]/20 p-4">
            <h3 className="text-[#60a5fa] text-xs uppercase tracking-wider mb-3 font-semibold">Explore</h3>
            <div className="flex flex-wrap gap-2">
              {FOOTER_LINKS.map(({ href, label, icon: Icon }) => (
                <a
                  key={label}
                  href={href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1e3a5f]/40 border-2 border-[#60a5fa]/40 text-[#93c5fd] hover:text-white hover:border-[#60a5fa] hover:bg-[#60a5fa]/20 text-sm font-medium transition-all duration-200"
                >
                  <Icon className="w-4 h-4" />
                  {label}
                  <ArrowRight className="w-3.5 h-3.5" />
                </a>
              ))}
            </div>
          </div>
        </motion.div>

        {/* Help row */}
        <motion.div
          className="rounded-xl border border-[#374151] bg-[#1f2937]/60 px-4 py-3 mb-4 flex flex-wrap items-center justify-between gap-3"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55 }}
        >
          <p className="text-[#9ca3af] text-sm">
            Need help? Visit our <a href="https://www.sellerqi.com" target="_blank" rel="noopener noreferrer" className="text-[#60a5fa] hover:underline font-medium">help center</a> or reach out to support from Settings.
          </p>
        </motion.div>

      </div>

      {/* Shimmer keyframes for locked button — ensure it exists in global CSS or inline */}
      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%) skewX(-12deg); }
          100% { transform: translateX(200%) skewX(-12deg); }
        }
      `}</style>
    </div>
  );
};

export default AnalysingAccount;
