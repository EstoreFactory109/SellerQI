import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, TrendingUp, Package, DollarSign, BarChart3, Search, ArrowRight, Eye, Filter, ChevronDown, Activity, Clock, Star, HelpCircle } from 'lucide-react';
import Chart from 'react-apexcharts';

const OverView = () => {
  const navigate = useNavigate();
  const info = useSelector(state => state.Dashboard.DashBoardInfo);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPriority, setSelectedPriority] = useState('All');
  const [showDetails, setShowDetails] = useState(false);
  
  // New state variables for dropdowns
  const [sortBy, setSortBy] = useState('issues');
  const [filterBy, setFilterBy] = useState('all');
  const [showSortDropdown, setShowSortDropdown] = useState(false);
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);

  // Tooltip states
  const [hoveredTooltip, setHoveredTooltip] = useState(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  // Dropdown options
  const sortOptions = [
    { value: 'issues', label: 'Issues by Product' },
    { value: 'revenue', label: 'Products by Revenue' },
    { value: 'units', label: 'Products by Unit Sold' }
  ];

  const filterOptions = [
    { value: 'all', label: 'All Products' },
    { value: 'high', label: 'High Priority Only' },
    { value: 'medium', label: 'Medium Priority Only' },
    { value: 'low', label: 'Low Priority Only' }
  ];

  // Get error data with fallbacks and improved validation
  const profitabilityErrors = Number(info?.totalProfitabilityErrors) || 0;
  const sponsoredAdsErrors = Number(info?.totalSponsoredAdsErrors) || 0;
  const inventoryErrors = Number(info?.totalInventoryErrors) || 0;
  const rankingErrors = Number(info?.TotalRankingerrors) || 0;
  const conversionErrors = Number(info?.totalErrorInConversion) || 0;
  const accountErrors = Number(info?.totalErrorInAccount) || 0;

  // Additional validation for data structure
  console.log('Overview Debug Data:', {
    info: !!info,
    profitabilityErrors,
    sponsoredAdsErrors,
    inventoryErrors,
    rankingErrors,
    conversionErrors,
    accountErrors,
    hasProductWiseError: !!info?.productWiseError,
    productWiseErrorLength: info?.productWiseError?.length || 0
  });

  // Calculate totals and metrics
  const totalErrors = rankingErrors + conversionErrors + accountErrors + profitabilityErrors + sponsoredAdsErrors + inventoryErrors;
  const criticalErrors = rankingErrors + conversionErrors + profitabilityErrors;
  const warningErrors = accountErrors + sponsoredAdsErrors;
  const infoErrors = inventoryErrors;

  // Issue categories data for chart
  const issueCategories = [
    { name: 'Rankings', count: rankingErrors, color: '#fad12a' },
    { name: 'Conversion', count: conversionErrors, color: '#b92533' },
    { name: 'Inventory', count: inventoryErrors, color: '#ff6b35' },
    { name: 'Account Health', count: accountErrors, color: '#90acc7' },
    { name: 'Profitability', count: profitabilityErrors, color: '#05724e' },
    { name: 'Sponsored Ads', count: sponsoredAdsErrors, color: '#333651' }
  ];

  // Chart data for issues breakdown
  const chartData = {
    series: issueCategories.map(cat => cat.count),
    options: {
      chart: {
        type: "donut",
        fontFamily: "'Inter', sans-serif",
        height: 280,
        animations: {
          enabled: true,
          easing: 'easeinout',
          speed: 800,
        }
      },
      labels: issueCategories.map(cat => cat.name),
      colors: issueCategories.map(cat => cat.color),
      legend: {
        show: false
      },
      dataLabels: {
        enabled: false,
      },
      plotOptions: {
        pie: {
          donut: {
            size: '60%',
            labels: {
              show: true,
              name: {
                show: false
              },
              value: {
                show: false
              },
              total: {
                show: false
              }
            }
          }
        }
      },
      stroke: {
        width: 3,
        colors: ['#ffffff']
      },
      tooltip: {
        enabled: false
      },
      responsive: [{
        breakpoint: 480,
        options: {
          chart: {
            width: 200,
            height: 200
          }
        }
      }]
    }
  };



  // Get all products data with better error handling
  const allProducts = Array.isArray(info?.productWiseError) ? info.productWiseError : [];
  
  // Sort all products based on selected criteria
  const getSortedProducts = (products, criteria) => {
    const sortedProducts = [...products];
    
    switch (criteria) {
      case 'issues':
        return sortedProducts.sort((a, b) => Number(b.errors || 0) - Number(a.errors || 0));
      case 'revenue':
        return sortedProducts.sort((a, b) => Number(b.sales || 0) - Number(a.sales || 0));
      case 'units':
        return sortedProducts.sort((a, b) => Number(b.quantity || 0) - Number(a.quantity || 0));
      default:
        return sortedProducts.sort((a, b) => Number(b.errors || 0) - Number(a.errors || 0));
    }
  };

  // Get all products sorted by current criteria
  const sortedProducts = getSortedProducts(allProducts, sortBy);

  // Helper function to get priority based on position in the sorted list
  const getPriority = (product, sortedProductsList) => {
    const index = sortedProductsList.findIndex(p => p.asin === product.asin);
    if (index === -1) return 'low';
    
    const totalProducts = sortedProductsList.length;
    const third = Math.ceil(totalProducts / 3);
    
    if (index < third) return 'high';
    if (index < third * 2) return 'medium';
    return 'low';
  };

  // Apply search filter to products
  const getSearchFilteredProducts = (products) => {
    if (!searchQuery) return products;
    
    return products.filter(product => {
      if (!product) return false;
      const asin = (product.asin || '').toLowerCase();
      const name = (product.name || '').toLowerCase();
      const query = searchQuery.toLowerCase();
      return asin.includes(query) || name.includes(query);
    });
  };

  // Filter products based on priority
  const getFilteredProducts = (products) => {
    return products.filter(product => {
      if (!product) return false;

      const priority = getPriority(product, sortedProducts);

      switch (filterBy) {
        case 'high':
          return priority === 'high';
        case 'medium':
          return priority === 'medium';
        case 'low':
          return priority === 'low';
        case 'all':
        default:
          return true;
      }
    });
  };

  // Process products through filters
  const processedProducts = getFilteredProducts(
    getSearchFilteredProducts(sortedProducts)
  );

  // Calculate pagination
  const totalPages = Math.ceil(processedProducts.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const currentProducts = processedProducts.slice(startIndex, endIndex);

  // Reset to first page when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterBy, sortBy]);

  const handleViewAllIssues = () => {
    navigate('/seller-central-checker/issues?tab=category');
  };

  const handleProductClick = (asin) => {
    if (asin) {
      navigate(`/seller-central-checker/issues/${asin}`);
    }
  };

  // Close dropdowns when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (!event.target.closest('.dropdown-container')) {
        setShowSortDropdown(false);
        setShowFilterDropdown(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Custom Tooltip Component
  const CustomTooltip = ({ content, children }) => (
    <div className="relative group">
      {children}
      <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-800 text-white text-xs rounded-lg shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none z-50 w-64 text-center">
        {content}
        <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-gray-800"></div>
      </div>
    </div>
  )

  return (
    <div className="space-y-8 p-2">
      {/* Header Section */}
      <div className="bg-gradient-to-r from-slate-900 via-purple-900 to-slate-900 rounded-2xl p-8 text-white relative overflow-hidden">
        <div className="absolute inset-0 opacity-20" style={{backgroundImage: "url(\"data:image/svg+xml,%3Csvg width='60' height='60' viewBox='0 0 60 60' xmlns='http://www.w3.org/2000/svg'%3E%3Cg fill='none' fill-rule='evenodd'%3E%3Cg fill='%23ffffff' fill-opacity='0.05'%3E%3Ccircle cx='30' cy='30' r='2'/%3E%3C/g%3E%3C/g%3E%3C/svg%3E\")"}}></div>
        <div className="relative z-10">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
            <div className="space-y-2">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-2 h-8 bg-gradient-to-b from-blue-400 to-purple-500 rounded-full"></div>
                <div className="flex items-center gap-3">
                  <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                    Issues Overview
                  </h1>
                  <CustomTooltip content="Comprehensive dashboard showing all identified issues across your Amazon account including product problems, performance concerns, and optimization opportunities organized by priority levels.">
                    <HelpCircle className='w-5 h-5 text-gray-300 hover:text-white cursor-pointer transition-colors' />
                  </CustomTooltip>
                </div>
              </div>
              <p className="text-gray-300 text-lg">Monitor and prioritize your account issues for optimal performance</p>
              <div className="flex items-center gap-4 mt-4">
                <div className="flex items-center gap-2 text-sm text-gray-400">
                  <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
                  <span>Live monitoring active</span>
                </div>
                {totalErrors > 0 && (
                  <div className="flex items-center gap-2 text-sm text-orange-300">
                    <AlertTriangle className="w-4 h-4" />
                    <span>Action required</span>
                  </div>
                )}
              </div>
            </div>
            <div className="flex items-center gap-6">
              <div className="text-center lg:text-right">
                <div className="text-4xl lg:text-5xl font-bold bg-gradient-to-r from-orange-400 to-red-500 bg-clip-text text-transparent mb-1">
                  {totalErrors}
                </div>
                <div className="text-sm text-gray-300 font-medium tracking-wide uppercase">Total Issues</div>
                {totalErrors > 0 && (
                  <div className="text-xs text-orange-300 mt-1">Needs attention</div>
                )}
              </div>
              <div className="w-16 h-16 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl flex items-center justify-center shadow-lg">
                <BarChart3 className="w-8 h-8 text-white" />
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Issues Analysis Section */}
      <div className="relative overflow-hidden rounded-2xl shadow-2xl border-0 p-6 bg-gradient-to-br from-slate-50 via-white to-blue-50 hover:shadow-3xl transition-all duration-500 group">
        {/* Geometric Background Pattern */}
        <div className="absolute inset-0 opacity-5">
          <div className="absolute top-0 left-0 w-32 h-32 bg-gradient-to-br from-blue-500 to-purple-500 rounded-full transform rotate-45 translate-x-16 -translate-y-16"></div>
          <div className="absolute bottom-0 right-0 w-40 h-40 bg-gradient-to-tl from-indigo-500 to-cyan-500 rounded-full transform -rotate-12 -translate-x-20 translate-y-20"></div>
          <div className="absolute top-1/2 left-1/4 w-20 h-20 bg-gradient-to-br from-purple-400 to-pink-400 rounded-full transform rotate-12"></div>
        </div>
        
                  <div className="relative z-10">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg shadow-lg flex items-center justify-center transform hover:scale-110 transition-transform duration-300">
                  <BarChart3 className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="text-2xl font-bold bg-gradient-to-r from-gray-800 via-blue-600 to-purple-600 bg-clip-text text-transparent">
                    Product Issues Analysis
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">Real-time insights & recommendations</p>
                </div>
              </div>
                          <button
                onClick={handleViewAllIssues}
                className="relative px-4 py-2 bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white text-sm font-semibold rounded-lg transition-all duration-300 shadow-lg hover:shadow-xl transform hover:scale-105 flex items-center gap-2 overflow-hidden group"
              >
                <div className="absolute inset-0 bg-gradient-to-r from-white/0 via-white/20 to-white/0 transform -translate-x-full group-hover:translate-x-full transition-transform duration-700"></div>
                <span className="relative">View All Issues</span>
                <ArrowRight className="w-4 h-4 relative transform group-hover:translate-x-1 transition-transform duration-300" />
              </button>
            </div>

            <p className="text-gray-600 mb-6 text-base">Comprehensive analysis of account issues categorized by type and priority</p>

                      {/* Chart and Legend Section */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
            {/* Chart */}
            <div className="lg:col-span-1 flex justify-center items-center">
                              <div className="relative">
                  {/* Enhanced Chart Container */}
                  <div className="relative bg-gradient-to-br from-white to-gray-50 rounded-2xl p-6 shadow-2xl border-2 border-transparent bg-clip-padding transform hover:scale-105 transition-all duration-500 group">
                    {/* Animated gradient border */}
                    <div className="absolute inset-0 bg-gradient-to-r from-blue-500 via-purple-500 to-indigo-500 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-500 -z-10 animate-pulse"></div>
                    <div className="absolute inset-[2px] bg-gradient-to-br from-white to-gray-50 rounded-2xl"></div>
                    
                    {/* Decorative corner elements */}
                    <div className="absolute top-2 right-2 w-2 h-2 bg-gradient-to-br from-blue-400 to-purple-500 rounded-full opacity-60"></div>
                    <div className="absolute bottom-2 left-2 w-1.5 h-1.5 bg-gradient-to-br from-purple-400 to-pink-500 rounded-full opacity-60"></div>
                    
                    <div className="relative z-10">
                      <Chart 
                        options={chartData.options} 
                        series={chartData.series} 
                        type="donut" 
                        width={240} 
                        height={240}
                      />
                      {/* Enhanced Center Text */}
                      <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                        <div className="text-3xl font-black bg-gradient-to-r from-red-500 via-orange-500 to-red-600 bg-clip-text text-transparent">
                          {totalErrors}
                        </div>
                        <div className="text-xs font-bold text-red-600 uppercase tracking-wider mt-1">
                          Total Issues
                        </div>
                        {/* Subtle accent line */}
                        <div className="w-12 h-0.5 bg-gradient-to-r from-red-400 to-orange-400 mt-1.5 rounded-full"></div>
                      </div>
                    </div>
                  </div>
                </div>
            </div>

                          {/* Enhanced Legend */}
              <div className="lg:col-span-2 flex flex-col justify-center space-y-3">
              {issueCategories.map((category, index) => (
                                 <motion.div
                   key={index}
                   initial={{ opacity: 0, x: 20 }}
                   animate={{ opacity: 1, x: 0 }}
                   transition={{ duration: 0.5, delay: index * 0.1 }}
                   className="group relative"
                 >
                   {/* Card with enhanced effects */}
                   <div className="relative p-4 bg-gradient-to-br from-white to-gray-50/50 rounded-xl border-2 border-gray-200/50 shadow-lg hover:shadow-2xl transition-all duration-500 cursor-pointer transform hover:scale-[1.02] hover:-translate-y-1 hover:border-gray-300">
                     {/* Animated gradient border on hover */}
                     <div 
                       className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 rounded-xl border-2 -m-[2px]"
                       style={{ 
                         borderImage: `linear-gradient(135deg, ${category.color}40, ${category.color}20, ${category.color}40) 1`,
                         background: `linear-gradient(135deg, ${category.color}05, transparent, ${category.color}05)`
                       }}
                     ></div>
                     
                     {/* Diagonal stripe pattern */}
                     <div 
                       className="absolute inset-0 opacity-0 group-hover:opacity-5 transition-opacity duration-500 rounded-xl"
                       style={{
                         backgroundImage: `repeating-linear-gradient(45deg, ${category.color}, ${category.color} 2px, transparent 2px, transparent 12px)`
                       }}
                     ></div>
                    
                                         <div className="relative z-10 flex items-center justify-between">
                       <div className="flex items-center gap-3">
                         {/* Enhanced Color indicator */}
                         <div className="relative">
                           <div 
                             className="w-6 h-6 rounded-xl shadow-lg transform group-hover:scale-125 group-hover:rotate-12 transition-all duration-300 border-2 border-white"
                             style={{ 
                               background: `linear-gradient(135deg, ${category.color}, ${category.color}cc)`,
                             }}
                           ></div>
                           {/* Layered depth effect */}
                           <div 
                             className="absolute inset-0.5 w-5 h-5 rounded-xl opacity-60"
                             style={{ 
                               background: `linear-gradient(315deg, ${category.color}80, transparent)`
                             }}
                           ></div>
                         </div>
                         
                         <div>
                           <p className="text-sm font-bold text-gray-800 group-hover:text-gray-900 transition-colors">
                             {category.name}
                           </p>
                           <p className="text-xs text-gray-500 mt-0.5">
                             {category.count === 1 ? '1 issue detected' : `${category.count} issues detected`}
                           </p>
                         </div>
                       </div>
                      
                                             {/* Enhanced count badge */}
                       <div className="relative">
                         <div 
                           className="px-3 py-1.5 rounded-xl font-bold text-white shadow-xl transform group-hover:scale-110 transition-all duration-300 border-2 border-white/20"
                           style={{ 
                             background: `linear-gradient(135deg, ${category.color}, ${category.color}dd)`,
                           }}
                         >
                           <span className="relative z-10 text-sm">{category.count || 0}</span>
                           {/* Inner highlight */}
                           <div 
                             className="absolute inset-0 rounded-xl opacity-30"
                             style={{ 
                               background: `linear-gradient(135deg, white, transparent)`
                             }}
                           ></div>
                         </div>
                         {/* Subtle shadow base */}
                         <div 
                           className="absolute inset-0 px-3 py-1.5 rounded-xl opacity-20 transform translate-y-1"
                           style={{ backgroundColor: category.color }}
                         ></div>
                       </div>
                    </div>
                    
                                         {/* Progress bar effect */}
                     <div className="mt-2.5 h-1 bg-gray-200 rounded-full overflow-hidden">
                      <div 
                        className="h-full rounded-full transition-all duration-1000 ease-out"
                        style={{ 
                          width: totalErrors > 0 ? `${Math.min((category.count / totalErrors) * 100, 100)}%` : '0%',
                          background: `linear-gradient(90deg, ${category.color}, ${category.color}aa)`
                        }}
                      ></div>
                    </div>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Results Summary */}
      {(searchQuery || filterBy !== 'all' || sortBy !== 'issues') && (
        <motion.div 
          initial={{ opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 p-4 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl shadow-sm"
        >
          <div className="flex items-center gap-2 text-sm overflow-x-auto">
            <span className="text-blue-700 font-semibold flex items-center gap-2 whitespace-nowrap">
              <Filter className="w-4 h-4" />
              Active filters:
            </span>
            {searchQuery && (
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium whitespace-nowrap">
                Search: "{searchQuery}"
              </span>
            )}
            {filterBy !== 'all' && (
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium whitespace-nowrap">
                Filter: {filterOptions.find(opt => opt.value === filterBy)?.label}
              </span>
            )}
            {sortBy !== 'issues' && (
              <span className="px-3 py-1 bg-blue-100 text-blue-800 rounded-full text-xs font-medium whitespace-nowrap">
                Criteria: {sortOptions.find(opt => opt.value === sortBy)?.label}
              </span>
            )}
            <button
              onClick={() => {
                setSearchQuery('');
                setFilterBy('all');
                setSortBy('issues');
                setCurrentPage(1);
              }}
              className="ml-auto px-3 py-1 text-xs text-blue-600 hover:text-white hover:bg-blue-600 border border-blue-300 hover:border-blue-600 rounded-full transition-all duration-200 whitespace-nowrap"
            >
              Clear all filters
            </button>
          </div>
        </motion.div>
      )}

      {/* Enhanced Top Products Section */}
      <div className="bg-white rounded-2xl shadow-lg border-0 p-8 hover:shadow-xl transition-shadow duration-300">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h2 className="text-2xl font-bold text-gray-900">
                {sortOptions.find(opt => opt.value === sortBy)?.label || 'Issues by Product'}
              </h2>
              <CustomTooltip content="Detailed table showing individual products with issues. You can sort by number of issues, revenue, or units sold to prioritize which products to address first. Use search and filters to find specific products.">
                <HelpCircle className='w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors' />
              </CustomTooltip>
            </div>
            <p className="text-gray-600">
              Showing <span className="font-semibold text-blue-600">{currentProducts.length}</span> of <span className="font-semibold">{processedProducts.length}</span> products with issues
              {totalPages > 1 && (
                <span className="text-sm text-gray-500 ml-2">
                  (Page {currentPage} of {totalPages})
                </span>
              )}
              {filterBy !== 'all' && (
                <span className="text-sm text-gray-500 ml-2">
                  - Filtered by {filterOptions.find(opt => opt.value === filterBy)?.label}
                </span>
              )}
            </p>
          </div>
          
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            {/* Enhanced Sort Dropdown */}
            <div className="relative dropdown-container">
              <button
                onClick={() => {
                  setShowSortDropdown(!showSortDropdown);
                  setShowFilterDropdown(false);
                }}
                className="w-full sm:w-auto flex items-center justify-between gap-3 px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 shadow-sm"
              >
                <span className="text-gray-700 font-medium">
                  {sortOptions.find(opt => opt.value === sortBy)?.label}
                </span>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showSortDropdown ? 'rotate-180' : ''}`} />
              </button>
              
              <AnimatePresence>
                {showSortDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="absolute right-0 top-full mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden"
                  >
                    <div className="py-2">
                      <div className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">
                        Selection Criteria
                      </div>
                      {sortOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            setSortBy(option.value);
                            setShowSortDropdown(false);
                          }}
                          className={`w-full text-left px-4 py-3 text-sm hover:bg-blue-50 transition-all duration-150 ${
                            sortBy === option.value 
                              ? 'bg-blue-50 text-blue-700 font-semibold border-r-2 border-blue-500' 
                              : 'text-gray-700 hover:text-blue-600'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Enhanced Filter Dropdown */}
            <div className="relative dropdown-container">
              <button
                onClick={() => {
                  setShowFilterDropdown(!showFilterDropdown);
                  setShowSortDropdown(false);
                }}
                className="w-full sm:w-auto flex items-center justify-between gap-3 px-4 py-2.5 border border-gray-200 rounded-xl text-sm bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all duration-200 shadow-sm"
              >
                <div className="flex items-center gap-2">
                  <Filter className="w-4 h-4 text-gray-400" />
                  <span className="text-gray-700 font-medium">
                    {filterOptions.find(opt => opt.value === filterBy)?.label}
                  </span>
                </div>
                <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform duration-200 ${showFilterDropdown ? 'rotate-180' : ''}`} />
              </button>
              
              <AnimatePresence>
                {showFilterDropdown && (
                  <motion.div
                    initial={{ opacity: 0, y: -10, scale: 0.95 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -10, scale: 0.95 }}
                    transition={{ duration: 0.2 }}
                    className="absolute right-0 top-full mt-2 w-64 bg-white border border-gray-200 rounded-xl shadow-xl z-50 overflow-hidden"
                  >
                    <div className="py-2">
                      <div className="px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wider bg-gray-50 border-b border-gray-100">
                        Filter Options
                      </div>
                      {filterOptions.map((option) => (
                        <button
                          key={option.value}
                          onClick={() => {
                            setFilterBy(option.value);
                            setShowFilterDropdown(false);
                          }}
                          className={`w-full text-left px-4 py-3 text-sm hover:bg-blue-50 transition-all duration-150 ${
                            filterBy === option.value 
                              ? 'bg-blue-50 text-blue-700 font-semibold border-r-2 border-blue-500' 
                              : 'text-gray-700 hover:text-blue-600'
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Enhanced Search Input */}
            <div className="relative">
              <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="Search products..."
                className="pl-11 pr-4 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 w-full sm:w-56 transition-all duration-200 shadow-sm hover:shadow-md"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
          </div>
        </div>

        {currentProducts.length > 0 ? (
          <div className="rounded-xl border border-gray-200">
            <table className="w-full table-fixed">
              <thead className="bg-gradient-to-r from-gray-50 to-gray-100">
                <tr>
                  <th className="text-left py-4 px-3 text-xs font-semibold text-gray-700 w-2/5 sm:w-1/3">Product</th>
                  <th className="text-left py-4 px-2 text-xs font-semibold text-gray-700 w-20 hidden sm:table-cell">ASIN</th>
                  <th className="text-center py-4 px-2 text-xs font-semibold text-gray-700 w-16">Issues</th>
                  <th className="text-center py-4 px-2 text-xs font-semibold text-gray-700 w-20 hidden md:table-cell">Revenue</th>
                  <th className="text-center py-4 px-2 text-xs font-semibold text-gray-700 w-16 hidden lg:table-cell">Units</th>
                  <th className="text-center py-4 px-2 text-xs font-semibold text-gray-700 w-20">Priority</th>
                  <th className="text-center py-4 px-2 text-xs font-semibold text-gray-700 w-20">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {currentProducts.map((product, index) => {
                  const priority = getPriority(product, sortedProducts);
                  const priorityLabel = priority.charAt(0).toUpperCase() + priority.slice(1);
                  const priorityColor = priority === 'high' ? 'text-red-600 bg-red-50 border-red-200' : 
                                      priority === 'medium' ? 'text-yellow-600 bg-yellow-50 border-yellow-200' : 
                                      'text-blue-600 bg-blue-50 border-blue-200';
                  
                  return (
                    <motion.tr
                      key={product.asin || index}
                      whileHover={{ backgroundColor: '#f8fafc' }}
                      className="cursor-pointer hover:shadow-sm transition-all duration-200"
                      onClick={() => handleProductClick(product.asin)}
                    >
                      <td className="py-4 px-3">
                        <div className="flex items-center gap-2">
                          <div className="w-8 h-8 bg-gradient-to-br from-gray-100 to-gray-200 rounded-lg flex items-center justify-center shadow-sm flex-shrink-0">
                            <Package className="w-4 h-4 text-gray-500" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs font-semibold text-gray-900 truncate" title={product.name || 'Product Name Not Available'}>
                              {product.name ? 
                                (product.name.length > 35 ? 
                                  `${product.name.substring(0, 35)}...` : 
                                  product.name
                                ) : 
                                'Product Name Not Available'
                              }
                            </p>
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                              <span className="sm:hidden">{product.asin}</span>
                              <span className="md:hidden">${(product.sales || 0) > 999 ? `${((product.sales || 0) / 1000).toFixed(1)}k` : (product.sales || 0).toLocaleString()}</span>
                              <span className="lg:hidden">{(product.quantity || 0) > 999 ? `${((product.quantity || 0) / 1000).toFixed(1)}k` : (product.quantity || 0).toLocaleString()} units</span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="py-4 px-2 text-xs text-gray-900 font-mono truncate hidden sm:table-cell" title={product.asin}>
                        {product.asin}
                      </td>
                      <td className="py-4 px-2 text-center">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold bg-red-100 text-red-800">
                          {product.errors || 0}
                        </span>
                      </td>
                      <td className="py-4 px-2 text-center text-xs font-semibold text-gray-900 hidden md:table-cell">
                        ${(product.sales || 0) > 999 ? `${((product.sales || 0) / 1000).toFixed(1)}k` : (product.sales || 0).toLocaleString()}
                      </td>
                      <td className="py-4 px-2 text-center text-xs font-semibold text-gray-900 hidden lg:table-cell">
                        {(product.quantity || 0) > 999 ? `${((product.quantity || 0) / 1000).toFixed(1)}k` : (product.quantity || 0).toLocaleString()}
                      </td>
                      <td className="py-4 px-2 text-center">
                        <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-semibold ${priorityColor}`}>
                          {priorityLabel.charAt(0)}
                        </span>
                      </td>
                      <td className="py-4 px-2 text-center">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleProductClick(product.asin);
                          }}
                          className="px-2 py-1 text-blue-600 hover:text-white hover:bg-blue-600 border border-blue-200 hover:border-blue-600 text-xs font-medium rounded transition-all duration-200"
                          title="View Details"
                        >
                          View
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </tbody>
            </table>
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
              <div className="bg-gray-50 px-4 py-3 border-t border-gray-200 rounded-b-xl">
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                  <div className="text-sm text-gray-700 order-2 sm:order-1">
                    Showing <span className="font-medium">{startIndex + 1}</span> to{' '}
                    <span className="font-medium">{Math.min(endIndex, processedProducts.length)}</span> of{' '}
                    <span className="font-medium">{processedProducts.length}</span> results
                  </div>
                  <div className="flex items-center space-x-2 order-1 sm:order-2">
                    <button
                      onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                      disabled={currentPage === 1}
                      className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Previous
                    </button>
                    
                    <div className="flex items-center space-x-1">
                      {/* Page Numbers */}
                      {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                        let pageNum;
                        if (totalPages <= 5) {
                          pageNum = i + 1;
                        } else if (currentPage <= 3) {
                          pageNum = i + 1;
                        } else if (currentPage >= totalPages - 2) {
                          pageNum = totalPages - 4 + i;
                        } else {
                          pageNum = currentPage - 2 + i;
                        }
                        
                        return (
                          <button
                            key={pageNum}
                            onClick={() => setCurrentPage(pageNum)}
                            className={`px-3 py-1 text-sm font-medium rounded-md transition-colors ${
                              currentPage === pageNum
                                ? 'bg-blue-600 text-white'
                                : 'text-gray-700 bg-white border border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            {pageNum}
                          </button>
                        );
                      })}
                    </div>
                    
                    <button
                      onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                      disabled={currentPage === totalPages}
                      className="px-3 py-1 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-md hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                    >
                      Next
                    </button>
                  </div>
                </div>
              </div>
            )}
            
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500 bg-gray-50 rounded-2xl">
            <div className="w-20 h-20 bg-gradient-to-br from-gray-200 to-gray-300 rounded-full flex items-center justify-center mb-4 shadow-sm">
              <Package className="w-10 h-10 text-gray-400" />
            </div>
            <p className="text-lg font-semibold text-gray-700 mb-2">
              {searchQuery ? 'No products found' : 'No products with issues'}
            </p>
            <p className="text-sm text-gray-500 text-center max-w-md">
              {searchQuery 
                ? 'Try adjusting your search terms or filters to find what you\'re looking for.'
                : 'Great job! All your products are performing well without any detected issues.'
              }
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default OverView;