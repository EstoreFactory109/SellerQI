import React, { useState, useMemo, useEffect } from "react";
import { useSelector, useDispatch } from 'react-redux';
import { motion } from "framer-motion";
import { 
  AlertTriangle, 
  Search, 
  Filter,
  Download,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { fetchTasks, updateTaskStatus } from '../redux/slices/TasksSlice.js';

// Helper function to format messages with important details highlighted on separate line
const formatMessageWithHighlight = (message) => {
  if (!message) return { mainText: '', highlightedText: '' };
  
  // Patterns to extract and highlight on a separate line
  // These patterns match the exact formats from the backend
  const patterns = [
    // Ranking - Restricted words patterns (exact backend formats)
    /^(.*?)(The Characters used are:\s*.+)$/i,  // Title - restricted words
    /^(.*?)(The characters which are used:\s*.+)$/i,  // Title - special characters
    /^(.*?)(The words Used are:\s*.+)$/,  // Bullet Points - restricted words (case sensitive 'Used')
    /^(.*?)(The words used are:\s*.+)$/i,  // Description - restricted words
    /^(.*?)(The special characters used are:\s*.+)$/i,  // Bullet Points & Description - special characters
    
    // Inventory patterns - units available
    /^(.*?)(Only \d+ units available.*)$/i,
    /^(.*?)(Currently \d+ units available.*)$/i,
    /^(.*?)(\d+ units available.*)$/i,
    
    // Inventory - Stranded reason
    /^(.*?)(Reason:\s*.+)$/i,
    
    // Inventory - Inbound non-compliance problem
    /^(.*?)(Problem:\s*.+)$/i,
    
    // Buy Box patterns
    /^(.*?)(With \d+ page views.+)$/i,
    
    // Amazon recommends pattern
    /^(.*?)(Amazon recommends replenishing \d+ units.*)$/i,
    
    // Unfulfillable inventory quantity
    /^(.*?)(Unfulfillable Quantity:\s*\d+\s*units)$/i,
    
    // Profitability patterns
    /^(.*?)(Revenue:\s*\$[\d,.]+.*)$/i,
    /^(.*?)(Net Profit:\s*-?\$[\d,.]+.*)$/i,
    
    // PPC/Sponsored Ads patterns - match complete parenthetical expressions first (most specific)
    /^(.*?)(\([^)]*Spend:\s*\$[\d,.]+[^)]*\))/i,  // Match complete (Spend: ...) with brackets
    /^(.*?)(\([^)]*Sales:\s*\$[\d,.]+[^)]*\))/i,  // Match complete (Sales: ...) with brackets
    /^(.*?)(\([^)]*ACOS:\s*[\d.]+%[^)]*\))/i,  // Match complete (ACOS: ...) with brackets
    /^(.*?)(\([^)]*Spend:\s*\$[\d,.]+[^)]*Sales:\s*\$[\d,.]+[^)]*\))/i,  // Match (Spend: ... Sales: ...) together
    /^(.*?)(Spend:\s*\$[\d,.]+(?:\s*,\s*Sales:\s*\$[\d,.]+)?[^.)]*)/i,  // Fallback for Spend without brackets (stop at period or closing paren)
    /^(.*?)(ACOS:\s*[\d.]+%[^.(]*)/i,  // Fallback for ACOS without brackets (stop before opening paren or period)
    /^(.*?)(\d+ clicks from \d+ impressions.*)$/i,
  ];
  
  for (const pattern of patterns) {
    const match = message.match(pattern);
    if (match && match[2]) {
      return {
        mainText: match[1].trim(),
        highlightedText: match[2].trim()
      };
    }
  }
  
  return { mainText: message, highlightedText: '' };
};

// Component to render message with highlighted part
const FormattedMessage = ({ message, errorCategory }) => {
  const { mainText, highlightedText } = formatMessageWithHighlight(message);
  
  // Don't make bold for profitability and sponsored ads errors
  const shouldBold = errorCategory?.toLowerCase() !== 'profitability' && 
                     errorCategory?.toLowerCase() !== 'sponsoredads' &&
                     errorCategory?.toLowerCase() !== 'sponsored ads';
  
  return (
    <>
      {mainText && <span>{mainText}</span>}
      {highlightedText && (
        <>
          <br />
          {shouldBold ? (
            <strong className="text-gray-900 mt-1 block">{highlightedText}</strong>
          ) : (
            <span className="text-gray-900 mt-1 block">{highlightedText}</span>
          )}
        </>
      )}
    </>
  );
};

// Helper function to format "How to Solve" text with numbered points on separate lines
const formatHowToSolve = (text) => {
  if (!text) return [];
  
  // Check if text contains numbered points pattern (e.g., "1) ", "2) ", etc.)
  if (!text.match(/\d+\)\s+/)) {
    // No numbered points, return as single item
    return [text];
  }
  
  // Split on pattern: number followed by ") " (with optional space before)
  // Use positive lookahead to keep the delimiter
  const parts = text.split(/(?=\d+\)\s+)/);
  
  const formatted = [];
  
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed) {
      formatted.push(trimmed);
    }
  }
  
  return formatted.length > 0 ? formatted : [text];
};

// Component to render "How to Solve" with numbered points on separate lines
const FormattedHowToSolve = ({ text }) => {
  const formattedPoints = formatHowToSolve(text);
  
  return (
    <div className="space-y-1">
      {formattedPoints.map((point, index) => (
        <div key={index} className="whitespace-normal">
          {point}
        </div>
      ))}
    </div>
  );
};

export default function Tasks() {
  const dispatch = useDispatch();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('taskId');
  const [sortOrder, setSortOrder] = useState('asc');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  // Get tasks data from Redux store
  const tasks = useSelector(state => state.tasks?.tasks || []);
  const loading = useSelector(state => state.tasks?.loading || false);
  const error = useSelector(state => state.tasks?.error);
  const completedTasksArray = useSelector(state => state.tasks?.completedTasks || []);
  
  // Convert array to Set for easier checking
  const completedTasks = useMemo(() => new Set(completedTasksArray), [completedTasksArray]);

  // Get user data from Redux store
  const userData = useSelector(state => state.Auth?.user);
  
  // Get products data from Redux store for product name lookup
  const totalProducts = useSelector(state => state.Dashboard?.DashBoardInfo?.TotalProduct) || [];



  // Get severity based on error category
  const getSeverityFromCategory = (category) => {
    switch (category?.toLowerCase()) {
      case 'ranking':
        return 'medium';
      case 'conversion':
        return 'medium';
      case 'inventory':
        return 'high';
      case 'profitability':
        return 'high';
      case 'sponsoredads':
        return 'medium';
      default:
        return 'medium';
    }
  };

  // Fetch tasks data from Redux (only if not already loaded)
  useEffect(() => {
    if (!userData?.userId) {
      return;
    }

    // Only fetch if tasks are empty or haven't been fetched recently
    if (tasks.length === 0) {
      dispatch(fetchTasks());
    }
  }, [userData?.userId, tasks.length, dispatch]);

  // Create a map of ASIN to product details for quick lookup
  const productDetailsMap = useMemo(() => {
    const map = new Map();
    totalProducts.forEach(product => {
      if (product.asin) {
        map.set(product.asin, {
          name: product.itemName || product.title || product.productName || null,
          sku: product.sku || null
        });
      }
    });
    return map;
  }, [totalProducts]);

  // Transform API data to match table structure
  const transformedTasks = useMemo(() => {
    return tasks.map((task, index) => {
      // Get product details from the map
      const productDetails = productDetailsMap.get(task.asin);
      
      // Get the product name - prioritize the one from products list if the task has a generic name
      let productName = task.productName;
      
      // If product name is generic (starts with "Product " followed by ASIN), look it up
      if (productName && productName.startsWith('Product ') && task.asin) {
        if (productDetails?.name) {
          productName = productDetails.name;
        }
      }
      
      // If no product name at all, try to look it up
      if (!productName && task.asin) {
        productName = productDetails?.name || `Product ${task.asin}`;
      }
      
      // Get SKU from product details
      const sku = productDetails?.sku || null;
      
      return {
        slNo: index + 1,
        taskId: task.taskId,
        product: productName,
        asin: task.asin,
        sku: sku,
        errorCategory: task.errorCategory,
        error: task.error,
        howToSolve: task.solution,
        severity: getSeverityFromCategory(task.errorCategory),
        status: task.status,
        sales: 0,
        errorCount: 1
      };
    });
  }, [tasks, productDetailsMap]);

  // completedTasks is now managed by Redux, no need for this effect

  // Filter and sort data
  const filteredAndSortedData = useMemo(() => {
    let filtered = transformedTasks;

    // Apply status filter
    if (filterStatus === 'pending') {
      filtered = filtered.filter(item => !completedTasks.has(item.taskId));
    } else if (filterStatus === 'completed') {
      filtered = filtered.filter(item => completedTasks.has(item.taskId));
    }
    // If filterStatus is 'all', show all tasks

    // Apply search filter
    if (searchQuery) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(item =>
        item.product.toLowerCase().includes(query) ||
        item.asin.toLowerCase().includes(query) ||
        item.error.toLowerCase().includes(query) ||
        item.errorCategory.toLowerCase().includes(query)
      );
    }

    // Apply category filter
    if (filterCategory !== 'all') {
      filtered = filtered.filter(item => 
        item.errorCategory.toLowerCase() === filterCategory.toLowerCase()
      );
    }

    // Apply sorting
    filtered.sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];

      if (sortBy === 'slNo') {
        aValue = parseInt(aValue);
        bValue = parseInt(bValue);
      } else {
        aValue = aValue.toString().toLowerCase();
        bValue = bValue.toString().toLowerCase();
      }

      if (sortOrder === 'asc') {
        return aValue > bValue ? 1 : -1;
      } else {
        return aValue < bValue ? 1 : -1;
      }
    });

    // Reassign serial numbers after filtering and sorting
    return filtered.map((item, index) => ({
      ...item,
      slNo: index + 1
    }));
  }, [transformedTasks, searchQuery, filterCategory, filterStatus, completedTasks, sortBy, sortOrder]);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, filterCategory, filterStatus]);

  // Calculate pagination
  const totalPages = Math.ceil(filteredAndSortedData.length / itemsPerPage);
  const indexOfLastItem = currentPage * itemsPerPage;
  const indexOfFirstItem = indexOfLastItem - itemsPerPage;
  const currentItems = filteredAndSortedData.slice(indexOfFirstItem, indexOfLastItem);

  // Pagination navigation functions
  const goToPreviousPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  };

  const goToNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, totalPages));
  };

  const goToPage = (pageNumber) => {
    setCurrentPage(Math.max(1, Math.min(pageNumber, totalPages)));
  };

  const handleSort = (column) => {
    if (sortBy === column) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(column);
      setSortOrder('asc');
    }
  };

  const exportToCSV = () => {
    // Create CSV content
    const headers = ['Sl No.', 'Product', 'ASIN', 'Error Category', 'Error', 'How To Solve', 'Status'];
    const csvContent = [
      headers.join(','),
      ...filteredAndSortedData.map(item => [
        item.slNo,
        `"${item.product.replace(/"/g, '""')}"`, // Escape quotes in product name
        item.asin,
        item.errorCategory,
        `"${item.error.replace(/"/g, '""')}"`, // Escape quotes in error message
        `"${item.howToSolve.replace(/"/g, '""')}"`, // Escape quotes in how to solve
        completedTasks.has(item.taskId) ? 'Completed' : 'Pending'
      ].join(','))
    ].join('\n');

    // Create and download file
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `tasks_export_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleTaskStatus = async (taskId) => {
    const isCurrentlyCompleted = completedTasks.has(taskId);
    const newStatus = isCurrentlyCompleted ? 'pending' : 'completed';
    
    // Optimistically update Redux state
    dispatch(updateTaskStatus({ taskId, status: newStatus }));
  };

  const refreshTasks = () => {
    if (!userData?.userId) return;
    dispatch(fetchTasks());
  };

  const getSeverityColor = (severity) => {
    switch (severity.toLowerCase()) {
      case 'high':
        return 'text-red-600 bg-red-50 border-red-200';
      case 'medium':
        return 'text-yellow-600 bg-yellow-50 border-yellow-200';
      case 'low':
        return 'text-green-600 bg-green-50 border-green-200';
      default:
        return 'text-gray-600 bg-gray-50 border-gray-200';
    }
  };

  // Get category color for error category badges (same as Overview page)
  const getCategoryColor = (category) => {
    switch (category?.toLowerCase()) {
      case 'ranking':
        return 'text-yellow-700 bg-yellow-50 border-yellow-200';
      case 'conversion':
        return 'text-red-700 bg-red-50 border-red-200';
      case 'inventory':
        return 'text-orange-700 bg-orange-50 border-orange-200';
      case 'account health':
        return 'text-blue-700 bg-blue-50 border-blue-200';
      case 'profitability':
        return 'text-green-700 bg-green-50 border-green-200';
      case 'sponsored ads':
        return 'text-indigo-700 bg-indigo-50 border-indigo-200';
      default:
        return 'text-gray-700 bg-gray-50 border-gray-200';
    }
  };

  // Get unique categories from tasks
  const categories = useMemo(() => {
    const uniqueCategories = [...new Set(tasks.map(task => task.errorCategory))];
    return ['all', ...uniqueCategories];
  }, [tasks]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50/50 overflow-x-hidden w-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="text-gray-600">Loading tasks...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50/50 overflow-x-hidden w-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <AlertTriangle className="w-12 h-12 text-red-500" />
          <p className="text-red-600">{error}</p>
          <button 
            onClick={refreshTasks}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50/50 overflow-x-hidden w-full">
      {/* Header Section */}
      <div className='bg-white border-b border-gray-200/80 sticky top-0 z-40 w-full'>
        <div className='px-4 lg:px-6 py-4 w-full'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 w-full'>
            <div className='flex items-center gap-4 min-w-0'>
              <div className='min-w-0 flex-1'>
                <h1 className='text-2xl font-bold text-gray-900'>Tasks</h1>
                <p className='text-sm text-gray-600 mt-1'>Manage and track issues across your Amazon catalog</p>
              </div>
              <div className='hidden sm:flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium flex-shrink-0'>
                <AlertTriangle className='w-2 h-2' />
                {filterStatus === 'all' ? 'All tasks' : filterStatus === 'completed' ? 'Completed tasks' : 'Pending tasks'}
                                 {filterStatus === 'all' && (
                   <>
                     <span className='ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded-full'>
                       {filteredAndSortedData.filter(item => completedTasks.has(item.taskId)).length} completed
                     </span>
                     <span className='ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full'>
                       {filteredAndSortedData.filter(item => !completedTasks.has(item.taskId)).length} pending
                     </span>
                   </>
                 )}
                {filterStatus !== 'all' && (
                  <span className='ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full'>
                    {filteredAndSortedData.length} {filterStatus === 'completed' ? 'completed' : 'pending'}
                  </span>
                )}
              </div>
            </div>
            
            <div className='flex items-center gap-3 flex-shrink-0'>
              {/* Export Button */}
              <button 
                onClick={exportToCSV}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 shadow-sm hover:shadow text-sm font-medium text-gray-700"
              >
                <Download className="w-4 h-4" />
                Export as CSV
              </button>
              
              {/* Refresh Button */}
              <button 
                onClick={refreshTasks}
                disabled={loading}
                className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 shadow-sm hover:shadow text-sm font-medium text-gray-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Filters and Search Section */}
      <div className='bg-white border-b border-gray-200/80 w-full'>
        <div className='px-4 lg:px-6 py-4 w-full'>
          <div className='flex flex-col sm:flex-row gap-4 w-full'>
            {/* Search */}
            <div className='flex-1 min-w-0'>
              <div className='relative'>
                <Search className='absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400' />
                <input
                  type='text'
                  placeholder='Search tasks...'
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className='w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
                />
              </div>
            </div>

            {/* Category Filter */}
            <div className='sm:w-48 flex-shrink-0'>
              <select
                value={filterCategory}
                onChange={(e) => setFilterCategory(e.target.value)}
                className='w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              >
                {categories.map(category => (
                  <option key={category} value={category}>
                    {category === 'all' ? 'All Categories' : category}
                  </option>
                ))}
              </select>
            </div>

            {/* Status Filter */}
            <div className='sm:w-40 flex-shrink-0'>
              <select
                value={filterStatus}
                onChange={(e) => setFilterStatus(e.target.value)}
                className='w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent'
              >
                <option value="all">All Tasks</option>
                <option value="pending">Pending Only</option>
                <option value="completed">Completed Only</option>
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* Table Section */}
      <div className='px-4 lg:px-6 py-6 w-full'>
        <div className='bg-white rounded-xl shadow-sm border border-gray-200'>
          {/* Google Sheets-like Table */}
          <div className='w-full'>
            <table className='w-full'>
              <thead className='bg-gray-50 border-b border-gray-200'>
                <tr>
                  <th 
                    className='px-4 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors w-[60px]'
                    onClick={() => handleSort('slNo')}
                  >
                    <div className='flex items-center gap-2'>
                      Sl No.
                      {sortBy === 'slNo' && (
                        sortOrder === 'asc' ? 
                        <TrendingUp className='w-3 h-3' /> : 
                        <TrendingDown className='w-3 h-3' />
                      )}
                    </div>
                  </th>
                  <th 
                    className='px-4 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors min-w-[200px] max-w-[350px]'
                    onClick={() => handleSort('product')}
                  >
                    <div className='flex items-center gap-2'>
                      Product
                      {sortBy === 'product' && (
                        sortOrder === 'asc' ? 
                        <TrendingUp className='w-3 h-3' /> : 
                        <TrendingDown className='w-3 h-3' />
                      )}
                    </div>
                  </th>
                  <th 
                    className='px-4 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors min-w-[130px]'
                    onClick={() => handleSort('asin')}
                  >
                    <div className='flex items-center gap-2'>
                      ASIN/SKU
                      {sortBy === 'asin' && (
                        sortOrder === 'asc' ? 
                        <TrendingUp className='w-3 h-3' /> : 
                        <TrendingDown className='w-3 h-3' />
                      )}
                    </div>
                  </th>
                  <th 
                    className='px-4 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors w-[110px]'
                    onClick={() => handleSort('errorCategory')}
                  >
                    <div className='flex items-center gap-2'>
                      Error Category
                      {sortBy === 'errorCategory' && (
                        sortOrder === 'asc' ? 
                        <TrendingUp className='w-3 h-3' /> : 
                        <TrendingDown className='w-3 h-3' />
                      )}
                    </div>
                  </th>
                  <th 
                    className='px-4 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors'
                    onClick={() => handleSort('error')}
                  >
                    <div className='flex items-center gap-2'>
                      Error
                      {sortBy === 'error' && (
                        sortOrder === 'asc' ? 
                        <TrendingUp className='w-3 h-3' /> : 
                        <TrendingDown className='w-3 h-3' />
                      )}
                    </div>
                  </th>
                  <th className='px-4 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'>
                    How To Solve
                  </th>
                  <th className='px-4 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider w-[100px]'>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody className='bg-white divide-y divide-gray-200'>
                {currentItems.length > 0 ? (
                  currentItems.map((item, index) => (
                    <motion.tr
                      key={item.taskId}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className='hover:bg-gray-50 transition-colors'
                    >
                      <td className='px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 w-[60px]'>
                        {item.slNo}
                      </td>
                      <td className='px-4 py-4 text-sm text-gray-900 min-w-[200px] max-w-[350px]'>
                        <div className='whitespace-normal break-words leading-relaxed' title={item.product}>
                          {item.product}
                        </div>
                      </td>
                      <td className='px-4 py-4 text-sm text-gray-900 min-w-[130px]'>
                        <div className='space-y-1'>
                          <div className='flex items-center gap-1'>
                            <span className='text-xs text-gray-500 font-medium'>ASIN:</span>
                            <span className='font-mono text-gray-900'>{item.asin}</span>
                          </div>
                          {item.sku && (
                            <div className='flex items-center gap-1'>
                              <span className='text-xs text-gray-500 font-medium'>SKU:</span>
                              <span className='font-mono text-gray-700 text-xs'>{item.sku}</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className='px-4 py-4 whitespace-nowrap w-[110px]'>
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getCategoryColor(item.errorCategory)}`}>
                          {item.errorCategory}
                        </span>
                      </td>
                      <td className='px-4 py-4 text-sm text-gray-900'>
                        <div>
                          <p className='whitespace-normal'>
                            <FormattedMessage message={item.error} errorCategory={item.errorCategory} />
                          </p>
                        </div>
                      </td>
                      <td className='px-4 py-4 text-sm text-gray-900'>
                        <div>
                          <FormattedHowToSolve text={item.howToSolve} />
                        </div>
                      </td>
                                             <td className='px-4 py-4 whitespace-nowrap w-[100px]'>
                         <div className='flex items-center gap-2'>
                           <input
                             type="checkbox"
                             checked={completedTasks.has(item.taskId)}
                             onChange={() => toggleTaskStatus(item.taskId)}
                             className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 focus:ring-2 cursor-pointer"
                           />
                           <span className={`text-xs font-medium ${
                             completedTasks.has(item.taskId)
                               ? 'text-green-600'
                               : 'text-yellow-600'
                           }`}>
                             {completedTasks.has(item.taskId) ? 'Completed' : 'Pending'}
                           </span>
                         </div>
                       </td>
                    </motion.tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" className='px-4 py-12 text-center'>
                      <div className='flex flex-col items-center gap-3'>
                        <AlertTriangle className='w-12 h-12 text-gray-400' />
                        <div>
                          <h3 className='text-lg font-medium text-gray-900'>No tasks found</h3>
                          <p className='text-sm text-gray-500 mt-1'>
                            {searchQuery || filterCategory !== 'all' 
                              ? 'Try adjusting your search or filter criteria' 
                              : 'No issues detected in your account'
                            }
                          </p>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Pagination Controls */}
          {filteredAndSortedData.length > 0 && (
            <div className="flex items-center justify-between px-4 py-4 bg-gray-50 border-t border-gray-200">
              <div className="flex items-center gap-2">
                <span className="text-sm text-gray-700">
                  Showing {filteredAndSortedData.length > 0 ? indexOfFirstItem + 1 : 0} to {Math.min(indexOfLastItem, filteredAndSortedData.length)} of {filteredAndSortedData.length} tasks
                </span>
              </div>
              
              <div className="flex items-center gap-3">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={goToPreviousPage}
                  disabled={currentPage === 1}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                    currentPage === 1
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                      : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 shadow-sm hover:shadow-md'
                  }`}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                  <span className="text-sm font-medium">Previous</span>
                </motion.button>
                
                <div className="flex items-center gap-2">
                  <span className="px-4 py-2 text-sm font-medium text-gray-700 bg-blue-50 border border-blue-200 rounded-lg">
                    {currentPage} of {totalPages || 1}
                  </span>
                </div>
                
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages || totalPages === 0}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg transition-all duration-200 ${
                    currentPage === totalPages || totalPages === 0
                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                      : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 shadow-sm hover:shadow-md'
                  }`}
                  aria-label="Next page"
                >
                  <span className="text-sm font-medium">Next</span>
                  <ChevronRight className="w-4 h-4" />
                </motion.button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
