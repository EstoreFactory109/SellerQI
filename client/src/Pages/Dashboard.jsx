import React, { useState, useRef, useEffect, useMemo } from 'react'
import { Calendar, TrendingUp, AlertTriangle, DollarSign, Box, ShoppingBag, Activity, LineChart, PieChart, Users, Filter, Download, ChevronDown, FileText, FileSpreadsheet, Award, Target, RefreshCw, Receipt, TrendingDown, Gauge, FileWarning } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import ProductChecker from '../Components/Dashboard/SamePageComponents/ProductChecker.jsx'
import TotalSales from '../Components/Dashboard/SamePageComponents/TotalSales.jsx'
import AccountHealth from '../Components/Dashboard/SamePageComponents/AccountHealth.jsx'
import Calender from '../Components/Calender/Calender.jsx'
import ErrorBoundary from '../Components/ErrorBoundary/ErrorBoundary.jsx'
import { PartialDataNotice, useDataAvailability } from '../Components/DataFallback/DataFallback.jsx'
import { SkeletonStatValue, SkeletonCardBody, SkeletonChart, SkeletonTableBody } from '../Components/Skeleton/PageSkeletons.jsx'
import { SkeletonBar } from '../Components/Skeleton/Skeleton.jsx'
import { useSelector, useDispatch } from 'react-redux'
import { useNavigate, useLocation } from 'react-router-dom'
import { formatCurrency, formatCurrencyWithLocale } from '../utils/currencyUtils.js'
import { fetchReimbursementSummary } from '../redux/slices/ReimbursementSlice.js'
import { fetchLatestPPCMetrics, selectPPCSummary, selectLatestPPCMetricsLoading, selectPPCDateWiseMetrics } from '../redux/slices/PPCMetricsSlice.js'
import { parseLocalDate } from '../utils/dateUtils.js'
import { useDashboardData } from '../hooks/usePageData.js'

const Dashboard = () => {
  const [openCalender, setOpenCalender] = useState(false)
  const [openExportDropdown, setOpenExportDropdown] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState('Last 30 Days')
  const CalenderRef = useRef(null)
  const ExportRef = useRef(null)
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
  const { data: dashboardInfo, loading: dashboardLoading, error: dashboardError, refetch: refetchDashboard } = useDashboardData()
  
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
  const ppcDateWiseMetrics = useSelector(selectPPCDateWiseMetrics)
  const ppcMetricsLoading = useSelector(selectLatestPPCMetricsLoading)
  const ppcMetricsLastFetched = useSelector(state => state.ppcMetrics?.latestMetrics?.lastFetched)
  
  // Calculate filtered PPC summary based on date range (same approach as PPCDashboard)
  const calendarMode = dashboardInfo?.calendarMode || 'default';
  const isDateRangeSelected = (calendarMode === 'custom' || calendarMode === 'last7') && dashboardInfo?.startDate && dashboardInfo?.endDate;
  
  // Filter dateWiseMetrics and calculate summary for selected date range
  const ppcSummary = useMemo(() => {
    // If no custom date range, use latest summary
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
    
    console.log('=== Dashboard: Calculated filtered PPC Summary ===');
    console.log('Date range:', dashboardInfo.startDate, 'to', dashboardInfo.endDate);
    console.log('Filtered data points:', filteredMetrics.length);
    console.log('Total Spend:', totalSpend);
    console.log('Total Sales:', totalSales);
    console.log('Calculated ACOS:', overallAcos.toFixed(2) + '%');
    
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
  
  // Get search terms from Redux for "Amazon Owes You" calculation
  const searchTerms = useSelector((state) => state.Dashboard.DashBoardInfo?.searchTerms) || [];
  
  // Get adsKeywordsPerformanceData from Redux for "Money Wasted in Ads" calculation
  const adsKeywordsPerformanceDataRaw = useSelector((state) => state.Dashboard.DashBoardInfo?.adsKeywordsPerformanceData) || [];
  
  // Filter adsKeywordsPerformanceData based on selected date range (same as PPCDashboard)
  const adsKeywordsPerformanceData = useMemo(() => {
    if (!adsKeywordsPerformanceDataRaw.length) return adsKeywordsPerformanceDataRaw;
    
    // Only filter if custom date range is selected
    if (!isDateRangeSelected) return adsKeywordsPerformanceDataRaw;
    
    const startDate = parseLocalDate(dashboardInfo?.startDate);
    const endDate = parseLocalDate(dashboardInfo?.endDate);
    startDate.setHours(0, 0, 0, 0);
    endDate.setHours(23, 59, 59, 999);
    
    const filtered = adsKeywordsPerformanceDataRaw.filter(item => {
      // If no date field, include the item (backward compatibility)
      if (!item.date) return true;
      
      const itemDate = new Date(item.date);
      return itemDate >= startDate && itemDate <= endDate;
    });
    
    console.log('=== Dashboard: Filtered adsKeywordsPerformanceData ===');
    console.log('Date range:', dashboardInfo?.startDate, 'to', dashboardInfo?.endDate);
    console.log('Original length:', adsKeywordsPerformanceDataRaw.length);
    console.log('Filtered length:', filtered.length);
    
    return filtered;
  }, [adsKeywordsPerformanceDataRaw, isDateRangeSelected, dashboardInfo?.startDate, dashboardInfo?.endDate]);
  
  // Get currency from Redux
  const currency = useSelector(state => state.currency?.currency) || '$';
  
  // Update selectedPeriod based on Redux state
  useEffect(() => {
    const calendarMode = dashboardInfo?.calendarMode || 'default';
    
    console.log('=== Dashboard: Calendar Mode Update ===');
    console.log('Calendar mode:', calendarMode);
    console.log('Start date:', dashboardInfo?.startDate);
    console.log('End date:', dashboardInfo?.endDate);
    
    // Helper function to get actual end date (yesterday due to 24-hour data delay)
    const getActualEndDate = () => {
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      return yesterday;
    };

    const formatDate = (date) => {
      const dateObj = date instanceof Date ? date : new Date(date);
      return dateObj.toLocaleDateString('en-US', { 
        month: 'short', 
        day: 'numeric', 
        year: 'numeric' 
      });
    };

    // Always use the actual dates from the database if available
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
      console.log('Dashboard showing date range from database:', period);
    } else if (calendarMode === 'last7') {
      // Fallback: Show actual date range for Last 7 Days
      const actualEndDate = getActualEndDate();
      const startDate = new Date(actualEndDate);
      startDate.setDate(actualEndDate.getDate() - 6);
      const period = `${formatDate(startDate)} - ${formatDate(actualEndDate)}`;
      setSelectedPeriod(period);
      console.log('Dashboard showing Last 7 Days:', period);
    } else {
      // Fallback: Show actual date range for Last 30 Days
      const actualEndDate = getActualEndDate();
      const startDate = new Date(actualEndDate);
      startDate.setDate(actualEndDate.getDate() - 30);
      const period = `${formatDate(startDate)} - ${formatDate(actualEndDate)}`;
      setSelectedPeriod(period);
      console.log('Dashboard showing Last 30 Days:', period);
    }
  }, [dashboardInfo?.calendarMode, dashboardInfo?.startDate, dashboardInfo?.endDate]);
  
  // Check data availability
  const { hasAnyData, hasAllData, missingItems, availableItems } = useDataAvailability({
    accountHealth: dashboardInfo?.accountHealthPercentage,
    financeData: dashboardInfo?.accountFinance,
    totalSales: dashboardInfo?.TotalWeeklySale,
    products: dashboardInfo?.TotalProduct,
    reimbursement: dashboardInfo?.reimbustment,
    inventoryAnalysis: dashboardInfo?.InventoryAnalysis
  });

  // Fetch reimbursement data from Redux (cached for 5 minutes)
  useEffect(() => {
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
    const now = Date.now();
    
    // Only fetch if:
    // 1. Data has never been fetched (lastFetched is null)
    // 2. Cache has expired (more than 5 minutes old)
    const shouldFetch = !reimbursementLastFetched || (now - reimbursementLastFetched) > CACHE_DURATION;
    
    if (shouldFetch && !reimbursementLoading) {
      dispatch(fetchReimbursementSummary());
    }
  }, [dispatch, reimbursementLastFetched, reimbursementLoading])

  // Fetch PPC metrics from PPCMetrics model (cached for 5 minutes)
  useEffect(() => {
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds
    const now = Date.now();
    
    const shouldFetch = !ppcMetricsLastFetched || (now - ppcMetricsLastFetched) > CACHE_DURATION;
    
    if (shouldFetch && !ppcMetricsLoading) {
      dispatch(fetchLatestPPCMetrics());
    }
  }, [dispatch, ppcMetricsLastFetched, ppcMetricsLoading])

  useEffect(() => {
    const handleClickOutside = (event) => {
      // Don't close calendar if clicking inside the calendar portal
      // The calendar uses createPortal to render to document.body
      const calendarPortal = document.querySelector('.fixed.inset-0.z-\\[9999\\]');
      if (calendarPortal && calendarPortal.contains(event.target)) {
        return; // Click is inside the calendar portal, don't close
      }
      
      if (CalenderRef.current && !CalenderRef.current.contains(event.target)) {
        setOpenCalender(false)
      }
      if (ExportRef.current && !ExportRef.current.contains(event.target)) {
        setOpenExportDropdown(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Calculate PPC sales using PPCMetrics model (PRIMARY) or fallback to legacy data
  const calculatePPCSales = () => {
    // PRIMARY: Use data from PPCMetrics model
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
    // PRIMARY: Use data from PPCMetrics model
    if (ppcSummary?.totalSpend && ppcSummary.totalSpend > 0) {
      return ppcSummary.totalSpend;
    }
    
    // FALLBACK: Use sponsoredAdsMetrics.totalCost from Amazon Ads API (GetPPCProductWise)
    const adsPPCSpend = Number(sponsoredAdsMetrics?.totalCost || 0);
    
    // Last resort: accountFinance.ProductAdsPayment
    const spend = adsPPCSpend > 0 ? adsPPCSpend : Number(dashboardInfo?.accountFinance?.ProductAdsPayment || 0);
    return spend;
  };

  const handleDownloadCSV = () => {
    // Use actual dashboard data for CSV export
    const ppcSpend = calculatePPCSpend();
    const csvData = [
      ['Metric', 'Value', 'Change'],
      ['Revenue', formatCurrency(totalSales), 'N/A'],
      ['Amazon Owes You', formatCurrencyWithLocale(expectedReimbursement, currency), 'N/A'],
      ['Money Wasted in Ads', formatCurrencyWithLocale(amazonOwesYou, currency), 'N/A'],
      ['ACOS', `${acos}%`, 'N/A'],
      ['Total Issues', totalIssues.toLocaleString(), 'N/A'],
      ['Period', selectedPeriod, '']
    ]
    
    const csvContent = csvData.map(row => row.join(',')).join('\n')
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `dashboard-export-${new Date().toISOString().split('T')[0]}.csv`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setOpenExportDropdown(false)
  }

  const handleDownloadExcel = () => {
    // For Excel export, we'll create a simple tab-separated values file
    // In a real implementation, you might want to use a library like xlsx
    const ppcSpend = calculatePPCSpend();
    const excelData = [
      ['Metric', 'Value', 'Change'],
      ['Revenue', formatCurrency(totalSales), 'N/A'],
      ['Amazon Owes You', formatCurrencyWithLocale(expectedReimbursement, currency), 'N/A'],
      ['Money Wasted in Ads', formatCurrencyWithLocale(amazonOwesYou, currency), 'N/A'],
      ['ACOS', `${acos}%`, 'N/A'],
      ['Total Issues', totalIssues.toLocaleString(), 'N/A'],
      ['Period', selectedPeriod, '']
    ]
    
    const excelContent = excelData.map(row => row.join('\t')).join('\n')
    const blob = new Blob([excelContent], { type: 'application/vnd.ms-excel;charset=utf-8;' })
    const link = document.createElement('a')
    const url = URL.createObjectURL(blob)
    link.setAttribute('href', url)
    link.setAttribute('download', `dashboard-export-${new Date().toISOString().split('T')[0]}.xls`)
    link.style.visibility = 'hidden'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setOpenExportDropdown(false)
  }

  // Calculate real data from backend
  const totalSales = Number(dashboardInfo?.TotalWeeklySale || 0);
  const totalProducts = dashboardInfo?.TotalProduct?.length || 0;
  
  // Store filtered orders array where status is Shipped, Unshipped, or PartiallyShipped
  console.log("dashboardInfo?.GetOrderData: ", dashboardInfo?.GetOrderData);
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
  
  // Calculate ACOS - use PPCMetrics model value (PRIMARY) or calculate from spend/sales
  const acos = ppcSummary?.overallAcos 
    ? ppcSummary.overallAcos.toFixed(2) 
    : (ppcSales > 0 ? ((ppcSpend / ppcSales) * 100).toFixed(2) : '0.00');

  // Format sales value
  const formatCurrencyLocal = (value) => {
    return formatCurrency(value, currency);
  };

  // Calculate "Money Wasted in Ads" - total spend of keywords with zero sales
  // Uses adsKeywordsPerformanceData: cost > 0 && attributedSales30d < 0.01
  const calculateAmazonOwesYou = () => {
    if (!Array.isArray(adsKeywordsPerformanceData) || adsKeywordsPerformanceData.length === 0) {
      return 0;
    }
    
    // Filter keywords with zero sales (cost > 0 && attributedSales30d < 0.01)
    const wastedKeywords = adsKeywordsPerformanceData.filter(keyword => {
      if (!keyword) return false;
      const cost = parseFloat(keyword.cost) || 0;
      const attributedSales30d = parseFloat(keyword.attributedSales30d) || 0;
      // Use < 0.01 instead of === 0 to handle floating point precision issues
      return cost > 0 && attributedSales30d < 0.01;
    });
    
    // Sum the spend for all wasted keywords
    const totalWastedSpend = wastedKeywords.reduce((total, keyword) => {
      const cost = parseFloat(keyword.cost) || 0;
      return total + cost;
    }, 0);
    
    return Math.round(totalWastedSpend * 100) / 100; // Round to 2 decimal places
  };

  const amazonOwesYou = calculateAmazonOwesYou();

  const quickStats = [
    { icon: Receipt, label: 'Amazon Owes You', value: reimbursementLoading ? 'Loading...' : formatCurrencyWithLocale(expectedReimbursement, currency), change: 'N/A', trend: 'neutral', color: 'emerald', link: '/seller-central-checker/reimbursement-dashboard' },
    { icon: TrendingDown, label: 'Money Wasted in Ads', value: formatCurrencyWithLocale(amazonOwesYou, currency), change: 'N/A', trend: 'neutral', color: 'blue', link: '/seller-central-checker/ppc-dashboard' },
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
                  onClick={() => setOpenCalender(!openCalender)}
                  className='flex items-center gap-1 px-2 py-1 bg-[#21262d] border border-[#30363d] hover:border-blue-500/50 rounded transition-all duration-200'
                >
                  <Calendar className='w-3 h-3 text-gray-300' />
                  <span className='text-xs font-medium text-gray-200'>{selectedPeriod}</span>
                </button>
                
                <AnimatePresence>
                  {openCalender && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className="absolute top-full right-0 mt-1 z-[9999] bg-[#21262d] rounded border border-[#30363d] overflow-hidden max-h-[80vh] overflow-y-auto"
                      style={{ 
                        maxHeight: 'calc(100vh - 150px)',
                        transform: 'translateY(0)'
                      }}
                    >
                      <Calender 
                        setOpenCalender={setOpenCalender} 
                        setSelectedPeriod={setSelectedPeriod}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              <div className='relative' ref={ExportRef}>
                <button 
                  onClick={() => setOpenExportDropdown(!openExportDropdown)}
                  className='flex items-center gap-1 px-2.5 py-1 bg-blue-500 hover:bg-blue-600 text-white rounded text-xs font-medium transition-colors'
                >
                  <Download className='w-3 h-3' />
                  <span className='hidden sm:inline'>Export</span>
                  <ChevronDown className='w-3 h-3' />
                </button>
                
                <AnimatePresence>
                  {openExportDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className="absolute top-full right-0 mt-1 z-50 bg-[#21262d] rounded border border-[#30363d] overflow-hidden min-w-[160px]"
                    >
                      <div className="py-1">
                        <button
                          onClick={handleDownloadCSV}
                          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-gray-200 hover:bg-[#161b22] transition-colors text-sm"
                        >
                          <FileText className="w-4 h-4 text-blue-400" />
                          <span className="text-sm font-medium">Download as CSV</span>
                        </button>
                        <button
                          onClick={handleDownloadExcel}
                          className="w-full flex items-center gap-1.5 px-2 py-1.5 text-gray-200 hover:bg-[#161b22] transition-colors text-sm"
                        >
                          <FileSpreadsheet className="w-4 h-4 text-blue-400" />
                          <span className="text-sm font-medium">Download as Excel</span>
                        </button>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <div 
        ref={contentRef}
        className='px-2 lg:px-3 py-1.5 pb-0'
      >
            {hasAnyData && !hasAllData && (
            <PartialDataNotice 
              missingItems={missingItems} 
              availableItems={availableItems}
              className="mb-1.5"
            />
          )}

          {/* Quick Stats */}
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-1 mb-1'>
            {quickStats.map((stat) => {
              const Icon = stat.icon
              const isLoading = dashboardLoading || !hasAnyData
              
              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.01 }}
                  transition={{ duration: 0.2 }}
                  onClick={() => !isLoading && navigate(stat.link)}
                  className="rounded p-2 border border-border-dark hover:border-accent/50 transition-colors cursor-pointer"
                >
                  <div className='flex items-center gap-2 mb-1'>
                    <Icon className="w-4 h-4 text-accent" />
                    <p className='text-xs font-medium text-gray-300'>{stat.label}</p>
                  </div>
                  {isLoading ? <SkeletonStatValue /> : <div className='text-lg font-bold text-gray-100'>{stat.value}</div>}
                </motion.div>
              )
            })}
          </div>

          {/* Main grid */}
          <div className='grid grid-cols-1 lg:grid-cols-3 gap-1.5 mb-1'>
            <motion.div initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.2 }} className='bg-[#161b22] rounded border border-[#30363d] overflow-hidden'>
              {(dashboardLoading || !hasAnyData) ? (
                <>
                  <div className="p-1.5 border-b border-[#30363d]">
                    <h3 className="text-xs font-semibold text-gray-100">Account Health</h3>
                  </div>
                  <SkeletonCardBody rows={3} />
                </>
              ) : (
                <ErrorBoundary title="Account Health Unavailable" message="Unable to load account health data.">
                  <AccountHealth />
                </ErrorBoundary>
              )}
            </motion.div>
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.03 }} className='lg:col-span-2 bg-[#161b22] rounded border border-[#30363d] overflow-hidden'>
              {(dashboardLoading || !hasAnyData) ? (
                <>
                  <div className="p-1.5 border-b border-[#30363d]">
                    <h3 className="text-xs font-semibold text-gray-100">Total Sales</h3>
                  </div>
                  <div className="p-1"><SkeletonChart height={220} /></div>
                </>
              ) : (
                <ErrorBoundary title="Sales Data Unavailable" message="Unable to load sales data.">
                  <TotalSales />
                </ErrorBoundary>
              )}
            </motion.div>
          </div>

          {/* Product Checker */}
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, delay: 0.06 }} className='bg-[#161b22] rounded border border-[#30363d] overflow-hidden mb-0'>
            {(dashboardLoading || !hasAnyData) ? (
              <>
                <div className="p-1.5 border-b border-[#30363d]">
                  <h3 className="text-xs font-semibold text-gray-100">Product Checker</h3>
                </div>
                <div className="p-1"><SkeletonTableBody rows={3} /></div>
              </>
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