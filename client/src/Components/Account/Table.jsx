import React, { useState, useMemo, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Calendar, TrendingUp, TrendingDown, AlertCircle, CheckCircle, History } from 'lucide-react';

const ITEMS_PER_PAGE = 10;

const AccountSnapshotTable = () => {
  const info = useSelector(state => state.History.HistoryInfo || []);
  const [currentPage, setCurrentPage] = useState(1);

  console.log("🔍 ACCOUNT HISTORY DATA IN TABLE COMPONENT:");
  console.log("History Info from Redux:", info);
  console.log("Number of history records:", info ? info.length : 0);

  const totalPages = Math.max(1, Math.ceil(info.length / ITEMS_PER_PAGE));

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    const reversedInfo = [...info].reverse();
    return reversedInfo.slice(start, start + ITEMS_PER_PAGE);
  }, [currentPage, info]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [info.length, totalPages, currentPage]);

  const getPaginationGroup = () => {
    const group = [];
    const maxButtons = 5;

    if (totalPages <= maxButtons) {
      for (let i = 1; i <= totalPages; i++) group.push(i);
    } else {
      let startPage = Math.max(1, currentPage - 2);
      let endPage = Math.min(totalPages, currentPage + 2);

      if (currentPage <= 3) {
        startPage = 1;
        endPage = 5;
      } else if (currentPage >= totalPages - 2) {
        startPage = totalPages - 4;
        endPage = totalPages;
      }

      for (let i = startPage; i <= endPage; i++) group.push(i);
    }

    return group;
  };

  // Helper function to get health score status
  const getHealthStatus = (score) => {
    if (score >= 85) return { status: 'excellent', color: 'text-green-600', bg: 'bg-green-50', icon: CheckCircle };
    if (score >= 70) return { status: 'good', color: 'text-blue-600', bg: 'bg-blue-50', icon: TrendingUp };
    if (score >= 50) return { status: 'warning', color: 'text-yellow-600', bg: 'bg-yellow-50', icon: AlertCircle };
    return { status: 'critical', color: 'text-red-600', bg: 'bg-red-50', icon: TrendingDown };
  };

  // Helper function to format date nicely
  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", {
      day: 'numeric',
      month: 'long',
      year: 'numeric'
    }).replace(/^(\d+)(?= )/, d => d + (['th','st','nd','rd'][((d = +d) % 100 >> 3 ^ 1) && d % 10] || 'th'));
  };

  if (!Array.isArray(info) || info.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.4 }}
        className="text-center py-12"
      >
        <div className="flex flex-col items-center gap-4">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center">
            <History className="w-8 h-8 text-gray-400" />
          </div>
          <div className="space-y-2">
            <h4 className="text-lg font-semibold text-gray-900">No Historical Records</h4>
            <p className="text-sm text-gray-600 max-w-md">
              No historical data found. Records will appear here once your account analysis runs.
            </p>
          </div>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6 }}
      className="space-y-6"
    >
      {/* Table */}
      <div className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" />
                    Date
                  </div>
                </th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Health Score
                </th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Total Products
                </th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Products with Issues
                </th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-gray-700 uppercase tracking-wider">
                  Total Issues
                </th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-100">
              <AnimatePresence>
                {paginatedData.map((item, index) => {
                  console.log(`🔍 ACCOUNT HISTORY TABLE ROW ${index + 1} DATA:`, {
                    Date: item.Date,
                    HealthScore: item.HealthScore,
                    TotalProducts: item.TotalProducts,
                    ProductsWithIssues: item.ProductsWithIssues,
                    TotalNumberOfIssues: item.TotalNumberOfIssues,
                    fullItem: item
                  });
                  
                  const healthScore = item.HealthScore !== undefined && item.HealthScore !== null ? item.HealthScore : 0;
                  const healthInfo = getHealthStatus(healthScore);
                  const HealthIcon = healthInfo.icon;
                  
                  return (
                    <motion.tr
                      key={`${item.Date}-${index}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.3, delay: index * 0.05 }}
                      className="hover:bg-gray-50 transition-colors duration-200"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-xl flex items-center justify-center shadow-sm">
                            <Calendar className="w-5 h-5 text-white" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-gray-900">
                              {item.Date ? formatDate(item.Date) : 'N/A'}
                            </p>
                            <p className="text-xs text-gray-500">
                              {item.Date ? new Date(item.Date).toLocaleDateString('en-US', { weekday: 'long' }) : 'No date'}
                            </p>
                          </div>
                        </div>
                      </td>
                      
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <div className={`flex items-center gap-1 px-3 py-1 rounded-full ${healthInfo.bg}`}>
                            <HealthIcon className={`w-4 h-4 ${healthInfo.color}`} />
                            <span className={`text-sm font-semibold ${healthInfo.color}`}>
                              {healthScore}%
                            </span>
                          </div>
                        </div>
                      </td>
                      
                      <td className="px-6 py-4 text-center">
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-gray-100 text-gray-800 text-sm font-medium rounded-lg">
                          {item.TotalProducts !== undefined && item.TotalProducts !== null ? item.TotalProducts : 0}
                        </span>
                      </td>
                      
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center">
                          {(item.ProductsWithIssues || 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-orange-100 text-orange-800 text-sm font-medium rounded-lg">
                              <AlertCircle className="w-3 h-3" />
                              {item.ProductsWithIssues !== undefined && item.ProductsWithIssues !== null ? item.ProductsWithIssues : 0}
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-800 text-sm font-medium rounded-lg">
                              <CheckCircle className="w-3 h-3" />
                              0
                            </span>
                          )}
                        </div>
                      </td>
                      
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center">
                          {(item.TotalNumberOfIssues || 0) > 0 ? (
                            <span className="inline-flex items-center gap-1 px-3 py-1 bg-red-100 text-red-800 text-sm font-semibold rounded-lg">
                              {item.TotalNumberOfIssues !== undefined && item.TotalNumberOfIssues !== null ? item.TotalNumberOfIssues : 0} Issues
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-100 text-green-800 text-sm font-semibold rounded-lg">
                              <CheckCircle className="w-3 h-3" />
                              No Issues
                            </span>
                          )}
                        </div>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
      </div>

      {/* Enhanced Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between px-2 py-4">
          <div className="flex items-center gap-4">
            <p className="text-sm text-gray-600">
              Showing <span className="font-medium">{info.length > 0 ? ((currentPage - 1) * ITEMS_PER_PAGE) + 1 : 0}</span> to{' '}
              <span className="font-medium">{Math.min(currentPage * ITEMS_PER_PAGE, info.length)}</span> of{' '}
              <span className="font-medium">{info.length}</span> records
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                currentPage === 1
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 hover:border-gray-400'
              }`}
            >
              <ChevronLeft className="w-4 h-4" />
              Previous
            </button>
            
            <div className="flex items-center gap-1">
              {getPaginationGroup().map((page) => (
                <button
                  key={page}
                  onClick={() => setCurrentPage(page)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                    currentPage === page
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                  }`}
                >
                  {page}
                </button>
              ))}
              {totalPages > 5 && currentPage <= totalPages - 3 && (
                <span className="px-2 text-gray-400">...</span>
              )}
              {totalPages > 5 && !getPaginationGroup().includes(totalPages) && (
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                    currentPage === totalPages
                      ? 'bg-indigo-600 text-white shadow-md'
                      : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300'
                  }`}
                >
                  {totalPages}
                </button>
              )}
            </div>
            
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                currentPage === totalPages
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                  : 'bg-white text-gray-700 hover:bg-gray-50 border border-gray-300 hover:border-gray-400'
              }`}
            >
              Next
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default AccountSnapshotTable;
