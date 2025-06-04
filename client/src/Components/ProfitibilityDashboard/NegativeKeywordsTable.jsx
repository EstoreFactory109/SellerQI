import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSelector } from 'react-redux';

const NegativeKeywordsTable = () => {
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    
    // Get negative keywords metrics from Redux store
    const negativeKeywordsMetrics = useSelector((state) => 
        state.Dashboard.DashBoardInfo?.negativeKeywordsMetrics
    ) || [];
    
    // Calculate total pages
    const totalPages = Math.ceil(negativeKeywordsMetrics.length / itemsPerPage);
    
    // Calculate current items to display
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = negativeKeywordsMetrics.slice(indexOfFirstItem, indexOfLastItem);
    
    // Navigation functions
    const goToPreviousPage = () => {
        setCurrentPage(prev => Math.max(prev - 1, 1));
    };
    
    const goToNextPage = () => {
        setCurrentPage(prev => Math.min(prev + 1, totalPages));
    };
    
    // Format ACOS with color coding
    const getAcosColor = (acos) => {
        if (acos < 20) return 'text-green-600';
        if (acos < 30) return 'text-yellow-600';
        return 'text-red-600';
    };
    
    return (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="text-base font-semibold text-gray-900">Negative Keywords Performance</h3>
            </div>
            
            <table className="w-full">
                <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Keyword</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Campaign</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">Sales</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">Spend</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">ACOS</th>
                    </tr>
                </thead>
                <tbody className="bg-white">
                    {currentItems.length > 0 ? (
                        currentItems.map((item, index) => (
                            <tr key={indexOfFirstItem + index} className="border-b border-gray-200">
                                <td className="px-4 py-4 text-sm font-medium text-gray-900">
                                    {item.keyword}
                                </td>
                                <td className="px-4 py-4 text-sm text-gray-600">
                                    {item.campaignName || 'N/A'}
                                </td>
                                <td className="px-4 py-4 text-sm text-gray-900 text-center">
                                    ${item.sales.toFixed(2)}
                                </td>
                                <td className="px-4 py-4 text-sm text-gray-900 text-center">
                                    ${item.spend.toFixed(2)}
                                </td>
                                <td className={`px-4 py-4 text-sm font-medium text-center ${getAcosColor(item.acos)}`}>
                                    {item.acos.toFixed(2)}%
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan="5" className="px-4 py-8 text-center text-gray-500">
                                No negative keywords data available
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
            
            {/* Pagination Controls */}
            {negativeKeywordsMetrics.length > 0 && (
                <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-t border-gray-200">
                    <div className="text-sm text-gray-700">
                        Showing {negativeKeywordsMetrics.length > 0 ? indexOfFirstItem + 1 : 0} to {Math.min(indexOfLastItem, negativeKeywordsMetrics.length)} of {negativeKeywordsMetrics.length} keywords
                    </div>
                    
                    <div className="flex items-center gap-2">
                        <button
                            onClick={goToPreviousPage}
                            disabled={currentPage === 1 || negativeKeywordsMetrics.length === 0}
                            className={`p-2 rounded-md transition-colors ${
                                currentPage === 1 || negativeKeywordsMetrics.length === 0
                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                            }`}
                            aria-label="Previous page"
                        >
                            <ChevronLeft className="w-4 h-4" />
                        </button>
                        
                        <span className="px-3 py-1 text-sm text-gray-700">
                            Page {currentPage} of {totalPages || 1}
                        </span>
                        
                        <button
                            onClick={goToNextPage}
                            disabled={currentPage === totalPages || negativeKeywordsMetrics.length === 0}
                            className={`p-2 rounded-md transition-colors ${
                                currentPage === totalPages || negativeKeywordsMetrics.length === 0
                                    ? 'bg-gray-100 text-gray-400 cursor-not-allowed' 
                                    : 'bg-white text-gray-700 hover:bg-gray-100 border border-gray-300'
                            }`}
                            aria-label="Next page"
                        >
                            <ChevronRight className="w-4 h-4" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default NegativeKeywordsTable; 