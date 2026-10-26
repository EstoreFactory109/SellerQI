import React, { useState, useRef, useEffect, useMemo } from 'react'
import { TrendingUp, AlertTriangle, DollarSign, Box, ShoppingBag, Activity, LineChart, PieChart, Users, Filter, Award, Target, Receipt, TrendingDown, Gauge, FileWarning } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import CampaignAuditKpis, { useCampaignAuditKpis, MiniBar } from '../../Components/Dashboard/SamePageComponents/CampaignAuditKpis.jsx'
import TotalSales from '../../Components/Dashboard/SamePageComponents/TotalSales.jsx'
import ErrorBoundary from '../../Components/ErrorBoundary/ErrorBoundary.jsx'
import { SkeletonChart } from '../../Components/Skeleton/PageSkeletons.jsx'
import { SkeletonBar } from '../../Components/Skeleton/Skeleton.jsx'
import { useSelector, useDispatch } from 'react-redux'
import { useNavigate, useLocation, useSearchParams } from 'react-router-dom'
import useMarketplace, { ALL_MARKETPLACES } from '../../hooks/useMarketplace.js'
import MarketplaceSections, { comparisonExportRows } from '../../Components/Dashboard/MarketplaceSections.jsx'
import { ALL_MARKETPLACES_DASHBOARD } from '../../utils/featureFlags.js'
import MarketplaceSwitcher from '../../Components/Marketplace/MarketplaceSwitcher.jsx'
import { formatCurrencyWithLocale } from '../../utils/currencyUtils.js'
import { fetchReimbursementSummary } from '../../redux/slices/ReimbursementSlice.js'
import { fetchLatestPPCMetrics, selectPPCSummary, selectLatestPPCMetricsLoading, selectPPCDateWiseMetrics } from '../../redux/slices/PPCMetricsSlice.js'
import { fetchPPCKPISummary, selectPPCKPISummary, selectPPCKPISummaryLoading } from '../../redux/slices/PPCCampaignAnalysisSlice.js'
import { parseLocalDate } from '../../utils/dateUtils.js'
import { shouldUseCalendarDateRange } from '../../utils/totalSalesFilterUrl.js'
import { useQMate } from '../../contexts/QMateContext.js'
import { useDashboardData } from '../../hooks/usePageData.js'
import { devLog } from '../../utils/devLogger.js'
import axiosInstance from '../../config/axios.config.js'
import DownloadReport from '../../Components/DownloadReport/DownloadReport.jsx'
import { StatusPill, KPICard, VerdictBanner, HealthGauge, ActionCard, InfoTooltip, STATUS, COLORS, getStatusConfig } from '../../Components/Shared/index.js'

/**
 * The Dashboard page. With VITE_ALL_MARKETPLACES_DASHBOARD on (the default) and 2+ marketplaces it opens on
 * "All marketplaces": every marketplace side by side, each in its own currency. Its switcher (or
 * a column header) opens one marketplace's full Dashboard.
 */
const Dashboard = () => {
  const { isAll, select, marketplaces } = useMarketplace({ allowAll: ALL_MARKETPLACES_DASHBOARD })
  const [searchParams] = useSearchParams()
  const hasMarketplaceParam = searchParams.has('marketplace')
  const canShowAll = ALL_MARKETPLACES_DASHBOARD && marketplaces.length > 1

  // "All marketplaces" is the default: arriving with no ?marketplace= opens it.
  useEffect(() => {
    if (canShowAll && !hasMarketplaceParam) select(ALL_MARKETPLACES)
  }, [canShowAll, hasMarketplaceParam, select])

  if (canShowAll && (isAll || !hasMarketplaceParam)) {
    return <AllMarketplacesDashboard onOpenMarketplace={select} />
  }
  return <DashboardContent />
}

const AllMarketplacesDashboard = ({ onOpenMarketplace }) => {
  const [data, setData] = useState(null)

  return (
    <div
      className='w-full min-h-full bg-[#0B0E14] text-[#F5F7FA] text-sm leading-5'
      style={{ fontFamily: "Geist, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif" }}
    >
      <div className='px-7 pt-[26px] pb-6 max-w-[1400px] w-full'>
        <div className='flex items-end justify-between gap-6 flex-wrap mb-[22px]'>
          <div>
            <h1 className='m-0 mb-1 text-2xl leading-8 font-semibold tracking-[-0.02em] text-[#F5F7FA]'>Dashboard</h1>
            <p className='m-0 text-sm text-[#A5AEC0]'>One section per marketplace, each in its own currency. Open one for its full Dashboard.</p>
          </div>
          <div className='flex items-center gap-2 flex-wrap'>
            <MarketplaceSwitcher allowAll />
            <DownloadReport
              buttonText="Export report"
              filename="SellerQI_All_Marketplaces"
              showIcon={false}
              buttonClass="flex items-center gap-2 px-[14px] py-[9px] border border-[#252C3A] hover:border-[#3B4658] rounded-lg bg-[#151A23] text-[#F5F7FA] text-[13px] font-medium transition-colors"
              prepareDataFunc={() => {
                // DownloadReport treats null as "the page already explained", so say why here.
                if (!data) {
                  alert('Your marketplaces are still loading. Please export again once the figures are shown.')
                  return null
                }
                return comparisonExportRows(data)
              }}
            />
          </div>
        </div>
        <MarketplaceSections
          onData={setData}
          onOpenMarketplace={(m) => onOpenMarketplace({ country: m.country, region: m.region })}
        />
      </div>
    </div>
  )
}

const DashboardContent = () => {
  const [selectedPeriod, setSelectedPeriod] = useState('Last 30 Days')
  const [dismissedFixKeys, setDismissedFixKeys] = useState([])
  // Reported up by TotalSales.jsx (below) — the real Gross Profit figure it already
  // computes, so this page doesn't duplicate that fee/COGS calculation independently.
  const [grossProfitData, setGrossProfitData] = useState({ grossProfitRaw: null, totalSales: null, hasFinanceData: false, loading: true })
  const contentRef = useRef(null)
  const totalSalesSectionRef = useRef(null)
  const topFixesSectionRef = useRef(null)
  const navigate = useNavigate()
  const { askQMate } = useQMate()
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
    data: singleDashboardInfo,
    loading: dashboardLoading,
    error: dashboardError,
    isPhase1Complete: singlePhase1Complete,
    isPhase2Complete: singlePhase2Complete,
    isPhase3Complete: singlePhase3Complete,
    isFullyLoaded
  } = useDashboardData()

  const dashboardInfo = singleDashboardInfo
  const isPhase1Complete = singlePhase1Complete
  const isPhase2Complete = singlePhase2Complete
  const isPhase3Complete = singlePhase3Complete
  const runSingleFetches = singlePhase1Complete
  
  // Get reimbursement data from Redux (cached)
  const reimbursementData = useSelector(state => state.reimbursement)
  const reimbursementRawData = reimbursementData?.summary?.rawData
  const reimbursementLoading = reimbursementData?.loading || false
  const reimbursementLastFetched = reimbursementData?.lastFetched
  
  // Calculate last 30 days total (matching ReimbursementDashboard logic)
  const reimbursementBreakdown = useMemo(() => {
    if (!reimbursementRawData) return { total: 0, parts: [] };
    
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
    
    return {
      total: shipmentTotal + lostTotal + damagedTotal + disposedTotal,
      parts: [
        { label: 'shipment discrepancies', amount: shipmentTotal },
        { label: 'lost inventory', amount: lostTotal },
        { label: 'damaged inventory', amount: damagedTotal },
        { label: 'disposed inventory', amount: disposedTotal },
      ],
    };
  }, [reimbursementRawData]);
  const expectedReimbursement = reimbursementBreakdown.total;

  // Note: dashboardInfo is now obtained from useDashboardData hook above
  
  // Get PPC metrics from PPCMetrics model (NEW - primary source for PPC data)
  const ppcSummaryLatest = useSelector(selectPPCSummary)
  const ppcKPISummary = useSelector(selectPPCKPISummary)
  const ppcKPISummaryLoading = useSelector(selectPPCKPISummaryLoading)
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

  // AI-ranked "Top things to fix" — the top 5-6 money-recovery actions chosen by
  // OpenAI from a pre-ranked shortlist of grouped issues (see
  // server/Services/AI/TopOpportunitiesService.js). Pre-computed weekly and
  // cached server-side, so this is a single cheap GET, no LLM call on page load.
  const [topOpportunities, setTopOpportunities] = useState(null);
  const [topOpportunitiesLoading, setTopOpportunitiesLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    axiosInstance
      .get('/api/pagewise/top-opportunities')
      .then((res) => {
        if (!cancelled) setTopOpportunities(res.data?.data ?? null);
      })
      .catch(() => {
        // Fails open — visibleFixes below falls back to the heuristic list.
        if (!cancelled) setTopOpportunities(null);
      })
      .finally(() => {
        if (!cancelled) setTopOpportunitiesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // Fees at Risk (tasks-logics.xlsx tile), partly: aged inventory surcharge and the
  // low-inventory-level fee, from the newest planning report. Storage utilization and
  // returns processing fees have no data source and are named as not included.
  const [feesAtRisk, setFeesAtRisk] = useState(null);
  const [feesAtRiskLoading, setFeesAtRiskLoading] = useState(true);
  useEffect(() => {
    if (!runSingleFetches) return undefined;
    let cancelled = false;
    setFeesAtRiskLoading(true);
    axiosInstance
      .get('/api/pagewise/dashboard/fees-at-risk')
      .then((res) => { if (!cancelled) setFeesAtRisk(res.data?.data ?? null); })
      .catch(() => { if (!cancelled) setFeesAtRisk(null); })
      .finally(() => { if (!cancelled) setFeesAtRiskLoading(false); });
    return () => { cancelled = true; };
  }, [runSingleFetches]);

  // Wasted ad spend: always ask the same endpoint the Campaign Audit page uses (with the
  // calendar range when one is selected), so the Dashboard and Campaign Audit agree. The
  // server's one-time dashboard summary value is only the fallback while this loads/fails.
  useEffect(() => {
    if (!runSingleFetches) return;

    let cancelled = false;
    setCustomRangeMoneyWastedLoading(true);

    const params = { page: 1, limit: 1 };
    if (isDateRangeSelected && dashboardInfo?.startDate && dashboardInfo?.endDate) {
      params.startDate = dashboardInfo.startDate;
      params.endDate = dashboardInfo.endDate;
    }

    axiosInstance
      .get('/api/pagewise/ppc/wasted-spend', { params })
      .then((res) => {
        if (!cancelled) {
          setCustomRangeMoneyWasted(res.data?.data?.totalWastedSpend ?? null);
        }
      })
      .catch(() => {
        if (!cancelled) setCustomRangeMoneyWasted(null);
      })
      .finally(() => {
        if (!cancelled) setCustomRangeMoneyWastedLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [runSingleFetches, isDateRangeSelected, dashboardInfo?.startDate, dashboardInfo?.endDate]);

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
    if (shouldFetch && !reimbursementLoading && runSingleFetches) {
      dispatch(fetchReimbursementSummary());
    }
  }, [dispatch, reimbursementLastFetched, reimbursementLoading, runSingleFetches])

  // Fetch PPC metrics from PPCMetrics model (cached for 5 minutes)
  // Note: Basic PPC summary is now included in dashboard summary
  // This fetch is for detailed PPC metrics if needed
  useEffect(() => {
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
    const now = Date.now();
    
    const shouldFetch = !ppcMetricsLastFetched || (now - ppcMetricsLastFetched) > CACHE_DURATION;
    
    // Defer PPC fetch until Phase 1 is complete (don't block initial load)
    if (shouldFetch && !ppcMetricsLoading && runSingleFetches) {
      dispatch(fetchLatestPPCMetrics());
    }
  }, [dispatch, ppcMetricsLastFetched, ppcMetricsLoading, runSingleFetches])

  // Campaign Audit boxes: fetch the KPI summary for the selected calendar window (same
  // call the Campaign Audit page makes). The thunk caches per date range.
  useEffect(() => {
    if (!runSingleFetches) return;
    if (isDateRangeSelected) {
      dispatch(fetchPPCKPISummary({ startDate: dashboardInfo.startDate, endDate: dashboardInfo.endDate }));
    } else {
      dispatch(fetchPPCKPISummary());
    }
  }, [dispatch, runSingleFetches, isDateRangeSelected, dashboardInfo?.startDate, dashboardInfo?.endDate])

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

  // Calculate PPC Sales and Spend for the ACoS KPI
  const ppcSales = calculatePPCSales();
  const ppcSpend = calculatePPCSpend();
  
  // ACoS must match the spend & sales shown above (same rule as PPC / profitability)
  const acos =
    ppcSales > 0 ? ((ppcSpend / ppcSales) * 100).toFixed(2) : '0.00';

  // Full, comma-grouped, non-abbreviated dollar figure (e.g. "$6,841", never "$6.8K") —
  // used everywhere in the redesigned sections (KPI cards, Verdict Banner, Top Things to Fix).
  const formatFullCurrency = (value) => formatCurrencyWithLocale(value, currency, 2);

  // Money Wasted in Ads — Campaign Audit's wasted-spend total (fetched above); phase-3 summary value is the fallback
  const moneyWastedInAds = useMemo(() => {
    if (customRangeMoneyWasted != null) {
      return customRangeMoneyWasted;
    }
    return dashboardInfo?.moneyWastedInAds ?? dashboardInfo?.ppcSummary?.moneyWastedInAds ?? 0;
  }, [
    customRangeMoneyWasted,
    dashboardInfo?.moneyWastedInAds,
    dashboardInfo?.ppcSummary?.moneyWastedInAds,
  ]);

  const campaignAuditKpis = useCampaignAuditKpis({
    ppcKPISummary,
    ppcSummary,
    sponsoredAdsMetrics,
    info: dashboardInfo,
    currency,
    totalWastedSpend: moneyWastedInAds,
  })

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

  const scrollToTopFixes = () => {
    topFixesSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const formatRelativeTime = (timestamp) => {
    if (!timestamp) return null;
    const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60000));
    if (minutes < 1) return 'just now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    return `${hours}h ago`;
  };

  // Verdict Banner: which of the two evaluable KPIs (ACoS, Account Health) need attention.
  // (Superseded below by the AI-ranked opportunity count/status when that data is available.)
  const attentionItems = [];
  if (acosStatus !== STATUS.GOOD) attentionItems.push({ label: 'wasted ad spend', status: acosStatus });
  if (healthPillStatus !== STATUS.GOOD) attentionItems.push({ label: 'account health', status: healthPillStatus });

  // AI-ranked opportunities drive this figure when available. Falls back to the old
  // heuristic (ads waste + reimbursements) for accounts not synced since it shipped.
  const hasAiOpportunities = Array.isArray(topOpportunities?.opportunities) && topOpportunities.opportunities.length > 0;
  // The ACCOUNT-wide, de-duplicated profit figure — not the sum of the 5-6 shown
  // (a subset), and not a sum of issue groups (which double-counts, because a
  // product's loss already contains its wasted ad spend). Older stored records lack
  // the field, so fall back to what they do have.
  const recoverableAmount = hasAiOpportunities
    ? (topOpportunities.potentialProfitImpact
        || topOpportunities.accountRecoverableAmount
        || topOpportunities.totalEstimatedRecovery)
    : moneyWastedInAds + expectedReimbursement;
  // Capital locked in unsellable stock — a different quantity, shown separately so
  // it can never inflate a profit figure.
  const capitalTiedUp = hasAiOpportunities ? (topOpportunities.capitalTiedUp || 0) : 0;
  const verdictDataReady = isPhase2Complete && isPhase3Complete && !reimbursementLoading && !topOpportunitiesLoading;

  // Badge/route/"start with" phrase per opportunity category — same destinations the
  // old category rows below already used, so "See issues" behaves identically either way.
  // Opportunities are groups of TASKS (see TaskOpportunityGroupsService), so every
  // category the Tasks page can carry needs an entry here — including ranking and
  // account health, which this card was previously blind to.
  const OPPORTUNITY_CATEGORY_META = {
    profitability: { badge: 'Profitability', startWithPhrase: 'your money-losing products' },
    sponsoredAds: { badge: 'Sponsored Ads', startWithPhrase: 'your ad waste' },
    inventory: { badge: 'Inventory', startWithPhrase: 'your inventory issues' },
    conversion: { badge: 'Conversion', startWithPhrase: 'your Buy Box losses' },
    ranking: { badge: 'Ranking', startWithPhrase: 'your listing quality issues' },
    account: { badge: 'Account Health', startWithPhrase: 'your account health' },
  };

  // The AI already ranked opportunities by priority — its #1 pick drives "Start with...".
  const topOpportunity = hasAiOpportunities ? topOpportunities.opportunities[0] : null;
  const topOpportunityPhrase = topOpportunity
    ? (OPPORTUNITY_CATEGORY_META[topOpportunity.category]?.startWithPhrase || 'your top issue')
    : null;

  // Overall banner status/color: a real AI-found opportunity means there's something
  // to act on even if ACoS/Account Health both look fine on their own — but "healthy
  // overall" framing (WATCH, not FIX) unless one of those two core KPIs is truly bad.
  const overallVerdictStatus = attentionItems.some((i) => i.status === STATUS.FIX)
    ? STATUS.FIX
    : (attentionItems.length > 0 || hasAiOpportunities)
      ? STATUS.WATCH
      : STATUS.GOOD;

  const healthDescriptor = healthPillStatus === STATUS.GOOD
    ? 'healthy overall'
    : healthPillStatus === STATUS.WATCH
      ? 'at risk'
      : 'struggling';

  // Top Things to Fix — AI-ranked opportunities when available (already ordered by
  // the AI, considering overlaps/priority, not just raw dollars — so this list is
  // NOT re-sorted, unlike the heuristic fallback below).
  const aiFixCandidates = hasAiOpportunities
    ? topOpportunities.opportunities.map((o) => {
        const meta = OPPORTUNITY_CATEGORY_META[o.category] || { badge: o.category };
        const hasAmount = (o.amount || 0) > 0;
        return {
          key: o.candidateId,
          status: o.isGrowthOpportunity ? STATUS.SETUP : (o.confidence === 'estimated' ? STATUS.WATCH : STATUS.FIX),
          title: o.title,
          badge: meta.badge,
          why: o.why || o.action,
          value: hasAmount ? formatFullCurrency(o.amount) : (o.count || 0).toLocaleString(),
          valueLabel: hasAmount ? (o.confidence === 'estimated' ? 'est. recoverable' : 'recoverable') : (o.isGrowthOpportunity ? 'growth opportunity' : 'issues open'),
          // Land on the exact task rows that make up this figure, so the seller sees
          // the same problem broken down rather than a differently-scoped page.
          ctaLabel: 'See these tasks',
          onCta: () => navigate(
            `/seller-central-checker/tasks?category=${encodeURIComponent(o.category)}&type=${encodeURIComponent(o.issueType)}`
          ),
        };
      })
    : [];

  // Top Things to Fix (heuristic fallback): every row reuses a value already computed
  // above or already shown elsewhere on this page (same category counts ProductChecker.jsx
  // charts). Dollar-backed rows sort first (real impact ordering); count-only rows follow.
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

  // AI-ranked candidates keep the AI's own order (it already weighed overlaps and
  // priority) — only the heuristic fallback gets re-sorted by raw dollar value.
  const visibleFixes = hasAiOpportunities
    ? aiFixCandidates.filter((f) => !dismissedFixKeys.includes(f.key))
    : fixCandidates
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
  const costCoveragePct = totalProducts > 0 ? Math.round((productsWithCogsCount / totalProducts) * 100) : 0;
  const grossProfitStatusLabel = cogsIncomplete
    ? (productsWithCogsCount === 0 ? 'Costs not set up' : `${costCoveragePct}% costed`)
    : undefined;
  // One short line (kept compact so this card doesn't make the whole row taller).
  const grossProfitFootnote = grossProfitData.hasFinanceData && cogsIncomplete
    ? `Costs missing for ${(totalProducts - productsWithCogsCount).toLocaleString()} of ${totalProducts.toLocaleString()} products`
    : undefined;
  const marginPct = grossProfitData.hasFinanceData && grossProfitData.totalSales > 0
    ? (grossProfitData.grossProfitRaw / grossProfitData.totalSales) * 100
    : null;
  const marginBar = marginPct != null ? (
    <MiniBar
      pct={Math.max(0, marginPct)}
      color={marginPct >= 15 ? COLORS.good : marginPct >= 0 ? COLORS.watch : '#F87171'}
      leftLabel={marginPct >= 0 ? `${marginPct.toFixed(1)}% of sales kept` : `${Math.abs(marginPct).toFixed(1)}% loss on sales`}
      rightLabel={marginPct >= 0 ? `${(100 - marginPct).toFixed(1)}% went to costs` : undefined}
    />
  ) : null;

  // Data-driven footnotes for the Performance cards (computed from the same figures shown above).
  const reimbursementTopPart = [...reimbursementBreakdown.parts].sort((a, b) => b.amount - a.amount)[0];
  const reimbursementNote = expectedReimbursement > 0 && reimbursementTopPart?.amount > 0
    ? `Biggest share: ${reimbursementTopPart.label} (${formatFullCurrency(reimbursementTopPart.amount)})`
    : undefined;

  const adsShare = campaignAuditKpis.adsSharePct != null ? Math.min(100, campaignAuditKpis.adsSharePct) : null;
  const totalSalesNote = adsShare != null ? (
    <div className='flex flex-col gap-2'>
      <MiniBar
        pct={adsShare}
        color={COLORS.accent}
        leftLabel={`${adsShare.toFixed(0)}% from ads`}
        rightLabel={`${(100 - adsShare).toFixed(0)}% other sales`}
      />
      <span>Ad-driven vs. other sales this period</span>
    </div>
  ) : `Sales for ${grossProfitData.periodLabel || selectedPeriod}`;

  const biggestCostSlice = (grossProfitData.visibleSlices || [])
    .filter((slice) => slice.id !== 'grossProfit' && slice.value > 0)
    .sort((a, b) => b.value - a.value)[0];
  const biggestCostNote = biggestCostSlice && grossProfitData.totalSales > 0
    ? `Biggest cost: ${biggestCostSlice.label} (${Math.round((biggestCostSlice.value / grossProfitData.totalSales) * 100)}% of sales)`
    : undefined;

  // Export report — every value and sentence below is the one rendered on this
  // page (verdict banner, KPI cards, Top things to fix, Where your money goes,
  // account health, issue mix, QMate noticed), so the file matches the screen.
  const prepareDashboardExportData = () => {
    const stillLoading = !isPhase1Complete || !isPhase2Complete || !isPhase3Complete ||
      !verdictDataReady || grossProfitData.loading || ppcMetricsLoading ||
      customRangeMoneyWastedLoading;
    if (stillLoading) {
      alert('The dashboard is still loading. Please export again once all figures are shown.');
      return null;
    }

    const pillLabel = (status, label) => label || getStatusConfig(status).label;
    const rows = [
      ['SellerQI Dashboard Report'],
      ['Period', selectedPeriod],
      ['Generated on', new Date().toLocaleDateString()],
      [],
    ];

    // Verdict banner — same sentence as the page
    let verdict = `Your account is ${healthDescriptor} (${healthPercentage}%)`;
    if (hasAiOpportunities) {
      const n = topOpportunities.opportunities.length;
      verdict += ` — but ${n} thing${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention`;
      if (recoverableAmount > 0) verdict += ` and about ${formatFullCurrency(recoverableAmount)}/mo of profit is in play`;
      verdict += '. ';
      if (topOpportunityPhrase) verdict += `Start with ${topOpportunityPhrase}.`;
    } else if (attentionItems.length > 0) {
      verdict += ` — but ${attentionItems.map((i) => i.label).join(' and ')} need${attentionItems.length === 1 ? 's' : ''} attention`;
      if (recoverableAmount > 0) verdict += ` and about ${formatFullCurrency(recoverableAmount)} of profit may be in play this period.`;
    } else {
      verdict += ' — nothing urgent needs attention right now.';
    }
    rows.push(['Summary', verdict.trim()]);
    rows.push([]);

    // KPI row
    rows.push(['Key Metrics']);
    rows.push(['Card', 'Item', 'Value']);
    if (expectedReimbursement > 0) {
      rows.push(['Money Amazon Owes You', 'Unclaimed FBA reimbursements', formatFullCurrency(expectedReimbursement)]);
      rows.push(['Money Amazon Owes You', 'Status', 'Ready to claim']);
    } else {
      rows.push(['Money Amazon Owes You', 'Unclaimed FBA reimbursements', 'No unclaimed reimbursements found for this period.']);
    }

    rows.push(['Wasted Ad Spend', 'ACoS', `${acos}%`]);
    if (moneyWastedInAds > 0) rows.push(['Wasted Ad Spend', 'Wasted', `${formatFullCurrency(moneyWastedInAds)} wasted`]);
    rows.push(['Wasted Ad Spend', 'Status', pillLabel(acosStatus)]);
    rows.push(['Wasted Ad Spend', 'Benchmark', `${acosBenchmark.healthyText} · ${acosBenchmark.valueText}`]);

    if (grossProfitData.hasFinanceData) {
      rows.push(['Sales & Profit', 'Total Sales', formatFullCurrency(grossProfitData.totalSales)]);
      rows.push(['Sales & Profit', 'Gross Profit', formatFullCurrency(grossProfitData.grossProfitRaw)]);
      if (grossProfitMarginLabel) rows.push(['Sales & Profit', 'Margin', grossProfitMarginLabel]);
      if (grossProfitStatus) rows.push(['Sales & Profit', 'Status', pillLabel(grossProfitStatus, grossProfitStatusLabel)]);
      if (cogsIncomplete) rows.push(['Sales & Profit', 'Note', `Only ${productsWithCogsCount} of ${totalProducts} products have costs added, so this is understated.`]);
    } else {
      rows.push(['Sales & Profit', 'Status', 'No finance data available for this period yet.']);
    }

    rows.push(['Account Health', 'Status', pillLabel(healthPillStatus)]);
    rows.push(['Account Health', 'Score', `${healthPercentage}%`]);
    rows.push(['Account Health', 'Summary', healthPillStatus === STATUS.GOOD
      ? 'Healthy — a few things need attention.'
      : healthPillStatus === STATUS.WATCH
        ? 'Fair — several things need attention.'
        : 'At risk — action needed soon.']);
    rows.push(['Account Health', 'Total issues', `${totalIssues.toLocaleString()} total issues across your account`]);
    rows.push([]);

    // Top things to fix — the same cards in the same order (snoozed ones excluded, as on screen)
    rows.push(['Top Things to Fix']);
    rows.push(['Potential profit impact', formatFullCurrency(recoverableAmount)]);
    if (capitalTiedUp > 0) rows.push(['Capital tied up', `+ ${formatFullCurrency(capitalTiedUp)} capital tied up`]);
    if (visibleFixes.length > 0) {
      rows.push(['Rank', 'Issue', 'Category', 'Value', 'Value Type', 'Why']);
      visibleFixes.forEach((fix, index) => {
        rows.push([String(index + 1).padStart(2, '0'), fix.title, fix.badge, fix.value, fix.valueLabel || '', fix.why || '']);
      });
      rows.push([`Amounts in ${currency} are estimates for ${selectedPeriod}.`]);
    } else {
      rows.push(['All clear for now — Nothing high-impact is outstanding right now.']);
    }
    rows.push([]);

    // Where your money goes — legend rows (amount + % of sales) and the hover breakdowns
    rows.push(['Where Your Money Goes']);
    if (grossProfitData.hasFinanceData) {
      const moneySlices = grossProfitData.visibleSlices || [];
      const salesForPct = grossProfitData.totalSales;
      const breakdownAmount = (amount) => `${amount < 0 ? '-' : ''}${currency}${Math.abs(amount).toFixed(2)}`;
      rows.push([`Where the ${formatFullCurrency(salesForPct)} you sold ${grossProfitData.periodLabel || 'this period'} went.`]);
      rows.push(['You keep', formatFullCurrency(grossProfitData.grossProfitRaw)]);
      rows.push(['Category', 'Item', 'Amount', '% of Sales']);
      moneySlices.forEach((slice) => {
        const pct = salesForPct > 0 ? Math.round((slice.value / salesForPct) * 100) : 0;
        rows.push([slice.label, 'Total', formatFullCurrency(slice.displayAmount), `${pct}%`]);
        (slice.breakdown || []).forEach((item) => {
          rows.push([slice.label, item.label, breakdownAmount(item.amount), '']);
        });
      });
      if (grossProfitData.cogsNote) rows.push([grossProfitData.cogsNote]);
    } else {
      rows.push(['No finance data available for this period. Run integration to sync finance data.']);
    }
    rows.push([]);

    return rows;
  };

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
            <div className='flex items-center gap-2 flex-wrap'>
              <MarketplaceSwitcher allowAll={ALL_MARKETPLACES_DASHBOARD} />
              <DownloadReport
                buttonText="Export report"
                filename="SellerQI_Dashboard_Summary"
                showIcon={false}
                buttonClass="flex items-center gap-2 px-[14px] py-[9px] border border-[#252C3A] hover:border-[#3B4658] rounded-lg bg-[#151A23] text-[#F5F7FA] text-[13px] font-medium transition-colors"
                prepareDataFunc={prepareDashboardExportData}
              />
            </div>
          </div>

          {/* Verdict Banner — one-sentence takeaway, driven by real ACoS + Account Health status */}
          <div className='mb-[22px]'>
            {verdictDataReady ? (
              <VerdictBanner
                status={overallVerdictStatus}
                actionLabel="See top fixes"
                onAction={scrollToTopFixes}
              >
                Your account is{' '}
                <span style={{ color: getStatusConfig(healthPillStatus).color, fontWeight: 600 }}>
                  {healthDescriptor} ({healthPercentage}%)
                </span>
                {hasAiOpportunities ? (
                  <>
                    {' '}— but{' '}
                    <span style={{ color: getStatusConfig(overallVerdictStatus).color, fontWeight: 600 }}>
                      {topOpportunities.opportunities.length} thing{topOpportunities.opportunities.length === 1 ? '' : 's'} need{topOpportunities.opportunities.length === 1 ? 's' : ''} attention
                    </span>
                    {recoverableAmount > 0 && (
                      <>
                        {' '}and about{' '}
                        <span style={{ fontWeight: 600 }}>{formatFullCurrency(recoverableAmount)}/mo</span>
                        {' '}of profit is in play
                      </>
                    )}
                    {'. '}
                    {topOpportunityPhrase && <>Start with {topOpportunityPhrase}.</>}
                  </>
                ) : attentionItems.length > 0 ? (
                  <>
                    {' '}— but{' '}
                    <span style={{ color: getStatusConfig(overallVerdictStatus).color, fontWeight: 600 }}>
                      {attentionItems.map((i) => i.label).join(' and ')} need{attentionItems.length === 1 ? 's' : ''} attention
                    </span>
                    {recoverableAmount > 0 && (
                      <>
                        {' '}and about{' '}
                        <span style={{ fontWeight: 600 }}>{formatFullCurrency(recoverableAmount)}</span>
                        {' '}of profit may be in play this period.
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

          <div className='mb-3 mt-2'>
            <h2 className='m-0 text-lg font-semibold tracking-[-0.01em]' style={{ color: COLORS.textPrimary }}>Performance</h2>
            <p className='m-0 mt-0.5 text-sm' style={{ color: COLORS.textMuted }}>Your profit, account health and money owed at a glance.</p>
          </div>
          {/* KPI row — real data: reimbursements owed, wasted ad spend, net profit, account health */}
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-[22px]'>
            <KPICard
              label="Money Amazon Owes You"
              meaning="Unclaimed FBA reimbursements"
              tooltip="Estimated amount Amazon may owe you for lost, damaged or over-charged items. Most claims must be filed within 60 days, and you still have to file each one."
              loading={!isPhase1Complete || reimbursementLoading}
              value={formatFullCurrency(expectedReimbursement)}
              status={expectedReimbursement > 0 ? STATUS.SETUP : undefined}
              statusLabel={expectedReimbursement > 0 ? 'Ready to claim' : undefined}
              noData={expectedReimbursement > 0 ? undefined : {
                message: 'No unclaimed reimbursements found for this period.',
                actionLabel: 'View reimbursements',
                href: '/seller-central-checker/reimbursement-dashboard',
              }}
              footnote={[reimbursementNote, formatRelativeTime(reimbursementLastFetched) ? `Updated ${formatRelativeTime(reimbursementLastFetched)}` : null].filter(Boolean).join(' · ') || undefined}
              onClick={() => navigate('/seller-central-checker/reimbursement-dashboard')}
            />

            <KPICard
              label="Total Sales"
              meaning="Everything you sold this period"
              tooltip="Total revenue in the selected date range, before Amazon fees, refunds, ad spend and product costs."
              loading={grossProfitData.loading}
              value={formatFullCurrency(grossProfitData.totalSales)}
              footnote={totalSalesNote}
              noData={grossProfitData.hasFinanceData ? undefined : {
                message: 'No finance data available for this period yet.',
                actionLabel: 'View breakdown',
                onAction: (e) => { e.preventDefault(); e.stopPropagation(); scrollToTotalSales(); },
              }}
              onClick={() => navigate('/seller-central-checker/profitibility-dashboard')}
            />

            <KPICard
              label="Gross Profit"
              meaning={grossProfitMarginLabel || 'What you kept after costs'}
              tooltip="Sales minus Amazon fees (referral, fulfilment, storage, aged inventory and low-inventory fees), ad spend, refunds, overhead and product cost where provided. The same figure shown in Where Your Money Goes below."
              loading={grossProfitData.loading}
              value={formatFullCurrency(grossProfitData.grossProfitRaw)}
              status={grossProfitStatus}
              statusLabel={grossProfitStatusLabel}
              footnote={(marginBar || biggestCostNote || grossProfitFootnote) ? (
                <div className='flex flex-col gap-2'>
                  {marginBar}
                  {biggestCostNote && <span>{biggestCostNote}</span>}
                  {grossProfitFootnote && <span>{grossProfitFootnote}</span>}
                </div>
              ) : undefined}
              noData={grossProfitData.hasFinanceData ? undefined : {
                message: 'No finance data available for this period yet.',
                actionLabel: 'View breakdown',
                onAction: (e) => { e.preventDefault(); e.stopPropagation(); scrollToTotalSales(); },
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

          {runSingleFetches && (
            <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-[22px]'>
              <KPICard
                label="Fees at Risk"
                meaning="Fees you can still avoid this month"
                tooltip="Estimated fees you can still avoid this month: aged inventory surcharge, low-inventory fee and storage utilization surcharge. Returns processing fees are not included yet."
                loading={feesAtRiskLoading}
                value={(feesAtRisk?.agedSurcharge || feesAtRisk?.storageUtilization)
                  ? formatFullCurrency((feesAtRisk?.agedSurcharge?.amount || 0) + (feesAtRisk?.storageUtilization?.amount || 0))
                  : undefined}
                secondaryValue={[
                  feesAtRisk?.lowInventoryFee ? `${feesAtRisk.lowInventoryFee.products} product${feesAtRisk.lowInventoryFee.products === 1 ? '' : 's'} paying the low-inventory fee` : null,
                  feesAtRisk?.storageUtilization ? `Storage: ${feesAtRisk.storageUtilization.ratio} weeks of stock (surcharge over 22)` : null
                ].filter(Boolean).join(' · ') || undefined}
                status={(feesAtRisk?.agedSurcharge?.amount > 0 || feesAtRisk?.lowInventoryFee?.products > 0 || feesAtRisk?.storageUtilization?.amount > 0) ? STATUS.WATCH : undefined}
                statusLabel={(feesAtRisk?.agedSurcharge?.amount > 0 || feesAtRisk?.lowInventoryFee?.products > 0 || feesAtRisk?.storageUtilization?.amount > 0) ? 'Avoidable' : undefined}
                noData={(feesAtRisk?.available || feesAtRisk?.storageUtilization) ? undefined : {
                  message: 'Fees at risk appear once Amazon\'s inventory planning report has been read for this marketplace.',
                }}
                footnote={(feesAtRisk?.available || feesAtRisk?.storageUtilization)
                  ? `Aged inventory surcharge and storage utilization surcharge (Amazon's estimates${feesAtRisk?.storageUtilization?.month ? `, storage for ${feesAtRisk.storageUtilization.month}` : ''}) and low-inventory fee; returns processing fees not included.`
                  : undefined}
                onClick={() => navigate('/seller-central-checker/tasks?category=inventory')}
              />
            </div>
          )}

          <div className='mb-3 mt-2'>
            <h2 className='m-0 text-lg font-semibold tracking-[-0.01em]' style={{ color: COLORS.textPrimary }}>Ads</h2>
            <p className='m-0 mt-0.5 text-sm' style={{ color: COLORS.textMuted }}>How your ad campaigns are performing for this period.</p>
          </div>
          {/* Advertising — the same 10 PPC boxes as the Campaign Audit page */}
          <div className='mb-[22px]'>
            <CampaignAuditKpis kpiData={campaignAuditKpis} loading={ppcKPISummaryLoading} groupLabels variant='dashboard' />
          </div>

          <div className='mb-3 mt-2'>
            <h2 className='m-0 text-lg font-semibold tracking-[-0.01em]' style={{ color: COLORS.textPrimary }}>What to fix first</h2>
            <p className='m-0 mt-0.5 text-sm' style={{ color: COLORS.textMuted }}>The actions worth the most to your profit, in order.</p>
          </div>
          {/* Top Things to Fix — every row reuses a value already computed above, or already
              shown elsewhere on this page (ProductChecker.jsx's category counts). */}
          <div ref={topFixesSectionRef} className='rounded-2xl border overflow-hidden mb-[22px]' style={{ background: COLORS.surface, borderColor: COLORS.border }}>
            <div className='flex items-center gap-4 px-7 py-5 border-b flex-wrap' style={{ borderColor: COLORS.border }}>
              <div className='flex-1 min-w-[240px]'>
                <div className='flex items-center gap-2'>
                  <h2 className='m-0 text-xl font-semibold' style={{ color: COLORS.textPrimary }}>Top things to fix</h2>
                  <button
                    type='button'
                    onClick={() => askQMate?.()}
                    className='flex items-center gap-1 pl-1 pr-2 py-0.5 rounded-full text-xs font-semibold border transition-colors'
                    style={{ background: 'rgba(59,130,246,.12)', borderColor: 'rgba(59,130,246,.35)', color: '#7EA8F8' }}
                    title='Ask QMate about these fixes'
                  >
                    <span className='w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-bold' style={{ background: COLORS.accent, color: '#061021' }}>Q</span>
                    QMate
                  </button>
                </div>
                <p className='m-0 mt-1 text-sm' style={{ color: COLORS.textSecondary }}>Ordered by estimated profit impact — the top one is worth more than the rest combined.</p>
              </div>
              <div className='text-right'>
                <div className='text-xs font-semibold uppercase tracking-wide' style={{ color: COLORS.textMuted }}>Potential profit impact</div>
                <div className='text-xl font-bold tabular-nums' style={{ color: getStatusConfig(STATUS.GOOD).color }}>{formatFullCurrency(recoverableAmount)}</div>
                {capitalTiedUp > 0 && (
                  <div className='text-[11px] mt-0.5' style={{ color: COLORS.textMuted }}>
                    + {formatFullCurrency(capitalTiedUp)} capital tied up
                  </div>
                )}
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
                <span className='text-xs' style={{ color: COLORS.textMuted }}>Amounts in {currency} are estimates for {selectedPeriod}.</span>
              </div>
            )}
          </div>

          <div className='mb-3 mt-2'>
            <h2 className='m-0 text-lg font-semibold tracking-[-0.01em]' style={{ color: COLORS.textPrimary }}>Sales & profit</h2>
            <p className='m-0 mt-0.5 text-sm' style={{ color: COLORS.textMuted }}>What you sold and where the money goes.</p>
          </div>
          {/* Where your money goes */}
          <motion.div ref={totalSalesSectionRef} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }} className='rounded-2xl border overflow-visible mb-[22px]' style={{ background: COLORS.surface, borderColor: COLORS.border }}>
            {!isPhase3Complete ? (
              <div className="p-5"><SkeletonChart height={220} /></div>
            ) : (
              <ErrorBoundary title="Sales Data Unavailable" message="Unable to load sales data.">
                <TotalSales onGrossProfitChange={setGrossProfitData} />
              </ErrorBoundary>
            )}
          </motion.div>

      </div>
    </div>
  )
}

export default Dashboard