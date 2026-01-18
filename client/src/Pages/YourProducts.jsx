import React, { useState, useEffect, useMemo } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { useNavigate } from 'react-router-dom';
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
  Info,
  AlertTriangle,
  Check,
  X
} from 'lucide-react';
import { fetchYourProductsData } from '../redux/slices/PageDataSlice.js';

const YourProducts = () => {
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState('');
  const [activeTab, setActiveTab] = useState('all');
  const [sortConfig, setSortConfig] = useState({ key: 'title', direction: 'asc' });
  const [loadingMore, setLoadingMore] = useState(false);
  const itemsPerPage = 20; // Items fetched from backend per page

  // Get current marketplace from Redux
  const currentCountry = useSelector((state) => state.currency?.country) || '';
  const currentRegion = useSelector((state) => state.currency?.region) || '';

  // Get products data from Redux
  const yourProductsData = useSelector((state) => state.pageData?.yourProducts?.data);
  const loading = useSelector((state) => state.pageData?.yourProducts?.loading) ?? true;
  const error = useSelector((state) => state.pageData?.yourProducts?.error);

  // Extract products, summary, and pagination from Redux data
  const products = useMemo(() => yourProductsData?.products || [], [yourProductsData]);
  const summary = useMemo(() => yourProductsData?.summary || {}, [yourProductsData]);
  const pagination = useMemo(() => yourProductsData?.pagination || {}, [yourProductsData]);

  // Fetch products data from Redux (only if empty)
  useEffect(() => {
    // Only fetch if data doesn't exist in Redux
    if (!yourProductsData && !loading) {
      dispatch(fetchYourProductsData({ page: 1, limit: itemsPerPage }));
    }
  }, [dispatch, yourProductsData, loading]);

  // Track if we've loaded all products for inactive/incomplete tabs
  const [allProductsLoaded, setAllProductsLoaded] = useState(false);
  
  // Reset allProductsLoaded when tab changes away from inactive/incomplete
  useEffect(() => {
    if (activeTab !== 'inactive' && activeTab !== 'incomplete') {
      setAllProductsLoaded(false);
    }
  }, [activeTab]);

  // Auto-load ALL products when switching to inactive/incomplete tabs (one-time load)
  useEffect(() => {
    const loadAllProducts = async () => {
      // Only proceed if on inactive/incomplete tab and haven't loaded all yet
      if ((activeTab === 'inactive' || activeTab === 'incomplete') && 
          !allProductsLoaded && !loading && !loadingMore) {
        
        const totalItems = summary.totalProducts || pagination.totalItems || 0;
        
        // If all products are already loaded, mark as complete
        if (products.length >= totalItems || !pagination.hasMore) {
          setAllProductsLoaded(true);
          return;
        }
        
        // Load all remaining products in sequence
        setLoadingMore(true);
        try {
          let currentPage = pagination.page || 1;
          let currentProductCount = products.length;
          
          while (currentProductCount < totalItems && currentPage < Math.ceil(totalItems / itemsPerPage)) {
            currentPage++;
            const result = await dispatch(fetchYourProductsData({ 
              page: currentPage, 
              limit: itemsPerPage, 
              append: true 
            })).unwrap();
            
            currentProductCount = result.products?.length || currentProductCount;
            
            // Safety check to prevent infinite loop
            if (!result.pagination?.hasMore) break;
          }
          
          setAllProductsLoaded(true);
        } catch (err) {
          console.error('Error auto-loading products for inactive tab:', err);
        } finally {
          setLoadingMore(false);
        }
      }
    };
    
    loadAllProducts();
  }, [activeTab, allProductsLoaded]); // Only depend on tab and our tracking flag
  
  // Handle loading more products from backend
  const handleLoadMoreFromBackend = async () => {
    // Guard against loading if already loading
    if (loadingMore || loading) return;
    
    // Check if we already have all data
    const totalItems = summary.totalProducts || pagination.totalItems || 0;
    if (products.length >= totalItems) return;
    
    setLoadingMore(true);
    try {
      // Calculate next page based on current products loaded
      const currentPage = Math.ceil(products.length / itemsPerPage);
      const nextPage = currentPage + 1;
      
      await dispatch(fetchYourProductsData({ 
        page: nextPage, 
        limit: itemsPerPage, 
        append: true 
      })).unwrap();
    } catch (err) {
      console.error('Error loading more products:', err);
    } finally {
      setLoadingMore(false);
    }
  };

  // Filter products based on search and tab (client-side filtering of loaded products)
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

  // For display, we use all filtered products (no client-side pagination needed since we paginate from backend)
  const displayedProducts = filteredProducts;
  
  // Check if there's more data to load from backend
  // Use both pagination.hasMore and compare loaded count vs total
  const totalItems = summary.totalProducts || pagination.totalItems || 0;
  // More robust check: show Load More if we have fewer products than total
  const hasMoreFromBackend = products.length > 0 && products.length < totalItems;

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

  // Get issues badge color based on count
  const getIssuesBadge = (totalIssues) => {
    if (totalIssues === null || totalIssues === undefined) {
      return { bg: '#f1f5f9', color: '#94a3b8', text: '—' };
    }
    if (totalIssues === 0) {
      return { bg: '#d1fae5', color: '#065f46', text: '0' };
    }
    if (totalIssues >= 5) {
      return { bg: '#fee2e2', color: '#991b1b', text: totalIssues.toString() };
    }
    if (totalIssues >= 2) {
      return { bg: '#fef3c7', color: '#92400e', text: totalIssues.toString() };
    }
    return { bg: '#dbeafe', color: '#1e40af', text: totalIssues.toString() };
  };

  // Get issues data from Redux
  const issuesData = useMemo(() => yourProductsData?.issuesData || null, [yourProductsData]);

  // Debug logging
  useEffect(() => {
    if (issuesData) {
      console.log('[YourProducts] issuesData received:', {
        hasRankingErrors: !!issuesData.rankingProductWiseErrors,
        rankingErrorsCount: issuesData.rankingProductWiseErrors?.length || 0,
        hasTotalProduct: !!issuesData.TotalProduct,
        totalProductCount: issuesData.TotalProduct?.length || 0,
        hasBuyBoxData: !!issuesData.buyBoxData,
        sampleRankingError: issuesData.rankingProductWiseErrors?.[0],
        sampleTotalProduct: issuesData.TotalProduct?.[0]
      });
    } else {
      console.log('[YourProducts] issuesData is null or undefined');
    }
  }, [issuesData]);

  // Count ranking issues for a product (same logic as IssuesByProduct)
  const countRankingIssues = (product) => {
    if (!issuesData?.rankingProductWiseErrors) return 0;
    const rankingData = issuesData.rankingProductWiseErrors.find(item => item.asin === product.asin);
    if (!rankingData?.data) return 0;
    
    const rankingErrors = rankingData.data;
    let count = 0;
    const sections = ['TitleResult', 'BulletPoints', 'Description'];
    const checks = ['RestictedWords', 'checkSpecialCharacters', 'charLim'];
    
    sections.forEach(section => {
      if (rankingErrors[section]) {
        checks.forEach(check => {
          if (rankingErrors[section][check]?.status === 'Error') count++;
        });
      }
    });
    
    if (rankingErrors.charLim?.status === 'Error') count++;
    return count;
  };

  // Count conversion issues for a product (same logic as IssuesByProduct)
  const countConversionIssues = (product) => {
    if (!issuesData?.TotalProduct) return 0;
    const productData = issuesData.TotalProduct.find(item => item.asin === product.asin);
    if (!productData?.conversionErrors) return 0;
    
    const conversionErrors = productData.conversionErrors;
    let count = 0;
    
    const checks = [
      conversionErrors.imageResultErrorData,
      conversionErrors.videoResultErrorData,
      conversionErrors.productStarRatingResultErrorData,
      conversionErrors.productsWithOutBuyboxErrorData,
      conversionErrors.aplusErrorData,
      conversionErrors.brandStoryErrorData
    ];
    
    checks.forEach(check => {
      if (check?.status === 'Error') count++;
    });
    
    // Also count buybox issues
    if (issuesData?.buyBoxData?.asinBuyBoxData) {
      const buyBox = issuesData.buyBoxData.asinBuyBoxData.find(
        item => item.childAsin === product.asin || item.parentAsin === product.asin
      );
      if (buyBox && (buyBox.buyBoxPercentage === 0 || buyBox.buyBoxPercentage < 50)) {
        count++;
      }
    }
    
    return count;
  };

  // Count inventory issues for a product (same logic as IssuesByProduct)
  const countInventoryIssues = (product) => {
    if (!issuesData?.TotalProduct) return 0;
    const productData = issuesData.TotalProduct.find(item => item.asin === product.asin);
    if (!productData?.inventoryErrors) return 0;
    
    const inventoryErrors = productData.inventoryErrors;
    let count = 0;
    
    if (inventoryErrors.inventoryPlanningErrorData) {
      const planning = inventoryErrors.inventoryPlanningErrorData;
      if (planning.longTermStorageFees?.status === 'Error') count++;
      if (planning.unfulfillable?.status === 'Error') count++;
    }
    
    if (inventoryErrors.strandedInventoryErrorData) count++;
    if (inventoryErrors.inboundNonComplianceErrorData) count++;
    if (inventoryErrors.replenishmentErrorData) {
      count += Array.isArray(inventoryErrors.replenishmentErrorData) 
        ? inventoryErrors.replenishmentErrorData.length 
        : 1;
    }
    
    return count;
  };

  // Calculate total issues for a product
  const getTotalIssues = (product) => {
    if (product.status !== 'Active') return null;
    return countRankingIssues(product) + countConversionIssues(product) + countInventoryIssues(product);
  };

  // Export to CSV
  const exportToCSV = () => {
    const headers = [
      'ASIN',
      'SKU',
      'Title',
      'Status',
      'Price',
      'Reviews',
      'Ratings',
      'Has A+ Content',
      'A+ Status',
      'Ranking Issues',
      'Conversion Issues',
      'Inventory Issues',
      'Total Issues'
    ];

    const csvRows = [
      headers.join(','),
      ...filteredProducts.map(product => {
        const rankingIssues = product.status === 'Active' ? countRankingIssues(product) : '';
        const conversionIssues = product.status === 'Active' ? countConversionIssues(product) : '';
        const inventoryIssues = product.status === 'Active' ? countInventoryIssues(product) : '';
        const totalIssues = product.status === 'Active' ? getTotalIssues(product) : '';
        return [
          product.asin,
          `"${(product.sku || '').replace(/"/g, '""')}"`,
          `"${(product.title || '').replace(/"/g, '""')}"`,
          product.status,
          product.price,
          product.numRatings,
          product.starRatings,
          product.hasAPlus ? 'Yes' : 'No',
          product.aPlusStatus,
          rankingIssues,
          conversionIssues,
          inventoryIssues,
          totalIssues
        ].join(',');
      })
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
            { key: 'withAPlus', label: 'With A+', count: summary.productsWithAPlus || 0 }
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
          <div className="overflow-hidden">
            <table className="w-full" style={{ tableLayout: 'fixed' }}>
              <thead className="bg-gray-50">
                <tr>
                  {/* Show different columns based on tab */}
                  {(activeTab === 'inactive' || activeTab === 'incomplete') ? (
                    <>
                      {/* Simplified columns for inactive/incomplete tabs: SKU, ASIN, Title, Issues */}
                      <th 
                        className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 border-b border-gray-200"
                        style={{ width: '6%' }}
                        onClick={() => handleSort('sku')}
                      >
                        SKU {sortConfig.key === 'sku' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th 
                        className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 border-b border-gray-200"
                        style={{ width: '10%' }}
                        onClick={() => handleSort('asin')}
                      >
                        ASIN {sortConfig.key === 'asin' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th 
                        className="px-2 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 border-b border-gray-200"
                        style={{ width: '28%' }}
                        onClick={() => handleSort('title')}
                      >
                        Title {sortConfig.key === 'title' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th className="px-2 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200" style={{ width: '56%' }}>
                        <div className="th-with-tooltip">
                          <span>Issues</span>
                          <div className="tooltip-container tooltip-last" onClick={(e) => e.stopPropagation()}>
                            <Info className="tooltip-icon" />
                            <div className="tooltip-content">
                              <strong>Listing Issues</strong><br />
                              Issues preventing this product from being active on Amazon.
                            </div>
                          </div>
                        </div>
                      </th>
                    </>
                  ) : (
                    <>
                      {/* Full columns for other tabs */}
                      <th 
                        className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                        style={{ width: activeTab === 'active' ? '11%' : '10%' }}
                        onClick={() => handleSort('asin')}
                      >
                        ASIN {sortConfig.key === 'asin' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th 
                        className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                        style={{ width: activeTab === 'active' ? '9%' : '8%' }}
                        onClick={() => handleSort('sku')}
                      >
                        SKU {sortConfig.key === 'sku' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th 
                        className="px-2 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                        style={{ width: activeTab === 'active' ? '22%' : '20%' }}
                        onClick={() => handleSort('title')}
                      >
                        Title {sortConfig.key === 'title' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      {/* Status column - hidden in 'active' tab */}
                      {activeTab !== 'active' && (
                        <th 
                          className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                          style={{ width: '8%' }}
                          onClick={() => handleSort('status')}
                        >
                          Status {sortConfig.key === 'status' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                        </th>
                      )}
                      <th className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider" style={{ width: activeTab === 'active' ? '8%' : '7%' }}>
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
                      <th className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider" style={{ width: activeTab === 'active' ? '9%' : '8%' }}>
                        <div className="th-with-tooltip">
                          <span>Brand Story</span>
                          <div className="tooltip-container" onClick={(e) => e.stopPropagation()}>
                            <Info className="tooltip-icon" />
                            <div className="tooltip-content">
                              <strong>Brand Story</strong><br />
                              A compelling brand narrative that helps customers connect emotionally with your product and brand.
                            </div>
                          </div>
                        </div>
                      </th>
                      <th 
                        className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                        style={{ width: activeTab === 'active' ? '9%' : '8%' }}
                        onClick={() => handleSort('price')}
                      >
                        Price {sortConfig.key === 'price' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                      </th>
                      <th 
                        className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                        style={{ width: activeTab === 'active' ? '9%' : '8%' }}
                        onClick={() => handleSort('numRatings')}
                      >
                        <div className="th-with-tooltip">
                          <span>Reviews {sortConfig.key === 'numRatings' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</span>
                          <div className="tooltip-container" onClick={(e) => e.stopPropagation()}>
                            <Info className="tooltip-icon" />
                            <div className="tooltip-content">
                              <strong>Reviews</strong><br />
                              Total number of customer reviews received for this product.
                            </div>
                          </div>
                        </div>
                      </th>
                      <th 
                        className="px-2 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                        style={{ width: activeTab === 'active' ? '9%' : '8%' }}
                        onClick={() => handleSort('starRatings')}
                      >
                        <div className="th-with-tooltip">
                          <span>Ratings {sortConfig.key === 'starRatings' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</span>
                          <div className="tooltip-container" onClick={(e) => e.stopPropagation()}>
                            <Info className="tooltip-icon" />
                            <div className="tooltip-content">
                              <strong>Ratings</strong><br />
                              Average star rating out of 5 based on customer reviews.
                            </div>
                          </div>
                        </div>
                      </th>
                      {/* Issues column - hidden in 'all' and 'active' tabs */}
                      {(activeTab === 'inactive' || activeTab === 'incomplete') && (
                        <th 
                          className="px-4 py-3 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700"
                          onClick={() => handleSort('totalIssues')}
                        >
                          <div className="th-with-tooltip">
                            <span>Issues {sortConfig.key === 'totalIssues' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</span>
                            <div className="tooltip-container tooltip-last" onClick={(e) => e.stopPropagation()}>
                              <Info className="tooltip-icon" />
                              <div className="tooltip-content">
                                <strong>Total Issues</strong><br />
                                Combined count of ranking, conversion, and inventory issues. Only shown for active products.
                              </div>
                            </div>
                          </div>
                        </th>
                      )}
                    </>
                  )}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {displayedProducts.length > 0 ? (
                  displayedProducts.map((product, index) => {
                    const statusBadge = getStatusBadge(product.status);
                    
                    // Render different row layout for inactive/incomplete tabs
                    if (activeTab === 'inactive' || activeTab === 'incomplete') {
                      const issueCount = product.issues?.length || 0;
                      return (
                        <tr key={`${product.asin}-${index}`} className="hover:bg-gray-50/50 transition-colors border-b border-gray-100">
                          <td className="px-2 py-4 text-center align-top">
                            <span className="text-xs font-medium text-gray-700 break-words">{product.sku || '—'}</span>
                          </td>
                          <td className="px-2 py-4 text-center align-top">
                            <code className="text-xs font-mono text-gray-900 bg-gray-50 px-1.5 py-0.5 rounded break-all">
                              {product.asin}
                            </code>
                          </td>
                          <td className="px-2 py-4 text-left align-top">
                            <span className="text-sm text-gray-900 font-medium leading-relaxed block break-words">
                              {product.title || '—'}
                            </span>
                          </td>
                          <td className="px-2 py-4 text-left align-top">
                            {issueCount > 0 ? (
                              <div className="space-y-2">
                                {product.issues.map((issue, issueIndex) => (
                                  <div 
                                    key={issueIndex} 
                                    className="flex items-start gap-2 p-2.5 bg-amber-50 border-l-3 border-amber-400 rounded-r-md hover:bg-amber-100/70 transition-colors"
                                  >
                                    <div className="flex-shrink-0 mt-0.5">
                                      <div className="w-4 h-4 rounded-full bg-amber-200 flex items-center justify-center">
                                        <AlertTriangle size={10} className="text-amber-700" />
                                      </div>
                                    </div>
                                    <p className="text-sm text-gray-800 leading-relaxed flex-1 break-words whitespace-normal">
                                      {issue}
                                    </p>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2 px-2.5 py-2 bg-gray-50 rounded-md border border-gray-200">
                                <CheckCircle size={12} className="text-gray-400 flex-shrink-0" />
                                <span className="text-xs text-gray-500 italic">No issues recorded</span>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    }
                    
                    // Default row layout for other tabs
                    return (
                      <tr key={`${product.asin}-${index}`} className="hover:bg-gray-50 transition-colors">
                        <td className="px-2 py-3 text-center align-top">
                          <code className="text-xs font-mono text-gray-900 break-all">{product.asin}</code>
                        </td>
                        <td className="px-2 py-3 text-center align-top">
                          <span className="text-xs text-gray-600 break-words">{product.sku || '—'}</span>
                        </td>
                        <td className="px-2 py-3 text-left align-top">
                          <span className="text-xs text-gray-900 break-words line-clamp-2" title={product.title}>
                            {product.title || '—'}
                          </span>
                        </td>
                        {/* Status column - hidden in 'active' tab */}
                        {activeTab !== 'active' && (
                          <td className="px-2 py-3 text-center align-top">
                            <span 
                              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium"
                              style={{ backgroundColor: statusBadge.bg, color: statusBadge.color }}
                            >
                              {statusBadge.icon}
                              {product.status}
                            </span>
                          </td>
                        )}
                        <td className="px-2 py-3 text-center align-top">
                          {product.hasAPlus ? (
                            <Check size={16} className="text-green-600 font-bold mx-auto" strokeWidth={3} />
                          ) : (
                            <X size={16} className="text-red-600 font-bold mx-auto" strokeWidth={3} />
                          )}
                        </td>
                        <td className="px-2 py-3 text-center align-top">
                          {product.hasBrandstory ? (
                            <Check size={16} className="text-green-600 font-bold mx-auto" strokeWidth={3} />
                          ) : (
                            <X size={16} className="text-red-600 font-bold mx-auto" strokeWidth={3} />
                          )}
                        </td>
                        <td className="px-2 py-3 text-center align-top">
                          <span className="text-xs font-medium text-gray-900 whitespace-nowrap">
                            {product.price ? `$${parseFloat(product.price).toFixed(2)}` : '—'}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center align-top">
                          <span className="text-xs text-gray-600 whitespace-nowrap">
                            {product.numRatings ? parseInt(product.numRatings).toLocaleString() : '0'}
                          </span>
                        </td>
                        <td className="px-2 py-3 text-center align-top">
                          <div className="flex items-center justify-center gap-1">
                            <Star size={12} className="text-amber-400 fill-amber-400" />
                            <span className="text-xs font-medium text-gray-900 whitespace-nowrap">
                              {product.starRatings ? parseFloat(product.starRatings).toFixed(1) : '0.0'}
                            </span>
                          </div>
                        </td>
                        {/* Issues column - hidden in 'all' and 'active' tabs */}
                        {(activeTab === 'inactive' || activeTab === 'incomplete') && (
                          <td className="px-4 py-3 text-center">
                            {product.status === 'Active' ? (() => {
                              const totalIssues = getTotalIssues(product);
                              const rankingIssues = countRankingIssues(product);
                              const conversionIssues = countConversionIssues(product);
                              const inventoryIssues = countInventoryIssues(product);
                              const badge = getIssuesBadge(totalIssues);
                              // Non-clickable for inactive/incomplete tabs
                              return (
                                <span 
                                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium"
                                  style={{ backgroundColor: badge.bg, color: badge.color }}
                                  title={totalIssues > 0 ? `Ranking: ${rankingIssues}, Conversion: ${conversionIssues}, Inventory: ${inventoryIssues}` : 'No issues'}
                                >
                                  {totalIssues > 0 && <AlertTriangle size={12} />}
                                  {badge.text}
                                </span>
                              );
                            })() : (
                              <span className="text-sm text-gray-400">—</span>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={
                      (activeTab === 'inactive' || activeTab === 'incomplete') ? 4 : 
                      activeTab === 'all' ? 9 : 
                      activeTab === 'active' ? 8 : 10
                    } className="px-4 py-12 text-center text-gray-500">
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
          {hasMoreFromBackend && (
            <div className="px-4 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-center gap-4">
              <span className="text-sm text-gray-500">
                Showing {products.length} of {summary.totalProducts || pagination.totalItems || products.length} products
              </span>
              <button
                onClick={handleLoadMoreFromBackend}
                disabled={loadingMore}
                className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingMore ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    Loading...
                  </>
                ) : (
                  <>
                    Load More
                    <ChevronDown size={16} />
                  </>
                )}
              </button>
            </div>
          )}
          {!hasMoreFromBackend && products.length > 0 && (
            <div className="px-4 py-4 border-t border-gray-100 bg-gray-50 flex items-center justify-center">
              <span className="text-sm text-gray-500">
                Showing all {summary.totalProducts || products.length} products
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default YourProducts;
