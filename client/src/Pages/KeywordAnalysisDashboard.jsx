import React, { useState, useEffect, useMemo } from 'react';
import { useSelector } from 'react-redux';
import { ChevronDown, ChevronUp, Search, Download, TrendingUp, AlertCircle, CheckCircle, DollarSign, Target, Filter, MoreVertical, ChevronLeft, ChevronRight } from 'lucide-react';
import axiosInstance from '../config/axios.config.js';

// Main Dashboard Component
const KeywordAnalysisDashboard = () => {
  const [keywordRecommendationsData, setKeywordRecommendationsData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [selectedKeywords, setSelectedKeywords] = useState([]);
  const [sortConfig, setSortConfig] = useState({ key: 'keyword', direction: 'desc' });
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;
  // Only show BROAD match type keywords - no filter needed

  // Get current marketplace from Redux
  const currentCountry = useSelector((state) => state.currency?.country) || '';
  const currentRegion = useSelector((state) => state.currency?.region) || '';

  // Fetch keyword recommendations data
  useEffect(() => {
    const fetchKeywordRecommendations = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await axiosInstance.get('/app/analyse/keywordRecommendations');
        
        if (response.data && response.data.data) {
          setKeywordRecommendationsData(response.data.data);
        } else {
          setError('No data received from server');
        }
      } catch (err) {
        console.error('Error fetching keyword recommendations:', err);
        setError(err.response?.data?.message || 'Failed to fetch keyword recommendations');
      } finally {
        setLoading(false);
      }
    };

    fetchKeywordRecommendations();
  }, []);

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
    if (activeTab === 'selected') {
      filtered = filtered.filter(k => k.userSelectedKeyword === true);
    } else if (activeTab === 'highRank') {
      filtered = filtered.filter(k => k.rank !== null && k.rank <= 5);
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

  // Pagination calculations
  const totalPages = useMemo(() => Math.ceil(filteredKeywords.length / itemsPerPage), [filteredKeywords.length]);
  
  const paginatedKeywords = useMemo(() => {
    const indexOfLastItem = currentPage * itemsPerPage;
    const indexOfFirstItem = indexOfLastItem - itemsPerPage;
    return filteredKeywords.slice(indexOfFirstItem, indexOfLastItem);
  }, [filteredKeywords, currentPage]);

  // Reset to page 1 when tabs or sorting changes
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, sortConfig.key]);

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

  // Export to CSV
  const exportToCSV = () => {
    // Get the filtered keywords (already filtered to BROAD only)
    const dataToExport = filteredKeywords;

    // Define CSV headers
    const headers = [
      'Keyword',
      'Bid',
      'Rank',
      'Impression Share',
      'Impression Rank',
      'Suggested Bid Range Start',
      'Suggested Bid Range End',
      'Suggested Bid Median',
      'User Selected'
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
          (keyword.bid / 100).toFixed(2),
          keyword.rank !== null ? keyword.rank : '',
          keyword.searchTermImpressionShare !== null ? keyword.searchTermImpressionShare.toFixed(2) : '',
          keyword.searchTermImpressionRank !== null ? keyword.searchTermImpressionRank : '',
          suggestedBidStart,
          suggestedBidEnd,
          suggestedBidMedian,
          keyword.userSelectedKeyword ? 'Yes' : 'No'
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
    link.setAttribute('download', `keyword-recommendations-${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  if (loading) {
    return (
      <div className="dashboard-container">
        <div style={{ 
          display: 'flex', 
          justifyContent: 'center', 
          alignItems: 'center', 
          minHeight: '100vh',
          flexDirection: 'column',
          gap: '20px'
        }}>
          <div className="loading" style={{ width: '40px', height: '40px' }}></div>
          <p style={{ color: '#64748b', fontSize: '16px' }}>Loading keyword recommendations...</p>
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
          gap: '20px'
        }}>
          <AlertCircle size={48} color="#ef4444" />
          <p style={{ color: '#ef4444', fontSize: '16px' }}>{error}</p>
        </div>
      </div>
    );
  }

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
        
        @keyframes spin {
          to { transform: rotate(360deg); }
        }
      `}</style>

      <div className="container">
        {/* Header */}
        <div className="header">
          <div className="logo">
            🎯 Keyword Recommendations Dashboard
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
            <button
              onClick={exportToCSV}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 16px',
                backgroundColor: '#3b82f6',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: 'pointer',
                fontSize: '14px',
                fontWeight: '500',
                transition: 'background-color 0.2s'
              }}
              onMouseEnter={(e) => e.target.style.backgroundColor = '#2563eb'}
              onMouseLeave={(e) => e.target.style.backgroundColor = '#3b82f6'}
            >
              <Download size={16} />
              Export CSV
            </button>
            <div style={{ fontSize: '14px', color: '#64748b' }}>
              {currentCountry ? `Marketplace: ${currentCountry.toUpperCase()}` : 'Amazon Ads'}
            </div>
          </div>
        </div>

        {/* Metrics Grid */}
        <div className="metrics-grid">
          <div className="metric-card">
            <div className="metric-content">
              <div className="metric-label">Total Recommendations</div>
              <div className="metric-value">{metrics.totalKeywords}</div>
              <div className="metric-trend">
                <TrendingUp size={14} />
                {metrics.uniqueKeywords} unique keywords
              </div>
            </div>
            <div className="metric-icon icon-blue">
              <Search size={24} />
            </div>
          </div>
          
          <div className="metric-card">
            <div className="metric-content">
              <div className="metric-label">Unique Keywords</div>
              <div className="metric-value">{metrics.uniqueKeywords}</div>
              <div className="metric-trend">
                {metrics.totalKeywords > 0 ? ((metrics.uniqueKeywords / metrics.totalKeywords) * 100).toFixed(1) : 0}% unique
              </div>
            </div>
            <div className="metric-icon icon-green">
              <CheckCircle size={24} />
            </div>
          </div>
          
          <div className="metric-card">
            <div className="metric-content">
              <div className="metric-label">Avg. Bid</div>
              <div className="metric-value">${metrics.avgBid}</div>
              <div className="metric-trend">
                <DollarSign size={14} />
                Average bid amount
              </div>
            </div>
            <div className="metric-icon icon-orange">
              <DollarSign size={24} />
            </div>
          </div>
          
          <div className="metric-card">
            <div className="metric-content">
              <div className="metric-label">High Rank Keywords</div>
              <div className="metric-value">{metrics.highRankKeywords}</div>
              <div className="metric-trend">
                Rank ≤ 10
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
            All Keywords ({keywords.filter(k => k.matchType === 'BROAD').length})
          </div>
          <div 
            className={`tab ${activeTab === 'selected' ? 'active' : ''}`}
            onClick={() => setActiveTab('selected')}
          >
            User Selected ({keywords.filter(k => k.matchType === 'BROAD' && k.userSelectedKeyword === true).length})
          </div>
          <div 
            className={`tab ${activeTab === 'highRank' ? 'active' : ''}`}
            onClick={() => setActiveTab('highRank')}
          >
            High Rank ({keywords.filter(k => k.matchType === 'BROAD' && k.rank !== null && k.rank <= 5).length})
          </div>
          <div 
            className={`tab ${activeTab === 'highImpression' ? 'active' : ''}`}
            onClick={() => setActiveTab('highImpression')}
          >
            High Impression ({keywords.filter(k => k.matchType === 'BROAD' && k.searchTermImpressionShare !== null && k.searchTermImpressionShare >= 50).length})
          </div>
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
                <th onClick={() => handleSort('bid')}>
                  Bid {sortConfig.key === 'bid' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('rank')}>
                  Rank {sortConfig.key === 'rank' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('searchTermImpressionShare')}>
                  Impression Share {sortConfig.key === 'searchTermImpressionShare' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th onClick={() => handleSort('searchTermImpressionRank')}>
                  Impression Rank {sortConfig.key === 'searchTermImpressionRank' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                </th>
                <th>Suggested Bid Range</th>
                <th>User Selected</th>
              </tr>
            </thead>
            <tbody>
              {paginatedKeywords.length > 0 ? (
                paginatedKeywords.map(keyword => {
                  return (
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
                      <td>${(keyword.bid / 100).toFixed(2)}</td>
                      <td>
                        {keyword.rank !== null ? (
                          <span style={{ fontWeight: 600, color: keyword.rank <= 5 ? '#10b981' : keyword.rank <= 10 ? '#f59e0b' : '#ef4444' }}>
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
                          <span style={{ fontSize: '12px', color: '#64748b' }}>
                            ${(keyword.suggestedBid.rangeStart / 100).toFixed(2)} - ${(keyword.suggestedBid.rangeEnd / 100).toFixed(2)}
                            <br />
                            <span style={{ color: '#3b82f6', fontWeight: 600 }}>
                              Median: ${(keyword.suggestedBid.rangeMedian / 100).toFixed(2)}
                            </span>
                          </span>
                        ) : '—'}
                      </td>
                      <td>
                        <span style={{
                          padding: '4px 10px',
                          borderRadius: '12px',
                          fontSize: '11px',
                          fontWeight: 600,
                          background: keyword.userSelectedKeyword ? '#d1fae5' : '#f1f5f9',
                          color: keyword.userSelectedKeyword ? '#065f46' : '#475569'
                        }}>
                          {keyword.userSelectedKeyword ? 'Yes' : 'No'}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="empty-state">
                    {keywords.length === 0 
                      ? 'No keyword recommendations available. Please ensure data is loaded.'
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
