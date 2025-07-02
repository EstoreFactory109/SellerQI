import React, { useState, useRef, useEffect } from 'react'
import { Calendar, TrendingUp, AlertTriangle, DollarSign, Package, ShoppingCart, Activity, BarChart3, PieChart, Users, Filter, Download, ChevronDown, FileText, FileSpreadsheet } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import ExpectedReimbursement from '../Components/Dashboard/SamePageComponents/ExpectedReimbursement.jsx'
import ProductsToReplinish from '../Components/Dashboard/SamePageComponents/ProductsToReplinish.jsx'
import ProductsWithoutBuybox from '../Components/Dashboard/SamePageComponents/ProductsWithoutBuybox.jsx'
import AmazonReadyProducts from '../Components/Dashboard/SamePageComponents/AmazonReadyProducts.jsx'
import ProductChecker from '../Components/Dashboard/SamePageComponents/ProductChecker.jsx'
import TotalSales from '../Components/Dashboard/SamePageComponents/TotalSales.jsx'
import AccountHealth from '../Components/Dashboard/SamePageComponents/AccountHealth.jsx'
import Calender from '../Components/Calender/Calender.jsx'

const Dashboard = () => {
  const [openCalender, setOpenCalender] = useState(false)
  const [openExportDropdown, setOpenExportDropdown] = useState(false)
  const [selectedPeriod, setSelectedPeriod] = useState('Last 30 Days')
  const CalenderRef = useRef(null)
  const ExportRef = useRef(null)

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

  const handleDownloadCSV = () => {
    // Sample data for CSV export - replace with actual dashboard data
    const csvData = [
      ['Metric', 'Value', 'Change'],
      ['Revenue', '$124,580', '+12.5%'],
      ['Products', '1,247', '+3.2%'],
      ['Orders', '3,421', '+8.7%'],
      ['Customers', '2,156', '+15.3%'],
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
    const excelData = [
      ['Metric', 'Value', 'Change'],
      ['Revenue', '$124,580', '+12.5%'],
      ['Products', '1,247', '+3.2%'],
      ['Orders', '3,421', '+8.7%'],
      ['Customers', '2,156', '+15.3%'],
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

  const quickStats = [
    { icon: DollarSign, label: 'Revenue', value: '$124,580', change: '+12.5%', trend: 'up' },
    { icon: Package, label: 'Products', value: '1,247', change: '+3.2%', trend: 'up' },
    { icon: ShoppingCart, label: 'Orders', value: '3,421', change: '+8.7%', trend: 'up' },
    { icon: Users, label: 'Customers', value: '2,156', change: '+15.3%', trend: 'up' }
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
          {/* Quick Stats */}
          <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8'>
            {quickStats.map((stat, index) => {
              const Icon = stat.icon
              return (
                <motion.div
                  key={stat.label}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className='bg-white rounded-xl p-6 border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg'
                >
                  <div className='flex items-center justify-between mb-4'>
                    <div className='flex items-center gap-3'>
                      <div className='w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center'>
                        <Icon className='w-5 h-5 text-blue-600' />
                      </div>
                      <div>
                        <p className='text-sm font-medium text-gray-600'>{stat.label}</p>
                      </div>
                    </div>
                    <div className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${
                      stat.trend === 'up' 
                        ? 'bg-emerald-50 text-emerald-700' 
                        : 'bg-red-50 text-red-700'
                    }`}>
                      <TrendingUp className={`w-3 h-3 ${stat.trend === 'down' ? 'rotate-180' : ''}`} />
                      {stat.change}
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
              <AccountHealth />
            </motion.div>

            {/* Middle Column - Total Sales */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className='lg:col-span-2 bg-white rounded-xl border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg overflow-hidden'
            >
              <TotalSales />
            </motion.div>
          </div>

          {/* Second Row - Product Checker */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
            className='bg-white rounded-xl border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg overflow-hidden mb-8'
          >
            <ProductChecker />
          </motion.div>

          {/* Third Row - Small Cards */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
            className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'
          >
            <div className='bg-white rounded-xl border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg overflow-hidden'>
              <ExpectedReimbursement />
            </div>
            <div className='bg-white rounded-xl border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg overflow-hidden'>
              <AmazonReadyProducts />
            </div>
            <div className='bg-white rounded-xl border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg overflow-hidden'>
              <ProductsToReplinish />
            </div>
            <div className='bg-white rounded-xl border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg overflow-hidden'>
              <ProductsWithoutBuybox />
            </div>
          </motion.div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard