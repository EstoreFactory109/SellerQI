import React, { useState, useRef, useEffect } from 'react'
import { Calendar, TrendingUp, AlertTriangle, DollarSign, Package, ShoppingCart, Activity, BarChart3, PieChart, Users, Filter, Download, ChevronDown, FileText, FileSpreadsheet, Zap, Target } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import ExpectedReimbursement from '../Components/Dashboard/SamePageComponents/ExpectedReimbursement.jsx'
import ProductsToReplinish from '../Components/Dashboard/SamePageComponents/ProductsToReplinish.jsx'
import ProductsWithoutBuybox from '../Components/Dashboard/SamePageComponents/ProductsWithoutBuybox.jsx'
import AmazonReadyProducts from '../Components/Dashboard/SamePageComponents/AmazonReadyProducts.jsx'
import ProductChecker from '../Components/Dashboard/SamePageComponents/ProductChecker.jsx'
import TotalSales from '../Components/Dashboard/SamePageComponents/TotalSales.jsx'
import AccountHealth from '../Components/Dashboard/SamePageComponents/AccountHealth.jsx'
import Calender from '../Components/Calender/Calender.jsx'
import ErrorBoundary from '../Components/ErrorBoundary/ErrorBoundary.jsx'
import DataFallback, { PartialDataNotice, useDataAvailability } from '../Components/DataFallback/DataFallback.jsx'
import { useSelector } from 'react-redux'

const Dashboard = () => {
  const [openCalender, setOpenCalender] = useState(false)
  const [openExportDropdown, setOpenExportDropdown] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState('Last 30 Days')
  const CalenderRef = useRef(null)
  const ExportRef = useRef(null)

  // Get dashboard data from Redux
  const dashboardInfo = useSelector(state => state.Dashboard.DashBoardInfo)
  
  // Get sponsored ads metrics from Redux (same as sponsored ads page)
  const sponsoredAdsMetrics = useSelector((state) => state.Dashboard.DashBoardInfo?.sponsoredAdsMetrics);
  
  // Check data availability
  const { hasAnyData, hasAllData, missingItems, availableItems } = useDataAvailability({
    accountHealth: dashboardInfo?.accountHealthPercentage,
    financeData: dashboardInfo?.accountFinance,
    totalSales: dashboardInfo?.TotalWeeklySale,
    products: dashboardInfo?.TotalProduct,
    reimbursement: dashboardInfo?.reimbustment,
    inventoryAnalysis: dashboardInfo?.InventoryAnalysis
  });

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

  // Calculate PPC sales using the exact same logic as sponsored ads page
  const calculatePPCSales = () => {
    // Calculate totals from filtered TotalSales data if available
    const totalSalesData = dashboardInfo?.TotalSales;
    let filteredTotalSales = 0;
    let estimatedPPCSales = 0;
    
    if (totalSalesData && Array.isArray(totalSalesData) && totalSalesData.length > 0) {
      // Calculate totals from filtered date range
      filteredTotalSales = totalSalesData.reduce((sum, item) => sum + (parseFloat(item.TotalAmount) || 0), 0);
      estimatedPPCSales = filteredTotalSales * 0.3; // Assume 30% of sales come from PPC
    }
    
    // Use filtered data if available, otherwise fall back to original metrics
    const ppcSales = estimatedPPCSales > 0 ? estimatedPPCSales : (sponsoredAdsMetrics?.totalSalesIn30Days || 0);
    return ppcSales;
  };

  // Calculate PPC Spend using actual ProductAdsPayment data from finance
  const calculatePPCSpend = () => {
    // Use actual PPC spend from accountFinance ProductAdsPayment (official data)
    const actualPPCSpend = Number(dashboardInfo?.accountFinance?.ProductAdsPayment || 0);
    
    // Fall back to sponsored ads metrics if no finance data available
    const spend = actualPPCSpend > 0 ? actualPPCSpend : (sponsoredAdsMetrics?.totalCost || 0);
    return spend;
  };

  const handleDownloadCSV = () => {
    // Use actual dashboard data for CSV export
    const ppcSales = calculatePPCSales();
    const ppcSpend = calculatePPCSpend();
    const acos = ppcSales > 0 ? ((ppcSpend / ppcSales) * 100).toFixed(2) : '25.00';
    const csvData = [
      ['Metric', 'Value', 'Change'],
      ['Revenue', formatCurrency(totalSales), '+12.5%'],
      ['PPC Sales', `$${ppcSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, '+8.3%'],
      ['ACOS', `${acos}%`, '-2.1%'],
      ['Total Issues', totalIssues.toLocaleString(), '+15.3%'],
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
    const ppcSales = calculatePPCSales();
    const ppcSpend = calculatePPCSpend();
    const acos = ppcSales > 0 ? ((ppcSpend / ppcSales) * 100).toFixed(2) : '25.00';
    const excelData = [
      ['Metric', 'Value', 'Change'],
      ['Revenue', formatCurrency(totalSales), '+12.5%'],
      ['PPC Sales', `$${ppcSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, '+8.3%'],
      ['ACOS', `${acos}%`, '-2.1%'],
      ['Total Issues', totalIssues.toLocaleString(), '+15.3%'],
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
  
  // Calculate ACOS using the exact same logic as sponsored ads page
  const acos = ppcSales > 0 ? ((ppcSpend / ppcSales) * 100).toFixed(2) : '25.00';

  // Format sales value
  const formatCurrency = (value) => {
    if (value >= 1000000) {
      return `$${(value / 1000000).toFixed(1)}M`;
    } else if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}K`;
    } else {
      return `$${value.toFixed(0)}`;
    }
  };

  const quickStats = [
    { icon: BarChart3, label: 'Sales', value: formatCurrency(totalSales), change: '+12.5%', trend: 'up', color: 'emerald' },
    { icon: Zap, label: 'PPC Sales', value: `$${ppcSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, change: '+8.3%', trend: 'up', color: 'blue' },
    { icon: Target, label: 'ACOS', value: `${acos}%`, change: '-2.1%', trend: 'down', color: 'purple' },
    { icon: AlertTriangle, label: 'Total Issues', value: totalIssues.toLocaleString(), change: '+15.3%', trend: 'up', color: 'orange' }
  ]

  return (
    <div className='min-h-screen w-full bg-gray-50/50 lg:mt-0 mt-[12vh]'>
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
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className={`bg-gradient-to-br ${colors.gradient} rounded-xl p-6 border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-xl hover:scale-105 transform shadow-lg`}
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
                className='bg-white rounded-xl border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg overflow-hidden mb-8'
              >
                <ErrorBoundary
                  title="Product Analysis Unavailable"
                  message="Unable to load product analysis data. Showing available information."
                >
                  <ProductChecker />
                </ErrorBoundary>
              </motion.div>

              {/* Third Row - Small Cards */}
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.6, delay: 0.5 }}
                className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'
              >
                {/* Expected Reimbursement - Green Theme */}
                <motion.div 
                  whileHover={{ scale: 1.02, y: -2 }}
                  transition={{ duration: 0.2 }}
                  className='bg-gradient-to-br from-emerald-50 via-emerald-25 to-emerald-100 rounded-xl border border-emerald-200/60 hover:border-emerald-300 transition-all duration-300 hover:shadow-xl overflow-hidden shadow-lg'
                  style={{
                    boxShadow: `
                      0 8px 25px -5px rgba(16, 185, 129, 0.15),
                      0 4px 6px -2px rgba(0, 0, 0, 0.05),
                      inset 0 1px 0 rgba(255, 255, 255, 0.4)
                    `
                  }}
                >
                  <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-emerald-200/30 to-emerald-300/20 rounded-full blur-xl transform translate-x-6 -translate-y-6"></div>
                  <ErrorBoundary
                    title="Reimbursement Data Unavailable"
                    message="Unable to load reimbursement data."
                  >
                    <ExpectedReimbursement />
                  </ErrorBoundary>
                </motion.div>

                {/* Amazon Ready Products - Blue Theme */}
                <motion.div 
                  whileHover={{ scale: 1.02, y: -2 }}
                  transition={{ duration: 0.2 }}
                  className='bg-gradient-to-br from-blue-50 via-blue-25 to-blue-100 rounded-xl border border-blue-200/60 hover:border-blue-300 transition-all duration-300 hover:shadow-xl overflow-hidden shadow-lg'
                  style={{
                    boxShadow: `
                      0 8px 25px -5px rgba(59, 130, 246, 0.15),
                      0 4px 6px -2px rgba(0, 0, 0, 0.05),
                      inset 0 1px 0 rgba(255, 255, 255, 0.4)
                    `
                  }}
                >
                  <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-blue-200/30 to-blue-300/20 rounded-full blur-xl transform translate-x-6 -translate-y-6"></div>
                  <ErrorBoundary
                    title="Product Data Unavailable"
                    message="Unable to load Amazon ready products data."
                  >
                    <AmazonReadyProducts />
                  </ErrorBoundary>
                </motion.div>

                {/* Products to Replenish - Orange Theme */}
                <motion.div 
                  whileHover={{ scale: 1.02, y: -2 }}
                  transition={{ duration: 0.2 }}
                  className='bg-gradient-to-br from-orange-50 via-orange-25 to-orange-100 rounded-xl border border-orange-200/60 hover:border-orange-300 transition-all duration-300 hover:shadow-xl overflow-hidden shadow-lg'
                  style={{
                    boxShadow: `
                      0 8px 25px -5px rgba(251, 146, 60, 0.15),
                      0 4px 6px -2px rgba(0, 0, 0, 0.05),
                      inset 0 1px 0 rgba(255, 255, 255, 0.4)
                    `
                  }}
                >
                  <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-orange-200/30 to-orange-300/20 rounded-full blur-xl transform translate-x-6 -translate-y-6"></div>
                  <ErrorBoundary
                    title="Inventory Data Unavailable"
                    message="Unable to load inventory replenishment data."
                  >
                    <ProductsToReplinish />
                  </ErrorBoundary>
                </motion.div>

                {/* Products Without Buybox - Purple Theme */}
                <motion.div 
                  whileHover={{ scale: 1.02, y: -2 }}
                  transition={{ duration: 0.2 }}
                  className='bg-gradient-to-br from-purple-50 via-purple-25 to-purple-100 rounded-xl border border-purple-200/60 hover:border-purple-300 transition-all duration-300 hover:shadow-xl overflow-hidden shadow-lg'
                  style={{
                    boxShadow: `
                      0 8px 25px -5px rgba(147, 51, 234, 0.15),
                      0 4px 6px -2px rgba(0, 0, 0, 0.05),
                      inset 0 1px 0 rgba(255, 255, 255, 0.4)
                    `
                  }}
                >
                  <div className="absolute top-0 right-0 w-20 h-20 bg-gradient-to-br from-purple-200/30 to-purple-300/20 rounded-full blur-xl transform translate-x-6 -translate-y-6"></div>
                  <ErrorBoundary
                    title="Buy Box Data Unavailable"
                    message="Unable to load buy box data."
                  >
                    <ProductsWithoutBuybox />
                  </ErrorBoundary>
                </motion.div>
              </motion.div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export default Dashboard