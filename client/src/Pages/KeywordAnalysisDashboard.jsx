import React, { useState, useEffect, useMemo } from 'react';
import { ChevronDown, ChevronUp, Search, Download, TrendingUp, AlertCircle, CheckCircle, DollarSign, Target, Filter, MoreVertical, RefreshCw } from 'lucide-react';

// Main Dashboard Component
const KeywordAnalysisDashboard = () => {
  const [selectedAsin, setSelectedAsin] = useState('B00GB85JR4');
  const [marketplace, setMarketplace] = useState('us');
  const [activeTab, setActiveTab] = useState('all');
  const [keywords, setKeywords] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'opportunityScore', direction: 'desc' });
  const [filters, setFilters] = useState({
    competition: 'all',
    matchType: 'all',
    ranking: 'all',
    indexed: 'all'
  });

  // Sample products list
  const products = [
    { asin: 'B00GB85JR4', name: 'Vitamin D3 5000iu - NatureWise', category: 'Supplements' },
    { asin: 'B07XYZABC1', name: 'Organic Protein Powder - Chocolate', category: 'Supplements' },
    { asin: 'B08DEFGH23', name: 'Multivitamin for Men', category: 'Supplements' },
    { asin: 'B09IJKLMN4', name: 'Omega-3 Fish Oil Capsules', category: 'Supplements' },
    { asin: 'B10OPQRST5', name: 'Probiotic Complex 50 Billion CFU', category: 'Supplements' }
  ];

  // Sample data - in production, this would come from API calls
  const sampleKeywords = [
    {
      id: 1,
      keyword: 'vitamin d3',
      searchVolume: 125000,
      relevanceScore: 95,
      cpc: 1.85,
      competition: 'high',
      organicRank: 3,
      ppcPosition: 1,
      indexed: true,
      opportunityScore: 92,
      trending: true,
      matchType: 'exact',
      estimatedOrders: 450
    },
    {
      id: 2,
      keyword: 'vitamin d supplement',
      searchVolume: 89000,
      relevanceScore: 92,
      cpc: 1.65,
      competition: 'medium',
      organicRank: 8,
      ppcPosition: null,
      indexed: true,
      opportunityScore: 85,
      trending: false,
      matchType: 'phrase',
      estimatedOrders: 380
    },
    {
      id: 3,
      keyword: 'vitamin d3 5000 iu',
      searchVolume: 67500,
      relevanceScore: 98,
      cpc: 2.15,
      competition: 'high',
      organicRank: 45,
      ppcPosition: null,
      indexed: true,
      opportunityScore: 88,
      trending: false,
      matchType: 'exact',
      isOpportunity: true,
      estimatedOrders: 290
    },
    {
      id: 4,
      keyword: 'd3 supplement',
      searchVolume: 45000,
      relevanceScore: 88,
      cpc: 1.45,
      competition: 'low',
      organicRank: 12,
      ppcPosition: 3,
      indexed: true,
      opportunityScore: 76,
      trending: false,
      matchType: 'broad',
      estimatedOrders: 250
    },
    {
      id: 5,
      keyword: 'vitamin d deficiency supplement',
      searchVolume: 38000,
      relevanceScore: 72,
      cpc: 1.95,
      competition: 'medium',
      organicRank: null,
      ppcPosition: null,
      indexed: false,
      opportunityScore: 65,
      trending: false,
      matchType: 'phrase',
      isGap: true,
      estimatedOrders: 180
    },
    {
      id: 6,
      keyword: 'best vitamin d3',
      searchVolume: 32000,
      relevanceScore: 85,
      cpc: 1.55,
      competition: 'medium',
      organicRank: 18,
      ppcPosition: 5,
      indexed: true,
      opportunityScore: 70,
      trending: false,
      matchType: 'broad',
      estimatedOrders: 195
    },
    {
      id: 7,
      keyword: 'vitamin d3 organic',
      searchVolume: 28500,
      relevanceScore: 78,
      cpc: 2.25,
      competition: 'high',
      organicRank: 52,
      ppcPosition: null,
      indexed: true,
      opportunityScore: 52,
      trending: false,
      matchType: 'exact',
      estimatedOrders: 120
    },
    {
      id: 8,
      keyword: 'vitamin d3 k2',
      searchVolume: 26000,
      relevanceScore: 65,
      cpc: 1.75,
      competition: 'medium',
      organicRank: 28,
      ppcPosition: 8,
      indexed: true,
      opportunityScore: 68,
      trending: true,
      matchType: 'exact',
      estimatedOrders: 145
    }
  ];

  // Initialize keywords on mount
  useEffect(() => {
    setKeywords(sampleKeywords);
  }, []);

  // Filter keywords based on active tab and filters
  const filteredKeywords = useMemo(() => {
    let filtered = [...keywords];

    // Tab filtering
    if (activeTab === 'campaign') {
      filtered = filtered.filter(k => k.ppcPosition !== null);
    } else if (activeTab === 'gap') {
      filtered = filtered.filter(k => k.isGap || !k.indexed);
    } else if (activeTab === 'opportunities') {
      filtered = filtered.filter(k => k.opportunityScore >= 80);
    }

    // Apply filters
    if (filters.competition !== 'all') {
      filtered = filtered.filter(k => k.competition === filters.competition);
    }
    if (filters.matchType !== 'all') {
      filtered = filtered.filter(k => k.matchType === filters.matchType);
    }
    if (filters.ranking !== 'all') {
      if (filters.ranking === 'top10') {
        filtered = filtered.filter(k => k.organicRank && k.organicRank <= 10);
      } else if (filters.ranking === 'top20') {
        filtered = filtered.filter(k => k.organicRank && k.organicRank <= 20);
      } else if (filters.ranking === 'top50') {
        filtered = filtered.filter(k => k.organicRank && k.organicRank <= 50);
      } else if (filters.ranking === 'notRanked') {
        filtered = filtered.filter(k => !k.organicRank);
      }
    }
    if (filters.indexed !== 'all') {
      filtered = filtered.filter(k => k.indexed === (filters.indexed === 'indexed'));
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

  // Metrics calculation
  const metrics = useMemo(() => {
    const totalKeywords = keywords.length;
    const indexedKeywords = keywords.filter(k => k.indexed).length;
    const avgCpc = keywords.reduce((sum, k) => sum + k.cpc, 0) / keywords.length;
    const highOpportunityCount = keywords.filter(k => k.opportunityScore >= 80).length;
    
    return {
      totalKeywords,
      indexedKeywords,
      avgCpc: avgCpc.toFixed(2),
      highOpportunityCount
    };
  }, [keywords]);

  // Handle analyze
  const handleAnalyze = async () => {
    setLoading(true);
    // Simulate API call
    setTimeout(() => {
      setLoading(false);
    }, 1500);
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
      setSelectedKeywords(filteredKeywords.map(k => k.id));
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
          <div className="sync-status">
            <RefreshCw size={14} />
            Last sync: 2 mins ago
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
              <label>Select Product</label>
              <select 
                value={selectedAsin}
                onChange={(e) => setSelectedAsin(e.target.value)}
              >
                {products.map(product => (
                  <option key={product.asin} value={product.asin}>
                    {product.name} ({product.asin})
                  </option>
                ))}
              </select>
              <div className="product-info">
                {products.find(p => p.asin === selectedAsin)?.category}
              </div>
            </div>
            
            <div className="form-group">
              <label>Marketplace</label>
              <select value={marketplace} onChange={(e) => setMarketplace(e.target.value)}>
                <option value="us">United States (US)</option>
                <option value="uk">United Kingdom (UK)</option>
                <option value="de">Germany (DE)</option>
              </select>
            </div>
            
            <div className="form-group">
              <label>Quick Actions</label>
              <button className="btn-secondary" onClick={handleAnalyze}>
                {loading ? <span className="loading" /> : <Search size={16} />}
                Analyze Product
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
              <div className="metric-label">Opportunity Score</div>
              <div className="metric-value">{metrics.highOpportunityCount}</div>
              <div className="metric-trend">
                High potential keywords
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
            className={`tab ${activeTab === 'campaign' ? 'active' : ''}`}
            onClick={() => setActiveTab('campaign')}
          >
            Campaign Keywords ({keywords.filter(k => k.ppcPosition).length})
          </div>
          <div 
            className={`tab ${activeTab === 'gap' ? 'active' : ''}`}
            onClick={() => setActiveTab('gap')}
          >
            Gap Analysis ({keywords.filter(k => k.isGap || !k.indexed).length})
          </div>
          <div 
            className={`tab ${activeTab === 'opportunities' ? 'active' : ''}`}
            onClick={() => setActiveTab('opportunities')}
          >
            Opportunities ({keywords.filter(k => k.opportunityScore >= 80).length})
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
              value={filters.matchType}
              onChange={(e) => setFilters(prev => ({ ...prev, matchType: e.target.value }))}
            >
              <option value="all">All Match Types</option>
              <option value="exact">Exact</option>
              <option value="phrase">Phrase</option>
              <option value="broad">Broad</option>
            </select>
            
            <select 
              className="filter-select"
              value={filters.ranking}
              onChange={(e) => setFilters(prev => ({ ...prev, ranking: e.target.value }))}
            >
              <option value="all">All Rankings</option>
              <option value="top10">Top 10</option>
              <option value="top20">Top 20</option>
              <option value="top50">Top 50</option>
              <option value="notRanked">Not Ranked</option>
            </select>
          </div>
          
          <button 
            className="filter-select"
            onClick={() => setFilters({
              competition: 'all',
              matchType: 'all',
              ranking: 'all',
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
                    checked={selectedKeywords.length === filteredKeywords.length && filteredKeywords.length > 0}
                    onChange={handleSelectAll}
                  />
                </th>
                <th onClick={() => handleSort('keyword')}>
                  Keyword {sortConfig.key === 'keyword' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('searchVolume')}>
                  Search Volume {sortConfig.key === 'searchVolume' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('relevanceScore')}>
                  Relevance
                </th>
                <th onClick={() => handleSort('cpc')}>
                  CPC {sortConfig.key === 'cpc' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th>Competition</th>
                <th onClick={() => handleSort('organicRank')}>
                  Organic Rank
                </th>
                <th>PPC Position</th>
                <th>Status</th>
                <th onClick={() => handleSort('opportunityScore')}>
                  Opportunity {sortConfig.key === 'opportunityScore' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredKeywords.length > 0 ? (
                filteredKeywords.map(keyword => (
                  <tr key={keyword.id} style={{ background: keyword.isOpportunity ? '#fffbeb' : 'white' }}>
                    <td>
                      <input 
                        type="checkbox"
                        checked={selectedKeywords.includes(keyword.id)}
                        onChange={() => toggleKeywordSelection(keyword.id)}
                      />
                    </td>
                    <td>
                      <span className="keyword-cell">{keyword.keyword}</span>
                      {keyword.trending && <span className="badge badge-trending">Trending</span>}
                      {keyword.isOpportunity && <span className="badge badge-opportunity">Opportunity</span>}
                      {keyword.isGap && <span className="badge badge-gap">Gap</span>}
                    </td>
                    <td>{keyword.searchVolume.toLocaleString()}</td>
                    <td>
                      <div className="relevance-bar">
                        <div className="bar-bg">
                          <div 
                            className={`bar-fill ${
                              keyword.relevanceScore >= 80 ? 'bar-green' : 
                              keyword.relevanceScore >= 60 ? 'bar-yellow' : 'bar-red'
                            }`}
                            style={{ width: `${keyword.relevanceScore}%` }}
                          />
                        </div>
                        <span>{keyword.relevanceScore}%</span>
                      </div>
                    </td>
                    <td>${keyword.cpc.toFixed(2)}</td>
                    <td>
                      <span className={`competition-badge comp-${keyword.competition}`}>
                        {keyword.competition.charAt(0).toUpperCase() + keyword.competition.slice(1)}
                      </span>
                    </td>
                    <td>
                      {keyword.organicRank ? (
                        <span className={`rank ${
                          keyword.organicRank <= 10 ? 'rank-good' : 
                          keyword.organicRank <= 50 ? 'rank-medium' : 'rank-poor'
                        }`}>
                          #{keyword.organicRank}
                        </span>
                      ) : '—'}
                    </td>
                    <td>
                      {keyword.ppcPosition ? (
                        <span className="rank rank-good">#{keyword.ppcPosition}</span>
                      ) : '—'}
                    </td>
                    <td>
                      <span className={`status-badge-small ${keyword.indexed ? 'status-indexed' : 'status-not-indexed'}`}>
                        {keyword.indexed ? 'Indexed' : 'Not Indexed'}
                      </span>
                    </td>
                    <td>
                      <span className="opportunity-score">{keyword.opportunityScore}</span>
                    </td>
                    <td>
                      <button 
                        style={{ 
                          background: 'none', 
                          border: 'none', 
                          cursor: 'pointer',
                          color: '#64748b'
                        }}
                      >
                        <MoreVertical size={16} />
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={11} className="empty-state">
                    No keywords found matching your filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default KeywordAnalysisDashboard;
