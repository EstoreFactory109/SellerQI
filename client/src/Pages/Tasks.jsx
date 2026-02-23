import React, { useState, useMemo, useEffect } from "react";
import { useSelector, useDispatch } from 'react-redux';
import { motion } from "framer-motion";
import { 
  AlertTriangle, 
  Search, 
  Download,
  RefreshCw,
  TrendingUp,
  TrendingDown,
  ChevronLeft,
  ChevronRight,
  Info
} from 'lucide-react';
import { fetchTasks, updateTaskStatus } from '../redux/slices/TasksSlice.js';
import { TasksPageSkeleton } from '../Components/Skeleton/PageSkeletons.jsx';

// Helper function to escape special regex characters in currency symbol
const escapeRegex = (str) => {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
};

// Common currency symbols to detect in messages
// Order matters: longer symbols first to avoid partial matches (e.g., "C$" before "$")
const CURRENCY_SYMBOLS = ['C$', 'A$', 'S$', 'R$', 'MX$', 'E£', 'AED', 'SAR', 'د.إ', '﷼', '$', '€', '£', '¥', '₹', '₺', 'kr', 'zł'];

// Helper function to detect and convert currency in a message
const convertCurrencyInMessage = (message, targetCurrency = '$') => {
  if (!message) return message;
  
  let convertedMessage = message;
  
  // Replace each currency symbol with the target currency
  // Process longer symbols first to avoid partial matches
  CURRENCY_SYMBOLS.forEach(originalSymbol => {
    if (originalSymbol === targetCurrency) return; // Skip if already the target currency
    
    const escapedSymbol = escapeRegex(originalSymbol);
    
    // Pattern to match: currency symbol + optional negative + number (with commas/decimals)
    // Examples: $123.45, -$123.45, $1,234.56, €100, £50.00, C$100.00
    const pattern = new RegExp(`${escapedSymbol}(-?[\\d,.]+)`, 'g');
    
    convertedMessage = convertedMessage.replace(pattern, (match, numberPart) => {
      // Keep the number part, just replace the currency symbol
      return `${targetCurrency}${numberPart}`;
    });
  });
  
  return convertedMessage;
};

// Helper function to format messages with important details highlighted on separate line
const formatMessageWithHighlight = (message, currency = '$') => {
  if (!message) return { mainText: '', highlightedText: '' };
  
  // First, convert any currency in the message to the target currency
  const convertedMessage = convertCurrencyInMessage(message, currency);
  
  // Escape currency symbol for use in regex
  const escapedCurrency = escapeRegex(currency);
  
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
    
    // Profitability patterns - using dynamic currency (after conversion)
    new RegExp(`^(.*?)(Revenue:\\s*${escapedCurrency}[\\d,.]+.*)$`, 'i'),
    new RegExp(`^(.*?)(Net Profit:\\s*-?${escapedCurrency}[\\d,.]+.*)$`, 'i'),
    new RegExp(`^(.*?)(Total Costs:\\s*${escapedCurrency}[\\d,.]+.*)$`, 'i'),
    
    // PPC/Sponsored Ads patterns - match complete parenthetical expressions first (most specific)
    new RegExp(`^(.*?)(\\([^)]*Spend:\\s*${escapedCurrency}[\\d,.]+[^)]*\\))`, 'i'),  // Match complete (Spend: ...) with brackets
    new RegExp(`^(.*?)(\\([^)]*Sales:\\s*${escapedCurrency}[\\d,.]+[^)]*\\))`, 'i'),  // Match complete (Sales: ...) with brackets
    /^(.*?)(\([^)]*ACOS:\s*[\d.]+%[^)]*\))/i,  // Match complete (ACOS: ...) with brackets
    new RegExp(`^(.*?)(\\([^)]*Spend:\\s*${escapedCurrency}[\\d,.]+[^)]*Sales:\\s*${escapedCurrency}[\\d,.]+[^)]*\\))`, 'i'),  // Match (Spend: ... Sales: ...) together
    new RegExp(`^(.*?)(Spend:\\s*${escapedCurrency}[\\d,.]+(?:\\s*,\\s*Sales:\\s*${escapedCurrency}[\\d,.]+)?[^.)]*)`, 'i'),  // Fallback for Spend without brackets (stop at period or closing paren)
    new RegExp(`^(.*?)(Sales:\\s*${escapedCurrency}[\\d,.]+[^.)]*)`, 'i'),  // Fallback for Sales without brackets
    /^(.*?)(ACOS:\s*[\d.]+%[^.(]*)/i,  // Fallback for ACOS without brackets (stop before opening paren or period)
    /^(.*?)(\d+ clicks from \d+ impressions.*)$/i,
  ];
  
  for (const pattern of patterns) {
    const match = convertedMessage.match(pattern);
    if (match && match[2]) {
      return {
        mainText: match[1].trim(),
        highlightedText: match[2].trim()
      };
    }
  }
  
  return { mainText: convertedMessage, highlightedText: '' };
};

// Component to render message with highlighted part
const FormattedMessage = ({ message, errorCategory, currency }) => {
  const { mainText, highlightedText } = formatMessageWithHighlight(message, currency);
  
  // Don't make bold for profitability and sponsored ads errors
  const shouldBold = errorCategory?.toLowerCase() !== 'profitability' && 
                     errorCategory?.toLowerCase() !== 'sponsoredads' &&
                     errorCategory?.toLowerCase() !== 'sponsored ads';
  
  return (
    <>
      {mainText && <span style={{ color: '#f3f4f6' }}>{mainText}</span>}
      {highlightedText && (
        <>
          <br />
          {shouldBold ? (
            <strong className="mt-1 block" style={{ color: '#f3f4f6' }}>{highlightedText}</strong>
          ) : (
            <span className="mt-1 block" style={{ color: '#f3f4f6' }}>{highlightedText}</span>
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
  const taskRenewalDate = useSelector(state => state.tasks?.taskRenewalDate);
  const loading = useSelector(state => state.tasks?.loading || false);
  const error = useSelector(state => state.tasks?.error);
  const completedTasksArray = useSelector(state => state.tasks?.completedTasks || []);
  
  // Convert array to Set for easier checking
  const completedTasks = useMemo(() => new Set(completedTasksArray), [completedTasksArray]);

  // Get user data from Redux store
  const userData = useSelector(state => state.Auth?.user);
  
  // Get currency from Redux store
  const currency = useSelector(state => state.currency?.currency) || '$';
  
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
        return { color: '#f87171', background: 'rgba(239, 68, 68, 0.2)', border: 'rgba(239, 68, 68, 0.3)' };
      case 'medium':
        return { color: '#fbbf24', background: 'rgba(251, 191, 36, 0.2)', border: 'rgba(251, 191, 36, 0.3)' };
      case 'low':
        return { color: '#22c55e', background: 'rgba(34, 197, 94, 0.2)', border: 'rgba(34, 197, 94, 0.3)' };
      default:
        return { color: '#9ca3af', background: 'rgba(156, 163, 175, 0.2)', border: 'rgba(156, 163, 175, 0.3)' };
    }
  };

  // Get category color for error category badges (same as Overview page)
  const getCategoryColor = (category) => {
    switch (category?.toLowerCase()) {
      case 'ranking':
        return { color: '#fbbf24', background: 'rgba(251, 191, 36, 0.2)', border: 'rgba(251, 191, 36, 0.3)' };
      case 'conversion':
        return { color: '#f87171', background: 'rgba(239, 68, 68, 0.2)', border: 'rgba(239, 68, 68, 0.3)' };
      case 'inventory':
        return { color: '#fb923c', background: 'rgba(251, 146, 60, 0.2)', border: 'rgba(251, 146, 60, 0.3)' };
      case 'account health':
        return { color: '#60a5fa', background: 'rgba(96, 165, 250, 0.2)', border: 'rgba(96, 165, 250, 0.3)' };
      case 'profitability':
        return { color: '#22c55e', background: 'rgba(34, 197, 94, 0.2)', border: 'rgba(34, 197, 94, 0.3)' };
      case 'sponsored ads':
        return { color: '#c084fc', background: 'rgba(192, 132, 252, 0.2)', border: 'rgba(192, 132, 252, 0.3)' };
      default:
        return { color: '#9ca3af', background: 'rgba(156, 163, 175, 0.2)', border: 'rgba(156, 163, 175, 0.3)' };
    }
  };

  // Get unique categories from tasks
  const categories = useMemo(() => {
    const uniqueCategories = [...new Set(tasks.map(task => task.errorCategory))];
    return ['all', ...uniqueCategories];
  }, [tasks]);

  if (loading) {
    return <TasksPageSkeleton rows={10} />;
  }

  if (error) {
    return (
      <div className="min-h-screen overflow-x-hidden w-full flex items-center justify-center" style={{ background: '#1a1a1a' }}>
        <div className="flex flex-col items-center gap-2">
          <AlertTriangle className="w-6 h-6" style={{ color: '#f87171' }} />
          <p className="text-xs" style={{ color: '#f87171' }}>{error}</p>
          <button 
            onClick={refreshTasks}
            className="px-3 py-1.5 rounded-lg transition-all text-xs"
            style={{ background: '#3b82f6', color: 'white' }}
            onMouseEnter={(e) => e.target.style.background = '#2563eb'}
            onMouseLeave={(e) => e.target.style.background = '#3b82f6'}
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen overflow-x-hidden w-full" style={{ background: '#1a1a1a', padding: '10px', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif' }}>
      <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
      {/* Header Section */}
      <div className='sticky top-0 z-40 w-full' style={{ background: '#161b22', borderBottom: '1px solid #30363d', marginBottom: '10px', padding: '10px 15px', borderRadius: '6px', border: '1px solid #30363d' }}>
        <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 w-full'>
          <div className='flex items-center gap-2 min-w-0'>
            <AlertTriangle className='w-4 h-4 flex-shrink-0' style={{ color: '#fb923c' }} />
            <div className='min-w-0 flex-1'>
              <h1 className='text-base font-bold' style={{ color: '#f3f4f6' }}>Tasks</h1>
            </div>
            <div className='hidden sm:flex items-center gap-1.5 px-2 py-1 rounded text-[10px] font-medium flex-shrink-0' style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa' }}>
              {filterStatus === 'all' ? 'All tasks' : filterStatus === 'completed' ? 'Completed tasks' : 'Pending tasks'}
              {filterStatus === 'all' && (
                <>
                  <span className='ml-1.5 px-1.5 py-0.5 rounded text-[10px]' style={{ background: 'rgba(34, 197, 94, 0.2)', color: '#22c55e' }}>
                    {filteredAndSortedData.filter(item => completedTasks.has(item.taskId)).length} completed
                  </span>
                  <span className='ml-1.5 px-1.5 py-0.5 rounded text-[10px]' style={{ background: 'rgba(251, 191, 36, 0.2)', color: '#fbbf24' }}>
                    {filteredAndSortedData.filter(item => !completedTasks.has(item.taskId)).length} pending
                  </span>
                </>
              )}
              {filterStatus !== 'all' && (
                <span className='ml-1.5 px-1.5 py-0.5 rounded text-[10px]' style={{ background: 'rgba(251, 191, 36, 0.2)', color: '#fbbf24' }}>
                  {filteredAndSortedData.length} {filterStatus === 'completed' ? 'completed' : 'pending'}
                </span>
              )}
            </div>
          </div>
          
          <div className='flex items-center gap-2 flex-shrink-0'>
            {/* Export Button */}
            <button 
              onClick={exportToCSV}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-200 text-xs font-medium"
              style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
              onMouseEnter={(e) => e.target.style.borderColor = '#3b82f6'}
              onMouseLeave={(e) => e.target.style.borderColor = '#30363d'}
            >
              <Download className="w-3.5 h-3.5" />
              Export CSV
            </button>
            
            {/* Refresh Button */}
            <button 
              onClick={refreshTasks}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-200 text-xs font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
              onMouseEnter={(e) => !loading && (e.target.style.borderColor = '#3b82f6')}
              onMouseLeave={(e) => e.target.style.borderColor = '#30363d'}
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>
      </div>

      {/* Renew date tip - always visible (same style as Your Products page) */}
      <div className="bg-blue-500/10 border-l-4 border-blue-500/40 p-2 mb-2 rounded-r space-y-3">
        <div className="flex items-start gap-2">
          <Info className="text-blue-400 flex-shrink-0 mt-0.5" size={16} />
          <div>
            <h3 className="text-xs font-semibold text-blue-300 mb-0.5">Tasks renewal</h3>
            <p className="text-xs text-blue-400">
              {taskRenewalDate
                ? <>Tasks renew on <strong>{new Date(taskRenewalDate).toLocaleDateString(undefined, { dateStyle: 'long' })}</strong>.</>
                : 'Tasks are renewed periodically. The next renewal date will appear here once your tasks have been loaded.'}
            </p>
          </div>
        </div>
      </div>

      {/* Filters and Search Section */}
      <div className='w-full' style={{ background: '#161b22', borderRadius: '6px', border: '1px solid #30363d', marginBottom: '10px', padding: '8px 12px' }}>
        <div className='flex flex-col sm:flex-row gap-2 w-full'>
          {/* Search */}
          <div className='flex-1 min-w-0'>
            <div className='relative'>
              <Search className='absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5' style={{ color: '#6b7280' }} />
              <input
                type='text'
                placeholder='Search tasks...'
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className='w-full pl-8 pr-3 py-1.5 rounded-lg text-xs'
                style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
                onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                onBlur={(e) => e.target.style.borderColor = '#30363d'}
              />
            </div>
          </div>

          {/* Category Filter */}
          <div className='sm:w-40 flex-shrink-0'>
            <select
              value={filterCategory}
              onChange={(e) => setFilterCategory(e.target.value)}
              className='w-full px-2 py-1.5 rounded-lg text-xs'
              style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
              onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.target.style.borderColor = '#30363d'}
            >
              {categories.map(category => (
                <option key={category} value={category} style={{ background: '#21262d' }}>
                  {category === 'all' ? 'All Categories' : category}
                </option>
              ))}
            </select>
          </div>

          {/* Status Filter */}
          <div className='sm:w-36 flex-shrink-0'>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className='w-full px-2 py-1.5 rounded-lg text-xs'
              style={{ background: '#1a1a1a', border: '1px solid #30363d', color: '#f3f4f6' }}
              onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.target.style.borderColor = '#30363d'}
            >
              <option value="all" style={{ background: '#21262d' }}>All Tasks</option>
              <option value="pending" style={{ background: '#21262d' }}>Pending Only</option>
              <option value="completed" style={{ background: '#21262d' }}>Completed Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table Section */}
      <div className='w-full' style={{ marginBottom: '10px' }}>
        <div className='rounded-lg' style={{ background: '#161b22', border: '1px solid #30363d' }}>
          {/* Google Sheets-like Table */}
          <div className='w-full'>
            <table className='w-full'>
              <thead style={{ background: '#21262d', borderBottom: '1px solid #30363d' }}>
                <tr>
                  <th 
                    className='px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide cursor-pointer transition-colors w-[60px]'
                    onClick={() => handleSort('slNo')}
                    style={{ color: '#9ca3af' }}
                    onMouseEnter={(e) => e.target.style.color = '#d1d5db'}
                    onMouseLeave={(e) => e.target.style.color = '#9ca3af'}
                  >
                    <div className='flex items-center gap-1.5'>
                      Sl No.
                      {sortBy === 'slNo' && (
                        sortOrder === 'asc' ? 
                        <TrendingUp className='w-2.5 h-2.5' /> : 
                        <TrendingDown className='w-2.5 h-2.5' />
                      )}
                    </div>
                  </th>
                  <th 
                    className='px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide cursor-pointer transition-colors min-w-[200px] max-w-[350px]'
                    onClick={() => handleSort('product')}
                    style={{ color: '#9ca3af' }}
                    onMouseEnter={(e) => e.target.style.color = '#d1d5db'}
                    onMouseLeave={(e) => e.target.style.color = '#9ca3af'}
                  >
                    <div className='flex items-center gap-1.5'>
                      Product
                      {sortBy === 'product' && (
                        sortOrder === 'asc' ? 
                        <TrendingUp className='w-2.5 h-2.5' /> : 
                        <TrendingDown className='w-2.5 h-2.5' />
                      )}
                    </div>
                  </th>
                  <th 
                    className='px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide cursor-pointer transition-colors min-w-[130px]'
                    onClick={() => handleSort('asin')}
                    style={{ color: '#9ca3af' }}
                    onMouseEnter={(e) => e.target.style.color = '#d1d5db'}
                    onMouseLeave={(e) => e.target.style.color = '#9ca3af'}
                  >
                    <div className='flex items-center gap-1.5'>
                      ASIN/SKU
                      {sortBy === 'asin' && (
                        sortOrder === 'asc' ? 
                        <TrendingUp className='w-2.5 h-2.5' /> : 
                        <TrendingDown className='w-2.5 h-2.5' />
                      )}
                    </div>
                  </th>
                  <th 
                    className='px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide cursor-pointer transition-colors w-[110px]'
                    onClick={() => handleSort('errorCategory')}
                    style={{ color: '#9ca3af' }}
                    onMouseEnter={(e) => e.target.style.color = '#d1d5db'}
                    onMouseLeave={(e) => e.target.style.color = '#9ca3af'}
                  >
                    <div className='flex items-center gap-1.5'>
                      Error Category
                      {sortBy === 'errorCategory' && (
                        sortOrder === 'asc' ? 
                        <TrendingUp className='w-2.5 h-2.5' /> : 
                        <TrendingDown className='w-2.5 h-2.5' />
                      )}
                    </div>
                  </th>
                  <th 
                    className='px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide cursor-pointer transition-colors'
                    onClick={() => handleSort('error')}
                    style={{ color: '#9ca3af' }}
                    onMouseEnter={(e) => e.target.style.color = '#d1d5db'}
                    onMouseLeave={(e) => e.target.style.color = '#9ca3af'}
                  >
                    <div className='flex items-center gap-1.5'>
                      Error
                      {sortBy === 'error' && (
                        sortOrder === 'asc' ? 
                        <TrendingUp className='w-2.5 h-2.5' /> : 
                        <TrendingDown className='w-2.5 h-2.5' />
                      )}
                    </div>
                  </th>
                  <th className='px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide' style={{ color: '#9ca3af' }}>
                    How To Solve
                  </th>
                  <th className='px-2 py-2 text-left text-[10px] font-medium uppercase tracking-wide w-[100px]' style={{ color: '#9ca3af' }}>
                    Status
                  </th>
                </tr>
              </thead>
              <tbody>
                {currentItems.length > 0 ? (
                  currentItems.map((item, index) => (
                    <motion.tr
                      key={item.taskId}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.05 }}
                      className='transition-colors'
                      style={{ borderBottom: '1px solid #30363d' }}
                      onMouseEnter={(e) => e.currentTarget.style.background = '#21262d'}
                      onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}
                    >
                      <td className='px-2 py-2 whitespace-nowrap text-[11px] font-medium w-[60px]' style={{ color: '#f3f4f6' }}>
                        {item.slNo}
                      </td>
                      <td className='px-2 py-2 text-[11px] min-w-[200px] max-w-[350px]' style={{ color: '#f3f4f6' }}>
                        <div className='whitespace-normal break-words leading-relaxed' title={item.product}>
                          {item.product}
                        </div>
                      </td>
                      <td className='px-2 py-2 text-[11px] min-w-[130px]' style={{ color: '#f3f4f6' }}>
                        <div className='space-y-0.5'>
                          <div className='flex items-center gap-1'>
                            <span className='text-[10px] font-medium' style={{ color: '#9ca3af' }}>ASIN:</span>
                            <span className='font-mono' style={{ color: '#f3f4f6' }}>{item.asin}</span>
                          </div>
                          {item.sku && (
                            <div className='flex items-center gap-1'>
                              <span className='text-[10px] font-medium' style={{ color: '#9ca3af' }}>SKU:</span>
                              <span className='font-mono text-[10px]' style={{ color: '#9ca3af' }}>{item.sku}</span>
                            </div>
                          )}
                        </div>
                      </td>
                      <td className='px-2 py-2 whitespace-nowrap w-[110px]'>
                        {(() => {
                          const categoryStyle = getCategoryColor(item.errorCategory);
                          return (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium border" style={categoryStyle}>
                              {item.errorCategory}
                            </span>
                          );
                        })()}
                      </td>
                      <td className='px-2 py-2 text-[11px]' style={{ color: '#f3f4f6' }}>
                        <div>
                          <p className='whitespace-normal'>
                            <FormattedMessage message={item.error} errorCategory={item.errorCategory} currency={currency} />
                          </p>
                        </div>
                      </td>
                      <td className='px-2 py-2 text-[11px]' style={{ color: '#f3f4f6' }}>
                        <div>
                          <FormattedHowToSolve text={item.howToSolve} />
                        </div>
                      </td>
                                             <td className='px-2 py-2 whitespace-nowrap w-[100px]'>
                         <div className='flex items-center gap-1.5'>
                           <input
                             type="checkbox"
                             checked={completedTasks.has(item.taskId)}
                             onChange={() => toggleTaskStatus(item.taskId)}
                             className="w-3.5 h-3.5 rounded focus:ring-2 cursor-pointer"
                             style={{ accentColor: '#3b82f6', background: '#1a1a1a', border: '1px solid #30363d' }}
                           />
                           <span className={`text-[10px] font-medium ${
                             completedTasks.has(item.taskId)
                               ? 'text-green-400'
                               : 'text-yellow-400'
                           }`}>
                             {completedTasks.has(item.taskId) ? 'Completed' : 'Pending'}
                           </span>
                         </div>
                       </td>
                    </motion.tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan="7" className='px-4 py-8 text-center'>
                      <div className='flex flex-col items-center gap-2'>
                        <AlertTriangle className='w-6 h-6' style={{ color: '#6b7280' }} />
                        <div>
                          <h3 className='text-sm font-medium' style={{ color: '#f3f4f6' }}>No tasks found</h3>
                          <p className='text-xs mt-1' style={{ color: '#9ca3af' }}>
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
            <div className="flex items-center justify-between px-3 py-2 border-t" style={{ background: '#21262d', borderTop: '1px solid #30363d' }}>
              <div className="flex items-center gap-2">
                <span className="text-xs" style={{ color: '#9ca3af' }}>
                  Showing {filteredAndSortedData.length > 0 ? indexOfFirstItem + 1 : 0} to {Math.min(indexOfLastItem, filteredAndSortedData.length)} of {filteredAndSortedData.length} tasks
                </span>
              </div>
              
              <div className="flex items-center gap-2">
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={goToPreviousPage}
                  disabled={currentPage === 1}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-200 ${
                    currentPage === 1
                      ? 'cursor-not-allowed' 
                      : ''
                  }`}
                  style={currentPage === 1 ? { background: '#21262d', color: '#6b7280' } : { background: '#1a1a1a', color: '#f3f4f6', border: '1px solid #30363d' }}
                  onMouseEnter={(e) => currentPage !== 1 && (e.target.style.borderColor = '#3b82f6')}
                  onMouseLeave={(e) => currentPage !== 1 && (e.target.style.borderColor = '#30363d')}
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-3.5 h-3.5" />
                  <span className="text-xs font-medium">Previous</span>
                </motion.button>
                
                <div className="flex items-center gap-2">
                  <span className="px-2 py-1 text-xs font-medium rounded-lg" style={{ background: 'rgba(59, 130, 246, 0.2)', color: '#60a5fa', border: '1px solid rgba(59, 130, 246, 0.3)' }}>
                    {currentPage} of {totalPages || 1}
                  </span>
                </div>
                
                <motion.button
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.95 }}
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages || totalPages === 0}
                  className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg transition-all duration-200 ${
                    currentPage === totalPages || totalPages === 0
                      ? 'cursor-not-allowed' 
                      : ''
                  }`}
                  style={(currentPage === totalPages || totalPages === 0) ? { background: '#21262d', color: '#6b7280' } : { background: '#1a1a1a', color: '#f3f4f6', border: '1px solid #30363d' }}
                  onMouseEnter={(e) => (currentPage !== totalPages && totalPages !== 0) && (e.target.style.borderColor = '#3b82f6')}
                  onMouseLeave={(e) => (currentPage !== totalPages && totalPages !== 0) && (e.target.style.borderColor = '#30363d')}
                  aria-label="Next page"
                >
                  <span className="text-xs font-medium">Next</span>
                  <ChevronRight className="w-3.5 h-3.5" />
                </motion.button>
              </div>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
}
