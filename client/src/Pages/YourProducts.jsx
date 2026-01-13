import React, { useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { 
  Package, 
  Search, 
  Download, 
  CheckCircle, 
  XCircle, 
  AlertCircle, 
  Star, 
  ChevronDown,
  Filter,
  Sparkles,
  Info
} from 'lucide-react';
import axiosInstance from '../config/axios.config.js';

const YourProducts = () => {
  const [products, setProducts] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'title', direction: 'asc' });
  const [itemsToShow, setItemsToShow] = useState(10);
  const itemsPerLoad = 10;

  // Get current marketplace from Redux
  const currentCountry = useSelector((state) => state.currency?.country) || '';
  const currentRegion = useSelector((state) => state.currency?.region) || '';

  // Fetch products data
  useEffect(() => {
    const fetchProducts = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await axiosInstance.get('/api/pagewise/your-products');
        if (response.data && response.data.data) {
          setProducts(response.data.data.products || []);
          setSummary(response.data.data.summary || {});
        }
      } catch (err) {
        console.error('Error fetching products:', err);
        setError(err.response?.data?.message || 'Failed to fetch products');
      } finally {
        setLoading(false);
      }
    };

    fetchProducts();
  }, [currentCountry, currentRegion]);

  // Filter products based on search and tab
  const filteredProducts = useMemo(() => {
    let filtered = [...products];

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase().trim();
      filtered = filtered.filter(product => 
        product.asin?.toLowerCase().includes(query) ||
        product.sku?.toLowerCase().includes(query) ||
        product.title?.toLowerCase().includes(query)
      );
    }

    // Tab filter
    if (activeTab === 'active') {
      filtered = filtered.filter(p => p.status === 'Active');
    } else if (activeTab === 'inactive') {
      filtered = filtered.filter(p => p.status === 'Inactive');
    } else if (activeTab === 'incomplete') {
      filtered = filtered.filter(p => p.status === 'Incomplete');
    } else if (activeTab === 'withAPlus') {
      filtered = filtered.filter(p => p.hasAPlus);
    } else if (activeTab === 'withoutAPlus') {
      filtered = filtered.filter(p => !p.hasAPlus);
    }

    // Sort
    if (sortConfig.key) {
      filtered.sort((a, b) => {
        let aValue = a[sortConfig.key];
        let bValue = b[sortConfig.key];

        // Handle numeric values
        if (sortConfig.key === 'price' || sortConfig.key === 'numRatings' || sortConfig.key === 'starRatings') {
          aValue = parseFloat(aValue) || 0;
          bValue = parseFloat(bValue) || 0;
        } else {
          aValue = (aValue || '').toString().toLowerCase();
          bValue = (bValue || '').toString().toLowerCase();
        }

        if (sortConfig.direction === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });
    }

    return filtered;
  }, [products, searchQuery, activeTab, sortConfig]);

  // Displayed products (load more logic)
  const displayedProducts = useMemo(() => {
    return filteredProducts.slice(0, itemsToShow);
  }, [filteredProducts, itemsToShow]);

  const hasMoreItems = filteredProducts.length > itemsToShow;

  // Reset items to show when filters change
  useEffect(() => {
    setItemsToShow(itemsPerLoad);
  }, [activeTab, searchQuery, sortConfig.key]);

  const handleLoadMore = () => {
    setItemsToShow(prev => prev + itemsPerLoad);
  };

  // Handle sort
  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'
    }));
  };

  // Get status badge styles
  const getStatusBadge = (status) => {
    switch (status) {
      case 'Active':
        return {
          bg: '#d1fae5',
          color: '#065f46',
          icon: <CheckCircle size={12} />
        };
      case 'Inactive':
        return {
          bg: '#fee2e2',
          color: '#991b1b',
          icon: <XCircle size={12} />
        };
      case 'Incomplete':
        return {
          bg: '#fef3c7',
          color: '#92400e',
          icon: <AlertCircle size={12} />
        };
      default:
        return {
          bg: '#f1f5f9',
          color: '#475569',
          icon: null
        };
    }
  };

  // Export to CSV
  const exportToCSV = () => {
    const headers = [
      'ASIN',
      'SKU',
      'Title',
      'Status',
      'Price',
      'Number of Ratings',
      'Star Rating',
      'Has A+ Content',
      'A+ Status'
    ];

    const csvRows = [
      headers.join(','),
      ...filteredProducts.map(product => [
        product.asin,
        `"${(product.sku || '').replace(/"/g, '""')}"`,
        `"${(product.title || '').replace(/"/g, '""')}"`,
        product.status,
        product.price,
        product.numRatings,
        product.starRatings,
        product.hasAPlus ? 'Yes' : 'No',
        product.aPlusStatus
      ].join(','))
    ];

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `your-products-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-blue-200 border-t-blue-600 rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-gray-600">Loading your products...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <AlertCircle size={48} className="text-red-500 mx-auto mb-4" />
          <p className="text-red-600">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-4 md:p-6 font-sans">
      <style>{`
        .tooltip-container {
          position: relative;
          display: inline-flex;
          align-items: center;
          margin-left: 6px;
        }
        
        .tooltip-icon {
          width: 14px;
          height: 14px;
          color: #94a3b8;
          cursor: help;
          transition: color 0.2s;
        }
        
        .tooltip-icon:hover {
          color: #3b82f6;
        }
        
        .tooltip-content {
          position: absolute;
          top: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-top: 8px;
          padding: 12px 16px;
          background: #1e293b;
          color: white;
          border-radius: 8px;
          font-size: 13px;
          font-weight: 400;
          line-height: 1.5;
          white-space: normal;
          width: 250px;
          max-width: calc(100vw - 40px);
          z-index: 10000;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s, transform 0.2s;
          transform: translateX(-50%) translateY(4px);
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
        }
        
        .tooltip-container:hover .tooltip-content {
          opacity: 1;
          pointer-events: auto;
          transform: translateX(-50%) translateY(0);
        }
        
        .tooltip-content::before {
          content: '';
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          border: 6px solid transparent;
          border-bottom-color: #1e293b;
        }
        
        .th-with-tooltip {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }
        
        .tooltip-container.tooltip-last {
          position: relative;
        }
        
        .tooltip-container.tooltip-last .tooltip-content {
          left: auto;
          right: 0;
          transform: translateX(0);
        }
        
        .tooltip-container.tooltip-last:hover .tooltip-content {
          transform: translateX(0) translateY(0);
        }
        
        .tooltip-container.tooltip-last .tooltip-content::before {
          left: auto;
          right: 20px;
          transform: translateX(0);
        }
      `}</style>

      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-xl shadow-sm p-6 mb-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-blue-100 rounded-xl">
                <Package className="w-6 h-6 text-blue-600" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Your Products</h1>
                <p className="text-gray-500 text-sm">
                  {currentCountry ? `Marketplace: ${currentCountry.toUpperCase()}` : 'All Products'}
                </p>
              </div>
            </div>
            <button
              onClick={exportToCSV}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Download size={18} />
              Export CSV
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-sm text-gray-500 mb-1">Total Products</div>
            <div className="text-2xl font-bold text-gray-900">{summary.totalProducts || 0}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-sm text-gray-500 mb-1">Active</div>
            <div className="text-2xl font-bold text-green-600">{summary.activeProducts || 0}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-sm text-gray-500 mb-1">Inactive</div>
            <div className="text-2xl font-bold text-red-600">{summary.inactiveProducts || 0}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-sm text-gray-500 mb-1">Incomplete</div>
            <div className="text-2xl font-bold text-amber-600">{summary.incompleteProducts || 0}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-sm text-gray-500 mb-1">With A+</div>
            <div className="text-2xl font-bold text-purple-600">{summary.productsWithAPlus || 0}</div>
          </div>
          <div className="bg-white rounded-xl shadow-sm p-4">
            <div className="text-sm text-gray-500 mb-1">Without A+</div>
            <div className="text-2xl font-bold text-gray-600">{summary.productsWithoutAPlus || 0}</div>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="bg-white rounded-xl shadow-sm p-4 mb-6">
          <div className="flex flex-col md:flex-row gap-4">
            {/* Search */}
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={20} />
              <input
                type="text"
                placeholder="Search by ASIN, SKU, or Title..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2.5 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="bg-white rounded-t-xl shadow-sm px-4 flex gap-2 overflow-x-auto border-b border-gray-200">
          {[
            { key: 'all', label: 'All', count: products.length },
            { key: 'active', label: 'Active', count: summary.activeProducts || 0 },
            { key: 'inactive', label: 'Inactive', count: summary.inactiveProducts || 0 },
            { key: 'incomplete', label: 'Incomplete', count: summary.incompleteProducts || 0 },
            { key: 'withAPlus', label: 'With A+', count: summary.productsWithAPlus || 0 },
            { key: 'withoutAPlus', label: 'Without A+', count: summary.productsWithoutAPlus || 0 }
          ].map(tab => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {tab.label} ({tab.count})
            </button>
          ))}
        </div>

        {/* Products Table */}
        <div className="bg-white rounded-b-xl shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th 
                    className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                    onClick={() => handleSort('asin')}
                  >
                    ASIN {sortConfig.key === 'asin' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                    onClick={() => handleSort('sku')}
                  >
                    SKU {sortConfig.key === 'sku' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                    onClick={() => handleSort('title')}
                  >
                    Title {sortConfig.key === 'title' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                    onClick={() => handleSort('status')}
                  >
                    Status {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <div className="th-with-tooltip">
                      <span>Has A+</span>
                      <div className="tooltip-container" onClick={(e) => e.stopPropagation()}>
                        <Info className="tooltip-icon" />
                        <div className="tooltip-content">
                          <strong>A+ Content</strong><br />
                          Enhanced product descriptions with rich media that can increase conversions by up to 10%.
                        </div>
                      </div>
                    </div>
                  </th>
                  <th 
                    className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                    onClick={() => handleSort('price')}
                  >
                    Price {sortConfig.key === 'price' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                  </th>
                  <th 
                    className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                    onClick={() => handleSort('numRatings')}
                  >
                    <div className="th-with-tooltip">
                      <span>rating no. {sortConfig.key === 'numRatings' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</span>
                      <div className="tooltip-container" onClick={(e) => e.stopPropagation()}>
                        <Info className="tooltip-icon" />
                        <div className="tooltip-content">
                          <strong>Number of Ratings</strong><br />
                          Total number of customer ratings received for this product.
                        </div>
                      </div>
                    </div>
                  </th>
                  <th 
                    className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                    onClick={() => handleSort('starRatings')}
                  >
                    <div className="th-with-tooltip">
                      <span>Rating {sortConfig.key === 'starRatings' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</span>
                      <div className="tooltip-container tooltip-last" onClick={(e) => e.stopPropagation()}>
                        <Info className="tooltip-icon" />
                        <div className="tooltip-content">
                          <strong>Star Rating</strong><br />
                          Average star rating out of 5 based on customer reviews.
                        </div>
                      </div>
                    </div>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayedProducts.length > 0 ? (
                  displayedProducts.map((product, index) => {
                    const statusBadge = getStatusBadge(product.status);
                    return (
                      <tr key={`${product.asin}-${index}`} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 text-center">
                          <span className="font-mono text-sm text-gray-900">{product.asin}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm text-gray-600">{product.sku || '—'}</span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm text-gray-900 line-clamp-2" title={product.title}>
                            {product.title || '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span 
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                            style={{ backgroundColor: statusBadge.bg, color: statusBadge.color }}
                          >
                            {statusBadge.icon}
                            {product.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {product.hasAPlus ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-purple-100 text-purple-700">
                              <Sparkles size={12} />
                              Yes
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-600">
                              No
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm font-medium text-gray-900">
                            {product.price ? `$${parseFloat(product.price).toFixed(2)}` : '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="text-sm text-gray-600">
                            {product.numRatings ? parseInt(product.numRatings).toLocaleString() : '0'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-1">
                            <Star size={14} className="text-amber-400 fill-amber-400" />
                            <span className="text-sm font-medium text-gray-900">
                              {product.starRatings ? parseFloat(product.starRatings).toFixed(1) : '0.0'}
                            </span>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={8} className="px-4 py-12 text-center text-gray-500">
                      {products.length === 0 
                        ? 'No products found. Please ensure your account is connected and data is synced.'
                        : 'No products match your current filters.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Load More */}
          {hasMoreItems && (
            <div className="px-4 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-center gap-4">
              <span className="text-sm text-gray-500">
                Showing {displayedProducts.length} of {filteredProducts.length} products
              </span>
              <button
                onClick={handleLoadMore}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                Load More
                <ChevronDown size={16} />
              </button>
            </div>
          )}
          {!hasMoreItems && displayedProducts.length > itemsPerLoad && (
            <div className="px-4 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-center">
              <span className="text-sm text-gray-500">
                Showing all {filteredProducts.length} products
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default YourProducts;
