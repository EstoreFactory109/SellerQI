import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useSelector, useDispatch } from 'react-redux';
import { ChevronDown, Search, Download, AlertCircle, DollarSign, Target, Info } from 'lucide-react';
import axiosInstance from '../config/axios.config.js';
import { formatCurrencyWithLocale } from '../utils/currencyUtils.js';
import {
  setInitialData,
  setLoadingAsins,
  setSelectedAsin,
  setKeywords,
  appendKeywords,
  setLoadingKeywords,
  setLoadingMoreKeywords,
  setCurrentFilter,
  setError
} from '../redux/slices/KeywordRecommendationsSlice.js';
import { TablePageSkeleton } from '../Components/Skeleton/PageSkeletons.jsx';

// Main Dashboard Component
const KeywordAnalysisDashboard = () => {
  const dispatch = useDispatch();
  const [activeTab, setActiveTab] = useState('all');
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'keyword', direction: 'desc' });
  const [isAsinDropdownOpen, setIsAsinDropdownOpen] = useState(false);
  const [asinSearchQuery, setAsinSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState(null);
  const [isSearching, setIsSearching] = useState(false);
  const asinDropdownRef = useRef(null);
  const hasInitializedRef = useRef(false);
  const searchDebounceRef = useRef(null);

  // Get data from Redux (optimized state - no more heavy keyword-analysis fetch)
  const asinsList = useSelector((state) => state.keywordRecommendations?.asinsList || []);
  const loadingAsins = useSelector((state) => state.keywordRecommendations?.loadingAsins || false);
  const selectedAsin = useSelector((state) => state.keywordRecommendations?.selectedAsin || '');
  const summary = useSelector((state) => state.keywordRecommendations?.summary || null);
  const keywords = useSelector((state) => state.keywordRecommendations?.keywords || []);
  const pagination = useSelector((state) => state.keywordRecommendations?.pagination || { page: 1, limit: 10, totalItems: 0, totalPages: 0, hasMore: false });
  const loadingKeywords = useSelector((state) => state.keywordRecommendations?.loadingKeywords || false);
  const loadingMoreKeywords = useSelector((state) => state.keywordRecommendations?.loadingMoreKeywords || false);
  const initialLoadComplete = useSelector((state) => state.keywordRecommendations?.initialLoadComplete || false);
  const reduxError = useSelector((state) => state.keywordRecommendations?.error);
  
  // Product info from the optimized initial response (name, sku for each ASIN)
  const productInfo = useSelector((state) => state.keywordRecommendations?.productInfo || {});

  // Get current marketplace from Redux
  const currentCountry = useSelector((state) => state.currency?.country) || '';
  const currency = useSelector((state) => state.currency?.currency) || '$';

  // Helper function to get product name by ASIN (uses productInfo from initial response)
  const getProductName = useCallback((asin) => {
    if (!asin) return '';
    return productInfo[asin]?.name || '';
  }, [productInfo]);

  // Helper function to get product SKU by ASIN (uses productInfo from initial response)
  const getProductSku = useCallback((asin) => {
    if (!asin) return '';
    return productInfo[asin]?.sku || '';
  }, [productInfo]);

  // Fetch initial data on mount
  useEffect(() => {
    if (hasInitializedRef.current || initialLoadComplete) return;
    
    const fetchInitialData = async () => {
      hasInitializedRef.current = true;
      dispatch(setLoadingAsins(true));
      dispatch(setLoadingKeywords(true));

      try {
        const response = await axiosInstance.get('/app/analyse/keywordOpportunities/initial?limit=10');
        
        if (response.data && response.data.data) {
          dispatch(setInitialData(response.data.data));
        }
      } catch (err) {
        console.error('Error fetching initial keyword opportunities data:', err);
        dispatch(setError(err.response?.data?.message || 'Failed to fetch keyword opportunities'));
        hasInitializedRef.current = false;
      }
    };

    fetchInitialData();
  }, [dispatch, initialLoadComplete]);

  // Fetch keywords when ASIN changes (after initial load)
  const fetchKeywordsForAsin = useCallback(async (asin, page = 1, filter = 'all', append = false) => {
    if (!asin) return;

    if (append) {
      dispatch(setLoadingMoreKeywords(true));
    } else {
      dispatch(setLoadingKeywords(true));
    }

    try {
      const response = await axiosInstance.get(`/app/analyse/keywordOpportunities/keywords?asin=${asin}&page=${page}&limit=10&filter=${filter}`);
      
      if (response.data && response.data.data) {
        const { keywords: newKeywords, pagination: newPagination, summary: newSummary } = response.data.data;
        
        if (append) {
          dispatch(appendKeywords({ asin, keywords: newKeywords, pagination: newPagination }));
        } else {
          dispatch(setKeywords({ asin, keywords: newKeywords, pagination: newPagination, summary: newSummary }));
        }
      }
    } catch (err) {
      console.error('Error fetching keywords for ASIN:', err);
      dispatch(setError(err.response?.data?.message || 'Failed to fetch keywords'));
    }
  }, [dispatch]);

  // Handle ASIN selection change
  const handleAsinSelect = useCallback((asin) => {
    if (asin === selectedAsin) {
      setIsAsinDropdownOpen(false);
      setAsinSearchQuery('');
      return;
    }

    dispatch(setSelectedAsin(asin));
    setIsAsinDropdownOpen(false);
    setAsinSearchQuery('');
    setActiveTab('all');
    
    // Fetch keywords for new ASIN
    fetchKeywordsForAsin(asin, 1, 'all', false);
  }, [selectedAsin, dispatch, fetchKeywordsForAsin]);

  // Handle tab change (filter)
  const handleTabChange = useCallback((tab) => {
    if (tab === activeTab) return;
    
    setActiveTab(tab);
    dispatch(setCurrentFilter(tab));
    
    // Fetch keywords with new filter
    if (selectedAsin) {
      fetchKeywordsForAsin(selectedAsin, 1, tab, false);
    }
  }, [activeTab, selectedAsin, dispatch, fetchKeywordsForAsin]);

  // Handle load more
  const handleLoadMore = useCallback(() => {
    if (!selectedAsin || loadingMoreKeywords || !pagination.hasMore) return;
    
    const nextPage = pagination.page + 1;
    fetchKeywordsForAsin(selectedAsin, nextPage, activeTab, true);
  }, [selectedAsin, loadingMoreKeywords, pagination.page, pagination.hasMore, activeTab, fetchKeywordsForAsin]);

  // Search ASINs with debounce
  const handleAsinSearch = useCallback((query) => {
    setAsinSearchQuery(query);
    
    // Clear previous timeout
    if (searchDebounceRef.current) {
      clearTimeout(searchDebounceRef.current);
    }

    if (!query.trim()) {
      setSearchResults(null);
      setIsSearching(false);
      return;
    }

    setIsSearching(true);

    // Debounce search
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const response = await axiosInstance.get(`/app/analyse/keywordOpportunities/search?query=${encodeURIComponent(query)}`);
        
        if (response.data && response.data.data) {
          setSearchResults(response.data.data.asinsList || []);
        }
      } catch (err) {
        console.error('Error searching ASINs:', err);
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);
  }, []);

  // Handle click outside dropdown
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (asinDropdownRef.current && !asinDropdownRef.current.contains(event.target)) {
        setIsAsinDropdownOpen(false);
        setAsinSearchQuery('');
        setSearchResults(null);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Get filtered ASINs for dropdown (use search results if searching, otherwise full list)
  const displayedAsinsList = useMemo(() => {
    if (searchResults !== null) {
      return searchResults;
    }
    
    if (!asinSearchQuery.trim()) {
      return asinsList;
    }
    
    // Local filter for fast response
    const query = asinSearchQuery.toLowerCase().trim();
    return asinsList.filter((asinItem) => {
      const asin = asinItem.asin?.toLowerCase() || '';
      const productName = getProductName(asinItem.asin)?.toLowerCase() || '';
      const productSku = getProductSku(asinItem.asin)?.toLowerCase() || '';
      return asin.includes(query) || productName.includes(query) || productSku.includes(query);
    });
  }, [asinsList, asinSearchQuery, searchResults, getProductName, getProductSku]);

  // Sort keywords locally
  const sortedKeywords = useMemo(() => {
    if (!keywords || keywords.length === 0) return [];
    
    const sorted = [...keywords];
    if (sortConfig.key) {
      sorted.sort((a, b) => {
        const aValue = a[sortConfig.key] || 0;
        const bValue = b[sortConfig.key] || 0;
        
        if (sortConfig.direction === 'asc') {
          return aValue > bValue ? 1 : -1;
        } else {
          return aValue < bValue ? 1 : -1;
        }
      });
    }
    return sorted;
  }, [keywords, sortConfig]);

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
      setSelectedKeywords(sortedKeywords.map(k => k.id));
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
    const dataToExport = sortedKeywords;

    const headers = [
      'Keyword',
      'Relevance Rank',
      'High Impression Share',
      'Impression Rank',
      'Suggested Bid Range Start',
      'Suggested Bid Range End',
      'Suggested Bid Median'
    ];

    const csvRows = [
      headers.join(','),
      ...dataToExport.map(keyword => {
        const suggestedBidStart = keyword.suggestedBid ? (keyword.suggestedBid.rangeStart / 100).toFixed(2) : '';
        const suggestedBidEnd = keyword.suggestedBid ? (keyword.suggestedBid.rangeEnd / 100).toFixed(2) : '';
        const suggestedBidMedian = keyword.suggestedBid ? (keyword.suggestedBid.rangeMedian / 100).toFixed(2) : '';
        
        return [
          `"${(keyword.keyword || '').replace(/"/g, '""')}"`,
          keyword.rank !== null ? keyword.rank : '',
          keyword.searchTermImpressionShare !== null ? keyword.searchTermImpressionShare.toFixed(2) : '',
          keyword.searchTermImpressionRank !== null ? keyword.searchTermImpressionRank : '',
          suggestedBidStart,
          suggestedBidEnd,
          suggestedBidMedian
        ].join(',');
      })
    ];

    const csvContent = csvRows.join('\n');
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

  // Calculate metrics from summary or keywords
  const metrics = useMemo(() => {
    if (summary) {
      return {
        totalKeywords: summary.totalKeywords || 0,
        avgBid: summary.avgBid?.toFixed(2) || '0.00',
        highRankKeywords: summary.highRelevanceCount || 0,
        highImpressionKeywords: summary.highImpressionCount || 0
      };
    }
    
    // Fallback calculation from keywords
    const totalKeywords = keywords.length;
    const avgBid = keywords.length > 0 
      ? (keywords.reduce((sum, k) => sum + (parseFloat(k.bid) || 0), 0) / keywords.length).toFixed(2)
      : '0.00';
    const highRankKeywords = keywords.filter(k => k.rank !== null && k.rank <= 10).length;
    const highImpressionKeywords = keywords.filter(k => k.searchTermImpressionShare !== null && k.searchTermImpressionShare >= 50).length;
    
    return { totalKeywords, avgBid, highRankKeywords, highImpressionKeywords };
  }, [summary, keywords]);

  // Loading state for initial load
  const isInitialLoading = loadingAsins && !initialLoadComplete;

  // Empty state when no ASINs
  if (!isInitialLoading && asinsList.length === 0 && !reduxError) {
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

  if (reduxError) {
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
          <p style={{ color: '#ef4444', fontSize: '12px' }}>{reduxError}</p>
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

        {/* Metrics Grid */}
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
                      placeholder="Search by ASIN, SKU, or product name..."
                      value={asinSearchQuery}
                      onChange={(e) => handleAsinSearch(e.target.value)}
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
                    {isSearching && (
                      <div className="loading" style={{ position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)' }} />
                    )}
                  </div>
                </div>

                {/* Dropdown Options */}
                <div style={{ 
                  maxHeight: '250px', 
                  overflowY: 'auto',
                  padding: '2px'
                }}>
                  {displayedAsinsList.length === 0 ? (
                    <div style={{ 
                      padding: '10px', 
                      textAlign: 'center', 
                      color: '#9ca3af', 
                      fontSize: '11px' 
                    }}>
                      {isSearching ? 'Searching...' : `No ASINs found matching "${asinSearchQuery}"`}
                    </div>
                  ) : (
                    displayedAsinsList.map((asinItem) => {
                      const productName = getProductName(asinItem.asin);
                      const productSku = getProductSku(asinItem.asin);
                      const isSelected = selectedAsin === asinItem.asin;
                      
                      return (
                        <button
                          key={asinItem.asin}
                          type="button"
                          onClick={() => handleAsinSelect(asinItem.asin)}
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
                            if (!isSelected) e.target.style.backgroundColor = '#161b22';
                          }}
                          onMouseLeave={(e) => {
                            if (!isSelected) e.target.style.backgroundColor = '#21262d';
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
                          {asinItem.keywordCount !== undefined && (
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

        {/* Loading state for initial load */}
        {isInitialLoading ? (
          <div style={{ marginTop: '24px' }}>
            <TablePageSkeleton rows={10} />
          </div>
        ) : (
        <>
        {/* Tabs */}
        <div className="tabs-container">
          <div 
            className={`tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => handleTabChange('all')}
          >
            All Keywords ({summary?.totalKeywords || pagination.totalItems || 0})
          </div>
          <div 
            className={`tab ${activeTab === 'highRank' ? 'active' : ''}`}
            onClick={() => handleTabChange('highRank')}
          >
            High Relevance ({summary?.highRelevanceCount || metrics.highRankKeywords})
          </div>
          <div 
            className={`tab ${activeTab === 'highImpression' ? 'active' : ''}`}
            onClick={() => handleTabChange('highImpression')}
          >
            High Impression ({summary?.highImpressionCount || metrics.highImpressionKeywords})
          </div>
        </div>

        {/* Keywords Table */}
        <div className="table-container-wrapper">
          <div className="table-container">
          {loadingKeywords ? (
            <div style={{ padding: '40px', textAlign: 'center' }}>
              <div className="loading" style={{ margin: '0 auto' }} />
              <p style={{ color: '#9ca3af', fontSize: '12px', marginTop: '10px' }}>Loading keywords...</p>
            </div>
          ) : (
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
              {sortedKeywords.length > 0 ? (
                sortedKeywords.map(keyword => {
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
          )}
          
          {/* Load More Controls */}
          {pagination.hasMore && (
            <div style={{
              padding: '8px 12px',
              borderTop: '1px solid #30363d',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              background: '#21262d'
            }}>
              <div style={{ fontSize: '11px', color: '#9ca3af', marginRight: '10px' }}>
                Showing {sortedKeywords.length} of {pagination.totalItems} keywords
              </div>
              <button
                onClick={handleLoadMore}
                disabled={loadingMoreKeywords}
                style={{
                  padding: '6px 12px',
                  border: '1px solid #3b82f6',
                  borderRadius: '4px',
                  background: loadingMoreKeywords ? '#1e3a5f' : '#3b82f6',
                  color: 'white',
                  cursor: loadingMoreKeywords ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px',
                  fontWeight: '500',
                  transition: 'background-color 0.2s'
                }}
                onMouseEnter={(e) => {
                  if (!loadingMoreKeywords) e.target.style.backgroundColor = '#2563eb';
                }}
                onMouseLeave={(e) => {
                  if (!loadingMoreKeywords) e.target.style.backgroundColor = '#3b82f6';
                }}
              >
                {loadingMoreKeywords ? (
                  <>
                    <div className="loading" />
                    Loading...
                  </>
                ) : (
                  <>
                    Load More
                    <ChevronDown size={12} />
                  </>
                )}
              </button>
            </div>
          )}
          {!pagination.hasMore && sortedKeywords.length > 0 && (
            <div style={{
              padding: '8px 12px',
              borderTop: '1px solid #30363d',
              display: 'flex',
              justifyContent: 'center',
              alignItems: 'center',
              background: '#21262d'
            }}>
              <div style={{ fontSize: '11px', color: '#9ca3af' }}>
                Showing all {pagination.totalItems} keywords
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
