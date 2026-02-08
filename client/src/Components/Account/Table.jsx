import React, { useState, useMemo, useEffect } from 'react';
import { useSelector } from 'react-redux';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronLeft, ChevronRight, Calendar, TrendingUp, TrendingDown, AlertCircle, CheckCircle, History } from 'lucide-react';

const ITEMS_PER_PAGE = 10;

const AccountSnapshotTable = () => {
  // Read from PageDataSlice (new) with fallback to legacy HistorySlice
  const pageDataHistory = useSelector(state => state.pageData?.accountHistory?.data?.accountHistory);
  const legacyHistoryInfo = useSelector(state => state.History?.HistoryInfo || []);
  const info = pageDataHistory || legacyHistoryInfo;
  const [currentPage, setCurrentPage] = useState(1);

  console.log("🔍 ACCOUNT HISTORY DATA IN TABLE COMPONENT:");
  console.log("Page Data History:", pageDataHistory);
  console.log("Legacy History Info:", legacyHistoryInfo);
  console.log("Final History Info:", info);
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
    if (score >= 85) return { status: 'excellent', color: 'text-green-400', bg: 'bg-green-500/10', icon: CheckCircle };
    if (score >= 70) return { status: 'good', color: 'text-blue-400', bg: 'bg-blue-500/10', icon: TrendingUp };
    if (score >= 50) return { status: 'warning', color: 'text-yellow-400', bg: 'bg-yellow-500/10', icon: AlertCircle };
    return { status: 'critical', color: 'text-red-400', bg: 'bg-red-500/10', icon: TrendingDown };
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
          <History className="w-8 h-8" style={{ color: '#60a5fa' }} />
          <div className="space-y-2">
            <h4 className="text-lg font-semibold text-gray-100">No Historical Records</h4>
            <p className="text-sm text-gray-400 max-w-md">
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
              <tr className="bg-[#21262d] border-b border-[#30363d]">
                <th className="px-6 py-4 text-left text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4" style={{ color: '#60a5fa' }} />
                    Date
                  </div>
                </th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  Health Score
                </th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  Products with Issues
                </th>
                <th className="px-6 py-4 text-center text-xs font-semibold text-gray-300 uppercase tracking-wider">
                  Total Issues
                </th>
              </tr>
            </thead>
            <tbody className="bg-[#161b22] divide-y divide-[#30363d]">
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
                  
                  // HealthScore is stored as String in DB, convert to number for display
                  const healthScore = item.HealthScore !== undefined && item.HealthScore !== null ? Number(item.HealthScore) : 0;
                  const healthInfo = getHealthStatus(healthScore);
                  
                  return (
                    <motion.tr
                      key={`${item.Date}-${index}`}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      transition={{ duration: 0.3, delay: index * 0.05 }}
                      className="hover:bg-[#21262d] transition-colors duration-200"
                    >
                      <td className="px-6 py-4">
                        <div className="flex items-center gap-3">
                          <Calendar className="w-4 h-4 flex-shrink-0" style={{ color: '#60a5fa' }} />
                          <div>
                            <p className="text-sm font-medium text-gray-100">
                              {item.Date ? formatDate(item.Date) : 'N/A'}
                            </p>
                            <p className="text-xs text-gray-400">
                              {item.Date ? new Date(item.Date).toLocaleDateString('en-US', { weekday: 'long' }) : 'No date'}
                            </p>
                          </div>
                        </div>
                      </td>
                      
                      <td className="px-6 py-4 text-center">
                        <span className="text-sm font-semibold text-white">
                          {healthScore}%
                        </span>
                      </td>
                      
                      <td className="px-6 py-4 text-center">
                        <span className="text-sm font-medium text-white">
                          {item.ProductsWithIssues !== undefined && item.ProductsWithIssues !== null ? item.ProductsWithIssues : 0}
                        </span>
                      </td>
                      
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-1">
                          {(item.TotalNumberOfIssues || 0) > 0 ? (
                            <span className="text-sm font-semibold text-red-400">
                              {item.TotalNumberOfIssues !== undefined && item.TotalNumberOfIssues !== null ? item.TotalNumberOfIssues : 0} Issues
                            </span>
                          ) : (
                            <>
                              <CheckCircle className="w-3 h-3 text-green-400" />
                              <span className="text-sm font-semibold text-green-400">
                                No Issues
                              </span>
                            </>
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
            <p className="text-sm text-gray-400">
              Showing <span className="font-medium text-gray-300">{info.length > 0 ? ((currentPage - 1) * ITEMS_PER_PAGE) + 1 : 0}</span> to{' '}
              <span className="font-medium text-gray-300">{Math.min(currentPage * ITEMS_PER_PAGE, info.length)}</span> of{' '}
              <span className="font-medium text-gray-300">{info.length}</span> records
            </p>
          </div>
          
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-all ${
                currentPage === 1
                  ? 'bg-[#21262d] text-gray-500 cursor-not-allowed border border-[#30363d]' 
                  : 'bg-[#21262d] text-gray-300 hover:bg-[#161b22] border border-[#30363d] hover:border-blue-500/40'
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
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
                      : 'bg-[#21262d] text-gray-300 hover:bg-[#161b22] border border-[#30363d] hover:border-blue-500/40'
                  }`}
                >
                  {page}
                </button>
              ))}
              {totalPages > 5 && currentPage <= totalPages - 3 && (
                <span className="px-2 text-gray-500">...</span>
              )}
              {totalPages > 5 && !getPaginationGroup().includes(totalPages) && (
                <button
                  onClick={() => setCurrentPage(totalPages)}
                  className={`w-8 h-8 rounded-lg text-sm font-medium transition-all ${
                    currentPage === totalPages
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-500/25'
                      : 'bg-[#21262d] text-gray-300 hover:bg-[#161b22] border border-[#30363d] hover:border-blue-500/40'
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
                  ? 'bg-[#21262d] text-gray-500 cursor-not-allowed border border-[#30363d]' 
                  : 'bg-[#21262d] text-gray-300 hover:bg-[#161b22] border border-[#30363d] hover:border-blue-500/40'
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
