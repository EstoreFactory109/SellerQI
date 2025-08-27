import React, { useState, useMemo } from "react";
import { useSelector } from 'react-redux';
import { motion } from "framer-motion";
import { 
  AlertTriangle, 
  Search, 
  Filter,
  Download,
  RefreshCw,
  TrendingUp,
  TrendingDown
} from 'lucide-react';

export default function Tasks() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('slNo');
  const [sortOrder, setSortOrder] = useState('asc');
  const [completedTasks, setCompletedTasks] = useState(new Set());

  // Get error data from Redux store
  const profitabilityErrors = useSelector(state => state.errors.profitabilityErrors);
  const sponsoredAdsErrors = useSelector(state => state.errors.sponsoredAdsErrors);
  
  // Get additional data from Dashboard store for product names and details
  const dashboardInfo = useSelector(state => state.Dashboard.DashBoardInfo);
  const totalProducts = useSelector(state => state.Dashboard.DashBoardInfo?.TotalProduct) || [];
  const profitibilityData = useSelector(state => state.Dashboard.DashBoardInfo?.profitibilityData) || [];
  const productWiseSponsoredAds = useSelector(state => state.Dashboard.DashBoardInfo?.ProductWiseSponsoredAds) || [];
  
  // Get all error categories from Dashboard store
  const rankingProductWiseErrors = useSelector(state => state.Dashboard.DashBoardInfo?.rankingProductWiseErrors) || [];
  const conversionProductWiseErrors = useSelector(state => state.Dashboard.DashBoardInfo?.conversionProductWiseErrors) || [];
  const inventoryProductWiseErrors = useSelector(state => state.Dashboard.DashBoardInfo?.inventoryProductWiseErrors) || [];
  const accountErrors = useSelector(state => state.Dashboard.DashBoardInfo?.AccountErrors) || {};
  const productWiseError = useSelector(state => state.Dashboard.DashBoardInfo?.productWiseError) || [];

  // Create a map of ASIN to product details for quick lookup
  const productDetailsMap = useMemo(() => {
    const map = new Map();
    totalProducts.forEach(product => {
      map.set(product.asin, product);
    });
    return map;
  }, [totalProducts]);

  // Combine all error data
  const allErrors = useMemo(() => {
    const combined = [];
    let slNo = 1;

    // Add profitability errors
    if (profitabilityErrors.errorDetails && profitabilityErrors.errorDetails.length > 0) {
      profitabilityErrors.errorDetails.forEach(error => {
        const productDetails = productDetailsMap.get(error.asin);
        const productName = productDetails?.itemName || productDetails?.title || `Product ${error.asin}`;
        
        // Generate error message based on error type
        let errorMessage = '';
        let howToSolve = '';
        let severity = 'medium';
        
        if (error.errorType === 'negative_profit') {
          errorMessage = `Negative profit margin: $${error.netProfit?.toFixed(2) || 0} net profit on $${error.sales?.toFixed(2) || 0} sales`;
          howToSolve = 'Review pricing strategy, reduce costs, or consider discontinuing the product';
          severity = 'high';
        } else if (error.errorType === 'low_margin') {
          const margin = error.profitMargin?.toFixed(1) || 0;
          errorMessage = `Low profit margin: ${margin}% margin on $${error.sales?.toFixed(2) || 0} sales`;
          howToSolve = 'Optimize pricing, reduce ad spend, or negotiate better supplier costs';
          severity = 'medium';
        }
        
        combined.push({
          slNo: slNo++,
          product: productName,
          asin: error.asin || 'N/A',
          errorCategory: 'Profitability',
          error: errorMessage,
          howToSolve: howToSolve,
          severity: severity,
          status: 'pending',
          sales: error.sales,
          netProfit: error.netProfit,
          profitMargin: error.profitMargin,
          errorCount: 1
        });
      });
    }

    // Add sponsored ads errors
    if (sponsoredAdsErrors.errorDetails && sponsoredAdsErrors.errorDetails.length > 0) {
      sponsoredAdsErrors.errorDetails.forEach(error => {
        const productDetails = productDetailsMap.get(error.asin);
        const productName = productDetails?.itemName || productDetails?.title || `Product ${error.asin}`;
        
        // Generate error message based on error type
        let errorMessage = '';
        let howToSolve = '';
        let severity = 'medium';
        
        if (error.errorType === 'high_acos') {
          const acos = error.acos?.toFixed(1) || 0;
          errorMessage = `High ACoS: ${acos}% ($${error.spend?.toFixed(2) || 0} spend, $${error.sales?.toFixed(2) || 0} sales)`;
          howToSolve = 'Reduce bid amounts, optimize keyword targeting, or pause underperforming campaigns';
          severity = 'high';
        } else if (error.errorType === 'no_sales_high_spend') {
          errorMessage = `No sales with high spend: $${error.spend?.toFixed(2) || 0} spent with $${error.sales?.toFixed(2) || 0} sales`;
          howToSolve = 'Review targeting, pause campaigns, or improve product listing quality';
          severity = 'high';
        } else if (error.errorType === 'marginal_profit') {
          const acos = error.acos?.toFixed(1) || 0;
          errorMessage = `Marginal profitability: ${acos}% ACoS with $${error.spend?.toFixed(2) || 0} spend`;
          howToSolve = 'Optimize bids, improve conversion rate, or adjust targeting strategy';
          severity = 'medium';
        }
        
        combined.push({
          slNo: slNo++,
          product: productName,
          asin: error.asin || 'N/A',
          errorCategory: 'Sponsored Ads',
          error: errorMessage,
          howToSolve: howToSolve,
          severity: severity,
          status: 'pending',
          spend: error.spend,
          sales: error.sales,
          acos: error.acos,
          errorCount: 1
        });
      });
    }

    // Add ranking errors
    rankingProductWiseErrors.forEach(error => {
      if (error && error.asin) {
        const productDetails = productDetailsMap.get(error.asin);
        const productName = productDetails?.itemName || productDetails?.title || error.data?.Title || `Product ${error.asin}`;
        
        // Check for specific ranking error types
        const errorTypes = [];
        if (error.data?.charLim?.status === "Error") {
          errorTypes.push("Character limit exceeded");
        }
        if (error.data?.dublicateWords === "Error") {
          errorTypes.push("Duplicate words detected");
        }
        if (error.data?.TotalErrors > 0) {
          errorTypes.push(`${error.data.TotalErrors} ranking issues`);
        }
        
        if (errorTypes.length > 0) {
          const errorMessage = `Ranking issues: ${errorTypes.join(', ')}`;
          const howToSolve = 'Optimize product title, remove duplicate words, and ensure character limits are within guidelines';
          
          combined.push({
            slNo: slNo++,
            product: productName,
            asin: error.asin,
            errorCategory: 'Ranking',
            error: errorMessage,
            howToSolve: howToSolve,
            severity: 'medium',
            status: 'pending',
            sales: 0,
            errorCount: errorTypes.length
          });
        }
      }
    });

    // Add conversion errors
    conversionProductWiseErrors.forEach(error => {
      if (error && error.asin) {
        const productDetails = productDetailsMap.get(error.asin);
        const productName = productDetails?.itemName || productDetails?.title || `Product ${error.asin}`;
        
        // Check for specific conversion error types
        const errorTypes = [];
        if (error.aplusErrorData?.status === "Error") {
          errorTypes.push("A+ Content issues");
        }
        if (error.imageResultErrorData?.status === "Error") {
          errorTypes.push("Image quality issues");
        }
        if (error.videoResultErrorData?.status === "Error") {
          errorTypes.push("Video content issues");
        }
        if (error.productReviewResultErrorData?.status === "Error") {
          errorTypes.push("Product review issues");
        }
        if (error.productStarRatingResultErrorData?.status === "Error") {
          errorTypes.push("Star rating issues");
        }
        if (error.productsWithOutBuyboxErrorData?.status === "Error") {
          errorTypes.push("Buy Box eligibility issues");
        }
        
        if (errorTypes.length > 0) {
          const errorMessage = `Conversion issues: ${errorTypes.join(', ')}`;
          const howToSolve = 'Improve product images, add A+ content, optimize reviews, and ensure Buy Box eligibility';
          
          combined.push({
            slNo: slNo++,
            product: productName,
            asin: error.asin,
            errorCategory: 'Conversion',
            error: errorMessage,
            howToSolve: howToSolve,
            severity: 'medium',
            status: 'pending',
            sales: 0,
            errorCount: errorTypes.length
          });
        }
      }
    });

    // Add inventory errors
    inventoryProductWiseErrors.forEach(error => {
      if (error && error.asin) {
        const productDetails = productDetailsMap.get(error.asin);
        const productName = productDetails?.itemName || productDetails?.title || `Product ${error.asin}`;
        
        // Check for specific inventory error types
        const errorTypes = [];
        if (error.inventoryPlanningErrorData) {
          errorTypes.push("Inventory planning issues");
        }
        if (error.strandedInventoryErrorData) {
          errorTypes.push("Stranded inventory");
        }
        if (error.inboundNonComplianceErrorData) {
          errorTypes.push("Inbound compliance issues");
        }
        if (error.replenishmentErrorData?.status === "Error") {
          errorTypes.push("Replenishment issues");
        }
        
        if (errorTypes.length > 0) {
          const errorMessage = `Inventory issues: ${errorTypes.join(', ')}`;
          const howToSolve = 'Review inventory levels, resolve stranded inventory, and ensure compliance with Amazon policies';
          
          combined.push({
            slNo: slNo++,
            product: productName,
            asin: error.asin,
            errorCategory: 'Inventory',
            error: errorMessage,
            howToSolve: howToSolve,
            severity: 'high',
            status: 'pending',
            sales: 0,
            errorCount: errorTypes.length
          });
        }
      }
    });

    // Add account-level errors
    if (accountErrors && Object.keys(accountErrors).length > 0) {
      Object.entries(accountErrors).forEach(([key, value]) => {
        if (value && typeof value === 'object' && value.status === "Error") {
          const errorMessage = `Account issue: ${key.replace(/([A-Z])/g, ' $1').toLowerCase()}`;
          const howToSolve = 'Review account health metrics and address any policy violations or performance issues';
          
          combined.push({
            slNo: slNo++,
            product: 'Account Level',
            asin: 'N/A',
            errorCategory: 'Account Health',
            error: errorMessage,
            howToSolve: howToSolve,
            severity: 'high',
            status: 'pending',
            sales: 0,
            errorCount: 1
          });
        }
      });
    }

    return combined;
  }, [profitabilityErrors, sponsoredAdsErrors, rankingProductWiseErrors, conversionProductWiseErrors, inventoryProductWiseErrors, accountErrors, productDetailsMap]);

  // Filter and sort data
  const filteredAndSortedData = useMemo(() => {
    let filtered = allErrors;

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
      filtered = filtered.filter(item => item.errorCategory === filterCategory);
    }

    // Apply status filter
    if (filterStatus !== 'all') {
      filtered = filtered.filter(item => {
        const isCompleted = completedTasks.has(item.slNo);
        if (filterStatus === 'completed') {
          return isCompleted;
        } else if (filterStatus === 'pending') {
          return !isCompleted;
        }
        return true;
      });
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

    return filtered;
  }, [allErrors, searchQuery, filterCategory, filterStatus, completedTasks, sortBy, sortOrder]);

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
        completedTasks.has(item.slNo) ? 'Completed' : 'Pending'
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

  const toggleTaskStatus = (slNo) => {
    setCompletedTasks(prev => {
      const newSet = new Set(prev);
      if (newSet.has(slNo)) {
        newSet.delete(slNo);
      } else {
        newSet.add(slNo);
      }
      return newSet;
    });
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



  const categories = ['all', 'Profitability', 'Sponsored Ads', 'Ranking', 'Conversion', 'Inventory', 'Account Health'];

  return (
    <div className="min-h-screen bg-gray-50/50 lg:mt-0 mt-[12vh] overflow-x-hidden w-full">
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
                   {filteredAndSortedData.length} filtered issues
                   <span className='ml-2 px-2 py-0.5 bg-red-100 text-red-700 rounded-full'>
                     {filteredAndSortedData.reduce((sum, item) => sum + (item.errorCount || 1), 0)} errors
                   </span>
                   <span className='ml-2 px-2 py-0.5 bg-green-100 text-green-700 rounded-full'>
                     {filteredAndSortedData.filter(item => completedTasks.has(item.slNo)).length} completed
                   </span>
                   <span className='ml-2 px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full'>
                     {filteredAndSortedData.filter(item => !completedTasks.has(item.slNo)).length} pending
                   </span>
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
              <button className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 rounded-lg hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 transition-all duration-200 shadow-sm hover:shadow text-sm font-medium text-gray-700">
                <RefreshCw className="w-4 h-4" />
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
                 <option value="all">All Status</option>
                 <option value="pending">Pending</option>
                 <option value="completed">Completed</option>
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
                     className='px-4 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors w-[150px]'
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
                     className='px-4 py-4 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:bg-gray-100 transition-colors w-[90px]'
                     onClick={() => handleSort('asin')}
                   >
                     <div className='flex items-center gap-2'>
                       ASIN
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
                {filteredAndSortedData.length > 0 ? (
                  filteredAndSortedData.map((item, index) => (
                                         <motion.tr
                       key={item.slNo}
                       initial={{ opacity: 0, y: 20 }}
                       animate={{ opacity: 1, y: 0 }}
                       transition={{ delay: index * 0.05 }}
                       className='hover:bg-gray-50 transition-colors'
                     >
                                             <td className='px-4 py-4 whitespace-nowrap text-sm font-medium text-gray-900 w-[60px]'>
                         {item.slNo}
                       </td>
                                             <td className='px-4 py-4 whitespace-nowrap text-sm text-gray-900 w-[150px]'>
                         <div className='truncate' title={item.product}>
                           {item.product.length > 20 ? `${item.product.substring(0, 20)}...` : item.product}
                         </div>
                       </td>
                                             <td className='px-4 py-4 whitespace-nowrap text-sm text-gray-900 font-mono w-[90px]'>
                         {item.asin}
                       </td>
                                             <td className='px-4 py-4 whitespace-nowrap w-[110px]'>
                         <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${getSeverityColor(item.severity)}`}>
                           {item.errorCategory}
                         </span>
                       </td>
                                             <td className='px-4 py-4 text-sm text-gray-900'>
                         <div>
                           <p className='whitespace-normal'>{item.error}</p>
                         </div>
                       </td>
                                             <td className='px-4 py-4 text-sm text-gray-900'>
                         <div>
                           <p className='whitespace-normal'>{item.howToSolve}</p>
                         </div>
                       </td>
                                             <td className='px-4 py-4 whitespace-nowrap w-[100px]'>
                         <button
                           onClick={() => toggleTaskStatus(item.slNo)}
                           className={`inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium border transition-all duration-200 cursor-pointer ${
                             completedTasks.has(item.slNo)
                               ? 'bg-green-100 text-green-800 border-green-300 hover:bg-green-200'
                               : 'bg-yellow-100 text-yellow-800 border-yellow-300 hover:bg-yellow-200'
                           }`}
                         >
                           {completedTasks.has(item.slNo) ? 'Completed' : 'Pending'}
                         </button>
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
        </div>
      </div>
    </div>
  );
}
