import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Calendar, TrendingUp, AlertTriangle, DollarSign, Box, ShoppingBag, Activity, LineChart, PieChart, Users, Filter, Award, Target, RefreshCw, Receipt, TrendingDown, Gauge, FileWarning } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import ProductChecker from '../../Components/Dashboard/SamePageComponents/ProductChecker.jsx'
import TotalSales from '../../Components/Dashboard/SamePageComponents/TotalSales.jsx'
import AccountHealth from '../../Components/Dashboard/SamePageComponents/AccountHealth.jsx'
import Calender, { isClickInsideGaCalDropdown } from '../../Components/Calender/Calender.jsx'
import ErrorBoundary from '../../Components/ErrorBoundary/ErrorBoundary.jsx'
import { SkeletonStatValue, SkeletonCardBody, SkeletonChart, SkeletonTableBody } from '../../Components/Skeleton/PageSkeletons.jsx'
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

const Dashboard = () => {
  const [openCalender, setOpenCalender] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState('Last 30 Days')
  const CalenderRef = useRef(null)
  const calendarAnchorRef = useRef(null)
  const contentRef = useRef(null)
  const navigate = useNavigate()
  const dispatch = useDispatch()
  const location = useLocation()
  
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
    loadingPhase1,
    loadingPhase2,
    loadingPhase3,
    loadingTop4,
    error: dashboardError, 
    forceRefresh: refreshDashboard,
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

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isClickInsideGaCalDropdown(event.target)) return
      if (CalenderRef.current && !CalenderRef.current.contains(event.target)) {
        setOpenCalender(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

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

  return (
    <div className='w-full bg-[#1a1a1a]'>
      {/* Header Section - compact */}
      <div className='bg-[#161b22] border-b border-[#30363d] sticky top-0 z-40'>
        <div className='px-2 lg:px-3 py-1.5'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1'>
            <div className='flex items-center gap-2'>
              <h1 className='text-lg font-bold text-gray-100'>Dashboard</h1>
              <div className='hidden sm:flex items-center gap-1 px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded text-xs font-medium border border-blue-500/30'>
                <div className='w-1 h-1 bg-blue-500 rounded-full'></div>
                OK
              </div>
            </div>
            
            <div className='flex items-center gap-1.5'>
              <div className='relative' ref={CalenderRef}>
                <button 
                  ref={calendarAnchorRef}
                  onClick={() => setOpenCalender(!openCalender)}
                  className='flex items-center gap-1 px-2 py-1 bg-[#21262d] border border-[#30363d] hover:border-blue-500/50 rounded transition-all duration-200'
                >
                  <Calendar className='w-3 h-3 text-gray-300' />
                  <span className='text-xs font-medium text-gray-200'>{selectedPeriod}</span>
                </button>
                
                {openCalender && (
                  <Calender
                    anchorRef={calendarAnchorRef}
                    setOpenCalender={setOpenCalender}
                    setSelectedPeriod={setSelectedPeriod}
                  />
                )}
              </div>

              <button
                type="button"
                onClick={() => refreshDashboard()}
                disabled={
                  loadingPhase1 || loadingPhase2 || loadingPhase3 || loadingTop4
                }
                title="Reload all dashboard data (sales, health, charts, top products)"
                className="flex items-center gap-1 px-2.5 py-1 bg-[#21262d] border border-[#30363d] hover:border-blue-500/50 rounded text-xs font-medium text-gray-200 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw
                  className={`w-3 h-3 text-gray-300 ${loadingPhase1 || loadingPhase2 || loadingPhase3 || loadingTop4 ? 'animate-spin' : ''}`}
                />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div 
        ref={contentRef}
        className='px-2 lg:px-3 py-1.5 pb-0'
      >
          {/* Quick Stats - each card shows skeleton based on which phase provides its data */}
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1 mb-1'>
            {quickStats.map((stat) => {
              const Icon = stat.icon
              // Determine loading state based on which phase provides the data
              const isStatLoading = stat.label === 'Amazon Owes You'
                ? (!isPhase1Complete || reimbursementLoading)
                : stat.label === 'Money Wasted in Ads'
                  ? !isPhase3Complete  // Money wasted comes from Phase 3 (adsKeywordsData)
                  : stat.label === 'ACoS %'
                    ? (!isPhase2Complete || ppcMetricsLoading)  // ACoS from Phase 2 (PPC summary)
                    : !isPhase1Complete  // Total Issues from Phase 1
              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.01 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => !isStatLoading && navigate(stat.link)}
                  className="rounded p-2 border border-border-dark hover:border-accent/50 transition-colors cursor-pointer"
                >
                  <div className='flex items-center gap-2 mb-1'>
                    <Icon className="w-4 h-4 text-accent" />
                    <p className='text-xs font-medium text-gray-300'>{stat.label}</p>
                  </div>
                  {isStatLoading ? <SkeletonStatValue /> : <div className='text-lg font-bold text-gray-100'>{stat.value}</div>}
                </motion.div>
              )
            })}
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
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.03 }} className='lg:col-span-2 bg-[#161b22] rounded border border-[#30363d] overflow-visible'>
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