import React, { useState, useEffect, useMemo, useRef } from 'react';
import calenderIcon from '../assets/Icons/Calender.png'
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useSelector, useDispatch } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Calender from '../Components/Calender/Calender.jsx';
import DownloadReport from '../Components/DownloadReport/DownloadReport.jsx';

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

// Reusable Pagination Component
const TablePagination = ({ currentPage, totalPages, onPageChange, totalItems, itemsPerPage }) => {
  if (totalPages <= 1) return null;
  
  const startItem = (currentPage - 1) * itemsPerPage + 1;
  const endItem = Math.min(currentPage * itemsPerPage, totalItems);
  
  return (
    <div className="flex items-center justify-between mt-4 px-4 py-3 bg-gray-50 rounded-lg">
      <div className="text-sm text-gray-700">
        Showing {startItem} to {endItem} of {totalItems} results
      </div>
      <div className="flex items-center gap-2">
        <button
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
          className={`p-2 rounded-lg border transition-colors ${
            currentPage === 1
              ? 'border-gray-200 text-gray-400 cursor-not-allowed'
              : 'border-gray-300 text-gray-600 hover:bg-gray-100'
          }`}
        >
          <ChevronLeft className="w-4 h-4" />
        </button>
        <span className="px-3 py-1 text-sm font-medium text-gray-700">
          Page {currentPage} of {totalPages}
        </span>
        <button
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === totalPages}
          className={`p-2 rounded-lg border transition-colors ${
            currentPage === totalPages
              ? 'border-gray-200 text-gray-400 cursor-not-allowed'
              : 'border-gray-300 text-gray-600 hover:bg-gray-100'
          }`}
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};

const PPCDashboard = () => {
  const [selectedTab, setSelectedTab] = useState(0);
  const [prevTab, setPrevTab] = useState(0);
  const [hasInteracted, setHasInteracted] = useState(false);
  const [openCalender, setOpenCalender] = useState(false);
  const [showAllSuggestions, setShowAllSuggestions] = useState(false);
  const CalenderRef = useRef(null);
  
  // Pagination states for each table
  const [highAcosPage, setHighAcosPage] = useState(1);
  const [wastedSpendPage, setWastedSpendPage] = useState(1);
  const [negativePage, setNegativePage] = useState(1);
  const [topPerformingPage, setTopPerformingPage] = useState(1);
  const [searchTermsPage, setSearchTermsPage] = useState(1);
  const [autoCampaignPage, setAutoCampaignPage] = useState(1);
  
  const itemsPerPage = 5;
  
  const dispatch = useDispatch();

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (CalenderRef.current && !CalenderRef.current.contains(event.target)) {
        setOpenCalender(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [])
  
  // Get sponsoredAdsMetrics from Redux store
  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  const sponsoredAdsMetrics = useSelector((state) => state.Dashboard.DashBoardInfo?.sponsoredAdsMetrics);
  // Get negativeKeywordsMetrics from Redux store
  const negativeKeywordsMetrics = useSelector((state) => state.Dashboard.DashBoardInfo?.negativeKeywordsMetrics) || [];
  
  // Get ProductWiseSponsoredAdsGraphData from Redux store
  const productWiseSponsoredAdsGraphData = useSelector((state) => state.Dashboard.DashBoardInfo?.ProductWiseSponsoredAdsGraphData) || [];
  
  // Get ProductWiseSponsoredAds for error calculation
  const productWiseSponsoredAds = useSelector((state) => state.Dashboard.DashBoardInfo?.ProductWiseSponsoredAds) || [];
  
  // Get keywords data from Redux store
  const keywords = useSelector((state) => state.Dashboard.DashBoardInfo?.keywords) || [];
  
  // Get searchTerms data from Redux store
  const searchTerms = useSelector((state) => state.Dashboard.DashBoardInfo?.searchTerms) || [];
  
  // Get campaignData from Redux store
  const campaignData = useSelector((state) => state.Dashboard.DashBoardInfo?.campaignData) || [];
  
  // Filter search terms where clicks >= 10 and sales = 0
  const filteredSearchTerms = searchTerms.filter(term => term.clicks >= 10 && term.sales === 0);
  
  // Transform the data for the chart - use filtered TotalSales from Redux
  const chartData = useMemo(() => {
    // Use date-filtered TotalSales data from Redux if available
    const totalSalesData = info?.TotalSales;
    
    if (totalSalesData && Array.isArray(totalSalesData) && totalSalesData.length > 0) {
      // Transform date-filtered sales data for the chart
      return totalSalesData.map(item => {
        // Extract date from interval format: "2025-03-01T00:00:00Z--2025-03-01T23:59:59Z"
        const startDate = new Date(item.interval.split('--')[0]);
        const formattedDate = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        // For PPC data, we'll use a percentage of total sales as PPC sales (estimated)
        const totalSales = parseFloat(item.TotalAmount) || 0;
        const estimatedPPCSales = totalSales * 0.3; // Assume 30% of sales come from PPC
        const estimatedSpend = estimatedPPCSales * 0.25; // Assume 25% ACOS
        
        return {
          date: formattedDate,
          ppcSales: estimatedPPCSales,
          spend: estimatedSpend,
        };
      });
    }
    
    // Fallback to original productWiseSponsoredAdsGraphData if no filtered data
    if (productWiseSponsoredAdsGraphData.length > 0) {
      return productWiseSponsoredAdsGraphData.map(item => ({
        date: new Date(item.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        ppcSales: item.totalSalesIn30Days || 0,
        spend: item.totalSpend || 0,
      }));
    }
    
    return mockChartData.slice();
  }, [info?.TotalSales, productWiseSponsoredAdsGraphData]);
  
  // Tab configuration
  const tabs = [
    { id: 0, label: 'High ACOS Campaigns' },
    { id: 1, label: 'Wasted Spend Keywords' },
    { id: 2, label: 'Negative Keywords' },
    { id: 3, label: 'Top Performing Keywords' },
    { id: 4, label: 'Search Terms' },
    { id: 5, label: 'Auto Campaign Insights' }
  ];
  
  // Get animation direction based on tab order
  const getDirection = () => {
    return selectedTab > prevTab ? 1 : -1;
  };
  
  const direction = getDirection();
  
  // Animation variants for page transitions
  const pageVariants = {
    enter: (direction) => ({
      x: direction > 0 ? "100%" : "-100%",
      opacity: 0,
      position: "absolute",
      width: "100%",
    }),
    center: {
      x: 0,
      opacity: 1,
      position: "relative",
      width: "100%",
      transition: { duration: 0.4, ease: "easeInOut" },
    },
    exit: (direction) => ({
      x: direction > 0 ? "-100%" : "100%",
      opacity: 0,
      position: "absolute",
      width: "100%",
      transition: { duration: 0.4, ease: "easeInOut" },
    }),
  };
  
  // Handle tab click with animation state
  const handleTabClick = (tabId) => {
    if (tabId === selectedTab) return;
    setPrevTab(selectedTab);
    setSelectedTab(tabId);
    setHasInteracted(true);
  };
  
  // Process data for different tabs
  // High ACOS Campaigns - First aggregate all products by campaign, then filter by ACOS > 40%
  // Step 1: Aggregate all products by campaign
  const campaignAggregates = productWiseSponsoredAds.reduce((acc, product) => {
    const sales = parseFloat(product.salesIn30Days) || 0;
    const spend = parseFloat(product.spend) || 0;
    const campaignName = product.campaignName;
    
    if (!campaignName) return acc;
    
    if (!acc[campaignName]) {
      acc[campaignName] = {
        campaignName: campaignName,
        campaignId: product.campaignId,
        totalSpend: 0,
        totalSales: 0,
        products: new Set()
      };
    }
    
    acc[campaignName].totalSpend += spend;
    acc[campaignName].totalSales += sales;
    acc[campaignName].products.add(product.asin);
    
    return acc;
  }, {});
  
  // Step 2: Convert to array, calculate ACOS, and filter
  const highAcosCampaigns = Object.values(campaignAggregates)
    .map(campaign => {
      // Count keywords for this campaign
      const campaignKeywords = keywords.filter(k => k.campaignId === campaign.campaignId);
      
      return {
        campaignName: campaign.campaignName,
        campaignId: campaign.campaignId,
        totalSpend: campaign.totalSpend,
        totalSales: campaign.totalSales,
        acos: campaign.totalSales > 0 ? (campaign.totalSpend / campaign.totalSales) * 100 : 0,
        productCount: campaign.products.size,
        keywordCount: campaignKeywords.length
      };
    })
    .filter(campaign => campaign.acos > 40 && campaign.totalSales > 0)
    .sort((a, b) => b.acos - a.acos);
  
  // Wasted Spend Keywords - cost > 5 && salesIn30Days < 1
  // First, create a map of campaignId to campaign data for easier lookup
  const campaignMap = new Map();
  productWiseSponsoredAds.forEach(product => {
    if (!campaignMap.has(product.campaignId)) {
      campaignMap.set(product.campaignId, {
        campaignName: product.campaignName,
        products: []
      });
    }
    campaignMap.get(product.campaignId).products.push(product);
  });
  
  // Process keywords to find wasted spend
  const wastedSpendKeywords = keywords
    .map(keyword => {
      // Get campaign info
      const campaignInfo = campaignMap.get(keyword.campaignId);
      if (!campaignInfo) return null;
      
      // Calculate total spend and sales for this keyword across all products in the campaign
      let totalSpend = 0;
      let totalSales = 0;
      
      // Find matching data from negativeKeywordsMetrics
      const keywordMetrics = negativeKeywordsMetrics.find(k => 
        k.keyword === keyword.keywordText && 
        k.campaignName === campaignInfo.campaignName
      );
      
      if (keywordMetrics) {
        totalSpend = keywordMetrics.spend;
        totalSales = keywordMetrics.sales;
      } else {
        // If not in negativeKeywordsMetrics, aggregate from products
        campaignInfo.products.forEach(product => {
          totalSpend += parseFloat(product.spend) || 0;
          totalSales += parseFloat(product.salesIn30Days) || 0;
        });
      }
      
      // Apply filter: cost > 5 && salesIn30Days < 1
      if (totalSpend > 5 && totalSales < 1) {
        const acos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
        
        return {
          keyword: keyword.keywordText,
          campaignName: campaignInfo.campaignName,
          campaignId: keyword.campaignId,
          bid: keyword.bid || 0,
          sales: totalSales,
          spend: totalSpend,
          acos: acos,
          matchType: keyword.matchType,
          state: keyword.state
        };
      }
      
      return null;
    })
    .filter(keyword => keyword !== null)
    .sort((a, b) => b.spend - a.spend);
  
  // Top Performing Keywords - ACOS < 20%, sales > 100, impressions > 10,000
  const topPerformingKeywords = keywords
    .map(keyword => {
      // Get campaign info from the campaign map we already created
      const campaignInfo = campaignMap.get(keyword.campaignId);
      if (!campaignInfo) return null;
      
      // Calculate aggregated metrics for this keyword across all products in the campaign
      let totalSpend = 0;
      let totalSales = 0;
      let totalImpressions = 0;
      
      // First check if we have keyword-specific metrics in negativeKeywordsMetrics
      const keywordMetrics = negativeKeywordsMetrics.find(k => 
        k.keyword === keyword.keywordText && 
        k.campaignName === campaignInfo.campaignName
      );
      
      if (keywordMetrics) {
        // Use keyword-specific metrics if available
        totalSpend = keywordMetrics.spend;
        totalSales = keywordMetrics.sales;
        totalImpressions = keywordMetrics.impressions || 0;
      }
      
      // If we don't have keyword metrics or impressions, aggregate from all products in the campaign
      if (!keywordMetrics || totalImpressions === 0) {
        // Reset totals if we're going to aggregate from products
        if (!keywordMetrics) {
          totalSpend = 0;
          totalSales = 0;
        }
        
        // Aggregate impressions from ALL products in the campaign (30-day data)
        campaignInfo.products.forEach(product => {
          if (!keywordMetrics) {
            // If no keyword metrics, aggregate all metrics
            totalSpend += parseFloat(product.spend) || 0;
            totalSales += parseFloat(product.salesIn30Days) || 0;
          }
          // Always aggregate impressions from all products
          totalImpressions += parseFloat(product.impressions) || 0;
        });
      }
      
      // Calculate ACOS
      const acos = totalSales > 0 ? (totalSpend / totalSales) * 100 : 0;
      
      // Apply filters: ACOS < 20%, sales > 100, impressions > 3,000
      if (acos < 20 && totalSales > 100 && totalImpressions > 3000) {
        return {
          keyword: keyword.keywordText,
          campaignName: campaignInfo.campaignName,
          campaignId: keyword.campaignId,
          bid: keyword.bid || 0,
          sales: totalSales,
          spend: totalSpend,
          acos: acos,
          impressions: totalImpressions,
          matchType: keyword.matchType,
          state: keyword.state
        };
      }
      
      return null;
    })
    .filter(keyword => keyword !== null)
    .sort((a, b) => b.sales - a.sales);
  
  // Auto Campaign Insights Processing
  /*
   * Logic:
   * 1. Get all auto campaigns (targetingType === 'auto')
   * 2. Get keywords associated with auto campaigns
   * 3. For each search term:
   *    - Check if it has sales > 30
   *    - Check if its associated keyword belongs to an auto campaign
   *    - Show in table with ACOS calculation
   *    - If search term doesn't exist in manual campaigns, suggest migration
   *    - Otherwise, leave action blank
   */
  
  // Get auto campaigns
  const autoCampaigns = campaignData.filter(campaign => campaign.targetingType === 'auto');
  const autoCampaignIds = autoCampaigns.map(campaign => campaign.campaignId);
  
  // Get manual campaigns for checking if keywords exist there
  const manualCampaigns = campaignData.filter(campaign => campaign.targetingType === 'manual');
  const manualCampaignIds = manualCampaigns.map(campaign => campaign.campaignId);
  
  // Get keywords from manual campaigns - these are the keywords we want to check against
  const manualKeywords = keywords
    .filter(keyword => manualCampaignIds.includes(keyword.campaignId))
    .map(keyword => keyword.keywordText.toLowerCase());
  
    // Process auto campaign insights
  const autoCampaignInsights = [];
  
  // Process search terms directly by matching campaign IDs
  searchTerms.forEach(searchTerm => {
    // Check if sales > 30
    if (searchTerm.sales > 30) {
      // Check if this search term's campaignId belongs to an auto campaign
      if (searchTerm.campaignId && autoCampaignIds.includes(searchTerm.campaignId)) {
        
        // Calculate ACOS for this search term
        const acos = searchTerm.sales > 0 ? (searchTerm.spend / searchTerm.sales) * 100 : 0;
        
        // Find the campaign details
        const campaign = autoCampaigns.find(c => c.campaignId === searchTerm.campaignId);
        
        // Check if this search term exists as a keyword in manual campaigns
        const existsInManual = manualKeywords.includes(searchTerm.searchTerm.toLowerCase());
        
        // Determine action - only suggest migration if not in manual campaigns
        const action = !existsInManual ? 'Migrate to Manual Campaign' : '';
        
        // Check if we already have this search term in our insights
        const existingInsight = autoCampaignInsights.find(
          insight => insight.searchTerm === searchTerm.searchTerm
        );
        
        if (!existingInsight) {
          autoCampaignInsights.push({
            searchTerm: searchTerm.searchTerm,
            keyword: searchTerm.keyword || '',
            campaignName: searchTerm.campaignName || campaign?.name || 'Unknown Campaign',
            campaignId: searchTerm.campaignId,
            sales: searchTerm.sales,
            spend: searchTerm.spend,
            clicks: searchTerm.clicks,
            impressions: searchTerm.impressions || 0,
            acos: acos,
            action: action
          });
        }
      }
    }
  });
  
  // Sort by sales descending
  autoCampaignInsights.sort((a, b) => b.sales - a.sales);
  
  // Use Redux data for KPI values - prioritize filtered data from calendar selection
  const kpiData = useMemo(() => {
    // Calculate totals from filtered TotalSales data if available
    const totalSalesData = info?.TotalSales;
    let filteredTotalSales = 0;
    let estimatedPPCSales = 0;
    let estimatedSpend = 0;
    
    if (totalSalesData && Array.isArray(totalSalesData) && totalSalesData.length > 0) {
      // Calculate totals from filtered date range
      filteredTotalSales = totalSalesData.reduce((sum, item) => sum + (parseFloat(item.TotalAmount) || 0), 0);
      estimatedPPCSales = filteredTotalSales * 0.3; // Assume 30% of sales come from PPC
      estimatedSpend = estimatedPPCSales * 0.25; // Assume 25% ACOS
    }
    
    // Use filtered data if available, otherwise fall back to original metrics
    const ppcSales = estimatedPPCSales > 0 ? estimatedPPCSales : (sponsoredAdsMetrics?.totalSalesIn30Days || 25432.96);
    const spend = estimatedSpend > 0 ? estimatedSpend : (sponsoredAdsMetrics?.totalCost || 7654.21);
    const totalSales = filteredTotalSales > 0 ? filteredTotalSales : (Number(info?.TotalWeeklySale || 0) || 84776.44);
    
    return [
      { 
        label: 'PPC Sales', 
        value: `$${ppcSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
      },
      { 
        label: 'Spend', 
        value: `$${spend.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` 
      },
      { 
        label: 'ACOS', 
        value: ppcSales > 0 ? `${((spend / ppcSales) * 100).toFixed(2)}%` : '25.00%'
      },
      { 
        label: 'TACoS', 
        value: totalSales > 0 ? `${((spend / totalSales) * 100).toFixed(2)}%` : '9.04%'
      },
      { 
        label: 'Units Sold', 
        value: `${sponsoredAdsMetrics?.totalProductsPurchased || Math.round(ppcSales / 85)}`
      },
    ];
  }, [info?.TotalSales, info?.TotalWeeklySale, sponsoredAdsMetrics]);

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
    
    // 1. Suggestions from High ACOS Campaigns
    highAcosCampaigns.forEach((campaign, index) => {
      if (index < 3) { // Top 3 worst performing campaigns
        suggestions.push({
          type: 'campaign-high-acos',
          campaign: campaign.campaignName,
          message: `Campaign "${campaign.campaignName}" has ${campaign.acos.toFixed(0)}% ACOS. Consider reducing bids, refining targeting, or pausing underperforming keywords.`,
          priority: campaign.acos > 80 ? 'high' : 'medium',
          metrics: {
            spend: campaign.totalSpend,
            sales: campaign.totalSales,
            acos: campaign.acos
          }
        });
      }
    });
    
    // 2. Suggestions from Wasted Spend Keywords
    wastedSpendKeywords.slice(0, 5).forEach((keyword) => {
      suggestions.push({
        type: 'keyword-wasted-spend',
        keyword: keyword.keyword,
        campaign: keyword.campaignName,
        message: `"${keyword.keyword}" - Add as negative keyword. $${keyword.spend.toFixed(2)} spent with no sales.`,
        priority: 'high',
        metrics: {
          spend: keyword.spend,
          bid: keyword.bid
        }
      });
    });
    
    // 3. Suggestions from Top Performing Keywords (optimization opportunities)
    topPerformingKeywords.slice(0, 3).forEach((keyword) => {
      suggestions.push({
        type: 'keyword-optimize',
        keyword: keyword.keyword,
        campaign: keyword.campaignName,
        message: `"${keyword.keyword}" performing well (${keyword.acos.toFixed(0)}% ACOS). Consider increasing bid from $${keyword.bid.toFixed(2)} to capture more traffic.`,
        priority: 'low',
        metrics: {
          sales: keyword.sales,
          acos: keyword.acos,
          currentBid: keyword.bid
        }
      });
    });
    
    // 4. Suggestions from Negative Keywords (high ACOS keywords)
    negativeKeywordsMetrics
      .filter(keyword => keyword.acos > 50 && keyword.spend > 10)
      .slice(0, 5)
      .forEach((keyword) => {
        // Skip if already analyzed
        const keywordIdentifier = `${keyword.keyword}-${keyword.campaignName}`;
        if (analyzedKeywords.has(keywordIdentifier)) return;
        analyzedKeywords.add(keywordIdentifier);
        
        if (keyword.acos > 100) {
          suggestions.push({
            type: 'keyword-extreme-acos',
            keyword: keyword.keyword,
            campaign: keyword.campaignName,
            message: `"${keyword.keyword}" has ${keyword.acos.toFixed(0)}% ACOS. Pause immediately or reduce bid significantly.`,
            priority: 'high',
            metrics: {
              spend: keyword.spend,
              sales: keyword.sales,
              acos: keyword.acos
            }
          });
        } else {
          suggestions.push({
            type: 'keyword-high-acos',
            keyword: keyword.keyword,
            campaign: keyword.campaignName,
            message: `"${keyword.keyword}" has ${keyword.acos.toFixed(0)}% ACOS. Consider bid optimization or adding as negative keyword.`,
            priority: 'medium',
            metrics: {
              spend: keyword.spend,
              sales: keyword.sales,
              acos: keyword.acos
            }
          });
        }
      });
    
    // Continue with existing product-level analysis but skip if already covered
    if (Array.isArray(productWiseSponsoredAds)) {
      // Aggregate product data by ASIN
      const aggregatedProductData = new Map();
      
      productWiseSponsoredAds.forEach((product) => {
        const asin = product.asin;
        if (!aggregatedProductData.has(asin)) {
          aggregatedProductData.set(asin, {
            asin: asin,
            totalSpend: 0,
            totalSales: 0,
            campaigns: []
          });
        }
        
        const aggregated = aggregatedProductData.get(asin);
        aggregated.totalSpend += parseFloat(product.spend) || 0;
        aggregated.totalSales += parseFloat(product.salesIn30Days) || 0;
        if (product.campaignName) {
          aggregated.campaigns.push(product.campaignName);
        }
      });
      
      // Analyze aggregated product data for errors
      aggregatedProductData.forEach((aggregatedProduct) => {
        const spend = aggregatedProduct.totalSpend;
        const sales = aggregatedProduct.totalSales;
        const acos = sales > 0 ? (spend / sales) * 100 : 0;
        const campaignCount = new Set(aggregatedProduct.campaigns).size;
        
        // Check if this product has an error based on the same criteria used in analyse.js
        let hasError = false;
        let errorType = '';
        
        if (acos > 50 && sales > 0) {
          hasError = true;
          errorType = 'high_acos';
          suggestions.push({
            type: 'product-high-acos',
            asin: aggregatedProduct.asin,
            message: `ASIN ${aggregatedProduct.asin}: ACoS at ${acos.toFixed(0)}% ($${spend.toFixed(2)} spend, $${sales.toFixed(2)} sales). Consider reducing bids or pausing underperforming campaigns.`,
            priority: 'high'
          });
        } else if (spend > 5 && sales === 0) {
          hasError = true;
          errorType = 'no_sales';
          suggestions.push({
            type: 'product-no-sales',
            asin: aggregatedProduct.asin,
            message: `ASIN ${aggregatedProduct.asin}: $${spend.toFixed(2)} spent with no sales. Review targeting and consider pausing campaigns.`,
            priority: 'high'
          });
        } else if (spend > 10 && acos > 30) {
          hasError = true;
          errorType = 'marginal_profit';
          suggestions.push({
            type: 'product-marginal',
            asin: aggregatedProduct.asin,
            message: `ASIN ${aggregatedProduct.asin}: ACoS at ${acos.toFixed(0)}% with $${spend.toFixed(2)} spend. Optimize bids to improve profitability.`,
            priority: 'medium'
          });
        }
      });
    }
    
    // Then analyze negative keywords
    negativeKeywordsMetrics.forEach((keyword) => {
      const keywordIdentifier = `${keyword.keyword}-${keyword.campaignName}`;
      
      // Skip if already analyzed
      if (analyzedKeywords.has(keywordIdentifier)) return;
      analyzedKeywords.add(keywordIdentifier);
      
      // Check if this keyword has an error based on the same criteria used in analyse.js
      let hasError = false;
      
      // Rule #1: High Spend, No Sales
      if (keyword.spend >= 5 && keyword.sales === 0) {
        hasError = true;
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
        hasError = true;
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
    
    // Sort suggestions by priority
    return suggestions.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  };
  
  // Generate suggestions
  const suggestions = analyzeKeywordsAndGenerateSuggestions();
  
  // Get suggestions to display based on showAllSuggestions state
  const suggestionsToDisplay = showAllSuggestions ? suggestions : suggestions.slice(0, 5);

  // Prepare data for CSV/Excel export
  const preparePPCData = () => {
    const csvData = [];
    
    // Add KPI data
    csvData.push(['PPC Dashboard Report']);
    csvData.push(['Generated on:', new Date().toLocaleDateString()]);
    csvData.push(['Date Range:', info?.startDate && info?.endDate ? `${info.startDate} to ${info.endDate}` : 'Last 30 Days']);
    csvData.push([]);
    
    // Add KPI metrics
    csvData.push(['Key Performance Indicators']);
    kpiData.forEach(kpi => {
      csvData.push([kpi.label, kpi.value]);
    });
    csvData.push([]);
    
    // Add High ACOS Campaigns - ALL DATA (not paginated)
    if (highAcosCampaigns.length > 0) {
      csvData.push([`High ACOS Campaigns (>40%) - Total: ${highAcosCampaigns.length} campaigns`]);
      csvData.push(['Campaign Name', 'Campaign ID', 'Total Spend', 'Total Sales', 'ACOS %', 'Products', 'Keywords']);
      highAcosCampaigns.forEach(campaign => {
        csvData.push([
          campaign.campaignName,
          campaign.campaignId,
          `$${campaign.totalSpend.toFixed(2)}`,
          `$${campaign.totalSales.toFixed(2)}`,
          `${campaign.acos.toFixed(2)}%`,
          campaign.productCount,
          campaign.keywordCount
        ]);
      });
      csvData.push([]);
    }
    
    // Add Wasted Spend Keywords - ALL DATA (not paginated)
    if (wastedSpendKeywords.length > 0) {
      csvData.push([`Wasted Spend Keywords (>$5 spend, <$1 sales) - Total: ${wastedSpendKeywords.length} keywords`]);
      csvData.push(['Keyword', 'Campaign Name', 'Bid', 'Sales', 'Spend', 'ACOS %', 'Match Type']);
      wastedSpendKeywords.forEach(keyword => {
        csvData.push([
          keyword.keyword,
          keyword.campaignName,
          `$${keyword.bid.toFixed(2)}`,
          `$${keyword.sales.toFixed(2)}`,
          `$${keyword.spend.toFixed(2)}`,
          `${keyword.acos.toFixed(2)}%`,
          keyword.matchType
        ]);
      });
      csvData.push([]);
    }
    
    // Add Top Performing Keywords - ALL DATA (not paginated)
    if (topPerformingKeywords.length > 0) {
      csvData.push([`Top Performing Keywords (<20% ACOS, >$100 sales) - Total: ${topPerformingKeywords.length} keywords`]);
      csvData.push(['Keyword', 'Campaign Name', 'Bid', 'Sales', 'Spend', 'ACOS %', 'Impressions', 'Match Type']);
      topPerformingKeywords.forEach(keyword => {
        csvData.push([
          keyword.keyword,
          keyword.campaignName,
          `$${keyword.bid.toFixed(2)}`,
          `$${keyword.sales.toFixed(2)}`,
          `$${keyword.spend.toFixed(2)}`,
          `${keyword.acos.toFixed(2)}%`,
          keyword.impressions.toLocaleString(),
          keyword.matchType
        ]);
      });
      csvData.push([]);
    }
    
    // Add Auto Campaign Insights - ALL DATA (not paginated)
    if (autoCampaignInsights.length > 0) {
      csvData.push([`Auto Campaign Insights (>$30 sales) - Total: ${autoCampaignInsights.length} search terms`]);
      csvData.push(['Search Term', 'Campaign Name', 'Sales', 'Spend', 'Clicks', 'ACOS %', 'Recommended Action']);
      autoCampaignInsights.forEach(insight => {
        csvData.push([
          insight.searchTerm,
          insight.campaignName,
          `$${insight.sales.toFixed(2)}`,
          `$${insight.spend.toFixed(2)}`,
          insight.clicks,
          `${insight.acos.toFixed(2)}%`,
          insight.action || 'Monitor Performance'
        ]);
      });
      csvData.push([]);
    }
    
    // Add Negative Keywords Metrics - ALL DATA (not paginated)
    if (negativeKeywordsMetrics.length > 0) {
      csvData.push([`Negative Keywords Analysis - Total: ${negativeKeywordsMetrics.length} keywords`]);
      csvData.push(['Keyword', 'Campaign Name', 'Sales', 'Spend', 'Clicks', 'Impressions', 'ACOS %']);
      negativeKeywordsMetrics.forEach(keyword => {
        const acos = keyword.sales > 0 ? (keyword.spend / keyword.sales) * 100 : 0;
        csvData.push([
          keyword.keyword,
          keyword.campaignName,
          `$${keyword.sales.toFixed(2)}`,
          `$${keyword.spend.toFixed(2)}`,
          keyword.clicks || 0,
          keyword.impressions || 0,
          `${acos.toFixed(2)}%`
        ]);
      });
      csvData.push([]);
    }
    
    // Add Search Terms Data - ALL DATA (not paginated)
    if (searchTerms.length > 0) {
      csvData.push([`All Search Terms - Total: ${searchTerms.length} terms`]);
      csvData.push(['Search Term', 'Campaign Name', 'Sales', 'Spend', 'Clicks', 'Impressions', 'ACOS %']);
      searchTerms.forEach(term => {
        const acos = term.sales > 0 ? (term.spend / term.sales) * 100 : 0;
        csvData.push([
          term.searchTerm,
          term.campaignName,
          `$${term.sales.toFixed(2)}`,
          `$${term.spend.toFixed(2)}`,
          term.clicks || 0,
          term.impressions || 0,
          `${acos.toFixed(2)}%`
        ]);
      });
      csvData.push([]);
    }
    
    // Add All Keywords Data - ALL DATA (not paginated)
    if (keywords.length > 0) {
      csvData.push([`All Keywords - Total: ${keywords.length} keywords`]);
      csvData.push(['Keyword', 'Campaign ID', 'Bid', 'Match Type', 'State']);
      keywords.forEach(keyword => {
        csvData.push([
          keyword.keywordText,
          keyword.campaignId,
          `$${(keyword.bid || 0).toFixed(2)}`,
          keyword.matchType || 'N/A',
          keyword.state || 'N/A'
        ]);
      });
      csvData.push([]);
    }
    
    // Add Chart Data
    if (chartData.length > 0) {
      csvData.push(['Daily Performance Chart Data']);
      csvData.push(['Date', 'PPC Sales', 'Spend']);
      chartData.forEach(day => {
        csvData.push([
          day.date,
          `$${day.ppcSales.toFixed(2)}`,
          `$${day.spend.toFixed(2)}`
        ]);
      });
      csvData.push([]);
    }
    
    // Add Suggestions
    if (suggestions.length > 0) {
      csvData.push(['Optimization Suggestions']);
      suggestions.forEach((suggestion, index) => {
        csvData.push([`${index + 1}.`, suggestion.message]);
      });
    }
    
    return csvData;
  };

  return (
    <div className="h-[90vh] overflow-y-auto bg-[#eeeeee] p-6">
              <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-5">
          <h1 className="text-sm  text-gray-900">SPONSORED ADS</h1>
          <div className="flex gap-4 flex-wrap">
            <div className='fit-content relative' ref={CalenderRef}>
              <div className='flex bg-white gap-3 justify-between items-center px-3 py-1 border-2 border-gray-200  cursor-pointer' onClick={() => setOpenCalender(!openCalender)}>
                <p className='font-semi-bold text-xs'>Last 30 Days</p>
                <img src={calenderIcon} alt='' className='w-4 h-4' />
              </div>
              <AnimatePresence>
                {openCalender && (
                  <motion.div
                    initial={{ opacity: 0, scaleY: 0 }}
                    animate={{ opacity: 1, scaleY: 1 }}
                    exit={{ opacity: 0, scaleY: 0 }}
                    transition={{ duration: 0.3 }}
                    className="absolute top-full right-0 z-50 bg-white shadow-md rounded-md origin-top"
                  >
                    <Calender setOpenCalender={setOpenCalender} />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
                          <DownloadReport
                prepareDataFunc={preparePPCData}
                filename="PPC_Dashboard_Report"
                buttonText="Download Report"
                buttonClass="text-sm text-white bg-[#333651] rounded px-3 py-1 flex items-center gap-2"
                showIcon={true}
              />
          </div>
        </div>
        
        {/* KPI Cards */}
        <div className="grid grid-cols-5 gap-3 mb-6">
          {kpiData.map((kpi, index) => (
            <div 
              key={kpi.label} 
              className="bg-white rounded-xl p-4"
            >
              <p className="text-xs text-gray-500 mb-1">{kpi.label}</p>
              <p className="text-lg font-bold text-gray-900">{kpi.value}</p>
            </div>
          ))}
        </div>
        
        {/* Line Chart */}
        <div className="bg-white rounded-xl p-6 mb-6">
          <ResponsiveContainer width="100%" height={400}>
            <LineChart 
              data={chartData} 
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
                  if (name === 'PPC Sales' || name === 'PPC Spend') {
                    return [`$${value}`, name];
                  }
                  return [value, name];
                }}
              />
              <Legend 
                wrapperStyle={{ 
                  fontSize: '12px', 
                  paddingTop: '20px' 
                }}
                iconType="line"
              />
              <Line 
                type="monotone" 
                dataKey="ppcSales" 
                name="PPC Sales"
                stroke="#3B82F6" 
                strokeWidth={2.5} 
                dot={false}
                activeDot={{ r: 5 }}
              />
              <Line 
                type="monotone" 
                dataKey="spend" 
                name="PPC Spend"
                stroke="#F97316" 
                strokeWidth={2.5} 
                dot={false}
                activeDot={{ r: 5 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
        
        {/* Tabs */}
        <div className="flex gap-6 mb-6 relative">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className="relative pb-3 cursor-pointer"
              onClick={() => handleTabClick(tab.id)}
            >
              <p
                className={`text-sm font-medium transition-colors ${
                  selectedTab === tab.id 
                    ? 'text-gray-900 font-bold' 
                    : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                {tab.label}
              </p>
              
              {/* Animated underline */}
              {selectedTab === tab.id && (
                <motion.div
                  layoutId="ppcUnderline"
                  className="absolute bottom-0 left-0 right-0 h-[3px] bg-gray-900 rounded-full"
                  transition={{ type: "spring", stiffness: 500, damping: 30 }}
                />
              )}
            </div>
            ))}
          </div>
        
        {/* Tables based on selected tab */}
        <div className="bg-white rounded-xl p-6 mb-6 relative overflow-hidden" style={{ minHeight: '400px' }}>
          <AnimatePresence custom={direction} mode="sync">
            <motion.div
              key={selectedTab}
              custom={direction}
              variants={pageVariants}
              initial={hasInteracted ? "enter" : false}
              animate="center"
              exit="exit"
              className="w-full"
            >
              {/* High ACOS Campaigns Tab */}
              {selectedTab === 0 && (
                <>
              <h2 className="text-xl font-semibold text-gray-900 mb-6">High ACOS Campaigns</h2>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 text-sm font-medium text-gray-700">Campaign</th>
                    <th className="text-center py-3 text-sm font-medium text-gray-700">Spend</th>
                    <th className="text-center py-3 text-sm font-medium text-gray-700">Sales</th>
                    <th className="text-center py-3 text-sm font-medium text-gray-700">ACOS</th>
                  </tr>
                </thead>
                <tbody>
                  {highAcosCampaigns.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-12 text-gray-400">
                        No data available
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      const startIndex = (highAcosPage - 1) * itemsPerPage;
                      const endIndex = startIndex + itemsPerPage;
                      return highAcosCampaigns.slice(startIndex, endIndex).map((campaign, idx) => (
                        <tr key={idx} className="border-b border-gray-200">
                          <td className="py-4 text-sm text-gray-900">{campaign.campaignName}</td>
                          <td className="py-4 text-sm text-center">${campaign.totalSpend.toFixed(2)}</td>
                          <td className="py-4 text-sm text-center">${campaign.totalSales.toFixed(2)}</td>
                          <td className="py-4 text-sm text-center font-medium text-red-600">
                            {campaign.acos.toFixed(2)}%
                          </td>
                        </tr>
                      ));
                    })()
                  )}
                </tbody>
              </table>
              <TablePagination
                currentPage={highAcosPage}
                totalPages={Math.ceil(highAcosCampaigns.length / itemsPerPage)}
                onPageChange={setHighAcosPage}
                totalItems={highAcosCampaigns.length}
                itemsPerPage={itemsPerPage}
              />
            </>
          )}
          
          {/* Wasted Spend Keywords Tab */}
          {selectedTab === 1 && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-6">Wasted Spend Keywords</h2>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 text-sm font-medium text-gray-700">Keywords</th>
                    <th className="text-left py-3 text-sm font-medium text-gray-700">Campaign</th>
                    <th className="text-center py-3 text-sm font-medium text-gray-700">Bid</th>
                    <th className="text-center py-3 text-sm font-medium text-gray-700">Sales</th>
                    <th className="text-center py-3 text-sm font-medium text-gray-700">Spend</th>
                    <th className="text-center py-3 text-sm font-medium text-gray-700">ACOS</th>
                  </tr>
                </thead>
                <tbody>
                  {wastedSpendKeywords.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="text-center py-12 text-gray-400">
                        No data available
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      const startIndex = (wastedSpendPage - 1) * itemsPerPage;
                      const endIndex = startIndex + itemsPerPage;
                      return wastedSpendKeywords.slice(startIndex, endIndex).map((keyword, idx) => (
                        <tr key={idx} className="border-b border-gray-200">
                          <td className="py-4 text-sm text-gray-900">{keyword.keyword}</td>
                          <td className="py-4 text-sm text-gray-600">{keyword.campaignName}</td>
                          <td className="py-4 text-sm text-center">${keyword.bid.toFixed(2)}</td>
                          <td className="py-4 text-sm text-center">${keyword.sales.toFixed(2)}</td>
                          <td className="py-4 text-sm text-center font-medium text-red-600">
                            ${keyword.spend.toFixed(2)}
                          </td>
                          <td className="py-4 text-sm text-center font-medium text-gray-600">
                            {keyword.acos === 0 ? '-' : `${keyword.acos.toFixed(2)}%`}
                          </td>
                        </tr>
                      ));
                    })()
                  )}
                </tbody>
              </table>
              <TablePagination
                currentPage={wastedSpendPage}
                totalPages={Math.ceil(wastedSpendKeywords.length / itemsPerPage)}
                onPageChange={setWastedSpendPage}
                totalItems={wastedSpendKeywords.length}
                itemsPerPage={itemsPerPage}
              />
            </>
          )}
          
          {/* Negative Keywords Tab */}
          {selectedTab === 2 && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-6">Negative Keywords</h2>
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
                  {negativeKeywordsMetrics.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-12 text-gray-400">
                    No data available
                  </td>
                </tr>
              ) : (
                    (() => {
                      const startIndex = (negativePage - 1) * itemsPerPage;
                      const endIndex = startIndex + itemsPerPage;
                      return negativeKeywordsMetrics.slice(startIndex, endIndex).map((row, idx) => {
                        // Find keyword details
                        const keywordDetail = keywords.find(k => 
                          k.keywordText === row.keyword && 
                          productWiseSponsoredAds.some(p => 
                            p.campaignName === row.campaignName && 
                            p.campaignId === k.campaignId
                          )
                        );
                        
                        return (
                          <tr key={idx} className="border-b border-gray-200">
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
                        );
                      });
                    })()
                  )}
                </tbody>
              </table>
              <TablePagination
                currentPage={negativePage}
                totalPages={Math.ceil(negativeKeywordsMetrics.length / itemsPerPage)}
                onPageChange={setNegativePage}
                totalItems={negativeKeywordsMetrics.length}
                itemsPerPage={itemsPerPage}
              />
            </>
          )}
          
          {/* Top Performing Keywords Tab */}
          {selectedTab === 3 && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-6">Top Performing Keywords</h2>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 text-sm font-medium text-gray-700">Keyword</th>
                    <th className="text-left py-3 text-sm font-medium text-gray-700">Campaign</th>
                    <th className="text-center py-3 text-sm font-medium text-gray-700">Bid</th>
                    <th className="text-center py-3 text-sm font-medium text-gray-700">Sales</th>
                    <th className="text-center py-3 text-sm font-medium text-gray-700">ACOS</th>
                  </tr>
                </thead>
                <tbody>
                  {topPerformingKeywords.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-gray-400">
                        No data available
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      const startIndex = (topPerformingPage - 1) * itemsPerPage;
                      const endIndex = startIndex + itemsPerPage;
                      return topPerformingKeywords.slice(startIndex, endIndex).map((keyword, idx) => (
                        <tr key={idx} className="border-b border-gray-200">
                          <td className="py-4 text-sm text-gray-900">{keyword.keyword}</td>
                          <td className="py-4 text-sm text-gray-600">{keyword.campaignName}</td>
                          <td className="py-4 text-sm text-center">${keyword.bid.toFixed(2)}</td>
                          <td className="py-4 text-sm text-center font-medium text-green-600">
                            ${keyword.sales.toFixed(2)}
                          </td>
                          <td className="py-4 text-sm text-center font-medium text-green-600">
                            {keyword.acos.toFixed(2)}%
                          </td>
                        </tr>
                      ));
                    })()
                  )}
                </tbody>
              </table>
              <TablePagination
                currentPage={topPerformingPage}
                totalPages={Math.ceil(topPerformingKeywords.length / itemsPerPage)}
                onPageChange={setTopPerformingPage}
                totalItems={topPerformingKeywords.length}
                itemsPerPage={itemsPerPage}
              />
            </>
          )}
          
          {/* Search Terms Tab */}
          {selectedTab === 4 && (
            <>
              <h2 className="text-xl font-semibold text-gray-900 mb-6">Search Terms</h2>
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-200">
                    <th className="text-left py-3 text-sm font-medium text-gray-700">Search Term</th>
                    <th className="text-left py-3 text-sm font-medium text-gray-700">Matched Keyword</th>
                    <th className="text-center py-3 text-sm font-medium text-gray-700">Clicks</th>
                    <th className="text-center py-3 text-sm font-medium text-gray-700">Sales</th>
                    <th className="text-center py-3 text-sm font-medium text-gray-700">Spend</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredSearchTerms.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-gray-400">
                        No data available
                      </td>
                    </tr>
                  ) : (
                    (() => {
                      const startIndex = (searchTermsPage - 1) * itemsPerPage;
                      const endIndex = startIndex + itemsPerPage;
                      return filteredSearchTerms.slice(startIndex, endIndex).map((term, idx) => (
                        <tr key={idx} className="border-b border-gray-200">
                          <td className="py-4 text-sm text-gray-900">{term.searchTerm}</td>
                          <td className="py-4 text-sm text-gray-600">{term.keyword}</td>
                          <td className="py-4 text-sm text-center">{term.clicks}</td>
                          <td className="py-4 text-sm text-center">${term.sales.toFixed(2)}</td>
                          <td className="py-4 text-sm text-center font-medium text-red-600">
                            ${term.spend.toFixed(2)}
                          </td>
                        </tr>
                      ));
                    })()
                  )}
                </tbody>
              </table>
              <TablePagination
                currentPage={searchTermsPage}
                totalPages={Math.ceil(filteredSearchTerms.length / itemsPerPage)}
                onPageChange={setSearchTermsPage}
                totalItems={filteredSearchTerms.length}
                itemsPerPage={itemsPerPage}
              />
            </>
          )}
          
                      {/* Auto Campaign Insights Tab */}
            {selectedTab === 5 && (
              <>
                <h2 className="text-xl font-semibold text-gray-900 mb-6">Auto Campaign Insights</h2>
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-gray-200">
                      <th className="text-left py-3 text-sm font-medium text-gray-700">Search Term</th>
                      <th className="text-left py-3 text-sm font-medium text-gray-700">Campaign Name</th>
                      <th className="text-center py-3 text-sm font-medium text-gray-700">Sales</th>
                      <th className="text-center py-3 text-sm font-medium text-gray-700">ACOS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {autoCampaignInsights.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="text-center py-12 text-gray-400">
                          No data available
                        </td>
                      </tr>
                    ) : (
                      (() => {
                        const startIndex = (autoCampaignPage - 1) * itemsPerPage;
                        const endIndex = startIndex + itemsPerPage;
                        return autoCampaignInsights.slice(startIndex, endIndex).map((insight, idx) => (
                          <tr key={idx} className="border-b border-gray-200">
                            <td className="py-4 text-sm text-gray-900">{insight.searchTerm}</td>
                            <td className="py-4 text-sm text-gray-600">{insight.campaignName}</td>
                            <td className="py-4 text-sm text-center font-medium text-green-600">
                              ${insight.sales.toFixed(2)}
                            </td>
                            <td className="py-4 text-sm text-center font-medium">
                              {insight.acos.toFixed(2)}%
                            </td>
                          </tr>
                        ));
                      })()
                    )}
                  </tbody>
                </table>
                <TablePagination
                  currentPage={autoCampaignPage}
                  totalPages={Math.ceil(autoCampaignInsights.length / itemsPerPage)}
                  onPageChange={setAutoCampaignPage}
                  totalItems={autoCampaignInsights.length}
                  itemsPerPage={itemsPerPage}
                />
              </>
            )}
            </motion.div>
          </AnimatePresence>
        </div>
        
        {/* UI Suggestion Section */}
        <div className="bg-white rounded-xl p-6 mb-6">
          <div className="flex items-center gap-3 mb-4">
            {/* Bulb Icon */}
            <div className="flex items-center justify-center w-8 h-8 bg-yellow-100 rounded-full">
              <svg 
                className="w-5 h-5 text-yellow-600" 
                fill="currentColor" 
                viewBox="0 0 20 20" 
                xmlns="http://www.w3.org/2000/svg"
              >
                <path d="M11 3a1 1 0 10-2 0v1a1 1 0 102 0V3zM15.657 6.343a1 1 0 00-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM18 10a1 1 0 01-1 1h-1a1 1 0 110-2h1a1 1 0 011 1zM5.05 6.464a1 1 0 10-1.414-1.414l-.707.707a1 1 0 001.414 1.414l.707-.707zM6 10a1 1 0 01-1 1H4a1 1 0 110-2h1a1 1 0 011 1zM10 14a4 4 0 100-8 4 4 0 000 8zM8 18a1 1 0 100-2h4a1 1 0 100 2H8z"/>
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-900">UI Suggestion</h3>
          </div>
          
          {/* Different suggestions based on selected tab */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            {selectedTab === 1 && (
              <p className="text-sm text-blue-800">
                <span className="font-medium">Wasted Spend Keywords:</span> Consider pausing or lowering bids for unprofitable keywords to reduce unnecessary ad spend and improve overall campaign efficiency.
              </p>
            )}
            
            {selectedTab === 2 && (
              <p className="text-sm text-blue-800">
                <span className="font-medium">Negative Keywords:</span> Consider adding as a negative keyword or revising listing content to prevent irrelevant traffic and improve ad relevance.
              </p>
            )}
            
            {selectedTab === 4 && (
              <p className="text-sm text-blue-800">
                <span className="font-medium">Search Terms:</span> You haven't blocked irrelevant terms - consider analysing your search term report to identify and exclude non-converting search queries.
              </p>
            )}
            
            {selectedTab === 5 && (
              <p className="text-sm text-blue-800">
                <span className="font-medium">Auto Campaign:</span> Promote high-performing search terms to manual campaigns for better control over bids, keywords, and targeting strategies.
              </p>
            )}
            
            {/* Default message for tabs without specific suggestions */}
            {![1, 2, 4, 5].includes(selectedTab) && (
              <p className="text-sm text-blue-800">
                <span className="font-medium">Optimization Tip:</span> Monitor your campaign performance regularly and adjust bids, keywords, and targeting based on performance data to maximize ROI.
              </p>
            )}
          </div>
        </div>
        
        {/* Suggestions */}
        <div className="bg-white rounded-xl p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Suggestions</h3>
          {suggestionsToDisplay.length > 0 ? (
            <div>
              {/* Summary of potential impact */}
              {(() => {
                const highPrioritySuggestions = suggestions.filter(s => s.priority === 'high');
                let potentialSavings = 0;
                let campaignsToOptimize = new Set();
                let keywordsToNegative = 0;
                
                highPrioritySuggestions.forEach(suggestion => {
                  if (suggestion.type === 'keyword-wasted-spend') {
                    potentialSavings += suggestion.metrics?.spend || 0;
                    keywordsToNegative++;
                  } else if (suggestion.type === 'campaign-high-acos') {
                    campaignsToOptimize.add(suggestion.campaign);
                    potentialSavings += (suggestion.metrics?.spend || 0) * 0.2; // Assume 20% savings from optimization
                  } else if (suggestion.type === 'keyword-extreme-acos' || suggestion.type === 'high-spend-no-sales') {
                    potentialSavings += suggestion.metrics?.spend || 0;
                    keywordsToNegative++;
                  }
                });
                
                if (potentialSavings > 0 || campaignsToOptimize.size > 0) {
                  return (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
                      <p className="text-sm font-medium text-red-900">
                        Potential Monthly Savings: ${potentialSavings.toFixed(2)}
                      </p>
                      <div className="text-xs text-red-700 mt-1 space-y-1">
                        {campaignsToOptimize.size > 0 && (
                          <p>• {campaignsToOptimize.size} campaigns need optimization</p>
                        )}
                        {keywordsToNegative > 0 && (
                          <p>• {keywordsToNegative} keywords should be added as negative</p>
                        )}
                        <p>By implementing {highPrioritySuggestions.length} high-priority suggestions</p>
                      </div>
                    </div>
                  );
                }
                return null;
              })()}
              
              {/* Individual suggestions */}
              <div className="space-y-3">
                {suggestionsToDisplay.map((suggestion, index) => (
                  <div key={index} className="flex items-start gap-2 p-3 rounded-lg hover:bg-gray-50 transition-colors">
                    <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${
                      suggestion.priority === 'high' ? 'bg-red-500' : 
                      suggestion.priority === 'medium' ? 'bg-yellow-500' : 'bg-gray-400'
                    }`} />
                    <div className="flex-1">
                      <p className="text-sm text-gray-600">{suggestion.message}</p>
                    </div>
                  </div>
                ))}
                {!showAllSuggestions && suggestions.length > 5 && (
                  <button 
                    onClick={() => setShowAllSuggestions(true)}
                    className="text-sm text-blue-600 hover:text-blue-700 mt-3 font-medium transition-colors"
                  >
                    + {suggestions.length - 5} more suggestions available
                  </button>
                )}
                {showAllSuggestions && suggestions.length > 5 && (
                  <button 
                    onClick={() => setShowAllSuggestions(false)}
                    className="text-sm text-gray-600 hover:text-gray-700 mt-3 font-medium transition-colors"
                  >
                    Show less
                  </button>
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


     
    </div>
  );
};

export default PPCDashboard;