import React, { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useSelector } from 'react-redux';

const WastedKeywordsTable = () => {
    const [currentPage, setCurrentPage] = useState(1);
    const itemsPerPage = 10;
    
    // Get adsKeywordsPerformanceData from Redux store
    const adsKeywordsPerformanceData = useSelector((state) => 
        state.Dashboard.DashBoardInfo?.adsKeywordsPerformanceData
    ) || [];
    
    // Filter wasted keywords: cost > 0 && attributedSales30d === 0 (with tolerance for floating point)
    const wastedKeywords = adsKeywordsPerformanceData
        .filter(keyword => {
            const cost = parseFloat(keyword.cost) || 0;
            const attributedSales30d = parseFloat(keyword.attributedSales30d) || 0;
            // Use < 0.01 instead of === 0 to handle floating point precision issues
            return cost > 0 && attributedSales30d < 0.01;
        })
        .map(keyword => {
            const cost = parseFloat(keyword.cost) || 0;
            const attributedSales30d = parseFloat(keyword.attributedSales30d) || 0;
            
            return {
                keyword: keyword.keyword,
                campaignName: keyword.campaignName,
                spend: cost,
                sales: attributedSales30d
            };
        })
        .sort((a, b) => b.spend - a.spend);
    
    // Calculate total pages
    const totalPages = Math.ceil(wastedKeywords.length / itemsPerPage);
    
    // Calculate current items to display
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    const currentItems = wastedKeywords.slice(indexOfFirstItem, indexOfLastItem);
    
    // Navigation functions
    const goToPreviousPage = () => {
        setCurrentPage(prev => Math.max(prev - 1, 1));
    };
    
    const goToNextPage = () => {
        setCurrentPage(prev => Math.min(prev + 1, totalPages));
    };
    

    
    return (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200">
                <h3 className="text-base font-semibold text-gray-900">
                    Wasted Keywords (Cost &gt; $0, Sales = $0)
                </h3>
                <p className="text-sm text-gray-600 mt-1">
                    {wastedKeywords.length} keywords wasting ad spend
                </p>
            </div>
            
            <table className="w-full">
                <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Keyword</th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-700">Campaign</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">Sales</th>
                        <th className="px-4 py-3 text-center text-xs font-medium text-gray-700">Spend</th>
                    </tr>
                </thead>
                <tbody className="bg-white">
                    {currentItems.length > 0 ? (
                        currentItems.map((keyword, index) => (
                            <tr key={indexOfFirstItem + index} className="border-b border-gray-200">
                                <td className="px-4 py-4 text-sm font-medium text-gray-900">
                                    {keyword.keyword}
                                </td>
                                <td className="px-4 py-4 text-sm text-gray-600">
                                    {keyword.campaignName}
                                </td>
                                <td className="px-4 py-4 text-sm text-gray-900 text-center">
                                    ${keyword.sales.toFixed(2)}
                                </td>
                                <td className="px-4 py-4 text-sm font-medium text-red-600 text-center">
                                    ${keyword.spend.toFixed(2)}
                                </td>
                            </tr>
                        ))
                    ) : (
                        <tr>
                            <td colSpan="4" className="px-4 py-8 text-center text-gray-500">
                                No wasted keywords found
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
            
            {/* Pagination Controls */}
            {totalPages > 1 && (
                <div className="px-4 py-3 border-t border-gray-200 flex items-center justify-between">
                    <div className="flex items-center text-sm text-gray-700">
                        <span>
                            Showing {indexOfFirstItem + 1} to {Math.min(indexOfLastItem, wastedKeywords.length)} of {wastedKeywords.length} keywords
                        </span>
                    </div>
                    
                    <div className="flex items-center space-x-2">
                        <button
                            onClick={goToPreviousPage}
                            disabled={currentPage === 1}
                            className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                        >
                            <ChevronLeft className="h-4 w-4 mr-1" />
                            Previous
                        </button>
                        
                        <div className="flex items-center space-x-1">
                            <span className="text-sm text-gray-700">
                                Page {currentPage} of {totalPages}
                            </span>
                        </div>
                        
                        <button
                            onClick={goToNextPage}
                            disabled={currentPage === totalPages}
                            className="px-3 py-1 border border-gray-300 rounded-md text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed flex items-center"
                        >
                            Next
                            <ChevronRight className="h-4 w-4 ml-1" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default WastedKeywordsTable; 