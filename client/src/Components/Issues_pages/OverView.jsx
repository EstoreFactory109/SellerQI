import React, { useState, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, TrendingUp, Package, DollarSign, BarChart3, Search, ArrowRight, Eye, Filter, ChevronDown, Activity, Clock, Star } from 'lucide-react';
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

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage] = useState(10);

  // Dropdown options
  const sortOptions = [
    { value: 'issues', label: 'Products by Issues' },
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

  // Calculate priority-based product counts from processed products
  const highPriorityCount = processedProducts.filter(product => getPriority(product, sortedProducts) === 'high').length;
  const mediumPriorityCount = processedProducts.filter(product => getPriority(product, sortedProducts) === 'medium').length;
  const lowPriorityCount = processedProducts.filter(product => getPriority(product, sortedProducts) === 'low').length;

  // Issue categories with enhanced data and improved fallbacks
  const issueCategories = [
    {
      id: 'critical',
      name: 'Critical Issues',
      count: highPriorityCount,
      description: 'High priority products requiring immediate attention',
      color: 'bg-red-500',
      bgColor: 'bg-gradient-to-br from-red-50 to-red-100',
      textColor: 'text-red-700',
      borderColor: 'border-red-200',
      icon: AlertTriangle,
      subcategories: [
        { name: 'High Priority Products', count: highPriorityCount, color: '#ef4444' }
      ]
    },
    {
      id: 'warning',
      name: 'Warning Issues',
      count: mediumPriorityCount,
      description: 'Medium priority products needing attention soon',
      color: 'bg-yellow-500',
      bgColor: 'bg-gradient-to-br from-yellow-50 to-yellow-100',
      textColor: 'text-yellow-700',
      borderColor: 'border-yellow-200',
      icon: TrendingUp,
      subcategories: [
        { name: 'Medium Priority Products', count: mediumPriorityCount, color: '#eab308' }
      ]
    },
    {
      id: 'info',
      name: 'Info Issues',
      count: lowPriorityCount,
      description: 'Low priority products with optimization opportunities',
      color: 'bg-blue-500',
      bgColor: 'bg-gradient-to-br from-blue-50 to-blue-100',
      textColor: 'text-blue-700',
      borderColor: 'border-blue-200',
      icon: Package,
      subcategories: [
        { name: 'Low Priority Products', count: lowPriorityCount, color: '#8b5cf6' }
      ]
    }
  ];

  // Chart data for donut chart with priority-based data (after priority counts are calculated)
  const totalPriorityProducts = highPriorityCount + mediumPriorityCount + lowPriorityCount;
  const chartData = {
    series: totalPriorityProducts > 0 ? [highPriorityCount, mediumPriorityCount, lowPriorityCount] : [1],
    options: {
      chart: {
        type: 'donut',
        height: 280,
        animations: {
          enabled: true,
          easing: 'easeinout',
          speed: 800,
        }
      },
      labels: totalPriorityProducts > 0 ? ['High Priority', 'Medium Priority', 'Low Priority'] : ['No Issues'],
      colors: totalPriorityProducts > 0 ? ['#ef4444', '#eab308', '#3b82f6'] : ['#e5e7eb'],
      legend: {
        show: false,
      },
      dataLabels: {
        enabled: true,
        formatter: function (val, opts) {
          const value = opts.w.config.series[opts.seriesIndex];
          if (val > 5) {
            return Math.round(val) + '%';
          }
          return '';
        },
        style: {
          fontSize: '12px',
          fontWeight: '600',
          colors: ['#ffffff']
        },
        dropShadow: {
          enabled: true,
          top: 1,
          left: 1,
          blur: 1,
          opacity: 0.8
        }
      },
      plotOptions: {
        pie: {
          donut: {
            size: '60%',
            labels: {
              show: true,
              name: {
                show: true,
                fontSize: '14px',
                fontWeight: 600,
                color: '#374151',
                offsetY: -10,
                formatter: function () {
                  return 'Total Products';
                }
              },
              value: {
                show: true,
                fontSize: '28px',
                fontWeight: 'bold',
                color: '#1f2937',
                offsetY: 10,
                formatter: function () {
                  return totalPriorityProducts;
                }
              },
              total: {
                show: true,
                showAlways: true,
                label: 'Total Products',
                fontSize: '14px',
                fontWeight: 600,
                color: '#374151',
                formatter: function () {
                  return totalPriorityProducts;
                }
              }
            }
          },
          expandOnClick: false,
          offsetX: 0,
          offsetY: 0
        }
      },
      stroke: {
        width: 3,
        colors: ['#ffffff']
      },
      tooltip: {
        enabled: true,
        y: {
          formatter: function(value, { seriesIndex, w }) {
            const label = w.config.labels[seriesIndex];
            const percentage = ((value / totalPriorityProducts) * 100).toFixed(1);
            return `${value} products (${percentage}%)`;
          }
        },
        style: {
          fontSize: '12px',
        }
      },
      responsive: [{
        breakpoint: 480,
        options: {
          chart: {
            width: 200,
            height: 200
          },
          plotOptions: {
            pie: {
              donut: {
                size: '70%'
              }
            }
          }
        }
      }]
    }
  };

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
                <h1 className="text-3xl font-bold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                  Issues Overview
                </h1>
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

      {/* Main Content Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        
        {/* Issues Chart Section - Enhanced Layout */}
        <div className="xl:col-span-1">
          <div className="bg-white rounded-2xl shadow-lg border-0 p-6 hover:shadow-xl transition-all duration-300">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-1">Issues Distribution</h2>
                <p className="text-sm text-gray-500">Breakdown by category</p>
              </div>
              <button
                onClick={() => setShowDetails(!showDetails)}
                className="px-3 py-2 text-sm font-medium text-blue-600 hover:text-white hover:bg-blue-600 border border-blue-200 hover:border-blue-600 rounded-lg flex items-center gap-2 transition-all duration-200"
              >
                <Eye className="w-4 h-4" />
                {showDetails ? 'Hide' : 'Details'}
              </button>
            </div>
            
            {totalPriorityProducts > 0 ? (
              <div className="space-y-6">
                {/* Chart Container */}
                <div className="flex items-center justify-center p-4 bg-gray-50 rounded-xl">
                  <Chart 
                    options={chartData.options} 
                    series={chartData.series} 
                    type="donut" 
                    width={260} 
                    height={260}
                  />
                </div>
                
                {/* Chart Legend - Enhanced Custom Implementation */}
                <div className="space-y-3 bg-gray-50 rounded-xl p-4">
                  <h4 className="text-sm font-semibold text-gray-700 mb-3">Legend</h4>
                  {chartData.options.labels.map((label, index) => {
                    const value = chartData.series[index];
                    const color = chartData.options.colors[index];
                    const percentage = ((value / totalPriorityProducts) * 100).toFixed(1);
                    return (
                      <div key={label} className="flex items-center justify-between text-sm hover:bg-white p-2 rounded-lg transition-colors">
                        <div className="flex items-center gap-3">
                          <div 
                            className="w-4 h-4 rounded-full shadow-sm" 
                            style={{ backgroundColor: color }}
                          ></div>
                          <span className="text-gray-700 font-medium">{label}</span>
                        </div>
                        <div className="text-right">
                          <span className="font-bold text-gray-900">{value}</span>
                          <span className="text-xs text-gray-500 ml-1">({percentage}%)</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-16 text-gray-500">
                <div className="w-20 h-20 bg-gradient-to-br from-green-400 to-green-500 rounded-full flex items-center justify-center mb-4 shadow-lg">
                  <Star className="w-10 h-10 text-white" />
                </div>
                <p className="text-lg font-semibold text-gray-700 mb-2">No issues detected</p>
                <p className="text-sm text-gray-500 text-center">Your account is performing excellently!<br />Keep up the great work.</p>
              </div>
            )}

            <AnimatePresence>
              {showDetails && totalPriorityProducts > 0 && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.3 }}
                  className="mt-6 pt-6 border-t border-gray-200"
                >
                  <h3 className="text-sm font-semibold text-gray-900 mb-4 flex items-center gap-2">
                    <Activity className="w-4 h-4" />
                    Detailed Breakdown
                  </h3>
                  <div className="space-y-4">
                    {issueCategories.map(category => (
                      <div key={category.id} className="p-4 rounded-xl bg-gradient-to-r from-gray-50 to-gray-100 border border-gray-200">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-sm font-semibold text-gray-900">{category.name}</span>
                          <span className="text-lg font-bold text-gray-700">{category.count}</span>
                        </div>
                        <div className="space-y-2">
                          {category.subcategories.map(sub => (
                            <div key={sub.name} className="flex justify-between items-center text-xs bg-white p-2 rounded-lg">
                              <div className="flex items-center gap-2">
                                <div 
                                  className="w-3 h-3 rounded-full" 
                                  style={{ backgroundColor: sub.color }}
                                ></div>
                                <span className="text-gray-600 font-medium">{sub.name}</span>
                              </div>
                              <span className="font-bold" style={{ color: sub.color }}>{sub.count}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Issue Categories Cards - Enhanced Layout */}
        <div className="xl:col-span-2">
          <div className="flex items-center justify-between mb-6">
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-1">Issue Categories</h2>
              <p className="text-sm text-gray-500">Prioritized by severity level</p>
            </div>
            <button
              onClick={handleViewAllIssues}
              className="px-4 py-2 bg-gradient-to-r from-blue-600 to-blue-700 text-white text-sm font-medium rounded-lg hover:from-blue-700 hover:to-blue-800 flex items-center gap-2 transition-all duration-200 shadow-md hover:shadow-lg"
            >
              View All <ArrowRight className="w-4 h-4" />
            </button>
          </div>
          
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
            {issueCategories.map((category) => {
              const IconComponent = category.icon;
              return (
                <motion.div
                  key={category.id}
                  whileHover={{ scale: 1.02, y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  className={`${category.bgColor} ${category.borderColor} border-2 rounded-2xl p-6 cursor-pointer transition-all duration-300 hover:shadow-xl group`}
                  onClick={() => handleViewAllIssues()}
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className={`w-14 h-14 ${category.color} rounded-xl flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform duration-200`}>
                      <IconComponent className="w-7 h-7 text-white" />
                    </div>
                    <div className="text-right">
                      <div className={`text-3xl font-bold ${category.textColor} mb-1`}>
                        {category.count}
                      </div>
                      <div className="text-xs text-gray-500 font-medium">
                        {category.count === 1 ? 'Issue' : 'Issues'}
                      </div>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <h3 className={`font-bold text-lg ${category.textColor}`}>
                      {category.name}
                    </h3>
                    <p className="text-sm text-gray-600 leading-relaxed">
                      {category.description}
                    </p>
                    
                    {/* Subcategory breakdown */}
                    <div className="pt-4 border-t border-gray-200 space-y-2">
                      {category.subcategories.map((sub, index) => (
                        <div key={index} className="flex justify-between items-center text-sm bg-white/60 p-2 rounded-lg">
                          <div className="flex items-center gap-2">
                            <div 
                              className="w-3 h-3 rounded-full shadow-sm" 
                              style={{ backgroundColor: sub.color }}
                            ></div>
                            <span className="text-gray-700 font-medium">{sub.name}</span>
                          </div>
                          <span className="font-bold text-gray-800">{sub.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </motion.div>
              );
            })}
          </div>

          {/* Enhanced Quick Stats Summary */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-blue-50 rounded-2xl p-6 border border-blue-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-md">
                  <DollarSign className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <div className="text-sm text-blue-600 font-medium mb-1">Revenue Impact</div>
                  <div className="text-xl font-bold text-gray-900">
                    {criticalErrors > 0 ? 'High Risk' : warningErrors > 0 ? 'Medium Risk' : 'Low Risk'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    {criticalErrors > 0 ? 'Immediate action needed' : 'Monitor closely'}
                  </div>
                </div>
              </div>
            </div>
            
            <div className="bg-gradient-to-r from-green-50 via-emerald-50 to-green-50 rounded-2xl p-6 border border-green-200 shadow-sm hover:shadow-md transition-shadow">
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 bg-gradient-to-br from-green-500 to-green-600 rounded-xl flex items-center justify-center shadow-md">
                  <TrendingUp className="w-6 h-6 text-white" />
                </div>
                <div className="flex-1">
                  <div className="text-sm text-green-600 font-medium mb-1">Account Health</div>
                  <div className="text-xl font-bold text-gray-900">
                    {totalErrors === 0 ? 'Excellent' : totalErrors < 10 ? 'Good' : totalErrors < 25 ? 'Fair' : 'Needs Attention'}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">
                    Based on {totalErrors} total issues
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      
      </div>

      {/* Enhanced Top Products Section */}
      <div className="bg-white rounded-2xl shadow-lg border-0 p-8 hover:shadow-xl transition-shadow duration-300">
        <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6 mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-2">
              {sortOptions.find(opt => opt.value === sortBy)?.label || 'Products with Issues'}
            </h2>
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