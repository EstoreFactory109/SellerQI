import React, { useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { ChevronDown, ChevronUp, Search, Download, TrendingUp, AlertCircle, CheckCircle, DollarSign, Target, Filter, MoreVertical, ChevronLeft, ChevronRight } from 'lucide-react';

// Main Dashboard Component
const KeywordAnalysisDashboard = () => {
  const [selectedAsin, setSelectedAsin] = useState('');
  const [analyzedAsin, setAnalyzedAsin] = useState(''); // ASIN used for filtering table data
  const [activeTab, setActiveTab] = useState('all');
  const [loading, setLoading] = useState(false);
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'searchVolume', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  const [filters, setFilters] = useState({
    competition: 'all',
    indexed: 'all'
  });

  // Get keywordTrackingData from Redux
  const keywordTrackingData = useSelector((state) => state.Dashboard.DashBoardInfo?.keywordTrackingData) || [];
  
  // Get current marketplace from Redux (from currency slice or keyword data)
  const currentCountry = useSelector((state) => state.currency?.country) || '';
  const currentMarketplace = useMemo(() => {
    // First try to get from keywordTrackingData
    if (keywordTrackingData.length > 0 && keywordTrackingData[0].country) {
      return keywordTrackingData[0].country.toUpperCase();
    }
    // Fallback to currency slice
    if (currentCountry) {
      return currentCountry.toUpperCase();
    }
    return 'N/A';
  }, [keywordTrackingData, currentCountry]);
  
  // Transform Redux data to match component needs and filter by analyzed ASIN (only when button is clicked)
  const keywords = useMemo(() => {
    if (!keywordTrackingData || keywordTrackingData.length === 0) return [];
    
    let filtered = keywordTrackingData;
    
    // Filter by ASIN only if analyze button was clicked (analyzedAsin is set)
    if (analyzedAsin) {
      filtered = filtered.filter(k => k.asin === analyzedAsin);
    }
    
    // Add unique IDs for selection management
    return filtered.map((keyword, index) => ({
      ...keyword,
      id: `${keyword.asin}-${keyword.keyword}-${index}`,
      keyword: keyword.keyword || '',
      asin: keyword.asin || '',
      searchVolume: keyword.searchVolume || 0,
      competition: keyword.competition || 'unknown',
      difficulty: keyword.difficulty || 0,
      cpc: keyword.cpc || 0,
      rank: keyword.rank || null,
      isIndexed: keyword.isIndexed !== undefined ? keyword.isIndexed : null,
      impressions: keyword.impressions || 0,
      clicks: keyword.clicks || 0,
      ctr: keyword.ctr || 0,
      sponsored: keyword.sponsored !== undefined ? keyword.sponsored : false,
      country: keyword.country || '',
      region: keyword.region || ''
    }));
  }, [keywordTrackingData, analyzedAsin]);

  // Get unique ASINs from keywordTrackingData for product selection
  const products = useMemo(() => {
    const uniqueAsins = new Set();
    keywordTrackingData.forEach(k => {
      if (k.asin) uniqueAsins.add(k.asin);
    });
    return Array.from(uniqueAsins).map(asin => ({
      asin: asin,
      name: `Product ${asin}`,
      category: 'Product'
    }));
  }, [keywordTrackingData]);

  // Set default ASIN when products are loaded (for dropdown selection only)
  useEffect(() => {
    if (products.length > 0 && !selectedAsin) {
      setSelectedAsin(products[0].asin);
    }
  }, [products, selectedAsin]);

  // Filter keywords based on active tab and filters
  const filteredKeywords = useMemo(() => {
    let filtered = [...keywords];

    // Tab filtering
    if (activeTab === 'indexed') {
      filtered = filtered.filter(k => k.isIndexed === true);
    } else if (activeTab === 'notIndexed') {
      filtered = filtered.filter(k => k.isIndexed === false || k.isIndexed === null);
    } else if (activeTab === 'ranked') {
      filtered = filtered.filter(k => k.rank !== null && k.rank !== undefined);
    } else if (activeTab === 'campaignKeywords') {
      filtered = filtered.filter(k => k.sponsored === true);
    }

    // Apply filters
    if (filters.competition !== 'all') {
      filtered = filtered.filter(k => k.competition && k.competition.toLowerCase() === filters.competition.toLowerCase());
    }
    if (filters.indexed !== 'all') {
      filtered = filtered.filter(k => k.isIndexed === (filters.indexed === 'indexed'));
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
  }, [keywords, activeTab, filters, sortConfig]);

  // Pagination calculations
  const totalPages = useMemo(() => Math.ceil(filteredKeywords.length / itemsPerPage), [filteredKeywords.length]);
  
  const paginatedKeywords = useMemo(() => {
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    return filteredKeywords.slice(indexOfFirstItem, indexOfLastItem);
  }, [filteredKeywords, currentPage]);

  // Reset to page 1 when filters, tabs, sorting, or analyzed ASIN changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, filters, sortConfig.key, analyzedAsin]);

  // Metrics calculation
  const metrics = useMemo(() => {
    const totalKeywords = keywords.length;
    const indexedKeywords = keywords.filter(k => k.isIndexed === true).length;
    const avgCpc = keywords.length > 0 
      ? (keywords.reduce((sum, k) => sum + (parseFloat(k.cpc) || 0), 0) / keywords.length).toFixed(2)
      : '0.00';
    const rankedKeywords = keywords.filter(k => k.rank !== null && k.rank !== undefined).length;
    const totalImpressions = keywords.reduce((sum, k) => sum + (parseFloat(k.impressions) || 0), 0);
    const totalClicks = keywords.reduce((sum, k) => sum + (parseFloat(k.clicks) || 0), 0);
    
    return {
      totalKeywords,
      indexedKeywords,
      avgCpc,
      rankedKeywords,
      totalImpressions,
      totalClicks
    };
  }, [keywords]);

  // Handle analyze - filter table by selected ASIN
  const handleAnalyze = async () => {
    if (!selectedAsin) {
      alert('Please select an ASIN first');
      return;
    }
    
    setLoading(true);
    // Set the analyzed ASIN to filter the table
    setTimeout(() => {
      setAnalyzedAsin(selectedAsin);
      setLoading(false);
      setCurrentPage(1); // Reset to first page
    }, 500);
  };

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
      setSelectedKeywords(paginatedKeywords.map(k => k.id));
    } else {
      setSelectedKeywords([]);
    }
  };

  // Pagination navigation functions
  const goToPage = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const goToPreviousPage = () => {
    setCurrentPage(prev => Math.max(prev - 1, 1));
  };

  const goToNextPage = () => {
    setCurrentPage(prev => Math.min(prev + 1, totalPages));
  };

  // Toggle keyword selection
  const toggleKeywordSelection = (id) => {
    setSelectedKeywords(prev => 
      prev.includes(id) 
        ? prev.filter(kId => kId !== id)
        : [...prev, id]
    );
  };

  return (
    <div className="dashboard-container">
      <style>{`
        .dashboard-container {
          min-height: 100vh;
          background: #f5f6fa;
          padding: 20px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .container {
          max-width: 1400px;
          margin: 0 auto;
        }
        
        .header {
          background: white;
          padding: 20px 30px;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          margin-bottom: 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .logo {
          font-size: 24px;
          font-weight: 700;
          color: #1e293b;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        
        .sync-status {
          display: flex;
          align-items: center;
          gap: 8px;
          color: #64748b;
          font-size: 14px;
        }
        
        .panel {
          background: white;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          padding: 24px;
          margin-bottom: 24px;
        }
        
        .panel-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }
        
        .panel-title {
          font-size: 20px;
          font-weight: 600;
          color: #1e293b;
        }
        
        .status-badge {
          background: #10b981;
          color: white;
          padding: 6px 16px;
          border-radius: 20px;
          font-size: 13px;
          font-weight: 500;
        }
        
        .input-grid {
          display: grid;
          grid-template-columns: 2fr 1fr 1fr;
          gap: 20px;
        }
        
        .form-group label {
          display: block;
          margin-bottom: 8px;
          font-size: 14px;
          font-weight: 500;
          color: #64748b;
        }
        
        select, .btn-secondary {
          width: 100%;
          padding: 10px 14px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: white;
          font-size: 14px;
          cursor: pointer;
        }
        
        .btn-secondary {
          background: #3b82f6;
          color: white;
          font-weight: 500;
          border: 1px solid #3b82f6;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 6px;
        }
        
        .btn-secondary:hover {
          background: #2563eb;
          border-color: #2563eb;
        }
        
        .product-info {
          margin-top: 6px;
          font-size: 13px;
          color: #94a3b8;
        }
        
        .metrics-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
          gap: 20px;
          margin-bottom: 24px;
        }
        
        .metric-card {
          background: white;
          padding: 20px;
          border-radius: 12px;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .metric-content {
          flex: 1;
        }
        
        .metric-label {
          font-size: 13px;
          color: #64748b;
          margin-bottom: 4px;
        }
        
        .metric-value {
          font-size: 28px;
          font-weight: 700;
          color: #1e293b;
        }
        
        .metric-trend {
          font-size: 12px;
          color: #10b981;
          margin-top: 4px;
          display: flex;
          align-items: center;
          gap: 4px;
        }
        
        .metric-trend.negative {
          color: #ef4444;
        }
        
        .metric-icon {
          width: 48px;
          height: 48px;
          border-radius: 10px;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .icon-blue { background: #dbeafe; color: #3b82f6; }
        .icon-green { background: #d1fae5; color: #10b981; }
        .icon-orange { background: #fed7aa; color: #f97316; }
        .icon-purple { background: #e9d5ff; color: #a855f7; }
        
        .tabs-container {
          background: white;
          border-radius: 12px 12px 0 0;
          padding: 0 24px;
          display: flex;
          gap: 32px;
          border-bottom: 1px solid #e2e8f0;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        
        .tab {
          padding: 16px 0;
          border-bottom: 3px solid transparent;
          cursor: pointer;
          font-weight: 500;
          color: #64748b;
          transition: all 0.2s;
        }
        
        .tab:hover {
          color: #475569;
        }
        
        .tab.active {
          color: #3b82f6;
          border-bottom-color: #3b82f6;
        }
        
        .filters-bar {
          background: #f8fafc;
          padding: 16px 24px;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        
        .filter-group {
          display: flex;
          gap: 12px;
        }
        
        .filter-select {
          padding: 8px 12px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          background: white;
          font-size: 13px;
          cursor: pointer;
        }
        
        .table-container {
          background: white;
          border-radius: 0 0 12px 12px;
          overflow: hidden;
          box-shadow: 0 2px 8px rgba(0,0,0,0.08);
        }
        
        table {
          width: 100%;
          border-collapse: collapse;
        }
        
        thead {
          background: #f8fafc;
        }
        
        th {
          padding: 12px 16px;
          text-align: left;
          font-size: 12px;
          font-weight: 600;
          color: #64748b;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          cursor: pointer;
          user-select: none;
        }
        
        th:hover {
          color: #475569;
        }
        
        td {
          padding: 12px 16px;
          border-top: 1px solid #e2e8f0;
          font-size: 14px;
        }
        
        tbody tr:hover {
          background: #f8fafc;
        }
        
        .keyword-cell {
          font-weight: 500;
          color: #1e293b;
        }
        
        .badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 500;
          margin-left: 8px;
        }
        
        .badge-trending {
          background: #fef3c7;
          color: #92400e;
        }
        
        .badge-opportunity {
          background: #e9d5ff;
          color: #6b21a8;
        }
        
        .badge-gap {
          background: #fee2e2;
          color: #991b1b;
        }
        
        .relevance-bar {
          display: flex;
          align-items: center;
          gap: 8px;
        }
        
        .bar-bg {
          width: 60px;
          height: 6px;
          background: #e2e8f0;
          border-radius: 3px;
          overflow: hidden;
        }
        
        .bar-fill {
          height: 100%;
          transition: width 0.3s;
        }
        
        .bar-green { background: #10b981; }
        .bar-yellow { background: #f59e0b; }
        .bar-red { background: #ef4444; }
        
        .competition-badge {
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
        }
        
        .comp-low {
          background: #d1fae5;
          color: #065f46;
        }
        
        .comp-medium {
          background: #fef3c7;
          color: #92400e;
        }
        
        .comp-high {
          background: #fee2e2;
          color: #991b1b;
        }
        
        .rank {
          font-weight: 600;
        }
        
        .rank-good { color: #10b981; }
        .rank-medium { color: #f59e0b; }
        .rank-poor { color: #ef4444; }
        
        .status-badge-small {
          padding: 4px 10px;
          border-radius: 12px;
          font-size: 11px;
          font-weight: 600;
        }
        
        .status-indexed {
          background: #d1fae5;
          color: #065f46;
        }
        
        .status-not-indexed {
          background: #fee2e2;
          color: #991b1b;
        }
        
        .opportunity-score {
          font-weight: 700;
          font-size: 16px;
          color: #a855f7;
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
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div className="container">
        {/* Header */}
        <div className="header">
          <div className="logo">
            🎯 Keyword Analysis Dashboard
          </div>
        </div>

        {/* Product Analysis Panel */}
        <div className="panel">
          <div className="panel-header">
            <h2 className="panel-title">Product Analysis</h2>
            <span className="status-badge">Connected: SellerApp + Amazon Ads</span>
          </div>
          
          <div className="input-grid">
            <div className="form-group">
              <label>Select Product (ASIN)</label>
              <select 
                value={selectedAsin}
                onChange={(e) => setSelectedAsin(e.target.value)}
              >
                <option value="">All Products</option>
                {products.map(product => (
                  <option key={product.asin} value={product.asin}>
                    {product.asin}
                  </option>
                ))}
              </select>
              <div className="product-info">
                {analyzedAsin ? `Showing keywords for ASIN: ${analyzedAsin}` : selectedAsin ? `Selected ASIN: ${selectedAsin}` : 'Select an ASIN and click "Check Keywords"'}
              </div>
            </div>
            
            <div className="form-group">
              <label>Marketplace</label>
              <div style={{ 
                padding: '10px 14px', 
                border: '1px solid #e2e8f0', 
                borderRadius: '8px', 
                background: '#f8fafc',
                fontSize: '14px',
                fontWeight: '500',
                color: '#1e293b'
              }}>
                {currentMarketplace}
              </div>
            </div>
            
            <div className="form-group">
              <label>Quick Actions</label>
              <button className="btn-secondary" onClick={handleAnalyze}>
                {loading ? <span className="loading" /> : <Search size={16} />}
                Check Keywords
              </button>
            </div>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-content">
              <div className="metric-label">Total Keywords</div>
              <div className="metric-value">{metrics.totalKeywords}</div>
              <div className="metric-trend">
                <TrendingUp size={14} />
                23 new this week
              </div>
            </div>
            <div className="metric-icon icon-blue">
              <Search size={24} />
            </div>
          </div>
          
          <div className="metric-card">
            <div className="metric-content">
              <div className="metric-label">Indexed Keywords</div>
              <div className="metric-value">{metrics.indexedKeywords}</div>
              <div className="metric-trend">
                {((metrics.indexedKeywords / metrics.totalKeywords) * 100).toFixed(1)}% coverage
              </div>
            </div>
            <div className="metric-icon icon-green">
              <CheckCircle size={24} />
            </div>
          </div>
          
          <div className="metric-card">
            <div className="metric-content">
              <div className="metric-label">Avg. CPC</div>
              <div className="metric-value">${metrics.avgCpc}</div>
              <div className="metric-trend negative">
                <ChevronUp size={14} />
                $0.12 from last month
              </div>
            </div>
            <div className="metric-icon icon-orange">
              <DollarSign size={24} />
            </div>
          </div>
          
          <div className="metric-card">
            <div className="metric-content">
              <div className="metric-label">Ranked Keywords</div>
              <div className="metric-value">{metrics.rankedKeywords}</div>
              <div className="metric-trend">
                {metrics.totalKeywords > 0 ? ((metrics.rankedKeywords / metrics.totalKeywords) * 100).toFixed(1) : 0}% of total
              </div>
            </div>
            <div className="metric-icon icon-purple">
              <Target size={24} />
            </div>
          </div>
        </div>

        {/* Tabs */}
        <div className="tabs-container">
          <div 
            className={`tab ${activeTab === 'all' ? 'active' : ''}`}
            onClick={() => setActiveTab('all')}
          >
            All Keywords ({keywords.length})
          </div>
          <div 
            className={`tab ${activeTab === 'indexed' ? 'active' : ''}`}
            onClick={() => setActiveTab('indexed')}
          >
            Indexed ({keywords.filter(k => k.isIndexed === true).length})
          </div>
          <div 
            className={`tab ${activeTab === 'notIndexed' ? 'active' : ''}`}
            onClick={() => setActiveTab('notIndexed')}
          >
            Not Indexed ({keywords.filter(k => k.isIndexed === false || k.isIndexed === null).length})
          </div>
          <div 
            className={`tab ${activeTab === 'ranked' ? 'active' : ''}`}
            onClick={() => setActiveTab('ranked')}
          >
            Ranked ({keywords.filter(k => k.rank !== null && k.rank !== undefined).length})
          </div>
          <div 
            className={`tab ${activeTab === 'campaignKeywords' ? 'active' : ''}`}
            onClick={() => setActiveTab('campaignKeywords')}
          >
            Campaign Keywords ({keywords.filter(k => k.sponsored === true).length})
          </div>
        </div>

        {/* Filters Bar */}
        <div className="filters-bar">
          <div className="filter-group">
            <select 
              className="filter-select"
              value={filters.competition}
              onChange={(e) => setFilters(prev => ({ ...prev, competition: e.target.value }))}
            >
              <option value="all">All Competition</option>
              <option value="low">Low Competition</option>
              <option value="medium">Medium Competition</option>
              <option value="high">High Competition</option>
            </select>
            
            <select 
              className="filter-select"
              value={filters.indexed}
              onChange={(e) => setFilters(prev => ({ ...prev, indexed: e.target.value }))}
            >
              <option value="all">All Status</option>
              <option value="indexed">Indexed</option>
              <option value="notIndexed">Not Indexed</option>
            </select>
            
          </div>
          
          <button 
            className="filter-select"
            onClick={() => setFilters({
              competition: 'all',
              indexed: 'all'
            })}
          >
            Clear Filters
          </button>
        </div>

        {/* Keywords Table */}
        <div className="table-container">
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input 
                    type="checkbox"
                    checked={paginatedKeywords.length > 0 && paginatedKeywords.every(k => selectedKeywords.includes(k.id))}
                    onChange={handleSelectAll}
                  />
                </th>
                <th onClick={() => handleSort('keyword')}>
                  Keyword {sortConfig.key === 'keyword' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('asin')}>
                  ASIN {sortConfig.key === 'asin' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('searchVolume')}>
                  Search Volume {sortConfig.key === 'searchVolume' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('cpc')}>
                  CPC {sortConfig.key === 'cpc' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('competition')}>
                  Competition {sortConfig.key === 'competition' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('rank')}>
                  Rank {sortConfig.key === 'rank' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('sponsored')}>
                  Sponsored {sortConfig.key === 'sponsored' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th>Indexed</th>
              </tr>
            </thead>
            <tbody>
              {paginatedKeywords.length > 0 ? (
                paginatedKeywords.map(keyword => (
                  <tr key={keyword.id}>
                    <td>
                      <input 
                        type="checkbox"
                        checked={selectedKeywords.includes(keyword.id)}
                        onChange={() => toggleKeywordSelection(keyword.id)}
                      />
                    </td>
                    <td>
                      <span className="keyword-cell">{keyword.keyword || 'N/A'}</span>
                    </td>
                    <td>
                      <span style={{ fontFamily: 'monospace', fontSize: '12px' }}>{keyword.asin || 'N/A'}</span>
                    </td>
                    <td>{keyword.searchVolume ? keyword.searchVolume.toLocaleString() : '0'}</td>
                    <td>${parseFloat(keyword.cpc || 0).toFixed(2)}</td>
                    <td>
                      <span className={`competition-badge comp-${keyword.competition?.toLowerCase() || 'unknown'}`}>
                        {keyword.competition ? keyword.competition.charAt(0).toUpperCase() + keyword.competition.slice(1) : 'Unknown'}
                      </span>
                    </td>
                    <td>
                      {keyword.rank !== null && keyword.rank !== undefined ? (
                        <span className={`rank ${
                          keyword.rank <= 10 ? 'rank-good' : 
                          keyword.rank <= 50 ? 'rank-medium' : 'rank-poor'
                        }`}>
                          #{keyword.rank}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      <span className={`status-badge-small ${
                        keyword.sponsored === true ? 'status-indexed' : 'status-not-indexed'
                      }`}>
                        {keyword.sponsored === true ? 'Yes' : 'No'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-badge-small ${
                        keyword.isIndexed === true ? 'status-indexed' : 
                        keyword.isIndexed === false ? 'status-not-indexed' : 
                        'status-not-indexed'
                      }`}>
                        {keyword.isIndexed === true ? 'Indexed' : 
                         keyword.isIndexed === false ? 'Not Indexed' : 
                         'Unknown'}
                      </span>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={9} className="empty-state">
                    {keywordTrackingData.length === 0 
                      ? 'No keyword tracking data available. Please ensure data is loaded.'
                      : 'No keywords found matching your filters'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          
          {/* Pagination Controls */}
          {totalPages > 1 && (
            <div style={{
              padding: '16px 24px',
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f8fafc'
            }}>
              <div style={{ fontSize: '14px', color: '#64748b' }}>
                Showing {(currentPage - 1) * itemsPerPage + 1} to {Math.min(currentPage * itemsPerPage, filteredKeywords.length)} of {filteredKeywords.length} keywords
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  onClick={goToPreviousPage}
                  disabled={currentPage === 1}
                  style={{
                    padding: '6px 12px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    background: currentPage === 1 ? '#f1f5f9' : 'white',
                    color: currentPage === 1 ? '#94a3b8' : '#475569',
                    cursor: currentPage === 1 ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}
                >
                  <ChevronLeft size={16} />
                  Previous
                </button>
                
                <div style={{ display: 'flex', gap: '4px' }}>
                  {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 5) {
                      pageNum = i + 1;
                    } else if (currentPage <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 2) {
                      pageNum = totalPages - 4 + i;
                    } else {
                      pageNum = currentPage - 2 + i;
                    }
                    
                    return (
                      <button
                        key={pageNum}
                        onClick={() => goToPage(pageNum)}
                        style={{
                          minWidth: '36px',
                          height: '36px',
                          border: '1px solid #cbd5e1',
                          borderRadius: '6px',
                          background: currentPage === pageNum ? '#3b82f6' : 'white',
                          color: currentPage === pageNum ? 'white' : '#475569',
                          cursor: 'pointer',
                          fontSize: '14px',
                          fontWeight: currentPage === pageNum ? '600' : '500'
                        }}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                
                <button
                  onClick={goToNextPage}
                  disabled={currentPage === totalPages}
                  style={{
                    padding: '6px 12px',
                    border: '1px solid #cbd5e1',
                    borderRadius: '6px',
                    background: currentPage === totalPages ? '#f1f5f9' : 'white',
                    color: currentPage === totalPages ? '#94a3b8' : '#475569',
                    cursor: currentPage === totalPages ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    fontSize: '14px',
                    fontWeight: '500'
                  }}
                >
                  Next
                  <ChevronRight size={16} />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default KeywordAnalysisDashboard;
