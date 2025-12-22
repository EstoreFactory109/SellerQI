import React, { useState, useRef, useEffect } from 'react'
import { Calendar, TrendingUp, AlertTriangle, DollarSign, Package, ShoppingCart, Activity, BarChart3, PieChart, Users, Filter, Download, ChevronDown, FileText, FileSpreadsheet, Zap, Target, RefreshCw } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import ProductChecker from '../Components/Dashboard/SamePageComponents/ProductChecker.jsx'
import TotalSales from '../Components/Dashboard/SamePageComponents/TotalSales.jsx'
import AccountHealth from '../Components/Dashboard/SamePageComponents/AccountHealth.jsx'
import Calender from '../Components/Calender/Calender.jsx'
import ErrorBoundary from '../Components/ErrorBoundary/ErrorBoundary.jsx'
import DataFallback, { PartialDataNotice, useDataAvailability } from '../Components/DataFallback/DataFallback.jsx'
import { useSelector, useDispatch } from 'react-redux'
import { useNavigate } from 'react-router-dom'
import { formatCurrency, formatCurrencyWithLocale } from '../utils/currencyUtils.js'
import { fetchReimbursementSummary } from '../redux/slices/ReimbursementSlice.js'

const Dashboard = () => {
  const [openCalender, setOpenCalender] = useState(false)
  const [openExportDropdown, setOpenExportDropdown] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState('Last 30 Days')
  const CalenderRef = useRef(null)
  const ExportRef = useRef(null)
  const navigate = useNavigate()
  const dispatch = useDispatch()
  
  // Get reimbursement data from Redux (cached)
  const reimbursementData = useSelector(state => state.reimbursement)
  const expectedReimbursement = reimbursementData?.summary?.totalReimbursement || 0
  const reimbursementLoading = reimbursementData?.loading || false
  const reimbursementLastFetched = reimbursementData?.lastFetched

  // Get dashboard data from Redux
  const dashboardInfo = useSelector(state => state.Dashboard.DashBoardInfo)
  
  // Get sponsored ads metrics from Redux (same as sponsored ads page)
  const sponsoredAdsMetrics = useSelector((state) => state.Dashboard.DashBoardInfo?.sponsoredAdsMetrics);
  
  // Get search terms from Redux for "Amazon Owes You" calculation
  const searchTerms = useSelector((state) => state.Dashboard.DashBoardInfo?.searchTerms) || [];
  
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

    if (calendarMode === 'custom' && dashboardInfo?.startDate && dashboardInfo?.endDate) {
      // Show custom date range
      const customPeriod = `${formatDate(dashboardInfo.startDate)} - ${formatDate(dashboardInfo.endDate)}`;
      setSelectedPeriod(customPeriod);
      console.log('Dashboard showing custom range:', customPeriod);
    } else if (calendarMode === 'last7') {
      // Show actual date range for Last 7 Days
      const actualEndDate = getActualEndDate();
      const startDate = new Date(actualEndDate);
      startDate.setDate(actualEndDate.getDate() - 6);
      const period = `${formatDate(startDate)} - ${formatDate(actualEndDate)}`;
      setSelectedPeriod(period);
      console.log('Dashboard showing Last 7 Days:', period);
    } else {
      // Show actual date range for Last 30 Days
      const actualEndDate = getActualEndDate();
      const startDate = new Date(actualEndDate);
      startDate.setDate(actualEndDate.getDate() - 29);
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

  useEffect(() => {
    const handleClickOutside = (event) => {
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

  // Calculate PPC sales using only real Amazon Advertising data
  const calculatePPCSales = () => {
    // Only use actual PPC sales from sponsored ads data
    if (sponsoredAdsMetrics?.totalSalesIn30Days && sponsoredAdsMetrics.totalSalesIn30Days > 0) {
      return sponsoredAdsMetrics.totalSalesIn30Days;
    }
    
    // Return 0 when no real PPC data is available - no assumptions
    return 0;
  };

  // Calculate PPC Spend using Amazon Ads API data (PRIMARY source)
  const calculatePPCSpend = () => {
    // PRIMARY: Use sponsoredAdsMetrics.totalCost from Amazon Ads API (GetPPCProductWise)
    // This is the authoritative source for PPC spend
    const adsPPCSpend = Number(sponsoredAdsMetrics?.totalCost || 0);
    
    // Fallback to accountFinance.ProductAdsPayment if Ads API data not available
    // (Note: Backend now also uses Ads API for ProductAdsPayment, so they should match)
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
  
  // Calculate ACOS using only real data - no assumptions
  const acos = ppcSales > 0 ? ((ppcSpend / ppcSales) * 100).toFixed(2) : '0.00';

  // Format sales value
  const formatCurrencyLocal = (value) => {
    return formatCurrency(value, currency);
  };

  // Calculate "Amazon Owes You" - total spend of search terms with zero sales
  // Use the same filter as PPC Dashboard: clicks >= 10 && sales === 0
  const calculateAmazonOwesYou = () => {
    if (!Array.isArray(searchTerms) || searchTerms.length === 0) {
      return 0;
    }
    
    // Filter search terms with zero sales (same logic as PPC Dashboard)
    const zeroSalesSearchTerms = searchTerms.filter(term => {
      if (!term) return false;
      // Match the frontend filter: clicks >= 10 && sales === 0
      const clicks = term.clicks || 0;
      const sales = term.sales || 0;
      return clicks >= 10 && sales === 0;
    });
    
    // Sum the spend for all zero sales search terms
    const totalSpend = zeroSalesSearchTerms.reduce((total, term) => {
      const spend = term.spend || term.cost || 0;
      return total + (typeof spend === 'number' ? spend : parseFloat(spend) || 0);
    }, 0);
    
    return Math.round(totalSpend * 100) / 100; // Round to 2 decimal places
  };

  const amazonOwesYou = calculateAmazonOwesYou();

  const quickStats = [
    { icon: RefreshCw, label: 'Amazon Owes You', value: reimbursementLoading ? 'Loading...' : formatCurrencyWithLocale(expectedReimbursement, currency), change: 'N/A', trend: 'neutral', color: 'emerald', link: '/seller-central-checker/reimbursement-dashboard' },
    { icon: DollarSign, label: 'Money Wasted in Ads', value: formatCurrencyWithLocale(amazonOwesYou, currency), change: 'N/A', trend: 'neutral', color: 'blue', link: '/seller-central-checker/ppc-dashboard' },
    { icon: Target, label: 'ACOS', value: `${acos}%`, change: 'N/A', trend: 'neutral', color: 'purple', link: '/seller-central-checker/ppc-dashboard' },
    { icon: AlertTriangle, label: 'Total Issues', value: totalIssues.toLocaleString(), change: 'N/A', trend: 'neutral', color: 'orange', link: '/seller-central-checker/issues' }
  ]

  return (
    <div className='min-h-screen w-full bg-gray-50/50'>
      {/* Header Section */}
      <div className='bg-white border-b border-gray-200/80 sticky top-0 z-40'>
        <div className='px-4 lg:px-6 py-4'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
            <div className='flex items-center gap-4'>
              <div>
                <h1 className='text-2xl font-bold text-gray-900'>Dashboard</h1>
                <p className='text-sm text-gray-600 mt-1'>Monitor your Amazon business performance</p>
              </div>
              <div className='hidden sm:flex items-center gap-2 px-3 py-1.5 bg-emerald-50 text-emerald-700 rounded-full text-xs font-medium'>
                <div className='w-2 h-2 bg-emerald-500 rounded-full'></div>
                All systems operational
              </div>
            </div>
            
            <div className='flex items-center gap-3'>
              <div className='relative' ref={CalenderRef}>
                <button 
                  onClick={() => setOpenCalender(!openCalender)}
                  className='flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:border-gray-400 rounded-lg transition-all duration-200 shadow-sm hover:shadow'
                >
                  <Calendar className='w-4 h-4 text-gray-500' />
                  <span className='text-sm font-medium text-gray-700'>{selectedPeriod}</span>
                </button>
                
                <AnimatePresence>
                  {openCalender && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className="absolute top-full right-0 mt-2 z-50 bg-white shadow-xl rounded-xl border border-gray-200 overflow-hidden max-h-[80vh] overflow-y-auto"
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
                  className='flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all duration-200 shadow-sm hover:shadow'
                >
                  <Download className='w-4 h-4' />
                  <span className='hidden sm:inline text-sm font-medium'>Export</span>
                  <ChevronDown className='w-4 h-4' />
                </button>
                
                <AnimatePresence>
                  {openExportDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className="absolute top-full right-0 mt-2 z-50 bg-white shadow-xl rounded-xl border border-gray-200 overflow-hidden min-w-[180px]"
                    >
                      <div className="py-1">
                        <button
                          onClick={handleDownloadCSV}
                          className="w-full flex items-center gap-2 px-3 py-2 text-gray-700 hover:bg-gray-50 transition-colors duration-200"
                        >
                          <FileText className="w-4 h-4 text-green-600" />
                          <span className="text-sm font-medium">Download as CSV</span>
                        </button>
                        <button
                          onClick={handleDownloadExcel}
                          className="w-full flex items-center gap-2 px-3 py-2 text-gray-700 hover:bg-gray-50 transition-colors duration-200"
                        >
                          <FileSpreadsheet className="w-4 h-4 text-blue-600" />
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

      {/* Main Content - Scrollable */}
      <div className='overflow-y-auto' style={{ height: 'calc(100vh - 120px)' }}>
        <div className='px-4 lg:px-6 py-6 pb-20'>
          {/* Show partial data notice if some data is missing */}
          {hasAnyData && !hasAllData && (
            <PartialDataNotice 
              missingItems={missingItems} 
              availableItems={availableItems}
              className="mb-6"
            />
          )}

          {/* Show fallback if no data at all */}
          {!hasAnyData ? (
            <DataFallback 
              type="database"
              message="Dashboard data is currently unavailable. Please try refreshing the page or contact support if the issue persists."
              size="large"
            />
          ) : (
            <>
              {/* Quick Stats */}
              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8'>
            {quickStats.map((stat, index) => {
              const Icon = stat.icon
              const colorClasses = {
                emerald: {
                  iconBg: 'bg-gradient-to-br from-emerald-100 via-emerald-50 to-emerald-200',
                  iconColor: 'text-emerald-700',
                  badge: 'bg-gradient-to-br from-emerald-100 via-emerald-50 to-emerald-200 text-emerald-800 border border-emerald-200/80',
                  badgeShadow: 'shadow-emerald-200/60',
                  gradient: 'from-emerald-50 to-emerald-100',
                  shadow: 'shadow-emerald-200/60'
                },
                blue: {
                  iconBg: 'bg-gradient-to-br from-blue-100 via-blue-50 to-blue-200',
                  iconColor: 'text-blue-700',
                  badge: 'bg-gradient-to-br from-blue-100 via-blue-50 to-blue-200 text-blue-800 border border-blue-200/80',
                  badgeShadow: 'shadow-blue-200/60',
                  gradient: 'from-blue-50 to-blue-100',
                  shadow: 'shadow-blue-200/60'
                },
                purple: {
                  iconBg: 'bg-gradient-to-br from-purple-100 via-purple-50 to-purple-200',
                  iconColor: 'text-purple-700',
                  badge: 'bg-gradient-to-br from-purple-100 via-purple-50 to-purple-200 text-purple-800 border border-purple-200/80',
                  badgeShadow: 'shadow-purple-200/60',
                  gradient: 'from-purple-50 to-purple-100',
                  shadow: 'shadow-purple-200/60'
                },
                orange: {
                  iconBg: 'bg-gradient-to-br from-orange-100 via-orange-50 to-orange-200',
                  iconColor: 'text-orange-700',
                  badge: 'bg-gradient-to-br from-orange-100 via-orange-50 to-orange-200 text-orange-800 border border-orange-200/80',
                  badgeShadow: 'shadow-orange-200/60',
                  gradient: 'from-orange-50 to-orange-100',
                  shadow: 'shadow-orange-200/60'
                }
              }
              const colors = colorClasses[stat.color] || colorClasses.blue
              
              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  whileHover={{ scale: 1.05, y: -4 }}
                  whileTap={{ scale: 0.98 }}
                  transition={{ duration: 0.3, ease: "easeOut" }}
                  onClick={() => navigate(stat.link)}
                  className={`bg-gradient-to-br ${colors.gradient} rounded-xl p-6 border border-gray-200/80 hover:border-gray-300 transition-colors duration-300 hover:shadow-xl shadow-lg cursor-pointer`}
                  style={{
                    boxShadow: `
                      0 10px 15px -3px rgba(0, 0, 0, 0.1),
                      0 4px 6px -2px rgba(0, 0, 0, 0.05),
                      inset 0 1px 0 rgba(255, 255, 255, 0.3)
                    `
                  }}
                >
                  <div className='flex items-center gap-3 mb-4'>
                    <div className={`w-12 h-12 ${colors.iconBg} rounded-xl flex items-center justify-center shadow-lg ${colors.shadow} border-2 border-white/90 ring-1 ring-gray-300/30 transform transition-all duration-200 hover:shadow-xl hover:-translate-y-0.5`} 
                         style={{
                           boxShadow: `
                             0 4px 6px -1px rgba(0, 0, 0, 0.1),
                             0 2px 4px -1px rgba(0, 0, 0, 0.06),
                             inset 0 1px 0 rgba(255, 255, 255, 0.6),
                             inset 0 -1px 0 rgba(0, 0, 0, 0.1)
                           `
                         }}>
                      <Icon className={`w-6 h-6 ${colors.iconColor} drop-shadow-sm`} />
                    </div>
                    <div>
                      <p className='text-sm font-medium text-gray-600'>{stat.label}</p>
                    </div>
                  </div>
                  <div className='text-2xl font-bold text-gray-900'>{stat.value}</div>
                </motion.div>
              )
            })}
          </div>

              {/* Main Dashboard Grid */}
              <div className='grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8'>
                {/* Left Column - Account Health */}
                <motion.div
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                  className='bg-white rounded-xl border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg overflow-hidden'
                >
                  <ErrorBoundary
                    title="Account Health Unavailable"
                    message="Unable to load account health data. Showing available information."
                  >
                    <AccountHealth />
                  </ErrorBoundary>
                </motion.div>

                {/* Middle Column - Total Sales */}
                <motion.div
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.3 }}
                  className='lg:col-span-2 bg-white rounded-xl border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg overflow-hidden'
                >
                  <ErrorBoundary
                    title="Sales Data Unavailable"
                    message="Unable to load sales data. Showing available information."
                  >
                    <TotalSales />
                  </ErrorBoundary>
                </motion.div>
              </div>

              {/* Second Row - Product Checker */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.4 }}
                className='bg-white rounded-xl border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg overflow-hidden'
              >
                <ErrorBoundary
                  title="Product Analysis Unavailable"
                  message="Unable to load product analysis data. Showing available information."
                >
                  <ProductChecker />
                </ErrorBoundary>
              </motion.div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default Dashboard