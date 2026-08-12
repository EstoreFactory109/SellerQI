import React, { useState, useRef, useEffect, useMemo } from 'react'
import { TrendingUp, AlertTriangle, DollarSign, Box, ShoppingBag, Activity, LineChart, PieChart, Users, Filter, Award, Target, Receipt, TrendingDown, Gauge, FileWarning } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import ProductChecker from '../../Components/Dashboard/SamePageComponents/ProductChecker.jsx'
import TotalSales from '../../Components/Dashboard/SamePageComponents/TotalSales.jsx'
import AccountHealth from '../../Components/Dashboard/SamePageComponents/AccountHealth.jsx'
import ErrorBoundary from '../../Components/ErrorBoundary/ErrorBoundary.jsx'
import { SkeletonCardBody, SkeletonChart, SkeletonTableBody } from '../../Components/Skeleton/PageSkeletons.jsx'
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
import { StatusPill, KPICard, VerdictBanner, HealthGauge, STATUS, COLORS, getStatusConfig } from '../../Components/Shared/index.js'

const Dashboard = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('Last 30 Days')
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
                        <span style={{ fontWeight: 600 }}>{formatCurrencyLocal(recoverableAmount)}</span>
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
              value={formatCurrencyLocal(expectedReimbursement)}
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
              secondaryValue={moneyWastedInAds > 0 ? `${formatCurrencyLocal(moneyWastedInAds)} wasted` : undefined}
              status={acosStatus}
              benchmark={acosBenchmark}
              onClick={() => navigate('/seller-central-checker/ppc-dashboard')}
            />

            <KPICard
              label="Net Profit"
              meaning="After all fees, ads and costs"
              tooltip="What's left after Amazon fees, ad spend, refunds and your product cost (COGS)."
              noData={{
                message: 'See the full profit breakdown in "Where Your Money Goes" below.',
                actionLabel: 'View breakdown',
                onAction: (e) => { e.preventDefault(); scrollToTotalSales(); },
              }}
            />

            <div className='rounded-2xl border flex gap-5 p-6' style={{ background: COLORS.surface, borderColor: COLORS.border }}>
              <div className='flex-1 min-w-0 flex flex-col gap-3.5'>
                <div>
                  <div className='text-sm font-semibold uppercase tracking-wide' style={{ color: COLORS.textSecondary }}>Account Health</div>
                  <div className='text-xs mt-1' style={{ color: COLORS.textMuted }}>Amazon-facing risk</div>
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

          {/* Main grid - each section shows skeleton based on which phase provides its data */}
          <div className='grid grid-cols-1 lg:grid-cols-3 gap-1.5 mb-1'>
            {/* Account Health - needs Phase 2 data (account health percentage) */}
            <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className='bg-[#161b22] rounded border border-[#30363d] overflow-hidden'>
              {!isPhase2Complete ? (
                <SkeletonCardBody rows={3} />
              ) : (
                <ErrorBoundary title="Account Health Unavailable" message="Unable to load account health data.">
                  <AccountHealth />
                </ErrorBoundary>
              )}
            </motion.div>
            {/* TotalSales - needs Phase 3 data (datewiseSales array for chart) */}
            <motion.div ref={totalSalesSectionRef} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.03 }} className='lg:col-span-2 bg-[#161b22] rounded border border-[#30363d] overflow-visible'>
              {!isPhase3Complete ? (
                <div className="p-1"><SkeletonChart height={220} /></div>
              ) : (
                <ErrorBoundary title="Sales Data Unavailable" message="Unable to load sales data.">
                  <TotalSales />
                </ErrorBoundary>
              )}
            </motion.div>
          </div>

          {/* Product Checker - skeleton until Phase 4 (top 4 products) data is ready */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.06 }} className='bg-[#161b22] rounded border border-[#30363d] overflow-hidden mb-0'>
            {!isPhase4Complete ? (
              <div className="p-1"><SkeletonTableBody rows={3} /></div>
            ) : (
              <ErrorBoundary title="Product Analysis Unavailable" message="Unable to load product analysis data.">
                <ProductChecker />
              </ErrorBoundary>
            )}
          </motion.div>
      </div>
    </div>
  )
}

export default Dashboard