import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { ChevronDown, ChevronUp, Search, Download, AlertCircle, DollarSign, Target, Filter, MoreVertical, Info } from 'lucide-react';
import axiosInstance from '../config/axios.config.js';
import { formatCurrencyWithLocale } from '../utils/currencyUtils.js';
import {
  setAsinsList,
  setLoadingAsins,
  setKeywordsForAsin,
  setLoadingKeywordsForAsin,
  setErrorForAsin,
  setError
} from '../redux/slices/KeywordRecommendationsSlice.js';
import { useKeywordAnalysisData } from '../hooks/usePageData.js';
import { TablePageSkeleton } from '../Components/Skeleton/PageSkeletons.jsx';

// Main Dashboard Component
const KeywordAnalysisDashboard = () => {
  const dispatch = useDispatch();
  const [activeTab, setActiveTab] = useState('all');
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'keyword', direction: 'desc' });
  const [itemsToShow, setItemsToShow] = useState(10);
  const [selectedAsin, setSelectedAsin] = useState('');
  const [isSwitchingAsin, setIsSwitchingAsin] = useState(false);
  const [isAsinDropdownOpen, setIsAsinDropdownOpen] = useState(false);
  const [asinSearchQuery, setAsinSearchQuery] = useState('');
  const asinDropdownRef = useRef(null);
  const itemsPerLoad = 10;
  const hasAutoSelectedRef = useRef(false);

  // Fetch keyword analysis data using the hook (automatically fetches on mount)
  const { data: keywordPageData, loading: keywordPageLoading, refetch: refetchKeywordData } = useKeywordAnalysisData();

  // Get data from Redux
  const asinsList = useSelector((state) => state.keywordRecommendations?.asinsList || []);
  const loadingAsins = useSelector((state) => state.keywordRecommendations?.loadingAsins || false);
  const keywordsByAsin = useSelector((state) => state.keywordRecommendations?.keywordsByAsin || {});
  const reduxError = useSelector((state) => state.keywordRecommendations?.error);

  // Get product data from page-wise data if available, fall back to legacy DashboardSlice
  // Backend returns data directly (not nested) e.g. { TotalProduct, productWiseError, ... }
  const legacyDashboardInfo = useSelector((state) => state.Dashboard?.DashBoardInfo);
  const dashboardInfo = keywordPageData || legacyDashboardInfo;
  const totalProducts = dashboardInfo?.TotalProduct || [];
  const productWiseError = dashboardInfo?.productWiseError || [];

  // Get current marketplace from Redux
  const currentCountry = useSelector((state) => state.currency?.country) || '';
  const currentRegion = useSelector((state) => state.currency?.region) || '';
  const currency = useSelector((state) => state.currency?.currency) || '$';

  // Helper function to get product name by ASIN
  const getProductName = (asin) => {
    if (!asin) return '';
    
    // Try to find in TotalProduct first
    const product = totalProducts.find(p => p.asin === asin);
    if (product) {
      return product.name || product.itemName || product.title || '';
    }
    
    // Try to find in productWiseError
    const productError = productWiseError.find(p => p.asin === asin);
    if (productError) {
      return productError.name || productError.itemName || productError.title || '';
    }
    
    return '';
  };

  // Helper function to get product SKU by ASIN
  const getProductSku = (asin) => {
    if (!asin) return '';
    
    // Try to find in TotalProduct first
    const product = totalProducts.find(p => p.asin === asin);
    if (product && product.sku) {
      return product.sku;
    }
    
    // Try to find in productWiseError
    const productError = productWiseError.find(p => p.asin === asin);
    if (productError && productError.sku) {
      return productError.sku;
    }
    
    return '';
  };

  // Get data for selected ASIN from Redux
  const selectedAsinData = keywordsByAsin[selectedAsin] || null;
  const keywordRecommendationsData = selectedAsinData?.data || null;
  const loading = selectedAsinData?.loading || false;
  const error = selectedAsinData?.error || reduxError;

  // Fetch ASINs list (only if not in Redux)
  useEffect(() => {
    const fetchAsinsList = async () => {
      // If ASINs list already exists in Redux, use it
      if (asinsList.length > 0) {
        // Auto-select first ASIN if available and none selected (only once)
        if (!selectedAsin && !hasAutoSelectedRef.current) {
          setSelectedAsin(asinsList[0].asin);
          hasAutoSelectedRef.current = true;
        }
        return;
      }

      // Reset auto-select flag when fetching new data
      hasAutoSelectedRef.current = false;
      
      dispatch(setLoadingAsins(true));
      try {
        const response = await axiosInstance.get('/app/analyse/keywordRecommendations/asins');
        
        if (response.data && response.data.data && response.data.data.asins) {
          const asins = response.data.data.asins;
          dispatch(setAsinsList(asins));
          
          // Auto-select first ASIN if available (only once)
          if (asins.length > 0 && !selectedAsin && !hasAutoSelectedRef.current) {
            setSelectedAsin(asins[0].asin);
            hasAutoSelectedRef.current = true;
          }
        }
      } catch (err) {
        console.error('Error fetching ASINs list:', err);
        dispatch(setError(err.response?.data?.message || 'Failed to fetch ASINs list'));
      } finally {
        dispatch(setLoadingAsins(false));
      }
    };

    fetchAsinsList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [asinsList.length, dispatch]); // Removed selectedAsin from dependencies to prevent infinite loop

  // Use a ref to track keywordsByAsin without causing re-renders
  const keywordsByAsinRef = useRef(keywordsByAsin);
  useEffect(() => {
    keywordsByAsinRef.current = keywordsByAsin;
  }, [keywordsByAsin]);

  // Fetch keyword recommendations data for selected ASIN (only if not in Redux or stale)
  useEffect(() => {
    // Track if the component is still mounted
    let isMounted = true;

    const fetchKeywordRecommendations = async () => {
      if (!selectedAsin) {
        setIsSwitchingAsin(false);
        return;
      }

      // Check if data already exists in Redux (using ref to avoid dependency loop)
      const existingData = keywordsByAsinRef.current[selectedAsin];
      if (existingData && existingData.data) {
        // Check if data is still fresh (less than 5 minutes old)
        const fetchedAt = existingData.fetchedAt ? new Date(existingData.fetchedAt).getTime() : 0;
        const isStale = (Date.now() - fetchedAt) > 5 * 60 * 1000; // 5 minutes
        
        if (!isStale) {
          // Data is fresh, no need to fetch or show loader
          setIsSwitchingAsin(false);
          return;
        }
        // Data is stale, will refetch but don't show loader (silent refresh)
      }

      // Show loader only when we need to fetch
      setIsSwitchingAsin(true);

      // Data doesn't exist, fetch it
      dispatch(setLoadingKeywordsForAsin({ asin: selectedAsin, loading: true }));
      dispatch(setErrorForAsin({ asin: selectedAsin, error: null }));
      
      try {
        const response = await axiosInstance.get(`/app/analyse/keywordRecommendations/byAsin?asin=${selectedAsin}`);
        
        if (!isMounted) return; // Don't update state if unmounted
        
        if (response.data && response.data.data) {
          dispatch(setKeywordsForAsin({ asin: selectedAsin, data: response.data.data }));
        } else {
          dispatch(setErrorForAsin({ asin: selectedAsin, error: 'No data received from server' }));
        }
      } catch (err) {
        if (!isMounted) return; // Don't update state if unmounted
        
        console.error('Error fetching keyword recommendations:', err);
        dispatch(setErrorForAsin({ 
          asin: selectedAsin, 
          error: err.response?.data?.message || 'Failed to fetch keyword recommendations' 
        }));
      } finally {
        if (isMounted) {
          // Hide loader after data is loaded
          setIsSwitchingAsin(false);
        }
      }
    };

    fetchKeywordRecommendations();

    // Cleanup function to prevent state updates on unmounted component
    return () => {
      isMounted = false;
    };
  }, [selectedAsin, dispatch]); // Removed keywordsByAsin from dependencies

  // Handle click outside dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (asinDropdownRef.current && !asinDropdownRef.current.contains(event.target)) {
        setIsAsinDropdownOpen(false);
        setAsinSearchQuery('');
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  // Filter ASINs based on search query
  const filteredAsinsList = useMemo(() => {
    if (!asinSearchQuery.trim()) {
      return asinsList;
    }
    
    const query = asinSearchQuery.toLowerCase().trim();
    return asinsList.filter((asinItem) => {
      const asin = asinItem.asin?.toLowerCase() || '';
      const productName = getProductName(asinItem.asin)?.toLowerCase() || '';
      const productSku = getProductSku(asinItem.asin)?.toLowerCase() || '';
      return asin.includes(query) || productName.includes(query) || productSku.includes(query);
    });
  }, [asinsList, asinSearchQuery, totalProducts, productWiseError]);

  // Transform keywordTargetList data to flat structure for table display
  const keywords = useMemo(() => {
    if (!keywordRecommendationsData?.keywordRecommendationData?.keywordTargetList) {
      return [];
    }

    const keywordTargetList = keywordRecommendationsData.keywordRecommendationData.keywordTargetList;
    const flattened = [];

    keywordTargetList.forEach((keywordTarget) => {
      // Each keywordTarget can have multiple bidInfo entries (one per match type)
      if (keywordTarget.bidInfo && keywordTarget.bidInfo.length > 0) {
        keywordTarget.bidInfo.forEach((bidInfo) => {
          flattened.push({
            id: `${keywordTarget.recId}-${bidInfo.matchType}`,
            keyword: keywordTarget.keyword || '',
            matchType: bidInfo.matchType || '',
            theme: bidInfo.theme || '',
            rank: bidInfo.rank || null,
            bid: bidInfo.bid || 0,
            suggestedBid: bidInfo.suggestedBid || null,
            translation: keywordTarget.translation || '',
            userSelectedKeyword: keywordTarget.userSelectedKeyword || false,
            searchTermImpressionRank: keywordTarget.searchTermImpressionRank || null,
            searchTermImpressionShare: keywordTarget.searchTermImpressionShare || null,
            recId: keywordTarget.recId || ''
          });
        });
      } else {
        // If no bidInfo, still add the keyword with default values
        flattened.push({
          id: `${keywordTarget.recId}-no-bid`,
          keyword: keywordTarget.keyword || '',
          matchType: 'N/A',
          theme: '',
          rank: null,
          bid: 0,
          suggestedBid: null,
          translation: keywordTarget.translation || '',
          userSelectedKeyword: keywordTarget.userSelectedKeyword || false,
          searchTermImpressionRank: keywordTarget.searchTermImpressionRank || null,
          searchTermImpressionShare: keywordTarget.searchTermImpressionShare || null,
          recId: keywordTarget.recId || ''
        });
      }
    });

    return flattened;
  }, [keywordRecommendationsData]);

  // Filter keywords - only show BROAD match type
  const filteredKeywords = useMemo(() => {
    // First filter to only BROAD match type
    let filtered = keywords.filter(k => k.matchType === 'BROAD');

    // Tab filtering
    if (activeTab === 'highRank') {
      filtered = filtered.filter(k => k.rank !== null && k.rank <= 10);
    } else if (activeTab === 'highImpression') {
      filtered = filtered.filter(k => k.searchTermImpressionShare !== null && k.searchTermImpressionShare >= 50);
    }

    // Sort
    if (sortConfig.key) {
      filtered.sort((a, b) => {
        const aValue = a[sortConfig.key] || 0;
        const bValue = b[sortConfig.key] || 0;
        
        if (sortConfig.direction === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });
    }

    return filtered;
  }, [keywords, activeTab, sortConfig]);

  // Load more items logic
  const displayedKeywords = useMemo(() => {
    return filteredKeywords.slice(0, itemsToShow);
  }, [filteredKeywords, itemsToShow]);

  const hasMoreItems = filteredKeywords.length > itemsToShow;

  // Reset items to show when tabs or sorting changes
  useEffect(() => {
    setItemsToShow(itemsPerLoad);
  }, [activeTab, sortConfig.key, selectedAsin]);

  // Load more function
  const handleLoadMore = () => {
    setItemsToShow(prev => prev + itemsPerLoad);
  };

  // Metrics calculation - only for BROAD match type keywords
  const metrics = useMemo(() => {
    const broadKeywords = keywords.filter(k => k.matchType === 'BROAD');
    const totalKeywords = broadKeywords.length;
    const uniqueKeywords = new Set(broadKeywords.map(k => k.keyword)).size;
    const avgBid = broadKeywords.length > 0 
      ? (broadKeywords.reduce((sum, k) => sum + (parseFloat(k.bid) || 0), 0) / broadKeywords.length).toFixed(2)
      : '0.00';
    const highRankKeywords = broadKeywords.filter(k => k.rank !== null && k.rank <= 10).length;
    const totalImpressionShare = broadKeywords.reduce((sum, k) => sum + (parseFloat(k.searchTermImpressionShare) || 0), 0);
    const avgImpressionShare = broadKeywords.length > 0 
      ? (totalImpressionShare / broadKeywords.length).toFixed(2)
      : '0.00';
    
    return {
      totalKeywords,
      uniqueKeywords,
      avgBid,
      highRankKeywords,
      avgImpressionShare
    };
  }, [keywords]);

  // Handle sort
  const handleSort = (key) => {
    setSortConfig(prev => ({
      key,
      direction: prev.key === key && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  };

  // Select all keywords
  const handleSelectAll = (e) => {
    if (e.target.checked) {
      setSelectedKeywords(displayedKeywords.map(k => k.id));
    } else {
      setSelectedKeywords([]);
    }
  };

  // Toggle keyword selection
  const toggleKeywordSelection = (id) => {
    setSelectedKeywords(prev => 
      prev.includes(id) 
        ? prev.filter(kId => kId !== id)
        : [...prev, id]
    );
  };

  // Export to CSV
  const exportToCSV = () => {
    // Get the filtered keywords (already filtered to BROAD only)
    const dataToExport = filteredKeywords;

    // Define CSV headers
    const headers = [
      'Keyword',
      'Relevance Rank',
      'High Impression Share',
      'Impression Rank',
      'Suggested Bid Range Start',
      'Suggested Bid Range End',
      'Suggested Bid Median'
    ];

    // Convert data to CSV rows
    const csvRows = [
      headers.join(','),
      ...dataToExport.map(keyword => {
        const suggestedBidStart = keyword.suggestedBid ? (keyword.suggestedBid.rangeStart / 100).toFixed(2) : '';
        const suggestedBidEnd = keyword.suggestedBid ? (keyword.suggestedBid.rangeEnd / 100).toFixed(2) : '';
        const suggestedBidMedian = keyword.suggestedBid ? (keyword.suggestedBid.rangeMedian / 100).toFixed(2) : '';
        
        return [
          `"${(keyword.keyword || '').replace(/"/g, '""')}"`, // Escape quotes in keyword
          keyword.rank !== null ? keyword.rank : '',
          keyword.searchTermImpressionShare !== null ? keyword.searchTermImpressionShare.toFixed(2) : '',
          keyword.searchTermImpressionRank !== null ? keyword.searchTermImpressionRank : '',
          suggestedBidStart,
          suggestedBidEnd,
          suggestedBidMedian
        ].join(',');
      })
    ];

    // Create CSV content
    const csvContent = csvRows.join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `keyword-recommendations-${selectedAsin || 'all'}-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Empty state only when not loading (when loading, we show header + skeleton below)
  if (!loadingAsins && asinsList.length === 0) {
    return (
      <div className="dashboard-container">
        <div className="container" style={{ padding: '10px 0' }}>
          <div className="bg-[#161b22] rounded border border-[#30363d] p-4 text-center">
            <AlertCircle size={32} color="#ef4444" className="mx-auto mb-2" />
            <p style={{ color: '#ef4444', fontSize: '12px' }}>No ASINs with keyword recommendations found. Please ensure keyword data has been processed.</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="dashboard-container">
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          minHeight: '100vh',
          flexDirection: 'column',
          gap: '10px'
        }}>
          <AlertCircle size={32} color="#ef4444" />
          <p style={{ color: '#ef4444', fontSize: '12px' }}>{error}</p>
        </div>
      </div>
    );
  }

  // Get selected ASIN info
  const selectedAsinInfo = asinsList.find(a => a.asin === selectedAsin);

  return (
    <div className="dashboard-container">
      <style>{`
        .dashboard-container {
          min-height: 100vh;
          background: #1a1a1a;
          padding: 10px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .container {
          max-width: 1400px;
          margin: 0 auto;
        }
        
        .header {
          background: #161b22;
          padding: 10px 15px;
          border-radius: 6px;
          border: 1px solid #30363d;
          margin-bottom: 10px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .logo {
          font-size: 16px;
          font-weight: 700;
          color: #f3f4f6;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .asin-filter-container {
          background: #161b22;
          padding: 8px 12px;
          border-radius: 6px;
          border: 1px solid #30363d;
          margin-bottom: 10px;
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .asin-filter-label {
          font-size: 12px;
          font-weight: 600;
          color: #9ca3af;
          white-space: nowrap;
        }
        
        .asin-filter-select {
          flex: 1;
          min-width: 0;
          padding: 6px 10px;
          border: 1px solid #30363d;
          border-radius: 6px;
          background: #1a1a1a;
          font-size: 12px;
          font-weight: 500;
          color: #f3f4f6;
          cursor: pointer;
          transition: all 0.2s;
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 12 12'%3E%3Cpath fill='%239ca3af' d='M6 9L1 4h10z'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 10px center;
          padding-right: 30px;
        }
        
        .asin-filter-select option {
          padding: 6px;
          white-space: normal;
          background: #21262d;
          color: #f3f4f6;
        }
        
        .asin-filter-select:hover:not(:disabled) {
          border-color: #3b82f6;
        }
        
        .asin-filter-select:focus:not(:disabled) {
          outline: none;
          border-color: #3b82f6;
          box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
        }
        
        .asin-filter-select:disabled {
          background-color: #21262d;
          color: #6b7280;
          cursor: not-allowed;
        }
        
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 8px;
          margin-bottom: 10px;
        }
        
        .metric-card {
          background: #161b22;
          padding: 10px;
          border-radius: 6px;
          border: 1px solid #30363d;
        }
        
        .metric-content {
          flex: 1;
        }
        
        .metric-label {
          font-size: 11px;
          color: #9ca3af;
          margin-bottom: 2px;
          display: flex;
          align-items: center;
          gap: 6px;
        }
        
        .metric-label-icon {
          color: #60a5fa;
          flex-shrink: 0;
        }
        
        .metric-value {
          font-size: 18px;
          font-weight: 700;
          color: #f3f4f6;
        }
        
        .icon-blue { color: #60a5fa; }
        .icon-green { color: #34d399; }
        .icon-orange { color: #fb923c; }
        .icon-purple { color: #c084fc; }
        
        .tabs-container {
          background: #161b22;
          border-radius: 6px 6px 0 0;
          padding: 0 12px;
          display: flex;
          gap: 16px;
          border-bottom: 1px solid #30363d;
          border: 1px solid #30363d;
          border-bottom: 1px solid #30363d;
        }
        
        .tab {
          padding: 8px 0;
          border-bottom: 2px solid transparent;
          cursor: pointer;
          font-weight: 500;
          color: #9ca3af;
          transition: all 0.2s;
          font-size: 12px;
        }
        
        .tab:hover {
          color: #d1d5db;
        }
        
        .tab.active {
          color: #60a5fa;
          border-bottom-color: #3b82f6;
        }
        
        .filters-bar {
          background: #21262d;
          padding: 8px 12px;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-left: 1px solid #30363d;
          border-right: 1px solid #30363d;
        }
        
        .filter-group {
          display: flex;
          gap: 6px;
        }
        
        .filter-select {
          padding: 4px 8px;
          border: 1px solid #30363d;
          border-radius: 4px;
          background: #1a1a1a;
          font-size: 11px;
          color: #f3f4f6;
          cursor: pointer;
        }
        
        .table-container {
          background: #161b22;
          border-radius: 0 0 6px 6px;
          overflow-x: hidden;
          overflow-y: visible;
          border: 1px solid #30363d;
          border-top: none;
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
          table-layout: fixed;
        }
        
        thead {
          background: #21262d;
          position: relative;
        }
        
        th {
          padding: 8px 10px;
          text-align: left;
          font-size: 10px;
          font-weight: 600;
          color: #9ca3af;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          cursor: pointer;
          user-select: none;
          word-wrap: break-word;
          overflow-wrap: break-word;
          word-break: break-word;
        }
        
        th:hover {
          color: #d1d5db;
        }
        
        td {
          padding: 8px 10px;
          border-top: 1px solid #30363d;
          font-size: 11px;
          text-align: left;
          word-wrap: break-word;
          overflow-wrap: break-word;
          word-break: break-word;
          color: #f3f4f6;
        }
        
        tbody tr {
          border-bottom: 1px solid #30363d;
        }
        
        .keyword-cell {
          font-weight: 500;
          color: #f3f4f6;
          word-wrap: break-word;
          overflow-wrap: break-word;
          word-break: break-word;
        }
        
        .badge {
          display: inline-block;
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
        }
        
        .match-type-badge {
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
        }
        
        .empty-state {
          padding: 60px 20px;
          text-align: center;
          color: #64748b;
        }
        
        .loading {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid #e2e8f0;
          border-top-color: #3b82f6;
          border-radius: 50%;
          animation: spin 0.8s linear infinite;
        }
        
        .table-container-wrapper {
          position: relative;
          overflow: visible;
        }
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
        
        @keyframes fadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        
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
          left: 0;
          transform: translateY(4px);
          margin-top: 6px;
          padding: 8px 10px;
          background: #21262d;
          color: #f3f4f6;
          border: 1px solid #30363d;
          border-radius: 6px;
          font-size: 11px;
          font-weight: 400;
          line-height: 1.4;
          white-space: normal;
          width: 240px;
          max-width: calc(100vw - 40px);
          z-index: 10000;
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.2s, transform 0.2s;
          text-align: left;
          box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2);
        }
        
        .tooltip-container:hover .tooltip-content {
          opacity: 1;
          pointer-events: auto;
          transform: translateY(0);
        }
        
        /* Adjust tooltip position for right edge (last column) */
        .tooltip-container.tooltip-last .tooltip-content {
          left: auto;
          right: 0;
          transform: translateX(0) translateY(4px);
          text-align: left;
        }
        
        .tooltip-container.tooltip-last:hover .tooltip-content {
          transform: translateX(0) translateY(0);
        }
        
        .tooltip-content::before {
          content: '';
          position: absolute;
          bottom: 100%;
          left: 16px;
          transform: translateX(0);
          border: 5px solid transparent;
          border-bottom-color: #21262d;
        }
        
        .tooltip-container.tooltip-last .tooltip-content::before {
          left: auto;
          right: 20px;
          transform: translateX(0);
        }
        
        .th-with-tooltip {
          display: flex;
          align-items: center;
          justify-content: flex-start;
          gap: 4px;
        }
      `}</style>

      <div className="container">
        {/* Header */}
        <div className="header">
          <div className="logo">
            🎯 Keyword Opportunities Dashboard
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button
              onClick={exportToCSV}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                padding: '6px 12px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: '500',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#2563eb'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#3b82f6'}
            >
              <Download size={14} />
              Export CSV
            </button>
            <div style={{ fontSize: '11px', color: '#9ca3af' }}>
              {currentCountry ? `Marketplace: ${currentCountry.toUpperCase()}` : 'Amazon Ads'}
            </div>
          </div>
        </div>

        {/* Metrics Grid - boxes first like other pages */}
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-content">
              <div className="metric-label">
                <Search className="metric-label-icon" size={14} />
                <span>Total Recommendations</span>
              </div>
              <div className="metric-value">{metrics.totalKeywords}</div>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-content">
              <div className="metric-label">
                <DollarSign className="metric-label-icon" size={14} />
                <span>Avg. Bid</span>
              </div>
              <div className="metric-value">{formatCurrencyWithLocale(parseFloat(metrics.avgBid) || 0, currency, 2)}</div>
            </div>
          </div>
          <div className="metric-card">
            <div className="metric-content">
              <div className="metric-label">
                <Target className="metric-label-icon" size={14} />
                <span>High Relevance Keywords</span>
              </div>
              <div className="metric-value">{metrics.highRankKeywords}</div>
            </div>
          </div>
        </div>

        {/* ASIN Filter - Custom Dropdown with Search */}
        <div className="asin-filter-container" ref={asinDropdownRef}>
          <div className="asin-filter-label">Filter by ASIN:</div>
          <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
            <button
              type="button"
            className="asin-filter-select"
              onClick={() => setIsAsinDropdownOpen(!isAsinDropdownOpen)}
              disabled={loadingAsins || asinsList.length === 0}
              style={{
                width: '100%',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                border: '1px solid #30363d',
                borderRadius: '6px',
                background: '#1a1a1a',
                fontSize: '12px',
                fontWeight: '500',
                color: selectedAsin ? '#f3f4f6' : '#6b7280',
                cursor: (loadingAsins || asinsList.length === 0) ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s',
                appearance: 'none',
                paddingRight: '30px'
              }}
            >
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {loadingAsins ? 'Loading ASINs...' : 
                 asinsList.length === 0 ? 'No ASINs available' :
                 selectedAsin ? (() => {
                   const productName = getProductName(selectedAsin);
                   const productSku = getProductSku(selectedAsin);
                   const selectedItem = asinsList.find(a => a.asin === selectedAsin);
                   const skuDisplay = productSku ? ` | SKU: ${productSku}` : '';
                   const asinSkuDisplay = `ASIN: ${selectedAsin}${skuDisplay}`;
                   return productName 
                     ? `${asinSkuDisplay} - ${productName}${selectedItem?.keywordCount ? ` (${selectedItem.keywordCount} keywords)` : ''}`
                     : `${asinSkuDisplay}${selectedItem?.keywordCount ? ` (${selectedItem.keywordCount} keywords)` : ''}`;
                 })() : 'Select an ASIN'}
              </span>
              <ChevronDown 
                size={14} 
                style={{ 
                  position: 'absolute', 
                  right: '10px', 
                  color: '#9ca3af',
                  transform: isAsinDropdownOpen ? 'rotate(180deg)' : 'rotate(0deg)',
                  transition: 'transform 0.2s'
                }} 
              />
            </button>

            {isAsinDropdownOpen && !loadingAsins && asinsList.length > 0 && (
              <div style={{
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                marginTop: '2px',
                backgroundColor: '#21262d',
                border: '1px solid #30363d',
                borderRadius: '6px',
                boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.3), 0 2px 4px -1px rgba(0, 0, 0, 0.2)',
                zIndex: 1000,
                maxHeight: '300px',
                display: 'flex',
                flexDirection: 'column'
              }}>
                {/* Search Bar */}
                <div style={{ padding: '6px', borderBottom: '1px solid #30363d' }}>
                  <div style={{ position: 'relative' }}>
                    <Search 
                      size={14} 
                      style={{ 
                        position: 'absolute', 
                        left: '8px', 
                        top: '50%', 
                        transform: 'translateY(-50%)', 
                        color: '#6b7280' 
                      }} 
                    />
                    <input
                      type="text"
                      placeholder="Search by ASIN or product name..."
                      value={asinSearchQuery}
                      onChange={(e) => setAsinSearchQuery(e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        width: '100%',
                        padding: '6px 8px 6px 28px',
                        border: '1px solid #30363d',
                        borderRadius: '4px',
                        fontSize: '11px',
                        outline: 'none',
                        transition: 'border-color 0.2s',
                        backgroundColor: '#1a1a1a',
                        color: '#f3f4f6'
                      }}
                      onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
                      onBlur={(e) => e.target.style.borderColor = '#30363d'}
                    />
                  </div>
                </div>

                {/* Dropdown Options */}
                <div style={{ 
                  maxHeight: '250px', 
                  overflowY: 'auto',
                  padding: '2px'
                }}>
                  {filteredAsinsList.length === 0 ? (
                    <div style={{ 
                      padding: '10px', 
                      textAlign: 'center', 
                      color: '#9ca3af', 
                      fontSize: '11px' 
                    }}>
                      No ASINs found matching "{asinSearchQuery}"
                    </div>
                  ) : (
                    filteredAsinsList.map((asinItem) => {
                      const productName = getProductName(asinItem.asin);
                      const productSku = getProductSku(asinItem.asin);
                      const isSelected = selectedAsin === asinItem.asin;
                      
                      return (
                        <button
                          key={asinItem.asin}
                          type="button"
                          onClick={() => {
                            setSelectedAsin(asinItem.asin);
                            setIsAsinDropdownOpen(false);
                            setAsinSearchQuery('');
                          }}
                          style={{
                            width: '100%',
                            padding: '8px 10px',
                            textAlign: 'left',
                            border: 'none',
                            background: isSelected ? 'rgba(59, 130, 246, 0.2)' : '#21262d',
                            color: isSelected ? '#60a5fa' : '#f3f4f6',
                            cursor: 'pointer',
                            fontSize: '11px',
                            transition: 'background-color 0.15s',
                            borderRadius: '6px',
                            margin: '2px 0'
                          }}
                          onMouseEnter={(e) => {
                            if (!isSelected) {
                              e.target.style.backgroundColor = '#161b22';
                            }
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) {
                              e.target.style.backgroundColor = '#21262d';
                            }
                          }}
                        >
                          <div style={{ fontWeight: isSelected ? '600' : '500', marginBottom: '2px', fontSize: '11px' }}>
                            {productSku 
                              ? `ASIN: ${asinItem.asin} | SKU: ${productSku}`
                              : `ASIN: ${asinItem.asin}`
                            }
                          </div>
                          {productName && (
                            <div style={{ 
                              fontSize: '10px', 
                              color: isSelected ? '#60a5fa' : '#9ca3af',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap'
                            }}>
                              {productName}
                            </div>
                          )}
                          {asinItem.keywordCount && (
                            <div style={{ 
                              fontSize: '10px', 
                              color: isSelected ? '#60a5fa' : '#9ca3af',
                              marginTop: '2px'
                            }}>
                              {asinItem.keywordCount} keywords
                            </div>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Only data-dependent content shows skeleton when loading */}
        {(loadingAsins || (loading && selectedAsin)) ? (
          <div style={{ marginTop: '24px' }}>
            <TablePageSkeleton rows={10} />
          </div>
        ) : (
        <>
        {/* Tabs */}
        <div className="tabs-container">
          <div 
            className={`tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Keywords ({keywords.filter(k => k.matchType === 'BROAD').length})
          </div>
          <div 
            className={`tab ${activeTab === 'highRank' ? 'active' : ''}`}
            onClick={() => setActiveTab('highRank')}
          >
            High Relevance ({keywords.filter(k => k.matchType === 'BROAD' && k.rank !== null && k.rank <= 10).length})
          </div>
          <div 
            className={`tab ${activeTab === 'highImpression' ? 'active' : ''}`}
            onClick={() => setActiveTab('highImpression')}
          >
            High Impression ({keywords.filter(k => k.matchType === 'BROAD' && k.searchTermImpressionShare !== null && k.searchTermImpressionShare >= 50).length})
          </div>
        </div>

        {/* Keywords Table */}
        <div className="table-container-wrapper">
          <div className="table-container">
          <table>
            <thead>
              <tr>
                <th style={{ width: '30%' }} onClick={() => handleSort('keyword')}>
                  Keyword {sortConfig.key === 'keyword' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th style={{ width: '15%' }} onClick={() => handleSort('rank')}>
                  <div className="th-with-tooltip">
                    <span>Relevance Rank {sortConfig.key === 'rank' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</span>
                    <div className="tooltip-container" onClick={(e) => e.stopPropagation()}>
                      <Info className="tooltip-icon" />
                      <div className="tooltip-content">
                        <strong>Relevance Rank (Lower the better)</strong><br />
                        Estimate of how well this keyword matches your product - Rank 1 is their top pick, but always check search volume and competition before committing.
                      </div>
                    </div>
                  </div>
                </th>
                <th style={{ width: '18%' }} onClick={() => handleSort('searchTermImpressionShare')}>
                  <div className="th-with-tooltip">
                    <span>High Impression Share {sortConfig.key === 'searchTermImpressionShare' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</span>
                    <div className="tooltip-container" onClick={(e) => e.stopPropagation()}>
                      <Info className="tooltip-icon" />
                      <div className="tooltip-content">
                        <strong>Impression Share</strong><br />
                        The percentage of times your ad showed when it could have - if it's low, you're either getting outbid or hitting your budget cap before the day ends.
                      </div>
                    </div>
                  </div>
                </th>
                <th style={{ width: '15%' }} onClick={() => handleSort('searchTermImpressionRank')}>
                  <div className="th-with-tooltip">
                    <span>Impression Rank {sortConfig.key === 'searchTermImpressionRank' && (sortConfig.direction === 'asc' ? '↑' : '↓')}</span>
                    <div className="tooltip-container" onClick={(e) => e.stopPropagation()}>
                      <Info className="tooltip-icon" />
                      <div className="tooltip-content">
                        <strong>Impression Rank</strong><br />
                        Where your ad typically shows on the page - top positions get more clicks but cost more, while lower placements are cheaper but less visible.
                      </div>
                    </div>
                  </div>
                </th>
                <th style={{ width: '22%' }}>
                  <div className="th-with-tooltip">
                    <span>Suggested Bid Range</span>
                    <div className="tooltip-container tooltip-last">
                      <Info className="tooltip-icon" />
                      <div className="tooltip-content">
                        <strong>Suggested Bid Range</strong><br />
                        Recommended bid to stay competitive, start on the lower end and adjust based on actual performance.
                      </div>
                    </div>
                  </div>
                </th>
              </tr>
            </thead>
            <tbody>
              {displayedKeywords.length > 0 ? (
                displayedKeywords.map(keyword => {
                  return (
                    <tr key={keyword.id}>
                      <td>
                        <span className="keyword-cell">{keyword.keyword || 'N/A'}</span>
                      </td>
                      <td>
                        {keyword.rank !== null ? (
                          <span style={{ fontWeight: 600, color: keyword.rank <= 5 ? '#34d399' : keyword.rank <= 10 ? '#fbbf24' : '#f87171' }}>
                            #{keyword.rank}
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        {keyword.searchTermImpressionShare !== null ? `${keyword.searchTermImpressionShare.toFixed(2)}%` : '—'}
                      </td>
                      <td>
                        {keyword.searchTermImpressionRank !== null ? `#${keyword.searchTermImpressionRank}` : '—'}
                      </td>
                      <td>
                        {keyword.suggestedBid ? (
                          <span style={{ fontSize: '10px', color: '#9ca3af' }}>
                            ${(keyword.suggestedBid.rangeStart / 100).toFixed(2)} - ${(keyword.suggestedBid.rangeEnd / 100).toFixed(2)}
                            <br />
                            <span style={{ color: '#60a5fa', fontWeight: 600 }}>
                              Median: ${(keyword.suggestedBid.rangeMedian / 100).toFixed(2)}
                            </span>
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={5} className="empty-state">
                    {keywords.length === 0 
                      ? `No keyword recommendations available for ASIN: ${selectedAsin}. Please ensure data is loaded.`
                      : 'No keywords found matching your filters'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          
          {/* Load More Controls */}
          {hasMoreItems && (
            <div style={{
              padding: '8px 12px',
              borderTop: '1px solid #30363d',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              background: '#21262d'
            }}>
              <div style={{ fontSize: '11px', color: '#9ca3af', marginRight: '10px' }}>
                Showing {displayedKeywords.length} of {filteredKeywords.length} keywords
              </div>
              <button
                onClick={handleLoadMore}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #3b82f6',
                  borderRadius: '4px',
                  background: '#3b82f6',
                  color: 'white',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  fontWeight: '500',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => e.target.style.backgroundColor = '#2563eb'}
                onMouseLeave={(e) => e.target.style.backgroundColor = '#3b82f6'}
              >
                Load More
                <ChevronDown size={12} />
              </button>
            </div>
          )}
          {!hasMoreItems && displayedKeywords.length > itemsPerLoad && (
            <div style={{
              padding: '8px 12px',
              borderTop: '1px solid #30363d',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              background: '#21262d'
            }}>
              <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                Showing all {filteredKeywords.length} keywords
              </div>
            </div>
          )}
          </div>
        </div>
        </>
        )}
      </div>
    </div>
  );
};

export default KeywordAnalysisDashboard;
