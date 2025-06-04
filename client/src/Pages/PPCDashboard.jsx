import React, { useState } from 'react';
import calenderIcon from '../assets/Icons/Calender.png'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { useSelector } from 'react-redux';

// Enhanced mock data for smoother chart
const mockChartData = [
  { date: 'Apr 3', ppcSales: 1200, spend: 950, acos: 480, tacos: 450, units: 50 },
  { date: 'Apr 4', ppcSales: 1450, spend: 1000, acos: 500, tacos: 480, units: 65 },
  { date: 'Apr 5', ppcSales: 1520, spend: 1050, acos: 520, tacos: 490, units: 70 },
  { date: 'Apr 6', ppcSales: 1350, spend: 1020, acos: 510, tacos: 470, units: 58 },
  { date: 'Apr 7', ppcSales: 1280, spend: 980, acos: 490, tacos: 455, units: 52 },
  { date: 'Apr 8', ppcSales: 1100, spend: 950, acos: 500, tacos: 465, units: 45 },
  { date: 'Apr 9', ppcSales: 1150, spend: 980, acos: 520, tacos: 475, units: 48 },
  { date: 'Apr 10', ppcSales: 1380, spend: 1050, acos: 540, tacos: 485, units: 60 },
  { date: 'Apr 11', ppcSales: 1420, spend: 1080, acos: 550, tacos: 490, units: 64 },
  { date: 'Apr 12', ppcSales: 1500, spend: 1100, acos: 560, tacos: 495, units: 68 },
  { date: 'Apr 13', ppcSales: 1380, spend: 1120, acos: 580, tacos: 500, units: 62 },
  { date: 'Apr 14', ppcSales: 1250, spend: 1150, acos: 590, tacos: 505, units: 55 },
  { date: 'Apr 15', ppcSales: 1050, spend: 1180, acos: 600, tacos: 510, units: 42 },
  { date: 'Apr 16', ppcSales: 1100, spend: 1200, acos: 610, tacos: 515, units: 45 },
  { date: 'Apr 17', ppcSales: 1180, spend: 1280, acos: 620, tacos: 520, units: 50 },
  { date: 'Apr 18', ppcSales: 1250, spend: 1350, acos: 640, tacos: 525, units: 54 },
  { date: 'Apr 19', ppcSales: 1150, spend: 1400, acos: 660, tacos: 530, units: 48 },
  { date: 'Apr 20', ppcSales: 1080, spend: 1420, acos: 680, tacos: 535, units: 44 },
  { date: 'Apr 21', ppcSales: 1100, spend: 1450, acos: 700, tacos: 540, units: 46 },
  { date: 'Apr 22', ppcSales: 1050, spend: 1480, acos: 720, tacos: 545, units: 43 },
  { date: 'Apr 23', ppcSales: 980, spend: 1400, acos: 680, tacos: 540, units: 40 },
  { date: 'Apr 24', ppcSales: 1150, spend: 1350, acos: 650, tacos: 535, units: 48 },
  { date: 'Apr 25', ppcSales: 1280, spend: 1450, acos: 700, tacos: 545, units: 55 },
  { date: 'Apr 26', ppcSales: 1180, spend: 1500, acos: 720, tacos: 550, units: 50 },
  { date: 'Apr 27', ppcSales: 1150, spend: 1480, acos: 750, tacos: 560, units: 48 },
  { date: 'Apr 28', ppcSales: 1450, spend: 1450, acos: 780, tacos: 570, units: 65 },
  { date: 'Apr 29', ppcSales: 1680, spend: 1520, acos: 800, tacos: 580, units: 78 },
  { date: 'Apr 30', ppcSales: 1750, spend: 1500, acos: 820, tacos: 590, units: 82 },
  { date: 'Apr 31', ppcSales: 1800, spend: 1480, acos: 840, tacos: 600, units: 85 },
];

const PPCDashboard = () => {
  const [selectedTab, setSelectedTab] = useState(0);
  const [openCalender, setOpenCalender] = useState(false);
  
  // Get sponsoredAdsMetrics from Redux store
  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  const sponsoredAdsMetrics = useSelector((state) => state.Dashboard.DashBoardInfo?.sponsoredAdsMetrics);
  
  // Get negativeKeywordsMetrics from Redux store
  const negativeKeywordsMetrics = useSelector((state) => state.Dashboard.DashBoardInfo?.negativeKeywordsMetrics) || [];
  
  // Divide data into chunks of 10
  const itemsPerPage = 10;
  const totalPages = Math.ceil(negativeKeywordsMetrics.length / itemsPerPage);
  
  // Get current page data
  const getCurrentPageData = () => {
    const startIndex = selectedTab * itemsPerPage;
    const endIndex = startIndex + itemsPerPage;
    return negativeKeywordsMetrics.slice(startIndex, endIndex);
  };
  
  // Generate tab options based on data
  const tabOptions = Array.from({ length: totalPages }, (_, index) => ({
    key: index,
    label: `Table ${index + 1}`
  }));
  
  // Use Redux data for KPI values, fallback to mock data if not available
  const kpiData = [
    { 
      label: 'PPC Sales', 
      value: sponsoredAdsMetrics?.totalSalesIn30Days 
        ? `$${sponsoredAdsMetrics.totalSalesIn30Days.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
        : '$25,432.96' 
    },
    { 
      label: 'Spend', 
      value: sponsoredAdsMetrics?.totalCost 
        ? `$${sponsoredAdsMetrics.totalCost.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
        : '$7,654.21' 
    },
    { label: 'ACOS', value: `${((sponsoredAdsMetrics?.totalCost / sponsoredAdsMetrics?.totalSalesIn30Days) * 100).toFixed(2)}%` },
    { label: 'TACoS', value: `${((sponsoredAdsMetrics?.totalCost)/(Number(info?.TotalWeeklySale || 0).toFixed(2))*100).toFixed(2)}%` },
    { label: 'Units Sold', value: '1,140' },
  ];

  const formatYAxis = (value) => {
    if (value >= 1000) {
      return `$${(value / 1000).toFixed(1)}k`;
    }
    return `$${value}`;
  };

  // Function to analyze keywords and generate suggestions based on rules
  const analyzeKeywordsAndGenerateSuggestions = () => {
    const suggestions = [];
    const analyzedKeywords = new Set();
    
    // Analyze all keywords in the dataset
    negativeKeywordsMetrics.forEach((keyword) => {
      const keywordIdentifier = `${keyword.keyword}-${keyword.campaignName}`;
      
      // Skip if already analyzed
      if (analyzedKeywords.has(keywordIdentifier)) return;
      analyzedKeywords.add(keywordIdentifier);
      
      // Rule #1: High Spend, No Sales (modified without clicks data)
      if (keyword.spend >= 5 && keyword.sales === 0) {
        suggestions.push({
          type: 'high-spend-no-sales',
          keyword: keyword.keyword,
          campaign: keyword.campaignName,
          message: `"${keyword.keyword}" - Consider adding as negative. $${keyword.spend.toFixed(2)} spent with no conversions.`,
          priority: 'high'
        });
      }
      
      // Rule #2: Extremely High ACoS
      else if (keyword.acos >= 100 && keyword.spend >= 5) {
        suggestions.push({
          type: 'high-acos',
          keyword: keyword.keyword,
          campaign: keyword.campaignName,
          message: `"${keyword.keyword}" - ACoS at ${keyword.acos.toFixed(0)}%. Reduce bid or pause temporarily to improve profitability.`,
          priority: 'high'
        });
      }
      
      // Additional rule for keywords with some sales but still unprofitable
      else if (keyword.acos > 50 && keyword.acos < 100 && keyword.spend >= 10) {
        suggestions.push({
          type: 'moderate-acos',
          keyword: keyword.keyword,
          campaign: keyword.campaignName,
          message: `"${keyword.keyword}" - ACoS at ${keyword.acos.toFixed(0)}%. Consider bid optimization to improve performance.`,
          priority: 'medium'
        });
      }
      
      // Rule for low spend but poor performance
      else if (keyword.acos > 30 && keyword.spend < 5 && keyword.sales > 0) {
        suggestions.push({
          type: 'low-spend-poor-performance',
          keyword: keyword.keyword,
          campaign: keyword.campaignName,
          message: `"${keyword.keyword}" - Low spend ($${keyword.spend.toFixed(2)}) with ${keyword.acos.toFixed(0)}% ACoS. Test with adjusted bids or consider pausing.`,
          priority: 'low'
        });
      }
    });
    
    // Rule #5: Check for duplicate keywords across campaigns
    const keywordMap = new Map();
    negativeKeywordsMetrics.forEach((keyword) => {
      if (!keywordMap.has(keyword.keyword)) {
        keywordMap.set(keyword.keyword, []);
      }
      keywordMap.get(keyword.keyword).push(keyword);
    });
    
    keywordMap.forEach((instances, keywordText) => {
      if (instances.length > 1) {
        // Find best and worst performing instance
        const sortedByAcos = [...instances].sort((a, b) => {
          // Handle cases where acos is 0 (no sales)
          if (a.sales === 0 && b.sales === 0) return b.spend - a.spend;
          if (a.sales === 0) return 1;
          if (b.sales === 0) return -1;
          return a.acos - b.acos;
        });
        
        const best = sortedByAcos[0];
        const worst = sortedByAcos[sortedByAcos.length - 1];
        
        // Check if there's a significant performance difference
        if ((worst.acos > best.acos + 20) || (worst.sales === 0 && best.sales > 0)) {
          suggestions.push({
            type: 'duplicate-keyword',
            keyword: keywordText,
            campaign: worst.campaignName,
            message: `"${keywordText}" - Duplicate found. Pause in "${worst.campaignName}" (${worst.sales === 0 ? 'No sales' : worst.acos.toFixed(0) + '% ACoS'}) and consolidate in "${best.campaignName}" (${best.acos.toFixed(0)}% ACoS).`,
            priority: 'medium'
          });
        }
      }
    });
    
    // Sort suggestions by priority and then by spend impact
    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      if (priorityOrder[a.priority] !== priorityOrder[b.priority]) {
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }
      // Within same priority, sort by spend (higher spend first)
      const aKeyword = negativeKeywordsMetrics.find(k => k.keyword === a.keyword && k.campaignName === a.campaign);
      const bKeyword = negativeKeywordsMetrics.find(k => k.keyword === b.keyword && k.campaignName === b.campaign);
      return (bKeyword?.spend || 0) - (aKeyword?.spend || 0);
    });
  };
  
  // Generate suggestions
  const suggestions = analyzeKeywordsAndGenerateSuggestions();
  
  // Get top suggestions to display
  const topSuggestions = suggestions.slice(0, 5);

  return (
    <div className="h-screen overflow-y-auto bg-[#eeeeee] p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-sm  text-gray-900">SPONSORED ADS</h1>
          <div className='flex bg-white gap-3 justify-between items-center px-3 py-1 border-2 border-gray-200  cursor-pointer' onClick={() => setOpenCalender(!openCalender)}>
            <p className='font-semi-bold text-xs'>Last 30 Days</p>
            <img src={calenderIcon} alt='' className='w-4 h-4' />
          </div>
        </div>
        
        {/* Line Chart */}
        <div className="bg-white rounded-xl p-6 mb-6">
          <ResponsiveContainer width="100%" height={280}>
            <LineChart 
              data={mockChartData} 
              margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
            >
              <XAxis 
                dataKey="date" 
                tick={{ fontSize: 12, fill: '#6B7280' }}
                stroke="#E5E7EB"
                tickLine={false}
              />
              <YAxis 
                tick={{ fontSize: 12, fill: '#6B7280' }}
                stroke="#E5E7EB"
                tickLine={false}
                tickFormatter={formatYAxis}
              />
              <Tooltip 
                contentStyle={{ 
                  backgroundColor: 'white', 
                  border: 'none',
                  borderRadius: '8px',
                  boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1)',
                  padding: '12px'
                }}
                formatter={(value, name) => {
                  if (name === 'ppcSales' || name === 'spend') {
                    return [`$${value}`, name === 'ppcSales' ? 'PPC Sales' : 'Spend'];
                  }
                  return [value, name];
                }}
              />
              <Line 
                type="monotone" 
                dataKey="ppcSales" 
                stroke="#3B82F6" 
                strokeWidth={2.5} 
                dot={false}
                activeDot={{ r: 5 }}
              />
              <Line 
                type="monotone" 
                dataKey="spend" 
                stroke="#F97316" 
                strokeWidth={2.5} 
                dot={false}
                activeDot={{ r: 5 }}
              />
              <Line 
                type="monotone" 
                dataKey="acos" 
                stroke="#14B8A6" 
                strokeWidth={2.5} 
                dot={false}
                activeDot={{ r: 5 }}
              />
              <Line 
                type="monotone" 
                dataKey="tacos" 
                stroke="#9CA3AF" 
                strokeWidth={2.5} 
                dot={false}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        
        {/* KPI Cards */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
          {kpiData.map((kpi, index) => (
            <div 
              key={kpi.label} 
              className={`bg-white rounded-xl p-5 ${index === 4 ? 'md:col-span-1' : ''}`}
            >
              <p className="text-sm text-gray-500 mb-2">{kpi.label}</p>
              <p className="text-2xl font-bold text-gray-900">{kpi.value}</p>
            </div>
          ))}
        </div>
        
        {/* Tabs - Only show if there's more than one page */}
        {totalPages > 1 && (
          <div className="flex gap-6 mb-6">
            {tabOptions.map((tab) => (
              <button
                key={tab.key}
                className={`px-1 py-2 text-sm font-medium transition-colors relative ${
                  selectedTab === tab.key 
                    ? 'text-gray-900' 
                    : 'text-gray-400 hover:text-gray-600'
                }`}
                onClick={() => setSelectedTab(tab.key)}
              >
                {tab.label}
                {selectedTab === tab.key && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-gray-900"></div>
                )}
              </button>
            ))}
          </div>
        )}
        
        {/* Table */}
        <div className="bg-white rounded-xl p-6 mb-6">
          <h2 className="text-xl font-semibold text-gray-900 mb-6">Non Profitable Keywords</h2>
          <table className="w-full">
            <thead>
              <tr className="border-b border-gray-200">
                <th className="text-left py-3 text-sm font-medium text-gray-700">Keyword</th>
                <th className="text-left py-3 text-sm font-medium text-gray-700">Campaign</th>
                <th className="text-center py-3 text-sm font-medium text-gray-700">Sales</th>
                <th className="text-center py-3 text-sm font-medium text-gray-700">Spend</th>
                <th className="text-center py-3 text-sm font-medium text-gray-700">ACoS</th>
              </tr>
            </thead>
            <tbody>
              {getCurrentPageData().length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-gray-400">
                    No data available
                  </td>
                </tr>
              ) : (
                getCurrentPageData().map((row, idx) => (
                  <tr key={`${selectedTab}-${idx}`} className="border-b border-gray-200">
                    <td className="py-4 text-sm text-gray-900">{row.keyword}</td>
                    <td className="py-4 text-sm text-gray-600">{row.campaignName}</td>
                    <td className="py-4 text-sm text-center">${row.sales.toFixed(2)}</td>
                    <td className="py-4 text-sm text-center">${row.spend.toFixed(2)}</td>
                    <td className={`py-4 text-sm text-center font-medium ${
                      row.acos === 0 ? 'text-gray-400' : 
                      row.acos > 100 ? 'text-red-600' : 'text-gray-900'
                    }`}>
                      {row.acos === 0 ? '-' : `${row.acos.toFixed(2)}%`}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
          {/* Show data range info */}
          {negativeKeywordsMetrics.length > 0 && (
            <div className="mt-4 text-sm text-gray-500 text-right">
              Showing {selectedTab * itemsPerPage + 1} - {Math.min((selectedTab + 1) * itemsPerPage, negativeKeywordsMetrics.length)} of {negativeKeywordsMetrics.length} keywords
            </div>
          )}
        </div>
        
        {/* Suggestions */}
        <div className="bg-white rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-3">Suggestions</h3>
          {topSuggestions.length > 0 ? (
            <div>
              {/* Summary of potential impact */}
              {(() => {
                const highPrioritySuggestions = suggestions.filter(s => s.priority === 'high');
                const potentialSavings = highPrioritySuggestions.reduce((total, suggestion) => {
                  const keyword = negativeKeywordsMetrics.find(k => 
                    k.keyword === suggestion.keyword && k.campaignName === suggestion.campaign
                  );
                  return total + (keyword?.spend || 0);
                }, 0);
                
                if (potentialSavings > 0) {
                  return (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                      <p className="text-sm font-medium text-red-900">
                        Potential Monthly Savings: ${potentialSavings.toFixed(2)}
                      </p>
                      <p className="text-xs text-red-700 mt-1">
                        By implementing {highPrioritySuggestions.length} high-priority suggestions
                      </p>
                    </div>
                  );
                }
                return null;
              })()}
              
              {/* Individual suggestions */}
              <div className="space-y-3">
                {topSuggestions.map((suggestion, index) => (
                  <div key={index} className="flex items-start gap-2 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      suggestion.priority === 'high' ? 'bg-red-500' : 
                      suggestion.priority === 'medium' ? 'bg-yellow-500' : 'bg-gray-400'
                    }`} />
                    <div className="flex-1">
                      <p className="text-sm text-gray-600">{suggestion.message}</p>
                      <div className="mt-2 flex gap-2">
                        {suggestion.type === 'high-spend-no-sales' && (
                          <button className="text-xs px-3 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors">
                            Add as Negative
                          </button>
                        )}
                        {(suggestion.type === 'high-acos' || suggestion.type === 'moderate-acos') && (
                          <>
                            <button className="text-xs px-3 py-1 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200 transition-colors">
                              Reduce Bid
                            </button>
                            <button className="text-xs px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors">
                              Pause Keyword
                            </button>
                          </>
                        )}
                        {suggestion.type === 'duplicate-keyword' && (
                          <button className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors">
                            Consolidate Keywords
                          </button>
                        )}
                        {suggestion.type === 'low-spend-poor-performance' && (
                          <button className="text-xs px-3 py-1 bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors">
                            Review Performance
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
                {suggestions.length > 5 && (
                  <p className="text-sm text-gray-400 mt-3">
                    + {suggestions.length - 5} more suggestions available
                  </p>
                )}
              </div>
            </div>
          ) : (
            <div className="space-y-2 text-sm text-gray-600">
              <p>No specific optimization suggestions at this time.</p>
              <p>Continue monitoring keyword performance for optimization opportunities.</p>
            </div>
          )}
        </div>
      </div>
      <div className='w-full h-[3rem]'></div>
      <div className='w-full h-[2rem]'></div>
     
    </div>
  );
};

export default PPCDashboard;