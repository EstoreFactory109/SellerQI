import React, { useState, useMemo, useEffect } from "react";
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
import axios from 'axios';

export default function Tasks() {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterCategory, setFilterCategory] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortBy, setSortBy] = useState('taskId');
  const [sortOrder, setSortOrder] = useState('asc');
  const [completedTasks, setCompletedTasks] = useState(new Set());
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Get user data from Redux store
  const userData = useSelector(state => state.Auth?.user);

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

  // Fetch tasks data from API
  useEffect(() => {
    const fetchTasks = async () => {
      if (!userData?.userId) {
        setError('User ID not available');
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setError(null);
        
        const response = await axios.get(
          `${import.meta.env.VITE_CALCULATION_API_URI}/api/tasks/${userData.userId}`,
          { withCredentials: true }
        );

        if (response.status === 200 && response.data?.data) {
          setTasks(response.data.data);
        } else {
          setError('Failed to fetch tasks data');
        }
      } catch (err) {
        console.error('Error fetching tasks:', err);
        setError(err.response?.data?.message || 'Failed to fetch tasks');
      } finally {
        setLoading(false);
      }
    };

    fetchTasks();
  }, [userData?.userId]);

  // Transform API data to match table structure
  const transformedTasks = useMemo(() => {
    return tasks.map((task, index) => ({
      slNo: index + 1,
      taskId: task.taskId,
      product: task.productName,
      asin: task.asin,
      errorCategory: task.errorCategory,
      error: task.error,
      howToSolve: task.solution,
      severity: getSeverityFromCategory(task.errorCategory),
      status: task.status,
      sales: 0,
      errorCount: 1
    }));
  }, [tasks]);

  // Initialize completedTasks based on API data when tasks are loaded
  useEffect(() => {
    const completedTaskIds = new Set();
    tasks.forEach(task => {
      if (task.status === 'completed') {
        completedTaskIds.add(task.taskId);
      }
    });
    setCompletedTasks(completedTaskIds);
  }, [tasks]);

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
    // Optimistically update the frontend state first for better UX
    const isCurrentlyCompleted = completedTasks.has(taskId);
    const newStatus = isCurrentlyCompleted ? 'pending' : 'completed';
    
    setCompletedTasks(prev => {
      const newSet = new Set(prev);
      if (isCurrentlyCompleted) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
      }
      return newSet;
    });

    // Send request to backend to persist the change
    try {
      const response = await axios.put(
        `${import.meta.env.VITE_CALCULATION_API_URI}/api/tasks/update-status`,
        {
          userId: userData?.userId,
          taskId: taskId,
          status: newStatus
        },
        { withCredentials: true }
      );

      if (response.status !== 200) {
        // If the request fails, revert the frontend state
        console.error('Failed to update task status');
        setCompletedTasks(prev => {
          const newSet = new Set(prev);
          if (isCurrentlyCompleted) {
            newSet.add(taskId);
          } else {
            newSet.delete(taskId);
          }
          return newSet;
        });
      }
    } catch (error) {
      console.error('Error updating task status:', error);
      // Revert the frontend state on error
      setCompletedTasks(prev => {
        const newSet = new Set(prev);
        if (isCurrentlyCompleted) {
          newSet.add(taskId);
        } else {
          newSet.delete(taskId);
        }
        return newSet;
      });
    }
  };

  const refreshTasks = async () => {
    if (!userData?.userId) return;
    
    try {
      setLoading(true);
      setError(null);
      
      const response = await axios.get(
        `${import.meta.env.VITE_CALCULATION_API_URI}/api/tasks/${userData.userId}`,
        { withCredentials: true }
      );

      if (response.status === 200 && response.data?.data) {
        setTasks(response.data.data);
      } else {
        setError('Failed to refresh tasks data');
      }
    } catch (err) {
      console.error('Error refreshing tasks:', err);
      setError(err.response?.data?.message || 'Failed to refresh tasks');
    } finally {
      setLoading(false);
    }
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

  // Get unique categories from tasks
  const categories = useMemo(() => {
    const uniqueCategories = [...new Set(tasks.map(task => task.errorCategory))];
    return ['all', ...uniqueCategories];
  }, [tasks]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50/50 lg:mt-0 mt-[12vh] overflow-x-hidden w-full flex items-center justify-center">
        <div className="flex flex-col items-center gap-4">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          <p className="text-gray-600">Loading tasks...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50/50 lg:mt-0 mt-[12vh] overflow-x-hidden w-full flex items-center justify-center">
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
                      key={item.taskId}
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
        </div>
      </div>
    </div>
  );
}
