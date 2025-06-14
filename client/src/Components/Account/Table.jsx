import React, { useState, useMemo, useEffect } from 'react';
import { useSelector } from 'react-redux';

const ITEMS_PER_PAGE = 10;

const AccountSnapshotTable = () => {
  const info = useSelector(state => state.History.HistoryInfo || []);
  const [currentPage, setCurrentPage] = useState(1);

  const totalPages = Math.max(1, Math.ceil(info.length / ITEMS_PER_PAGE));

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * ITEMS_PER_PAGE;
    return info.slice(start, start + ITEMS_PER_PAGE);
  }, [currentPage, info]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(1);
    }
  }, [info.length]);

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

  if (!Array.isArray(info) || info.length === 0) {
    return (
      <div>
        <h2 className="text-lg font-semibold mb-4">ACCOUNT SNAPSHOT HISTORY</h2>
        <div className="text-center text-gray-500 py-8">
          No data found in the history section
        </div>
      </div>
    );
  }

  return (
    <div>
      <h2 className="text-lg font-semibold mb-4">ACCOUNT SNAPSHOT HISTORY</h2>
      <div className="overflow-x-auto">
        <table className="min-w-full border divide-y divide-gray-200">
          <thead className="bg-[#333751] text-white">
            <tr>
              <th className="px-4 py-3 text-left text-sm font-medium">Date</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Health Score</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Total products</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Products with issues</th>
              <th className="px-4 py-3 text-left text-sm font-medium">Total number of issues</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {paginatedData.map((item, index) => (
              <tr key={index}>
                <td className="px-4 py-3 text-sm text-gray-700">
                  {new Date(item.Date).toLocaleDateString("en-GB", {
                    day: 'numeric',
                    month: 'long',
                    year: 'numeric'
                  }).replace(/^(\d+)(?= )/, d => d + (['th','st','nd','rd'][((d = +d) % 100 >> 3 ^ 1) && d % 10] || 'th'))}
                </td>
                <td className="px-4 py-3 text-sm text-gray-700">{item.HealthScore}</td>
                <td className="px-4 py-3 text-sm text-gray-700">{item.TotalProducts}</td>
                <td className="px-4 py-3 text-sm text-gray-700">{item.ProductsWithIssues}</td>
                <td className="px-4 py-3 text-sm text-blue-600">{item.TotalNumberOfIssues} Issues Found</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-between items-center mt-4">
          <button
            className="text-sm text-gray-600 cursor-pointer disabled:text-gray-400"
            disabled={currentPage === 1}
            onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
          >
            &lt; Previous
          </button>

          <div className="flex gap-2">
            {getPaginationGroup().map((page) => (
              <button
                key={page}
                onClick={() => setCurrentPage(page)}
                className={`px-3 py-1 text-sm rounded ${currentPage === page ? 'bg-[#333751] text-white' : 'text-gray-600'}`}
              >
                {page}
              </button>
            ))}
            {totalPages > 5 && currentPage <= totalPages - 3 && <span className="text-sm text-gray-600">...</span>}
            {totalPages > 5 && !getPaginationGroup().includes(totalPages) && (
              <button
                onClick={() => setCurrentPage(totalPages)}
                className={`px-3 py-1 text-sm rounded ${currentPage === totalPages ? 'bg-[#333751] text-white' : 'text-gray-600'}`}
              >
                {totalPages}
              </button>
            )}
          </div>

          <button
            className="text-sm text-gray-600 cursor-pointer disabled:text-gray-400"
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
          >
            Next &gt;
          </button>
        </div>
      )}

      {/* Bottom padding so pagination is never clipped */}
      <div className="h-6" />
    </div>
  );
};

export default AccountSnapshotTable;
