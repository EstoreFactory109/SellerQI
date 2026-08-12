import React, { useState, useRef, useEffect, useMemo } from 'react'
import { TrendingUp, AlertTriangle, DollarSign, Box, ShoppingBag, Activity, LineChart, PieChart, Users, Filter, Award, Target, Receipt, TrendingDown, Gauge, FileWarning } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import ProductChecker from '../../Components/Dashboard/SamePageComponents/ProductChecker.jsx'
import TotalSales from '../../Components/Dashboard/SamePageComponents/TotalSales.jsx'
import ErrorBoundary from '../../Components/ErrorBoundary/ErrorBoundary.jsx'
import { SkeletonChart, SkeletonTableBody } from '../../Components/Skeleton/PageSkeletons.jsx'
import { SkeletonBar } from '../../Components/Skeleton/Skeleton.jsx'
import { useSelector, useDispatch } from 'react-redux'
import { useNavigate, useLocation } from 'react-router-dom'
import { formatCurrency, formatCurrencyWithLocale } from '../../utils/currencyUtils.js'
import { fetchReimbursementSummary } from '../../redux/slices/ReimbursementSlice.js'
import { fetchLatestPPCMetrics, selectPPCSummary, selectLatestPPCMetricsLoading, selectPPCDateWiseMetrics } from '../../redux/slices/PPCMetricsSlice.js'
import { fetchPPCKPISummary, selectPPCKPISummary } from '../../redux/slices/PPCCampaignAnalysisSlice.js'
import { parseLocalDate } from '../../utils/dateUtils.js'
import { shouldUseCalendarDateRange } from '../../utils/totalSalesFilterUrl.js'
import { useDashboardData } from '../../hooks/usePageData.js'
import { devLog } from '../../utils/devLogger.js'
import axiosInstance from '../../config/axios.config.js'
import DownloadReport from '../../Components/DownloadReport/DownloadReport.jsx'
import { StatusPill, KPICard, VerdictBanner, HealthGauge, ActionCard, InfoTooltip, STATUS, COLORS, getStatusConfig } from '../../Components/Shared/index.js'

const Dashboard = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('Last 30 Days')
  const [dismissedFixKeys, setDismissedFixKeys] = useState([])
  // Reported up by TotalSales.jsx (below) — the real Gross Profit figure it already
  // computes, so this page doesn't duplicate that fee/COGS calculation independently.
  const [grossProfitData, setGrossProfitData] = useState({ grossProfitRaw: 0, totalSales: 0, hasFinanceData: false, loading: true })
  const contentRef = useRef(null)
  const totalSalesSectionRef = useRef(null)
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const location = useLocation()

  // Redesign uses the Geist font (per the new design mock) — loaded at runtime so
  // no other file (index.html/index.css) needs to change for this one page.
  useEffect(() => {
    const id = 'geist-font-link'
    if (!document.getElementById(id)) {
      const link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      link.href = 'https://fonts.googleapis.com/css2?family=Geist:wght@400;500;600;700&display=swap'
      document.head.appendChild(link)
    }
  }, [])

  // Reset scroll position when navigating to Dashboard
  useEffect(() => {
    // Only reset scroll when navigating to Dashboard
    if (location.pathname.includes('/dashboard') || location.pathname === '/seller-central-checker/dashboard') {
      // Use requestAnimationFrame to ensure DOM is ready
      const resetScroll = () => {
        // Reset the parent scroll container (MainPagesLayout's scrollable div)
        // Try multiple selectors to find the scroll container
        const selectors = [
          'div.flex-1.overflow-y-auto.scrollbar-hide',
          'div.flex-1.overflow-y-auto',
          'section.flex-1 div.overflow-y-auto'
        ]
        
        for (const selector of selectors) {
          const parentScrollContainer = document.querySelector(selector)
          if (parentScrollContainer) {
            parentScrollContainer.scrollTop = 0
            break
          }
        }
        
        // Reset window scroll (in case of any window-level scrolling)
        window.scrollTo({ top: 0, behavior: 'instant' })
      }
      
      // Reset immediately
      resetScroll()
      
      // Try multiple times to ensure scroll reset happens
      requestAnimationFrame(() => {
        resetScroll()
        setTimeout(resetScroll, 0)
        setTimeout(resetScroll, 10)
        setTimeout(resetScroll, 50)
        setTimeout(resetScroll, 100)
      })
    }
  }, [location.pathname]) // Reset when route changes
  
  // Fetch dashboard data using the hook (automatically fetches on mount)
  // Now uses 4-phase progressive loading:
  // Phase 1: Instant (~50ms) - error counts, product counts, date range
  // Phase 2: Core (~150ms) - sales totals, account health, finance, PPC summary
  // Phase 3: Charts (~200ms) - datewiseSales, orders, products arrays
  // Phase 4: Top Products (~50ms) - top 4 products by issues
  const {
    data: dashboardInfo,
    loading: dashboardLoading,
    error: dashboardError,
    isPhase1Complete,
    isPhase2Complete,
    isPhase3Complete,
    isPhase4Complete,
    isFullyLoaded
  } = useDashboardData()
  
  // Get reimbursement data from Redux (cached)
  const reimbursementData = useSelector(state => state.reimbursement)
  const reimbursementRawData = reimbursementData?.summary?.rawData
  const reimbursementLoading = reimbursementData?.loading || false
  const reimbursementLastFetched = reimbursementData?.lastFetched
  
  // Calculate last 30 days total (matching ReimbursementDashboard logic)
  const expectedReimbursement = useMemo(() => {
    if (!reimbursementRawData) return 0;
    
    // Helper function to check if date is within last 30 days
    const isWithinLast30Days = (dateValue) => {
      if (!dateValue || dateValue === 'N/A' || dateValue === '') {
        return true; // Include items without dates
      }
      
      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - (30 * 24 * 60 * 60 * 1000));
      
      // Check if it's MM/YYYY format
      const mmYYYYMatch = dateValue.match(/^(\d{1,2})\/(\d{4})$/);
      if (mmYYYYMatch) {
        const month = parseInt(mmYYYYMatch[1], 10);
        const year = parseInt(mmYYYYMatch[2], 10);
        const itemDate = new Date(year, month - 1, 1);
        const lastDayOfMonth = new Date(year, month, 0);
        return lastDayOfMonth >= thirtyDaysAgo && itemDate <= now;
      }
      
      try {
        const itemDate = new Date(dateValue);
        if (isNaN(itemDate.getTime())) return true;
        return itemDate >= thirtyDaysAgo && itemDate <= now;
      } catch {
        return true;
      }
    };
    
    // Shipment: Use all-time total (no filtering)
    const shipmentTotal = reimbursementRawData?.feeProtector?.backendShipmentItems?.totalExpectedAmount || 0;
    
    // Lost, Damaged, Disposed: Filter to last 30 days and calculate totals
    const lostInventoryData = reimbursementRawData?.backendLostInventory?.data || [];
    const filteredLost = lostInventoryData.filter(item => 
      isWithinLast30Days(item.date) && (item.expectedAmount || 0) > 0
    );
    const lostTotal = filteredLost.reduce((sum, item) => sum + (item.expectedAmount || 0), 0);
    
    const damagedInventoryData = reimbursementRawData?.backendDamagedInventory?.data || [];
    const filteredDamaged = damagedInventoryData.filter(item => 
      isWithinLast30Days(item.date) && (item.expectedAmount || 0) > 0
    );
    const damagedTotal = filteredDamaged.reduce((sum, item) => sum + (item.expectedAmount || 0), 0);
    
    const disposedInventoryData = reimbursementRawData?.backendDisposedInventory?.data || [];
    const filteredDisposed = disposedInventoryData.filter(item => 
      isWithinLast30Days(item.date) && (item.expectedAmount || 0) > 0
    );
    const disposedTotal = filteredDisposed.reduce((sum, item) => sum + (item.expectedAmount || 0), 0);
    
    return shipmentTotal + lostTotal + damagedTotal + disposedTotal;
  }, [reimbursementRawData]);

  // Note: dashboardInfo is now obtained from useDashboardData hook above
  
  // Get PPC metrics from PPCMetrics model (NEW - primary source for PPC data)
  const ppcSummaryLatest = useSelector(selectPPCSummary)
  const ppcKPISummary = useSelector(selectPPCKPISummary)
  const ppcDateWiseMetrics = useSelector(selectPPCDateWiseMetrics)
  const ppcMetricsLoading = useSelector(selectLatestPPCMetricsLoading)
  const ppcMetricsLastFetched = useSelector(state => state.ppcMetrics?.latestMetrics?.lastFetched)
  
  // Calculate filtered PPC summary based on date range (same approach as PPCDashboard)
  const isDateRangeSelected = shouldUseCalendarDateRange(
    dashboardInfo?.startDate,
    dashboardInfo?.endDate,
    dashboardInfo?.calendarMode
  );
  
  // Filter dateWiseMetrics and calculate summary for selected date range
  const ppcSummary = useMemo(() => {
    // If no resolved calendar range, use latest summary
    if (!isDateRangeSelected || !ppcDateWiseMetrics || ppcDateWiseMetrics.length === 0) {
      return ppcSummaryLatest;
    }
    
    // Filter dateWiseMetrics to selected date range
    const startDate = parseLocalDate(dashboardInfo.startDate);
    const endDate = parseLocalDate(dashboardInfo.endDate);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
    
    const filteredMetrics = ppcDateWiseMetrics.filter(item => {
      const itemDate = new Date(item.date);
      return itemDate >= startDate && itemDate <= endDate;
    });
    
    if (filteredMetrics.length === 0) {
      return ppcSummaryLatest;
    }
    
    // Calculate summary from filtered data
    const totalSpend = filteredMetrics.reduce((sum, item) => sum + (item.spend || 0), 0);
    const totalSales = filteredMetrics.reduce((sum, item) => sum + (item.sales || 0), 0);
    const totalImpressions = filteredMetrics.reduce((sum, item) => sum + (item.impressions || 0), 0);
    const totalClicks = filteredMetrics.reduce((sum, item) => sum + (item.clicks || 0), 0);
    
    const overallAcos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
    const overallRoas = totalSpend > 0 ? totalSales / totalSpend : 0;
    const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) * 100 : 0;
    const cpc = totalClicks > 0 ? totalSpend / totalClicks : 0;
    
    devLog('=== Dashboard: Calculated filtered PPC Summary ===');
    devLog('Date range:', dashboardInfo.startDate, 'to', dashboardInfo.endDate);
    devLog('Filtered data points:', filteredMetrics.length);
    devLog('Total Spend:', totalSpend);
    devLog('Total Sales:', totalSales);
    devLog('Calculated ACOS:', overallAcos.toFixed(2) + '%');
    
    return {
      totalSpend,
      totalSales,
      totalImpressions,
      totalClicks,
      overallAcos,
      overallRoas,
      ctr,
      cpc
    };
  }, [isDateRangeSelected, ppcDateWiseMetrics, ppcSummaryLatest, dashboardInfo?.startDate, dashboardInfo?.endDate]);
  
  // Fallback to legacy sponsored ads metrics from Redux
  const sponsoredAdsMetrics = useSelector((state) => state.Dashboard.DashBoardInfo?.sponsoredAdsMetrics);
  
  // Money wasted for custom calendar range (fetched from Campaign Audit aggregation API)
  const [customRangeMoneyWasted, setCustomRangeMoneyWasted] = useState(null);
  const [customRangeMoneyWastedLoading, setCustomRangeMoneyWastedLoading] = useState(false);

  useEffect(() => {
    if (!isDateRangeSelected || !dashboardInfo?.startDate || !dashboardInfo?.endDate) {
      setCustomRangeMoneyWasted(null);
      return;
    }

    let cancelled = false;
    setCustomRangeMoneyWastedLoading(true);

    axiosInstance
      .get('/api/pagewise/ppc/wasted-spend', {
        params: {
          page: 1,
          limit: 1,
          startDate: dashboardInfo.startDate,
          endDate: dashboardInfo.endDate,
        },
      })
      .then((res) => {
        if (!cancelled) {
          setCustomRangeMoneyWasted(res.data?.data?.totalWastedSpend ?? 0);
        }
      })
      .catch(() => {
        if (!cancelled) setCustomRangeMoneyWasted(0);
      })
      .finally(() => {
        if (!cancelled) setCustomRangeMoneyWastedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [isDateRangeSelected, dashboardInfo?.startDate, dashboardInfo?.endDate]);

  // Get currency from Redux
  const currency = useSelector(state => state.currency?.currency) || '$';

  // COGS completion (Top Things to Fix "add product costs" row) — reads the same
  // Redux slice TotalSales.jsx already fetches on this page; no new fetch dispatched here.
  const cogsValues = useSelector(state => state.cogs?.cogsValues) || {};
  const cogsLoading = useSelector(state => state.cogs?.loading) || false;
  const productsWithCogsCount = Object.values(cogsValues).filter((v) => Number(v) > 0).length;
  
  // Update selectedPeriod based on Redux state
  useEffect(() => {
    const calendarMode = dashboardInfo?.calendarMode || 'default';
    
    devLog('=== Dashboard: Calendar Mode Update ===');
    devLog('Calendar mode:', calendarMode);
    devLog('Start date:', dashboardInfo?.startDate);
    devLog('End date:', dashboardInfo?.endDate);

    const formatDate = (date) => {
      const dateObj = date instanceof Date ? date : new Date(date);
      return dateObj.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    };

    // Only update selectedPeriod when we have actual dates from the database
    // This prevents showing incorrect calculated dates before Phase 1 data loads
    if (dashboardInfo?.startDate && dashboardInfo?.endDate) {
      // Parse date strings as local dates (YYYY-MM-DD format)
      const parseLocalDate = (dateString) => {
        const [year, month, day] = dateString.split('-').map(Number);
        return new Date(year, month - 1, day);
      };
      
      const startDateObj = parseLocalDate(dashboardInfo.startDate);
      const endDateObj = parseLocalDate(dashboardInfo.endDate);
      
      const period = `${formatDate(startDateObj)} - ${formatDate(endDateObj)}`;
      setSelectedPeriod(period);
      devLog('Dashboard showing date range from database:', period);
    }
    // If no dates from database yet, keep the default "Last 30 Days" label
    // The actual dates will be set once Phase 1 data loads from DataFetchTracking
  }, [dashboardInfo?.calendarMode, dashboardInfo?.startDate, dashboardInfo?.endDate]);
  
  // Fetch reimbursement data from Redux (cached for 5 minutes)
  // Note: Basic reimbursement summary is now included in dashboard summary
  // This fetch is only needed for detailed reimbursement breakdown
  useEffect(() => {
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
    const now = Date.now();
    
    // Only fetch if:
    // 1. Data has never been fetched (lastFetched is null)
    // 2. Cache has expired (more than 5 minutes old)
    const shouldFetch = !reimbursementLastFetched || (now - reimbursementLastFetched) > CACHE_DURATION;
    
    // Defer reimbursement fetch until Phase 1 is complete (don't block initial load)
    if (shouldFetch && !reimbursementLoading && isPhase1Complete) {
      dispatch(fetchReimbursementSummary());
    }
  }, [dispatch, reimbursementLastFetched, reimbursementLoading, isPhase1Complete])

  // Fetch PPC metrics from PPCMetrics model (cached for 5 minutes)
  // Note: Basic PPC summary is now included in dashboard summary
  // This fetch is for detailed PPC metrics if needed
  useEffect(() => {
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
    const now = Date.now();
    
    const shouldFetch = !ppcMetricsLastFetched || (now - ppcMetricsLastFetched) > CACHE_DURATION;
    
    // Defer PPC fetch until Phase 1 is complete (don't block initial load)
    if (shouldFetch && !ppcMetricsLoading && isPhase1Complete) {
      dispatch(fetchLatestPPCMetrics());
      dispatch(fetchPPCKPISummary());
    }
  }, [dispatch, ppcMetricsLastFetched, ppcMetricsLoading, isPhase1Complete])

  // Calculate PPC sales using PPCMetrics model (PRIMARY) or fallback to legacy data
  const calculatePPCSales = () => {
    // Same priority as PPC Dashboard KPIs when not using a custom calendar range
    if (
      !isDateRangeSelected &&
      ppcKPISummary &&
      ((ppcKPISummary.spend ?? 0) > 0 || (ppcKPISummary.sales ?? 0) > 0)
    ) {
      return ppcKPISummary.sales || 0;
    }
    // PRIMARY: Use data from PPCMetrics model (or filtered range summary)
    if (ppcSummary?.totalSales && ppcSummary.totalSales > 0) {
      return ppcSummary.totalSales;
    }
    
    // FALLBACK: Use legacy sponsored ads data
    if (sponsoredAdsMetrics?.totalSalesIn30Days && sponsoredAdsMetrics.totalSalesIn30Days > 0) {
      return sponsoredAdsMetrics.totalSalesIn30Days;
    }
    
    // Return 0 when no real PPC data is available - no assumptions
    return 0;
  };

  // Calculate PPC Spend using PPCMetrics model (PRIMARY) or fallback to legacy data
  const calculatePPCSpend = () => {
    if (
      !isDateRangeSelected &&
      ppcKPISummary &&
      ((ppcKPISummary.spend ?? 0) > 0 || (ppcKPISummary.sales ?? 0) > 0)
    ) {
      return ppcKPISummary.spend || 0;
    }
    // PRIMARY: Use data from PPCMetrics model (or filtered range summary)
    if (ppcSummary?.totalSpend && ppcSummary.totalSpend > 0) {
      return ppcSummary.totalSpend;
    }
    
    // FALLBACK: Use sponsoredAdsMetrics.totalCost from Amazon Ads API (GetPPCProductWise)
    const adsPPCSpend = Number(sponsoredAdsMetrics?.totalCost || 0);
    
    // Last resort: accountFinance.ProductAdsPayment
    const spend = adsPPCSpend > 0 ? adsPPCSpend : Number(dashboardInfo?.accountFinance?.ProductAdsPayment || 0);
    return spend;
  };

  // Calculate real data from backend
  const totalSales = Number(dashboardInfo?.TotalWeeklySale || 0);
  const totalProducts = dashboardInfo?.TotalProduct?.length || 0;
  
  // Store filtered orders array where status is Shipped, Unshipped, or PartiallyShipped
  const totalOrders = dashboardInfo?.GetOrderData?.filter(order => 
    order?.orderStatus === 'Shipped' || 
    order?.orderStatus === 'Unshipped' || 
    order?.orderStatus === 'PartiallyShipped'
  ) || [];
  
  // Get the count of filtered orders
  const totalOrdersCount = totalOrders.length;
  
  // Calculate total issues from ProductChecker data
  const totalIssues = (
    (dashboardInfo?.totalProfitabilityErrors || 0) +
    (dashboardInfo?.totalSponsoredAdsErrors || 0) +
    (dashboardInfo?.totalInventoryErrors || 0) +
    (dashboardInfo?.TotalRankingerrors || 0) +
    (dashboardInfo?.totalErrorInConversion || 0) +
    (dashboardInfo?.totalErrorInAccount || 0)
  );

  // Calculate PPC Sales and Spend for the quickStats
  const ppcSales = calculatePPCSales();
  const ppcSpend = calculatePPCSpend();
  
  // ACoS must match the spend & sales shown above (same rule as PPC / profitability)
  const acos =
    ppcSales > 0 ? ((ppcSpend / ppcSales) * 100).toFixed(2) : '0.00';

  // Format sales value
  const formatCurrencyLocal = (value) => {
    return formatCurrency(value, currency);
  };

  // Full, comma-grouped, non-abbreviated dollar figure (e.g. "$6,841", never "$6.8K") —
  // used everywhere in the redesigned sections (KPI cards, Verdict Banner, Top Things to Fix).
  const formatFullCurrency = (value) => formatCurrencyWithLocale(value, currency, 2);

  // Money Wasted in Ads — from phase 3 (DataFetchTracking window) or custom-range API (Campaign Audit logic)
  const moneyWastedInAds = useMemo(() => {
    if (isDateRangeSelected && customRangeMoneyWasted != null) {
      return customRangeMoneyWasted;
    }
    return dashboardInfo?.moneyWastedInAds ?? dashboardInfo?.ppcSummary?.moneyWastedInAds ?? 0;
  }, [
    isDateRangeSelected,
    customRangeMoneyWasted,
    dashboardInfo?.moneyWastedInAds,
    dashboardInfo?.ppcSummary?.moneyWastedInAds,
  ]);

  const moneyWastedDisplay = customRangeMoneyWastedLoading && isDateRangeSelected
    ? 'Loading...'
    : formatCurrencyWithLocale(moneyWastedInAds, currency);

  const quickStats = [
    { icon: Receipt, label: 'Amazon Owes You', value: reimbursementLoading ? 'Loading...' : formatCurrencyWithLocale(expectedReimbursement, currency), change: 'N/A', trend: 'neutral', color: 'emerald', link: '/seller-central-checker/reimbursement-dashboard' },
    { icon: TrendingDown, label: 'Money Wasted in Ads', value: moneyWastedDisplay, change: 'N/A', trend: 'neutral', color: 'blue', link: '/seller-central-checker/ppc-dashboard' },
    { icon: Gauge, label: 'ACoS %', value: `${acos}%`, change: 'N/A', trend: 'neutral', color: 'purple', link: '/seller-central-checker/ppc-dashboard' },
    { icon: FileWarning, label: 'Total Issues', value: totalIssues.toLocaleString(), change: 'N/A', trend: 'neutral', color: 'orange', link: '/seller-central-checker/issues' }
  ]

  // Export report reuses the exact values already shown in the quick-stat tiles below.
  const prepareDashboardExportData = () => ([
    { Metric: 'Period', Value: selectedPeriod },
    { Metric: 'Total Sales', Value: formatCurrencyLocal(totalSales) },
    ...quickStats.map((stat) => ({ Metric: stat.label, Value: stat.value })),
  ]);

  // --- Real data for the redesigned Verdict Banner + KPI row (§3.1) ---
  // Everything below reuses values already computed above — no new fetches, no invented numbers.

  const healthPercentage = dashboardInfo?.accountHealthPercentage?.Percentage || 0;
  const healthStatusRaw = dashboardInfo?.accountHealthPercentage?.status || 'POOR';
  const healthPillStatus = (healthStatusRaw === 'GOOD' || healthStatusRaw === 'Healthy')
    ? STATUS.GOOD
    : (healthStatusRaw === 'FAIR' || healthStatusRaw === 'At Risk')
      ? STATUS.WATCH
      : STATUS.FIX;

  const acosNum = parseFloat(acos) || 0;
  // Thresholds follow the doc's own wording: "Healthy: under 25%", "Above 30% ... too costly".
  const acosStatus = acosNum <= 25 ? STATUS.GOOD : acosNum <= 30 ? STATUS.WATCH : STATUS.FIX;
  const ACOS_BAR_SCALE = 60; // normalizes ACoS onto the 0-100% benchmark bar width
  const acosBenchmark = {
    healthyText: 'Healthy: under 25%',
    valueText: `You: ${acos}%`,
    rangeStart: 0,
    rangeEnd: (25 / ACOS_BAR_SCALE) * 100,
    markerPosition: (Math.min(acosNum, ACOS_BAR_SCALE) / ACOS_BAR_SCALE) * 100,
  };

  const scrollToTotalSales = () => {
    totalSalesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const formatRelativeTime = (timestamp) => {
    if (!timestamp) return null;
    const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    return `${hours}h ago`;
  };

  // Verdict Banner: which of the two evaluable KPIs (ACoS, Account Health) need attention,
  // and how much is realistically recoverable (money owed + money already being wasted).
  const attentionItems = [];
  if (acosStatus !== STATUS.GOOD) attentionItems.push({ label: 'wasted ad spend', status: acosStatus });
  if (healthPillStatus !== STATUS.GOOD) attentionItems.push({ label: 'account health', status: healthPillStatus });

  const overallVerdictStatus = attentionItems.some((i) => i.status === STATUS.FIX)
    ? STATUS.FIX
    : attentionItems.length > 0
      ? STATUS.WATCH
      : STATUS.GOOD;

  const recoverableAmount = moneyWastedInAds + expectedReimbursement;
  const verdictDataReady = isPhase2Complete && isPhase3Complete && !reimbursementLoading;

  // Top Things to Fix: every row reuses a value already computed above or already
  // shown elsewhere on this page (same category counts ProductChecker.jsx charts).
  // Dollar-backed rows sort first (real impact ordering); count-only rows follow.
  const fixCandidates = [];

  if (moneyWastedInAds > 0) {
    fixCandidates.push({
      key: 'ads-waste',
      status: acosStatus,
      title: 'Wasted ad spend needs a look',
      badge: 'Sponsored Ads',
      why: 'Ad spend that is not converting into sales this period.',
      value: formatFullCurrency(moneyWastedInAds),
      valueLabel: 'wasted this period',
      sortValue: moneyWastedInAds,
      ctaLabel: 'Review waste',
      onCta: () => navigate('/seller-central-checker/ppc-dashboard'),
    });
  }

  if (expectedReimbursement > 0) {
    fixCandidates.push({
      key: 'reimbursement',
      status: STATUS.GOOD,
      title: 'Unclaimed FBA reimbursements',
      badge: 'Reimbursement',
      why: 'Amazon lost, damaged, or over-charged you — you still need to file the claim.',
      value: formatFullCurrency(expectedReimbursement),
      valueLabel: 'recoverable',
      sortValue: expectedReimbursement,
      ctaLabel: 'Review claims',
      onCta: () => navigate('/seller-central-checker/reimbursement-dashboard'),
    });
  }

  if (!cogsLoading && totalProducts > 0 && productsWithCogsCount < totalProducts) {
    fixCandidates.push({
      key: 'cogs-setup',
      status: STATUS.SETUP,
      title: `Add product costs for ${(totalProducts - productsWithCogsCount).toLocaleString()} products`,
      badge: 'Profitability',
      why: 'Without a cost per unit we cannot tell you which products actually lose money.',
      value: 'Unlocks',
      valueLabel: 'true profit',
      sortValue: -1,
      ctaLabel: 'Add costs',
      onCta: () => navigate('/seller-central-checker/profitibility-dashboard'),
    });
  }

  const categoryFixDefs = [
    { key: 'cat-ranking', label: 'Rankings', count: dashboardInfo?.TotalRankingerrors || 0, filter: 'Ranking' },
    { key: 'cat-conversion', label: 'Conversion', count: dashboardInfo?.totalErrorInConversion || 0, filter: 'Conversion' },
    { key: 'cat-inventory', label: 'Inventory', count: dashboardInfo?.totalInventoryErrors || 0, filter: 'Inventory' },
  ];
  categoryFixDefs.forEach((c) => {
    if (c.count > 0) {
      fixCandidates.push({
        key: c.key,
        status: STATUS.WATCH,
        title: `${c.count.toLocaleString()} ${c.label.toLowerCase()} issues need attention`,
        badge: c.label,
        why: 'Open issues in this category across your catalog.',
        value: c.count.toLocaleString(),
        valueLabel: 'issues open',
        sortValue: -1,
        ctaLabel: 'See issues',
        onCta: () => navigate(`/seller-central-checker/issues?tab=category&filter=${c.filter}`),
      });
    }
  });

  const accountIssueCount = dashboardInfo?.totalErrorInAccount || 0;
  if (accountIssueCount > 0) {
    fixCandidates.push({
      key: 'cat-account',
      status: STATUS.FIX,
      title: `${accountIssueCount.toLocaleString()} account & policy issues need attention`,
      badge: 'Account & Policy',
      why: 'These can put your selling privileges at risk if left open.',
      value: accountIssueCount.toLocaleString(),
      valueLabel: 'issues open',
      sortValue: -1,
      ctaLabel: 'See issues',
      onCta: () => navigate('/seller-central-checker/issues?tab=account'),
    });
  }

  const visibleFixes = fixCandidates
    .filter((f) => !dismissedFixKeys.includes(f.key))
    .sort((a, b) => b.sortValue - a.sortValue)
    .slice(0, 5);

  // Gross Profit KPI card extras — same COGS-completion data already used for the
  // "Add product costs" row in Top Things to Fix, matching the mock's Net Profit card
  // (margin %, "Partial — Set up" pill, and the understated-profit footnote).
  const cogsIncomplete = totalProducts > 0 && productsWithCogsCount < totalProducts;
  const grossProfitMarginLabel = grossProfitData.hasFinanceData && grossProfitData.totalSales > 0
    ? `${((grossProfitData.grossProfitRaw / grossProfitData.totalSales) * 100).toFixed(1)}% margin`
    : undefined;
  const grossProfitStatus = !grossProfitData.hasFinanceData
    ? undefined
    : cogsIncomplete
      ? STATUS.WATCH
      : grossProfitData.grossProfitRaw >= 0
        ? STATUS.GOOD
        : STATUS.FIX;
  const grossProfitStatusLabel = cogsIncomplete ? 'Partial — Set up' : undefined;
  const grossProfitFootnote = grossProfitData.hasFinanceData && cogsIncomplete
    ? `Only ${productsWithCogsCount} of ${totalProducts} products have costs added, so this is understated.`
    : undefined;

  // Account health detail (2x2 grid, bottom-left of the money-goes/issue-mix row).
  // The backend only reports Good/Error + a descriptive message for these 4 metrics —
  // no numeric rate exists anywhere in the data layer, so these show real status + real
  // message text rather than a fabricated percentage (unlike the mock's "8.3%" example).
  const accountErrorsDetail = dashboardInfo?.AccountErrors || {};
  const accountHealthDetail = [
    {
      key: 'cr',
      label: 'Cancellation Rate',
      isError: accountErrorsDetail?.CancellationRate?.status === 'Error',
      message: accountErrorsDetail?.CancellationRate?.Message,
    },
    {
      key: 'ncx',
      label: 'NCX',
      tooltip: 'Negative Customer Experience rate — orders that ended in a complaint, return, or bad review.',
      isError: accountErrorsDetail?.NCX?.status === 'Error',
      message: accountErrorsDetail?.NCX?.Message,
    },
    {
      key: 'policy',
      label: 'Policy Violations',
      isError: accountErrorsDetail?.PolicyViolations?.status === 'Error',
      message: accountErrorsDetail?.PolicyViolations?.Message,
    },
    {
      key: 'odr',
      label: 'ODR',
      tooltip: 'Order Defect Rate — orders with a claim, chargeback, or negative feedback.',
      isError: accountErrorsDetail?.orderWithDefectsStatus?.status === 'Error',
      message: accountErrorsDetail?.orderWithDefectsStatus?.Message,
    },
  ];

  return (
    <div
      className='w-full min-h-full bg-[#0B0E14] text-[#F5F7FA] text-sm leading-5'
      style={{ fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" }}
    >
      {/* Date range + refresh live in the global TopNav (beside the marketplace pill) on this route.
          Marketplace switcher and notifications are also already in TopNav — not duplicated here. */}

      {/* Main Content */}
      <div
        ref={contentRef}
        className='px-7 pt-[26px] pb-6 max-w-[1400px] w-full'
      >
          {/* Page title row — exact match to the redesign mock (§3.1) */}
          <div className='flex items-end justify-between gap-6 flex-wrap mb-[22px]'>
            <div>
              <h1 className='m-0 mb-1 text-2xl leading-8 font-semibold tracking-[-0.02em] text-[#F5F7FA]'>Dashboard</h1>
              <p className='m-0 text-sm text-[#A5AEC0]'>Your account health, sales, and top issues — ranked by what needs attention first.</p>
            </div>
            <div className='flex items-center gap-2'>
              <DownloadReport
                buttonText="Export report"
                filename="SellerQI_Dashboard_Summary"
                showIcon={false}
                buttonClass="flex items-center gap-2 px-[14px] py-[9px] border border-[#252C3A] hover:border-[#3B4658] rounded-lg bg-[#151A23] text-[#F5F7FA] text-[13px] font-medium transition-colors"
                prepareDataFunc={prepareDashboardExportData}
              />
              <button
                type="button"
                onClick={() => navigate('/seller-central-checker/qmate')}
                className="px-[14px] py-[9px] rounded-lg bg-[#3B82F6] hover:bg-[#5A97F8] text-[#061021] text-[13px] font-semibold transition-colors"
              >
                Ask QMate
              </button>
            </div>
          </div>

          {/* Verdict Banner — one-sentence takeaway, driven by real ACoS + Account Health status */}
          <div className='mb-[22px]'>
            {verdictDataReady ? (
              <VerdictBanner
                status={overallVerdictStatus}
                actionLabel="See top fixes"
                onAction={() => navigate('/seller-central-checker/issues')}
              >
                Your account is{' '}
                <span style={{ color: getStatusConfig(STATUS.GOOD).color, fontWeight: 600 }}>
                  {healthPercentage}% healthy
                </span>
                {attentionItems.length > 0 ? (
                  <>
                    {' '}— but{' '}
                    <span style={{ color: getStatusConfig(overallVerdictStatus).color, fontWeight: 600 }}>
                      {attentionItems.map((i) => i.label).join(' and ')} need{attentionItems.length === 1 ? 's' : ''} attention
                    </span>
                    {recoverableAmount > 0 && (
                      <>
                        {' '}and about{' '}
                        <span style={{ fontWeight: 600 }}>{formatFullCurrency(recoverableAmount)}</span>
                        {' '}may be recoverable this period.
                      </>
                    )}
                  </>
                ) : (
                  ' — nothing urgent needs attention right now.'
                )}
              </VerdictBanner>
            ) : (
              <div className='h-[92px] rounded-[14px] animate-pulse' style={{ background: COLORS.surface }} />
            )}
          </div>

          {/* KPI row — real data: reimbursements owed, wasted ad spend, net profit, account health */}
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-[22px]'>
            <KPICard
              label="Money Amazon Owes You"
              meaning="Unclaimed FBA reimbursements"
              tooltip="Cases from the last 30 days where Amazon lost, damaged, or over-charged you. You still have to file the claim."
              loading={!isPhase1Complete || reimbursementLoading}
              value={formatFullCurrency(expectedReimbursement)}
              status={expectedReimbursement > 0 ? STATUS.SETUP : undefined}
              statusLabel={expectedReimbursement > 0 ? 'Ready to claim' : undefined}
              noData={expectedReimbursement > 0 ? undefined : {
                message: 'No unclaimed reimbursements found for this period.',
                actionLabel: 'View reimbursements',
                href: '/seller-central-checker/reimbursement-dashboard',
              }}
              footnote={formatRelativeTime(reimbursementLastFetched) ? `Updated ${formatRelativeTime(reimbursementLastFetched)}` : undefined}
              onClick={() => navigate('/seller-central-checker/reimbursement-dashboard')}
            />

            <KPICard
              label="Wasted Ad Spend"
              meaning="ACoS — ad cost as % of ad sales"
              tooltip="ACoS = ad cost as a % of the sales those ads made. Lower is better. Above 30% usually means you're paying more than the margin is worth."
              loading={!isPhase2Complete || ppcMetricsLoading}
              value={`${acos}%`}
              secondaryValue={moneyWastedInAds > 0 ? `${formatFullCurrency(moneyWastedInAds)} wasted` : undefined}
              status={acosStatus}
              benchmark={acosBenchmark}
              onClick={() => navigate('/seller-central-checker/ppc-dashboard')}
            />

            <KPICard
              label="Gross Profit"
              meaning="After all fees, ads and costs"
              tooltip="Sales minus Amazon fees, refunds, overhead, PPC spend, and COGS (when entered) — the same figure shown in Where Your Money Goes below."
              loading={grossProfitData.loading}
              value={grossProfitData.hasFinanceData ? formatFullCurrency(grossProfitData.grossProfitRaw) : undefined}
              secondaryValue={grossProfitMarginLabel}
              status={grossProfitStatus}
              statusLabel={grossProfitStatusLabel}
              footnote={grossProfitFootnote}
              noData={grossProfitData.hasFinanceData ? undefined : {
                message: 'No finance data available for this period yet.',
                actionLabel: 'View breakdown',
                onAction: (e) => { e.preventDefault(); scrollToTotalSales(); },
              }}
              onClick={() => navigate('/seller-central-checker/profitibility-dashboard')}
            />

            <div className='rounded-2xl border flex items-center gap-4 p-5' style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <div className='flex-1 min-w-0 flex flex-col gap-2.5'>
                <div>
                  <div className='text-sm font-semibold uppercase tracking-wide' style={{ color: COLORS.textSecondary }}>Account Health</div>
                  <div className='text-xs mt-0.5' style={{ color: COLORS.textMuted }}>Amazon-facing risk</div>
                </div>
                {isPhase2Complete ? (
                  <>
                    <StatusPill status={healthPillStatus} />
                    <div className='text-sm' style={{ color: COLORS.textSecondary }}>
                      {healthPillStatus === STATUS.GOOD
                        ? 'Healthy — a few things need attention.'
                        : healthPillStatus === STATUS.WATCH
                          ? 'Fair — several things need attention.'
                          : 'At risk — action needed soon.'}
                    </div>
                    <div className='h-px' style={{ background: COLORS.border }} />
                    <div className='text-sm' style={{ color: COLORS.textMuted }}>{totalIssues.toLocaleString()} total issues across your account</div>
                  </>
                ) : (
                  <>
                    <div className='h-5 w-20 rounded animate-pulse' style={{ background: COLORS.border }} />
                    <div className='h-8 w-full rounded animate-pulse' style={{ background: COLORS.border }} />
                  </>
                )}
              </div>
              {isPhase2Complete && (
                <HealthGauge percentage={healthPercentage} status={healthPillStatus} />
              )}
            </div>
          </div>

          {/* Top Things to Fix — every row reuses a value already computed above, or already
              shown elsewhere on this page (ProductChecker.jsx's category counts). */}
          <div className='rounded-2xl border overflow-hidden mb-[22px]' style={{ background: COLORS.surface, borderColor: COLORS.border }}>
            <div className='flex items-center gap-4 px-7 py-5 border-b flex-wrap' style={{ borderColor: COLORS.border }}>
              <div className='flex-1 min-w-[240px]'>
                <h2 className='m-0 text-xl font-semibold' style={{ color: COLORS.textPrimary }}>Top things to fix</h2>
                <p className='m-0 mt-1 text-sm' style={{ color: COLORS.textSecondary }}>Ordered by estimated dollar impact — the top one is worth more than the rest combined.</p>
              </div>
              <div className='text-right'>
                <div className='text-xs font-semibold uppercase tracking-wide' style={{ color: COLORS.textMuted }}>Est. recoverable</div>
                <div className='text-xl font-bold tabular-nums' style={{ color: getStatusConfig(STATUS.GOOD).color }}>{formatFullCurrency(recoverableAmount)}</div>
              </div>
            </div>

            {!verdictDataReady ? (
              <div className='p-7 flex flex-col gap-3'>
                {[0, 1, 2].map((i) => (
                  <div key={i} className='h-16 rounded-lg animate-pulse' style={{ background: COLORS.border }} />
                ))}
              </div>
            ) : visibleFixes.length > 0 ? (
              visibleFixes.map((fix, index) => (
                <ActionCard
                  key={fix.key}
                  rank={index + 1}
                  status={fix.status}
                  title={fix.title}
                  badge={fix.badge}
                  why={fix.why}
                  value={fix.value}
                  valueLabel={fix.valueLabel}
                  ctaLabel={fix.ctaLabel}
                  onCta={fix.onCta}
                  onLater={() => setDismissedFixKeys((prev) => [...prev, fix.key])}
                />
              ))
            ) : (
              <div className='py-11 px-7 text-center'>
                <div className='text-3xl mb-2' style={{ color: getStatusConfig(STATUS.GOOD).color }}>✓</div>
                <div className='text-base font-semibold mb-1' style={{ color: COLORS.textPrimary }}>All clear for now</div>
                <div className='text-sm' style={{ color: COLORS.textSecondary }}>Nothing high-impact is outstanding right now.</div>
                {dismissedFixKeys.length > 0 && (
                  <button
                    type='button'
                    onClick={() => setDismissedFixKeys([])}
                    className='mt-4 px-3.5 py-1.5 rounded-md text-xs font-medium border'
                    style={{ borderColor: COLORS.border, color: COLORS.textSecondary }}
                  >
                    Restore snoozed
                  </button>
                )}
              </div>
            )}

            {verdictDataReady && visibleFixes.length > 0 && (
              <div className='flex items-center justify-between gap-4 flex-wrap px-7 py-4'>
                <button
                  type='button'
                  onClick={() => navigate('/seller-central-checker/issues')}
                  className='text-sm font-medium'
                  style={{ color: COLORS.textSecondary }}
                >
                  See all {totalIssues.toLocaleString()} issues →
                </button>
                <span className='text-xs' style={{ color: COLORS.textMuted }}>Dollar figures are estimates for {selectedPeriod}.</span>
              </div>
            )}
          </div>

          {/* Where your money goes (+ account health detail) | Issue mix + QMate noticed — matches the mock's 2-column layout */}
          <div className='grid grid-cols-1 lg:grid-cols-[1.45fr_1fr] gap-4 mb-[22px] items-start'>
            <div className='flex flex-col gap-4'>
              {/* TotalSales - needs Phase 3 data (datewiseSales array for chart) */}
              <motion.div ref={totalSalesSectionRef} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className='rounded-2xl border overflow-visible' style={{ background: COLORS.surface, borderColor: COLORS.border }}>
                {!isPhase3Complete ? (
                  <div className="p-5"><SkeletonChart height={220} /></div>
                ) : (
                  <ErrorBoundary title="Sales Data Unavailable" message="Unable to load sales data.">
                    <TotalSales onGrossProfitChange={setGrossProfitData} />
                  </ErrorBoundary>
                )}
              </motion.div>

              {/* Account health detail — 2x2 grid, real status + message per metric (see note above) */}
              <div className='grid grid-cols-2 gap-3'>
                {!isPhase2Complete ? (
                  [0, 1, 2, 3].map((i) => (
                    <div key={i} className='rounded-xl border p-3.5 h-[104px] animate-pulse' style={{ background: COLORS.surface, borderColor: COLORS.border }} />
                  ))
                ) : (
                  accountHealthDetail.map((item) => (
                    <div key={item.key} className='rounded-xl border p-3.5 flex flex-col gap-1.5' style={{ background: COLORS.surface, borderColor: COLORS.border }}>
                      <div className='flex items-start gap-1.5'>
                        <div className='text-xs font-semibold uppercase tracking-wide' style={{ color: COLORS.textSecondary }}>{item.label}</div>
                        {item.tooltip && <InfoTooltip text={item.tooltip} position="right" />}
                      </div>
                      <StatusPill status={item.isError ? STATUS.FIX : STATUS.GOOD} compact />
                      <div className='text-xs leading-[18px] line-clamp-3' style={{ color: COLORS.textSecondary }}>
                        {item.message || (item.isError ? 'Needs attention — see Account Issues for details.' : 'No issues detected.')}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className='flex flex-col gap-4'>
              {/* Product Checker ("Issue mix") - skeleton until Phase 4 (top 4 products) data is ready */}
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.03 }} className='rounded-2xl border overflow-hidden' style={{ background: COLORS.surface, borderColor: COLORS.border }}>
                {!isPhase4Complete ? (
                  <div className="p-5"><SkeletonTableBody rows={3} /></div>
                ) : (
                  <ErrorBoundary title="Product Analysis Unavailable" message="Unable to load product analysis data.">
                    <ProductChecker />
                  </ErrorBoundary>
                )}
              </motion.div>

              {/* "QMate noticed" — static placeholder matching the mock exactly; there's no real
                  session/conversion-anomaly detection wired up yet, so this isn't live data.
                  "Ask about this" still really opens QMate. */}
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2, delay: 0.06 }}
                className='rounded-2xl border p-5'
                style={{ background: `linear-gradient(160deg, rgba(59,130,246,.10), transparent 60%), ${COLORS.surface}`, borderColor: COLORS.border }}
              >
                <div className='flex items-center gap-2 mb-2'>
                  <div className='w-[22px] h-[22px] rounded-md flex items-center justify-center text-xs font-bold' style={{ background: COLORS.accent, color: '#061021' }}>Q</div>
                  <div className='text-sm font-semibold' style={{ color: COLORS.textPrimary }}>QMate noticed</div>
                </div>
                <p className='m-0 mb-3 text-sm' style={{ color: COLORS.textSecondary }}>
                  Sessions on <b style={{ color: COLORS.textPrimary }}>B07XYZ</b> are up 22% but conversion fell 14.1% → 8.3%. Bullet 3 was edited Apr 9 and removed your top indexing keywords.
                </p>
                <button
                  type='button'
                  onClick={() => navigate('/seller-central-checker/qmate')}
                  className='w-full py-2.5 rounded-lg text-sm font-semibold border'
                  style={{ background: 'rgba(59,130,246,.12)', borderColor: 'rgba(59,130,246,.4)', color: '#7EA8F8' }}
                >
                  Ask about this →
                </button>
              </motion.div>
            </div>
          </div>

      </div>
    </div>
  )
}

export default Dashboard