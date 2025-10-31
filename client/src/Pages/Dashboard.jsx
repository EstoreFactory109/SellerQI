import React, { useState, useRef, useEffect } from 'react'
import { Calendar, TrendingUp, AlertTriangle, DollarSign, Package, ShoppingCart, Activity, BarChart3, PieChart, Users, Filter, Download, ChevronDown, FileText, FileSpreadsheet, Zap, Target, ArrowUp, ArrowDown } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'

// Simulated components - replace with your actual imports
const ExpectedReimbursement = () => (
  <div className="p-4">
    <div className="flex items-center justify-between mb-1.5">
      <h3 className="text-xs font-medium text-slate-600">Expected Reimbursement</h3>
      <DollarSign className="w-3.5 h-3.5 text-slate-400" />
    </div>
    <p className="text-xl font-semibold text-slate-900">$12,450</p>
    <p className="text-xs text-slate-500 mt-0.5">5 pending claims</p>
  </div>
)

const ProductsToReplinish = () => (
  <div className="p-4">
    <div className="flex items-center justify-between mb-1.5">
      <h3 className="text-xs font-medium text-slate-600">Products to Replenish</h3>
      <Package className="w-3.5 h-3.5 text-slate-400" />
    </div>
    <p className="text-xl font-semibold text-slate-900">24</p>
    <p className="text-xs text-slate-500 mt-0.5">Low stock alert</p>
  </div>
)

const ProductsWithoutBuybox = () => (
  <div className="p-4">
    <div className="flex items-center justify-between mb-1.5">
      <h3 className="text-xs font-medium text-slate-600">Without Buy Box</h3>
      <ShoppingCart className="w-3.5 h-3.5 text-slate-400" />
    </div>
    <p className="text-xl font-semibold text-slate-900">7</p>
    <p className="text-xs text-slate-500 mt-0.5">Needs attention</p>
  </div>
)

const AmazonReadyProducts = () => (
  <div className="p-4">
    <div className="flex items-center justify-between mb-1.5">
      <h3 className="text-xs font-medium text-slate-600">Amazon Ready</h3>
      <Activity className="w-3.5 h-3.5 text-slate-400" />
    </div>
    <p className="text-xl font-semibold text-slate-900">156</p>
    <p className="text-xs text-slate-500 mt-0.5">Ready to ship</p>
  </div>
)

const ProductChecker = () => (
  <div className="p-5">
    <div className="mb-4">
      <h3 className="text-base font-semibold text-slate-900">Product Analysis</h3>
      <p className="text-xs text-slate-500 mt-0.5">Monitor your product performance metrics</p>
    </div>
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-slate-50 rounded-md p-3">
        <p className="text-xs text-slate-600 mb-1">Profitability Issues</p>
        <p className="text-lg font-semibold text-slate-900">12</p>
      </div>
      <div className="bg-slate-50 rounded-md p-3">
        <p className="text-xs text-slate-600 mb-1">Sponsored Ads Errors</p>
        <p className="text-lg font-semibold text-slate-900">5</p>
      </div>
      <div className="bg-slate-50 rounded-md p-3">
        <p className="text-xs text-slate-600 mb-1">Inventory Errors</p>
        <p className="text-lg font-semibold text-slate-900">8</p>
      </div>
    </div>
  </div>
)

const TotalSales = () => (
  <div className="p-5">
    <div className="mb-4">
      <h3 className="text-base font-semibold text-slate-900">Sales Overview</h3>
      <p className="text-xs text-slate-500 mt-0.5">Track your revenue performance</p>
    </div>
    <div className="h-48 bg-slate-50 rounded-lg flex items-center justify-center">
      <p className="text-slate-400 text-sm">Sales Chart Placeholder</p>
    </div>
  </div>
)

const AccountHealth = () => (
  <div className="p-5">
    <div className="mb-4">
      <h3 className="text-base font-semibold text-slate-900">Account Health</h3>
      <p className="text-xs text-slate-500 mt-0.5">Overall account status</p>
    </div>
    <div className="flex items-center justify-center">
      <div className="relative w-28 h-28">
        <svg className="transform -rotate-90 w-28 h-28">
          <circle cx="56" cy="56" r="48" stroke="#e2e8f0" strokeWidth="10" fill="none" />
          <circle cx="56" cy="56" r="48" stroke="#3b82f6" strokeWidth="10" fill="none"
            strokeDasharray={`${2 * Math.PI * 48 * 0.92} ${2 * Math.PI * 48}`}
            strokeLinecap="round" />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          <span className="text-xl font-bold text-slate-900">92%</span>
        </div>
      </div>
    </div>
    <p className="text-center text-xs text-slate-600 mt-3">Excellent</p>
  </div>
)

const Calender = ({ setOpenCalender, setSelectedPeriod }) => (
  <div className="p-3 w-56">
    <div className="space-y-0.5">
      {['Last 7 Days', 'Last 30 Days', 'Last 90 Days', 'Custom Range'].map((period) => (
        <button
          key={period}
          onClick={() => {
            setSelectedPeriod(period)
            setOpenCalender(false)
          }}
          className="w-full text-left px-3 py-2 text-sm text-slate-700 hover:bg-slate-50 rounded-md transition-colors"
        >
          {period}
        </button>
      ))}
    </div>
  </div>
)

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

  const quickStats = [
    { 
      icon: BarChart3, 
      label: 'Total Sales', 
      value: '$48,250', 
      change: '+12.5%', 
      trend: 'up' 
    },
    { 
      icon: Zap, 
      label: 'PPC Sales', 
      value: '$15,320', 
      change: '+8.2%', 
      trend: 'up' 
    },
    { 
      icon: Target, 
      label: 'ACOS', 
      value: '24.5%', 
      change: '-2.1%', 
      trend: 'down' 
    },
    { 
      icon: AlertTriangle, 
      label: 'Total Issues', 
      value: '32', 
      change: '-5', 
      trend: 'down' 
    }
  ]

  return (
    <div className='min-h-screen w-full bg-slate-50'>
      {/* Header Section */}
      <div className='bg-white border-b border-slate-200'>
        <div className='px-6 py-4'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
            <div>
              <h1 className='text-xl font-semibold text-slate-900'>Dashboard</h1>
              <p className='text-xs text-slate-500 mt-0.5'>Monitor your Amazon business performance</p>
            </div>
            
            <div className='flex items-center gap-2'>
              {/* Date Range Selector */}
              <div className='relative' ref={CalenderRef}>
                <button 
                  onClick={() => setOpenCalender(!openCalender)}
                  className='flex items-center gap-2 px-3 py-2 bg-white border border-slate-200 hover:border-slate-300 rounded-lg transition-all duration-200'
                >
                  <Calendar className='w-3.5 h-3.5 text-slate-400' />
                  <span className='text-sm font-medium text-slate-700'>{selectedPeriod}</span>
                  <ChevronDown className='w-3.5 h-3.5 text-slate-400' />
                </button>
                
                <AnimatePresence>
                  {openCalender && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute top-full right-0 mt-2 z-50 bg-white shadow-lg rounded-lg border border-slate-200"
                    >
                      <Calender 
                        setOpenCalender={setOpenCalender} 
                        setSelectedPeriod={setSelectedPeriod}
                      />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Export Button */}
              <div className='relative' ref={ExportRef}>
                <button 
                  onClick={() => setOpenExportDropdown(!openExportDropdown)}
                  className='flex items-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-all duration-200'
                >
                  <Download className='w-3.5 h-3.5' />
                  <span className='text-sm font-medium'>Export</span>
                </button>
                
                <AnimatePresence>
                  {openExportDropdown && (
                    <motion.div
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="absolute top-full right-0 mt-2 z-50 bg-white shadow-lg rounded-lg border border-slate-200 w-44"
                    >
                      <div className="py-1">
                        <button className="w-full flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50 transition-colors">
                          <FileText className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-sm">Download CSV</span>
                        </button>
                        <button className="w-full flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50 transition-colors">
                          <FileSpreadsheet className="w-3.5 h-3.5 text-slate-400" />
                          <span className="text-sm">Download Excel</span>
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
      <div className='px-6 py-5'>
        {/* Quick Stats */}
        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5'>
          {quickStats.map((stat, index) => {
            const Icon = stat.icon
            return (
              <motion.div
                key={stat.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.3, delay: index * 0.05 }}
                className='bg-white rounded-lg p-4 border border-slate-200 hover:shadow-md transition-shadow duration-200'
              >
                <div className='flex items-start justify-between mb-3'>
                  <div className='p-1.5 bg-blue-50 rounded-md'>
                    <Icon className='w-4 h-4 text-blue-600' />
                  </div>
                  <div className={`flex items-center gap-0.5 text-xs font-medium ${
                    stat.trend === 'up' ? 'text-green-600' : 'text-green-600'
                  }`}>
                    {stat.trend === 'up' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />}
                    {stat.change}
                  </div>
                </div>
                <p className='text-xs text-slate-600 mb-0.5'>{stat.label}</p>
                <p className='text-xl font-semibold text-slate-900'>{stat.value}</p>
              </motion.div>
            )
          })}
        </div>

        {/* Main Dashboard Grid */}
        <div className='grid grid-cols-1 lg:grid-cols-3 gap-4 mb-5'>
          {/* Account Health */}
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.3, delay: 0.2 }}
            className='bg-white rounded-lg border border-slate-200 hover:shadow-md transition-shadow duration-200'
          >
            <AccountHealth />
          </motion.div>

          {/* Total Sales */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.25 }}
            className='lg:col-span-2 bg-white rounded-lg border border-slate-200 hover:shadow-md transition-shadow duration-200'
          >
            <TotalSales />
          </motion.div>
        </div>

        {/* Product Checker */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.3 }}
          className='bg-white rounded-lg border border-slate-200 hover:shadow-md transition-shadow duration-200 mb-5'
        >
          <ProductChecker />
        </motion.div>

        {/* Bottom Cards Grid */}
        <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4'>
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.35 }}
            className='bg-white rounded-lg border border-slate-200 hover:shadow-md transition-shadow duration-200'
          >
            <ExpectedReimbursement />
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.4 }}
            className='bg-white rounded-lg border border-slate-200 hover:shadow-md transition-shadow duration-200'
          >
            <AmazonReadyProducts />
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.45 }}
            className='bg-white rounded-lg border border-slate-200 hover:shadow-md transition-shadow duration-200'
          >
            <ProductsToReplinish />
          </motion.div>

          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.5 }}
            className='bg-white rounded-lg border border-slate-200 hover:shadow-md transition-shadow duration-200'
          >
            <ProductsWithoutBuybox />
          </motion.div>
        </div>
      </div>
    </div>
  )
}

export default Dashboard