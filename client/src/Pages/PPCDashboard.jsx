import React, { useState, useEffect, useMemo, useRef, Fragment } from 'react';
import calenderIcon from '../assets/Icons/Calender.png'
import { AreaChart, Area, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import { useSelector, useDispatch } from 'react-redux';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import Calender from '../Components/Calender/Calender.jsx';
import DownloadReport from '../Components/DownloadReport/DownloadReport.jsx';

// Create empty chart data with zero values when no data is available
const createEmptyChartData = () => {
  const today = new Date();
  const emptyData = [];
  
  // Generate last 7 days with zero values
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    emptyData.push({
      date: formattedDate,
      ppcSales: 0,
      spend: 0,
      acos: 0,
      tacos: 0,
      units: 0
    });
  }
  
  return emptyData;
};

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

// Optimization Tips Component
const OptimizationTip = ({ tip, icon = "💡" }) => {
  return (
    <div className="mt-6 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-200 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0 w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
          <span className="text-blue-600 text-lg">{icon}</span>
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-semibold text-blue-900 mb-1">
            Optimization Tip
          </h4>
          <p className="text-sm text-blue-800 leading-relaxed">
            {tip}
          </p>
        </div>
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
  const [expandedSuggestions, setExpandedSuggestions] = useState(new Set());
  const CalenderRef = useRef(null);
  
  // Pagination states for each table
  const [highAcosPage, setHighAcosPage] = useState(1);
  const [wastedSpendPage, setWastedSpendPage] = useState(1);
  const [negativePage, setNegativePage] = useState(1);
  const [campaignsWithoutNegativePage, setCampaignsWithoutNegativePage] = useState(1);
  const [topPerformingPage, setTopPerformingPage] = useState(1);
  const [searchTermsPage, setSearchTermsPage] = useState(1);
  const [autoCampaignPage, setAutoCampaignPage] = useState(1);
  
  const itemsPerPage = 10;
  
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
  

  
  // Get ProductWiseSponsoredAds for error calculation
  const productWiseSponsoredAds = useSelector((state) => state.Dashboard.DashBoardInfo?.ProductWiseSponsoredAds) || [];
  
  // Get keywords data from Redux store
  const keywords = useSelector((state) => state.Dashboard.DashBoardInfo?.keywords) || [];
  
  // Get searchTerms data from Redux store
  const searchTerms = useSelector((state) => state.Dashboard.DashBoardInfo?.searchTerms) || [];
  
  // Get campaignData from Redux store
  const campaignData = useSelector((state) => state.Dashboard.DashBoardInfo?.campaignData) || [];
  
  // Get adsKeywordsPerformanceData from Redux store
  const adsKeywordsPerformanceData = useSelector((state) => state.Dashboard.DashBoardInfo?.adsKeywordsPerformanceData) || [];
  
  // Get dateWiseTotalCosts from Redux store - actual PPC spend data by date
  const dateWiseTotalCosts = useSelector((state) => state.Dashboard.DashBoardInfo?.dateWiseTotalCosts) || [];

  const campaignWiseTotalSalesAndCost = useSelector((state) => state.Dashboard.DashBoardInfo?.campaignWiseTotalSalesAndCost) || [];
  console.log("campaignWiseTotalSalesAndCost", campaignWiseTotalSalesAndCost);
  
  // Filter dateWiseTotalCosts based on selected date range from calendar
  const filteredDateWiseTotalCosts = useMemo(() => {
    if (!dateWiseTotalCosts.length) return [];
    
    const startDate = info?.startDate;
    const endDate = info?.endDate;

    //console.log('startDate', new Date(startDate));
    //console.log('endDate', new Date(endDate));
    //console.log('dateWiseTotalCosts', new Date(dateWiseTotalCosts[0].date));
    
    // If no date range is selected, return all data
    if (!startDate || !endDate) {
      console.log('No date range selected, showing all dateWiseTotalCosts:', dateWiseTotalCosts);
      return dateWiseTotalCosts;
    }
    
    // Filter data based on selected date range
    const filtered = dateWiseTotalCosts.filter(item => {
      if (!item.date) return false;
      
      const itemDate = new Date(item.date);
      //console.log('itemDate', itemDate);
      const start = new Date(startDate);
      //console.log('start', start);
      const end = new Date(endDate);
      //console.log('end', end);
      
      return itemDate >= start && itemDate <= end;
    });

  
    
    console.log('=== Filtered DateWise Total Costs ===');
    console.log('Selected Date Range:', { startDate, endDate });
    console.log('Original dateWiseTotalCosts length:', dateWiseTotalCosts.length);
    console.log('Filtered dateWiseTotalCosts length:', filtered.length);
    console.log('Filtered dateWiseTotalCosts data:', filtered);
    console.log('Total filtered cost:', filtered.reduce((sum, item) => sum + (item.totalCost || 0), 0));
    
    return filtered;
  }, [dateWiseTotalCosts, info?.startDate, info?.endDate]);
  
  // Get negetiveKeywords and AdsGroupData from Redux store
  const negetiveKeywords = useSelector((state) => state.Dashboard.DashBoardInfo?.negetiveKeywords) || [];
  const AdsGroupData = useSelector((state) => state.Dashboard.DashBoardInfo?.AdsGroupData) || [];
  
  // Logic to find campaigns without negative keywords
  const campaignsWithoutNegativeKeywords = useMemo(() => {
    if (!campaignData.length || !AdsGroupData.length) return [];
    
    // Create a set of campaign IDs that have negative keywords
    const campaignIdsWithNegativeKeywords = new Set();
    negetiveKeywords.forEach(negKeyword => {
      if (negKeyword.campaignId) {
        campaignIdsWithNegativeKeywords.add(negKeyword.campaignId);
      }
    });
    
    // Find campaigns that don't have negative keywords
    const campaignsWithoutNegatives = campaignData.filter(campaign => 
      !campaignIdsWithNegativeKeywords.has(campaign.campaignId)
    );
    
    // Get ad groups for these campaigns and create the table data
    const result = [];
    campaignsWithoutNegatives.forEach(campaign => {
      // Find all ad groups for this campaign
      const adGroups = AdsGroupData.filter(adGroup => 
        adGroup.campaignId === campaign.campaignId
      );
      
      if (adGroups.length > 0) {
        adGroups.forEach(adGroup => {
          result.push({
            campaignId: campaign.campaignId,
            campaignName: campaign.name,
            adGroupId: adGroup.adGroupId,
            adGroupName: adGroup.name,
            negatives: 'No negative keywords'
          });
        });
      } else {
        // If no ad groups found, still show the campaign
        result.push({
          campaignId: campaign.campaignId,
          campaignName: campaign.name,
          adGroupId: 'N/A',
          adGroupName: 'No ad groups found',
          negatives: 'No negative keywords'
        });
      }
    });
    
    return result;
  }, [campaignData, negetiveKeywords, AdsGroupData]);
  
  // Debug: Log the data to console for troubleshooting
  // console.log('=== PPC Dashboard Debug - Raw Data ===');
  // console.log('adsKeywordsPerformanceData Length:', adsKeywordsPerformanceData.length);
  // console.log('adsKeywordsPerformanceData Full Array:', adsKeywordsPerformanceData);
  // console.log('Sample Keywords (first 3):', adsKeywordsPerformanceData.slice(0, 3));
  // console.log('dateWiseTotalCosts Length:', dateWiseTotalCosts.length);
  // console.log('dateWiseTotalCosts Sample (first 5):', dateWiseTotalCosts.slice(0, 5));
  // console.log('All Dashboard Keys:', Object.keys(useSelector((state) => state.Dashboard.DashBoardInfo) || {}));
  // console.log('=== Campaigns Without Negative Keywords Debug ===');
  // console.log('campaignData Length:', campaignData.length);
  // console.log('negetiveKeywords Length:', negetiveKeywords.length);
  // console.log('AdsGroupData Length:', AdsGroupData.length);
  // console.log('campaignsWithoutNegativeKeywords:', campaignsWithoutNegativeKeywords);
  
  // Filter search terms where clicks >= 10 and sales = 0
  const filteredSearchTerms = searchTerms.filter(term => term.clicks >= 10 && term.sales === 0);
  
  // Transform the data for the chart - use only dateWiseTotalCosts for both spend and sales
  const chartData = useMemo(() => {
    // Use filtered dateWiseTotalCosts if available, otherwise fall back to original
    const costsDataToUse = filteredDateWiseTotalCosts.length > 0 ? filteredDateWiseTotalCosts : dateWiseTotalCosts;
    
    // Console log to verify chart is using filtered data
    if (info?.startDate && info?.endDate) {
      console.log('=== Chart Data Update ===');
      console.log('Date range selected:', info.startDate, 'to', info.endDate);
      console.log('Chart using filtered data points:', costsDataToUse.length);
      console.log('Chart data source:', costsDataToUse === filteredDateWiseTotalCosts ? 'Filtered Data' : 'Original Data');
      console.log('costsDataToUse sample:', costsDataToUse.slice(0, 3));
    }
    
    // Use dateWiseTotalCosts for both spend and sales data
    if (costsDataToUse && Array.isArray(costsDataToUse) && costsDataToUse.length > 0) {
      console.log("🟢 CHART DATA: Using dateWiseTotalCosts for both spend and sales");
      
      const chartData = costsDataToUse.map((item, index) => {
        if (!item || !item.date) return null;
        
        const date = new Date(item.date);
        const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
        
        // Get spend and sales from dateWiseTotalCosts
        const spend = parseFloat(item.totalCost) || 0;
        const sales = parseFloat(item.sales) || 0; // Assuming sales value is available in dateWiseTotalCosts
        
        // Debug: Log data for first few items
        if ((info?.startDate && info?.endDate) && index < 5) {
          console.log(`=== Chart Data Item ${index + 1} ===`);
          console.log('item.date:', item.date);
          console.log('formattedDate:', formattedDate);
          console.log('item.totalCost:', item.totalCost);
          console.log('item.sales:', item.sales);
          console.log('Parsed spend:', spend);
          console.log('Parsed sales:', sales);
        }
        
        return {
          date: formattedDate,
          ppcSales: sales,
          spend: spend,
        };
      }).filter(Boolean); // Remove any null entries
      
      // Sort by date
      chartData.sort((a, b) => {
        return new Date(a.date + " 2024") - new Date(b.date + " 2024");
      });
      
      if (info?.startDate && info?.endDate) {
        console.log('=== Final Chart Data ===');
        console.log('chartData length:', chartData.length);
        console.log('chartData sample:', chartData.slice(0, 3));
        console.log('Total spend:', chartData.reduce((sum, item) => sum + item.spend, 0));
        console.log('Total sales:', chartData.reduce((sum, item) => sum + item.ppcSales, 0));
      }
      
      return chartData;
    }
    
    // Fallback: Return empty data with zero values
    console.log("🔴 CHART DATA: Using empty data fallback (No dateWiseTotalCosts available)");
    const emptyData = createEmptyChartData();
    
    if (info?.startDate && info?.endDate) {
      console.log('=== Using Empty Data Fallback ===');
      console.log('emptyData length:', emptyData.length);
      console.log('emptyData sample:', emptyData.slice(0, 3));
    }
    
    return emptyData;
  }, [filteredDateWiseTotalCosts, dateWiseTotalCosts, info?.startDate, info?.endDate]);
  
  // Final debug: Log the actual chart data being used
  if (info?.startDate && info?.endDate) {
    console.log('=== FINAL CHART DATA ===');
    console.log('chartData length:', chartData.length);
    console.log('chartData first:', chartData);
   
  }
  
  // Debug: Check all possible chart data sources
  console.log("=== CHART DATA SOURCE DEBUG ===");
  console.log("1. dateWiseTotalCosts length:", dateWiseTotalCosts.length);
  console.log("2. filteredDateWiseTotalCosts length:", filteredDateWiseTotalCosts.length);
  console.log("3. info?.TotalSales length:", info?.TotalSales?.length || 0);
  console.log("4. info?.accountFinance?.ProductAdsPayment:", info?.accountFinance?.ProductAdsPayment || 0);
  console.log("Final chartData length:", chartData.length);
  console.log("Final chartData sample:", chartData);
  
  // 🎯 DETAILED CHART DATA BEING PLOTTED
  console.log('🎯 COMPLETE CHART DATA BEING PLOTTED:', {
    totalDataPoints: chartData.length,
    ppcSalesSum: chartData.reduce((sum, item) => sum + (item.ppcSales || 0), 0),
    spendSum: chartData.reduce((sum, item) => sum + (item.spend || 0), 0),
    dailyBreakdown: chartData.map(item => ({
      date: item.date,
      ppcSales: item.ppcSales,
      spend: item.spend
    })),
    hasValidPPCSales: chartData.some(item => item.ppcSales > 0),
    hasValidSpend: chartData.some(item => item.spend > 0),
    maxPPCSales: Math.max(...chartData.map(item => item.ppcSales || 0)),
    maxSpend: Math.max(...chartData.map(item => item.spend || 0)),
    avgPPCSales: chartData.reduce((sum, item) => sum + (item.ppcSales || 0), 0) / chartData.length,
    avgSpend: chartData.reduce((sum, item) => sum + (item.spend || 0), 0) / chartData.length
  });
  
  // Tab configuration
  const tabs = [
    { id: 0, label: 'High ACOS Campaigns' },
    { id: 1, label: 'Wasted Spend Keywords' },
    { id: 2, label: 'Campaigns Without Negative Keywords' },
    { id: 3, label: 'Top Performing Keywords' },
    { id: 4, label: 'Search Terms with Zero Sales' },
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
  // High ACOS Campaigns - Use campaignWiseTotalSalesAndCost data
  const highAcosCampaigns = campaignWiseTotalSalesAndCost
    .map(campaign => {
      // Count keywords for this campaign
      const campaignKeywords = keywords.filter(k => k.campaignId === campaign.campaignId);
      
      return {
        campaignName: campaign.campaignName,
        campaignId: campaign.campaignId,
        totalSpend: campaign.totalSpend,
        totalSales: campaign.totalSales,
        acos: campaign.totalSales > 0 ? (campaign.totalSpend / campaign.totalSales) * 100 : 0,
        productCount: 0, // Not available in new structure
        keywordCount: campaignKeywords.length
      };
    })
    .filter(campaign => campaign.acos > 40 && campaign.totalSales > 0)
    .sort((a, b) => b.acos - a.acos);
  
  // Wasted Spend Keywords - cost > 5 && attributedSales30d < 1
  // Use the new adsKeywordsPerformanceData structure directly
  // console.log('=== Starting Wasted Keywords Processing ===');
  // console.log('Processing', adsKeywordsPerformanceData.length, 'keywords for wasted spend analysis');

  const wastedSpendKeywords = adsKeywordsPerformanceData
    .filter((keyword, index) => {
      // Apply filter: cost > 5 && attributedSales30d < 1
      const cost = parseFloat(keyword.cost) || 0;
      const attributedSales = parseFloat(keyword.attributedSales30d) || 0;
      const matchesCriteria = cost > 5 && attributedSales < 1;
      
      // Debug: Log every keyword for first 10, then log only matches
      if (index < 10 || matchesCriteria) {
        // console.log(`Keyword ${index + 1}:`, {
        //   keyword: keyword.keyword,
        //   rawCost: keyword.cost,
        //   parsedCost: cost,
        //   rawAttributedSales30d: keyword.attributedSales30d,
        //   parsedAttributedSales30d: attributedSales,
        //   costOver5: cost > 5,
        //   attributedSales30dUnder1: attributedSales < 1,
        //   matchesCriteria: matchesCriteria,
        //   campaignName: keyword.campaignName,
        //   matchType: keyword.matchType
        // });
      }
      
      return matchesCriteria;
    })
    .map((keyword, index) => {
      // Process keyword data
      const cost = parseFloat(keyword.cost) || 0;
      const attributedSales30d = parseFloat(keyword.attributedSales30d) || 0;
      
      const processedKeyword = {
        keyword: keyword.keyword,
        campaignName: keyword.campaignName,
        campaignId: keyword.campaignId,
        sales: attributedSales30d,
        spend: cost
      };
      
      // console.log(`Processed Wasted Keyword ${index + 1}:`, processedKeyword);
      return processedKeyword;
    })
    .sort((a, b) => b.spend - a.spend);

  // Debug: Final results
  // console.log('=== Final Wasted Keywords Results ===');
  // console.log('Total Input Keywords:', adsKeywordsPerformanceData.length);
  // console.log('Filtered Wasted Keywords:', wastedSpendKeywords.length);
  // console.log('Wasted Keywords Data:', wastedSpendKeywords);
  
  if (adsKeywordsPerformanceData.length > 0) {
    // console.log('=== Data Analysis ===');
    // console.log('Cost Distribution (all keywords):', adsKeywordsPerformanceData.map(k => ({ keyword: k.keyword, cost: parseFloat(k.cost) || 0 })).slice(0, 10));
    // console.log('AttributedSales30d Distribution (all keywords):', adsKeywordsPerformanceData.map(k => ({ keyword: k.keyword, attributedSales30d: parseFloat(k.attributedSales30d) || 0 })).slice(0, 10));
    
    const highCostKeywords = adsKeywordsPerformanceData.filter(k => parseFloat(k.cost) > 5);
    const lowAttributedSalesKeywords = adsKeywordsPerformanceData.filter(k => parseFloat(k.attributedSales30d) < 1);
    
    // console.log(`Keywords with cost > 5: ${highCostKeywords.length}`);
    // console.log(`Keywords with attributedSales30d < 1: ${lowAttributedSalesKeywords.length}`);
    // console.log('High cost keywords sample:', highCostKeywords.slice(0, 5).map(k => ({ keyword: k.keyword, cost: k.cost, attributedSales30d: k.attributedSales30d })));
    // console.log('Low attributedSales30d keywords sample:', lowAttributedSalesKeywords.slice(0, 5).map(k => ({ keyword: k.keyword, cost: k.cost, attributedSales30d: k.attributedSales30d })));
  }
  
  // First, create a map of campaignId to campaign data for easier lookup (still needed for top performing keywords)
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
  
  // Top Performing Keywords - Use adsKeywordsPerformanceData directly
  // Filter: ACOS < 20%, sales > 100, impressions > 1000
  // console.log('=== Starting Top Performing Keywords Processing ===');
  // console.log('Processing', adsKeywordsPerformanceData.length, 'keywords for top performance analysis');

  const topPerformingKeywords = adsKeywordsPerformanceData
    .filter((keyword, index) => {
      // Calculate ACOS using attributedSales30d and cost
      const cost = parseFloat(keyword.cost) || 0;
      const attributedSales30d = parseFloat(keyword.attributedSales30d) || 0;
      const impressions = parseFloat(keyword.impressions) || 0;
      const acos = attributedSales30d > 0 ? (cost / attributedSales30d) * 100 : 0;
      
      // Apply filters: ACOS < 20%, sales > 100, impressions > 1000
      const matchesCriteria = acos < 20 && attributedSales30d > 100 && impressions > 1000;
      
      // Debug: Log every keyword for first 10, then log only matches
      if (index < 10 || matchesCriteria) {
        // console.log(`Top Performance Keyword ${index + 1}:`, {
        //   keyword: keyword.keyword,
        //   rawCost: keyword.cost,
        //   parsedCost: cost,
        //   rawAttributedSales30d: keyword.attributedSales30d,
        //   parsedAttributedSales30d: attributedSales30d,
        //   rawImpressions: keyword.impressions,
        //   parsedImpressions: impressions,
        //   calculatedAcos: acos,
        //   acosUnder20: acos < 20,
        //   salesOver100: attributedSales30d > 100,
        //   impressionsOver1000: impressions > 1000,
        //   matchesCriteria: matchesCriteria,
        //   campaignName: keyword.campaignName,
        //   matchType: keyword.matchType
        // });
      }
      
      return matchesCriteria;
    })
    .map((keyword, index) => {
      // Process top performing keyword data
      const cost = parseFloat(keyword.cost) || 0;
      const attributedSales30d = parseFloat(keyword.attributedSales30d) || 0;
      const impressions = parseFloat(keyword.impressions) || 0;
      const acos = attributedSales30d > 0 ? (cost / attributedSales30d) * 100 : 0;
      
      const processedKeyword = {
        keyword: keyword.keyword,
        campaignName: keyword.campaignName,
        campaignId: keyword.campaignId,
        bid: 0, // Bid information not available in adsKeywordsPerformanceData
        sales: attributedSales30d,
        spend: cost,
        acos: acos,
        impressions: impressions,
        matchType: keyword.matchType,
        state: 'enabled', // Default state
        clicks: keyword.clicks || 0,
        adGroupName: keyword.adGroupName,
        keywordId: keyword.keywordId
      };
      
      // console.log(`Processed Top Performing Keyword ${index + 1}:`, processedKeyword);
      return processedKeyword;
    })
    .sort((a, b) => b.sales - a.sales);

  // Debug: Final results for top performing keywords
  // console.log('=== Final Top Performing Keywords Results ===');
  // console.log('Total Input Keywords:', adsKeywordsPerformanceData.length);
  // console.log('Filtered Top Performing Keywords:', topPerformingKeywords.length);
  // console.log('Top Performing Keywords Data:', topPerformingKeywords);
  
  if (adsKeywordsPerformanceData.length > 0) {
    // console.log('=== Top Performance Analysis ===');
    const highPerformanceKeywords = adsKeywordsPerformanceData.filter(k => {
      const cost = parseFloat(k.cost) || 0;
      const sales = parseFloat(k.attributedSales30d) || 0;
      const impressions = parseFloat(k.impressions) || 0;
      const acos = sales > 0 ? (cost / sales) * 100 : 0;
      return acos < 20;
    });
    const highSalesKeywords = adsKeywordsPerformanceData.filter(k => parseFloat(k.attributedSales30d) > 100);
    const highImpressionsKeywords = adsKeywordsPerformanceData.filter(k => parseFloat(k.impressions) > 1000);
    
    // console.log(`Keywords with ACOS < 20%: ${highPerformanceKeywords.length}`);
    // console.log(`Keywords with sales > $100: ${highSalesKeywords.length}`);
    // console.log(`Keywords with impressions > 1000: ${highImpressionsKeywords.length}`);
    // console.log('High performance keywords sample:', highPerformanceKeywords.slice(0, 5).map(k => ({ 
    //   keyword: k.keyword, 
    //   cost: k.cost, 
    //   attributedSales30d: k.attributedSales30d,
    //   impressions: k.impressions,
    //   acos: parseFloat(k.attributedSales30d) > 0 ? (parseFloat(k.cost) / parseFloat(k.attributedSales30d)) * 100 : 0
    // })));
  }
  
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
  
  // Use Redux data for KPI values - prioritize actual finance data over estimates, with date filtering
  const kpiData = useMemo(() => {
    // Check if date range is selected to determine which data to use
    const isDateRangeSelected = (info?.calendarMode === 'custom' || info?.calendarMode === 'last7') && info?.startDate && info?.endDate;
    
    // Calculate spend based on date range selection - match main dashboard logic
    let spend = 0;
    if (isDateRangeSelected && filteredDateWiseTotalCosts.length > 0) {
      // Use filtered spend data when date range is selected
      spend = filteredDateWiseTotalCosts.reduce((sum, item) => sum + (item.totalCost || 0), 0);
      console.log('=== KPI Calculation (Filtered) ===');
      console.log('Using filtered spend data:', spend);
      console.log('Filtered data points:', filteredDateWiseTotalCosts.length);
    } else {
      // Use same logic as main dashboard - prioritize ProductAdsPayment, fallback to sponsoredAds
      const actualPPCSpend = Number(info?.accountFinance?.ProductAdsPayment || 0);
      spend = actualPPCSpend > 0 ? actualPPCSpend : (sponsoredAdsMetrics?.totalCost || 0);
      console.log('=== KPI Calculation (Default - Matching Main Dashboard) ===');
      console.log('ProductAdsPayment:', actualPPCSpend);
      console.log('sponsoredAdsMetrics?.totalCost:', sponsoredAdsMetrics?.totalCost || 0);
      console.log('Final spend used:', spend);
    }
    
    // Calculate PPC sales - only use real data, no assumptions
    let ppcSales = 0;
    if (isDateRangeSelected) {
      // For date range selection, only use actual PPC sales data
      ppcSales = sponsoredAdsMetrics?.totalSalesIn30Days || 0;
      console.log('Using real PPC sales for date range:', ppcSales);
    } else {
      // Use only real PPC sales data - no fallbacks or estimates
      ppcSales = sponsoredAdsMetrics?.totalSalesIn30Days || 0;
      console.log('Using real PPC sales (default):', ppcSales);
    }
    
    // Calculate total sales for TACoS calculation
    let totalSales = 0;
    if (isDateRangeSelected) {
      // Use filtered sales data for TACoS when date range is selected
      const totalSalesData = info?.TotalSales;
      if (totalSalesData && Array.isArray(totalSalesData) && totalSalesData.length > 0) {
        totalSales = totalSalesData.reduce((sum, item) => sum + (parseFloat(item.TotalAmount) || 0), 0);
      }
    } else {
      // Use default total sales calculation
      const totalSalesData = info?.TotalSales;
      if (totalSalesData && Array.isArray(totalSalesData) && totalSalesData.length > 0) {
        totalSales = totalSalesData.reduce((sum, item) => sum + (parseFloat(item.TotalAmount) || 0), 0);
      } else {
        totalSales = Number(info?.TotalWeeklySale || 0);
      }
    }
    
    // Calculate units sold - only use real data
    const unitsSold = sponsoredAdsMetrics?.totalProductsPurchased || 0;
    
    // Log final calculations
    if (isDateRangeSelected) {
      console.log('=== Final KPI Values (Filtered) ===');
      console.log('PPC Sales:', ppcSales);
      console.log('Spend:', spend);
      console.log('Total Sales:', totalSales);
      console.log('ACOS:', ppcSales > 0 ? ((spend / ppcSales) * 100).toFixed(2) + '%' : 'N/A');
      console.log('TACoS:', totalSales > 0 ? ((spend / totalSales) * 100).toFixed(2) + '%' : 'N/A');
      console.log('Units Sold (unchanged):', unitsSold);
    }
    
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
        value: ppcSales > 0 ? `${((spend / ppcSales) * 100).toFixed(2)}%` : '0.00%'
      },
      { 
        label: 'TACoS', 
        value: totalSales > 0 ? `${((spend / totalSales) * 100).toFixed(2)}%` : '0.00%'
      },
      { 
        label: 'Units Sold', 
        value: `${unitsSold}`
      },
    ];
  }, [info?.TotalSales, info?.TotalWeeklySale, info?.accountFinance, info?.startDate, info?.endDate, sponsoredAdsMetrics, filteredDateWiseTotalCosts]);

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
        message: `"${keyword.keyword}" performing well (${keyword.acos.toFixed(0)}% ACOS, ${keyword.impressions.toLocaleString()} impressions). High-performing keyword with potential for increased investment.`,
        priority: 'low',
        metrics: {
          sales: keyword.sales,
          acos: keyword.acos,
          impressions: keyword.impressions,
          spend: keyword.spend
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
  const suggestionsToDisplay = showAllSuggestions ? suggestions : suggestions.slice(0, 10);

  // Prepare data for CSV/Excel export
  // Function to toggle suggestion expansion
  const toggleSuggestionExpansion = (index) => {
    const newExpanded = new Set(expandedSuggestions);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedSuggestions(newExpanded);
  };

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
      csvData.push(['Campaign Name', 'Campaign ID', 'Total Spend', 'Total Sales', 'ACOS %', 'Keywords']);
      highAcosCampaigns.forEach(campaign => {
        csvData.push([
          campaign.campaignName,
          campaign.campaignId,
          `$${campaign.totalSpend.toFixed(2)}`,
          `$${campaign.totalSales.toFixed(2)}`,
          `${campaign.acos.toFixed(2)}%`,
          campaign.keywordCount
        ]);
      });
      csvData.push([]);
    }
    
    // Add Wasted Spend Keywords - ALL DATA (not paginated)
    if (wastedSpendKeywords.length > 0) {
      csvData.push([`Wasted Spend Keywords (>$5 spend, <$1 sales) - Total: ${wastedSpendKeywords.length} keywords`]);
      csvData.push(['Keyword', 'Campaign Name', 'Sales', 'Spend']);
      wastedSpendKeywords.forEach(keyword => {
        csvData.push([
          keyword.keyword,
          keyword.campaignName,
          `$${keyword.sales.toFixed(2)}`,
          `$${keyword.spend.toFixed(2)}`
        ]);
      });
      csvData.push([]);
    }
    
    // Add Top Performing Keywords - ALL DATA (not paginated)
    if (topPerformingKeywords.length > 0) {
      csvData.push([`Top Performing Keywords (<20% ACOS, >$100 sales, >1000 impressions) - Total: ${topPerformingKeywords.length} keywords`]);
      csvData.push(['Keyword', 'Campaign Name', 'Sales', 'Spend', 'ACOS %', 'Impressions', 'Match Type', 'Clicks']);
      topPerformingKeywords.forEach(keyword => {
        csvData.push([
          keyword.keyword,
          keyword.campaignName,
          `$${keyword.sales.toFixed(2)}`,
          `$${keyword.spend.toFixed(2)}`,
          `${keyword.acos.toFixed(2)}%`,
          keyword.impressions.toLocaleString(),
          keyword.matchType || 'N/A',
          keyword.clicks.toString()
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
      csvData.push([`Negative Keywords Analysis (using adsKeywordsPerformanceData) - Total: ${negativeKeywordsMetrics.length} keywords`]);
      csvData.push(['Keyword', 'Campaign Name', 'Sales', 'Spend', 'ACOS %']);
      negativeKeywordsMetrics.forEach(keyword => {
        csvData.push([
          keyword.keyword,
          keyword.campaignName,
          `$${keyword.sales.toFixed(2)}`,
          `$${keyword.spend.toFixed(2)}`,
          keyword.acos === 0 ? '-' : `${keyword.acos.toFixed(2)}%`
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
    
    // Add Chart Data (using dateWiseTotalCosts for both spend and sales)
    if (chartData.length > 0) {
      csvData.push([`Daily Performance Chart Data (from dateWiseTotalCosts)`]);
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
    
    // Add Raw DateWise Total Costs if available (filtered by selected date range)
    const costsForExport = filteredDateWiseTotalCosts.length > 0 ? filteredDateWiseTotalCosts : dateWiseTotalCosts;
    if (costsForExport.length > 0) {
      const dateRangeInfo = filteredDateWiseTotalCosts.length > 0 ? 
        ` (Filtered: ${info?.startDate || 'N/A'} to ${info?.endDate || 'N/A'})` : 
        ' (All Data)';
      csvData.push([`Raw DateWise Total Costs (Source Data)${dateRangeInfo}`]);
      csvData.push(['Date', 'Total Cost']);
      costsForExport.forEach(item => {
        csvData.push([
          item.date,
          `$${item.totalCost.toFixed(2)}`
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
    <div className='min-h-screen w-full bg-gray-50/50 lg:mt-0 mt-[12vh]'>
      {/* Header Section */}
      <div className='bg-white border-b border-gray-200/80 sticky top-0 z-40'>
        <div className='px-4 lg:px-6 py-4'>
          <div className='flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4'>
            <div className='flex items-center gap-4'>
              <div>
                <h1 className='text-2xl font-bold text-gray-900'>Sponsored Ads</h1>
                <p className='text-sm text-gray-600 mt-1'>Monitor your Amazon PPC performance and optimize campaigns</p>
              </div>
              <div className='hidden sm:flex items-center gap-2 px-3 py-1.5 bg-blue-50 text-blue-700 rounded-full text-xs font-medium'>
                <div className='w-2 h-2 bg-blue-500 rounded-full'></div>
                PPC campaigns active
              </div>
            </div>
            
            <div className='flex items-center gap-3'>
              <div className='relative' ref={CalenderRef}>
                <button 
                  onClick={() => setOpenCalender(!openCalender)}
                  className='flex items-center gap-2 px-4 py-2 bg-white border border-gray-300 hover:border-gray-400 rounded-lg transition-all duration-200 shadow-sm hover:shadow'
                >
                  <img src={calenderIcon} alt='' className='w-4 h-4' />
                  <span className='text-sm font-medium text-gray-700'>
                    {(info?.calendarMode === 'custom' && info?.startDate && info?.endDate)
                      ? `${new Date(info.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${new Date(info.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                      : info?.calendarMode === 'last7'
                      ? 'Last 7 Days'
                      : 'Last 30 Days'
                    }
                  </span>
                </button>
                
                <AnimatePresence>
                  {openCalender && (
                    <motion.div
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                      className="absolute top-full right-0 mt-2 z-50 bg-white shadow-xl rounded-xl border border-gray-200 overflow-hidden max-h-[80vh] overflow-y-auto"
                    >
                      <Calender setOpenCalender={setOpenCalender} />
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              
              <DownloadReport
                prepareDataFunc={preparePPCData}
                filename="PPC_Dashboard_Report"
                buttonText="Export"
                showIcon={true}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Main Content - Scrollable */}
      <div className='overflow-y-auto' style={{ height: 'calc(100vh - 120px)' }}>
        <div className='px-4 lg:px-6 py-6 pb-20'>
          
          {/* KPI Cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            {kpiData.map((kpi, index) => (
              <motion.div
                key={kpi.label}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="bg-white rounded-xl p-6 border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg"
              >
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center">
                      <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M8.433 7.418c.155-.103.346-.196.567-.267v1.698a2.305 2.305 0 01-.567-.267C8.07 8.34 8 8.114 8 8c0-.114.07-.34.433-.582zM11 12.849v-1.698c.22.071.412.164.567.267.364.243.433.468.433.582 0 .114-.07.34-.433.582a2.305 2.305 0 01-.567.267z" />
                        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-13a1 1 0 10-2 0v.092a4.535 4.535 0 00-1.676.662C6.602 6.234 6 7.009 6 8c0 .99.602 1.765 1.324 2.246.48.32 1.054.545 1.676.662v1.941c-.391-.127-.68-.317-.843-.504a1 1 0 10-1.51 1.31c.562.649 1.413 1.076 2.353 1.253V15a1 1 0 102 0v-.092a4.535 4.535 0 001.676-.662C13.398 13.766 14 12.991 14 12c0-.99-.602-1.765-1.324-2.246A4.535 4.535 0 0011 9.092V7.151c.391.127.68.317.843.504a1 1 0 101.511-1.31c-.563-.649-1.413-1.076-2.354-1.253V5z" clipRule="evenodd" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-600">{kpi.label}</p>
                      {kpi.label === 'Units Sold' && (
                        <p className="text-xs text-gray-500 mt-0.5">For last 30 days</p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-2xl font-bold text-gray-900">{kpi.value}</div>
              </motion.div>
            ))}
          </div>
        
          {/* Performance Chart */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="bg-white rounded-xl border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg overflow-hidden mb-8"
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">PPC Performance Over Time</h3>
                  <p className="text-sm text-gray-600 mt-1">Track your advertising spend and sales trends</p>
                </div>
              </div>
              <ResponsiveContainer width="100%" height={400}>
                <AreaChart 
                  data={chartData} 
                  margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
                >
                  <defs>
                    <linearGradient id="ppcSalesGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3B82F6" stopOpacity={0.4}/>
                      <stop offset="100%" stopColor="#3B82F6" stopOpacity={0.05}/>
                    </linearGradient>
                    <linearGradient id="ppcSpendGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F97316" stopOpacity={0.4}/>
                      <stop offset="100%" stopColor="#F97316" stopOpacity={0.05}/>
                    </linearGradient>
                  </defs>
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
                        return [`$${parseFloat(value).toFixed(2)}`, name];
                      }
                      return [parseFloat(value).toFixed(2), name];
                    }}
                  />
                  <Legend 
                    wrapperStyle={{ 
                      fontSize: '12px', 
                      paddingTop: '20px' 
                    }}
                    iconType="line"
                  />
                  <Area 
                    type="monotone" 
                    dataKey="ppcSales" 
                    name="PPC Sales"
                    stroke="#3B82F6" 
                    strokeWidth={2.5} 
                    fill="url(#ppcSalesGradient)"
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                  <Area 
                    type="monotone" 
                    dataKey="spend" 
                    name="PPC Spend"
                    stroke="#F97316" 
                    strokeWidth={2.5} 
                    fill="url(#ppcSpendGradient)"
                    dot={false}
                    activeDot={{ r: 5 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </motion.div>
        
          {/* Campaign Analysis Tabs */}
          <div className="bg-white rounded-xl border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg overflow-hidden mb-8">
            <div className="p-6 border-b border-gray-200">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Campaign Analysis</h3>
                  <p className="text-sm text-gray-600 mt-1">Detailed insights across different campaign aspects</p>
                </div>
              </div>
              
              {/* Tabs */}
              <div className="flex gap-6 relative overflow-x-auto">
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    className="relative pb-3 cursor-pointer whitespace-nowrap flex-shrink-0"
                    onClick={() => handleTabClick(tab.id)}
                  >
                    <p
                      className={`text-sm font-medium transition-colors ${
                        selectedTab === tab.id 
                          ? 'text-blue-600 font-semibold' 
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      {tab.label}
                    </p>
                    
                    {/* Animated underline */}
                    {selectedTab === tab.id && (
                      <motion.div
                        layoutId="ppcUnderline"
                        className="absolute bottom-0 left-0 right-0 h-[2px] bg-blue-600 rounded-full"
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
            
            {/* Tab Content */}
            <div className="p-6 relative overflow-hidden" style={{ minHeight: '400px' }}>
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
                      <div className="mb-4 text-sm text-gray-600">
                        Campaigns with high advertising cost of sales for last 30 days
                      </div>
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
                      <OptimizationTip 
                        tip="Reduce bids or add negatives to lower ACoS."
                        icon="📉"
                      />
                    </>
                  )}
                  
                  {/* Wasted Spend Keywords Tab */}
                  {selectedTab === 1 && (
                    <>
                      <h2 className="text-xl font-semibold text-gray-900 mb-6">Wasted Spend Keywords</h2>
                      <div className="mb-4 text-sm text-gray-600">
                        Keywords with high spend but low returns for last 30 days
                      </div>
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-3 text-sm font-medium text-gray-700">Keyword</th>
                            <th className="text-left py-3 text-sm font-medium text-gray-700">Campaign</th>
                            <th className="text-center py-3 text-sm font-medium text-gray-700">Sales</th>
                            <th className="text-center py-3 text-sm font-medium text-gray-700">Spend</th>
                          </tr>
                        </thead>
                                                <tbody>
                          {wastedSpendKeywords.length === 0 ? (
                            <tr>
                              <td colSpan={4} className="text-center py-12 text-gray-400">
                                {adsKeywordsPerformanceData.length === 0 ? (
                                  <div className="flex flex-col items-center space-y-2">
                                    <div>No keyword performance data available</div>
                                    <div className="text-xs">Check if keywords performance data has been synced</div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center space-y-2">
                                    <div>No wasted keywords found</div>
                                    <div className="text-xs">
                                       No keywords with cost &gt; $5 and sales &lt; $1 
                                       (Total keywords: {adsKeywordsPerformanceData.length})
                                    </div>
                                  </div>
                                )}
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
                                  <td className="py-4 text-sm text-center">${keyword.sales.toFixed(2)}</td>
                                  <td className="py-4 text-sm text-center font-medium text-red-600">
                                    ${keyword.spend.toFixed(2)}
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
                      <OptimizationTip 
                        tip="Consider pausing or lowering bids for unprofitable keywords."
                        icon="⚠️"
                      />
                    </>
                  )}
                  
                  {/* Campaigns Without Negative Keywords Tab */}
                  {selectedTab === 2 && (
                    <>
                      <h2 className="text-xl font-semibold text-gray-900 mb-6">Campaigns Without Negative Keywords</h2>
                      <div className="mb-4 text-sm text-gray-600">
                        Campaigns that don't have any negative keywords configured. Consider adding negative keywords to block irrelevant traffic.
                      </div>
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-3 text-sm font-medium text-gray-700">Campaign</th>
                            <th className="text-left py-3 text-sm font-medium text-gray-700">AdGroup</th>
                            <th className="text-center py-3 text-sm font-medium text-gray-700">Negatives</th>
                          </tr>
                        </thead>
                        <tbody>
                          {campaignsWithoutNegativeKeywords.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="text-center py-12 text-gray-400">
                                All campaigns have negative keywords configured ✅
                              </td>
                            </tr>
                          ) : (
                            (() => {
                              const startIndex = (campaignsWithoutNegativePage - 1) * itemsPerPage;
                              const endIndex = startIndex + itemsPerPage;
                              return campaignsWithoutNegativeKeywords.slice(startIndex, endIndex).map((row, idx) => (
                                <tr key={idx} className="border-b border-gray-200">
                                  <td className="py-4 text-sm text-gray-900">{row.campaignName}</td>
                                  <td className="py-4 text-sm text-gray-600">{row.adGroupName}</td>
                                  <td className="py-4 text-sm text-center">
                                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                                      {row.negatives}
                                    </span>
                                  </td>
                                </tr>
                              ));
                            })()
                          )}
                        </tbody>
                      </table>
                      <TablePagination
                        currentPage={campaignsWithoutNegativePage}
                        totalPages={Math.ceil(campaignsWithoutNegativeKeywords.length / itemsPerPage)}
                        onPageChange={setCampaignsWithoutNegativePage}
                        totalItems={campaignsWithoutNegativeKeywords.length}
                        itemsPerPage={itemsPerPage}
                      />
                      <OptimizationTip 
                        tip="Add negative keywords to these campaigns to prevent irrelevant traffic and improve ad performance."
                        icon="⚠️"
                      />
                    </>
                  )}
                  
                  {/* Top Performing Keywords Tab */}
                  {selectedTab === 3 && (
                    <>
                      <h2 className="text-xl font-semibold text-gray-900 mb-6">Top Performing Keywords</h2>
                      <div className="mb-4 text-sm text-gray-600">
                        For Last 30 days
                      </div>
                      <table className="w-full">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-3 text-sm font-medium text-gray-700">Keyword</th>
                            <th className="text-left py-3 text-sm font-medium text-gray-700">Campaign</th>
                            <th className="text-center py-3 text-sm font-medium text-gray-700">Sales</th>
                            <th className="text-center py-3 text-sm font-medium text-gray-700">Spend</th>
                            <th className="text-center py-3 text-sm font-medium text-gray-700">ACOS</th>
                            <th className="text-center py-3 text-sm font-medium text-gray-700">Impressions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {topPerformingKeywords.length === 0 ? (
                            <tr>
                              <td colSpan={6} className="text-center py-12 text-gray-400">
                                {adsKeywordsPerformanceData.length === 0 ? (
                                  <div className="flex flex-col items-center space-y-2">
                                    <div>No keyword performance data available</div>
                                    <div className="text-xs">Check if keywords performance data has been synced</div>
                                  </div>
                                ) : (
                                  <div className="flex flex-col items-center space-y-2">
                                    <div>No top performing keywords found</div>
                                    <div className="text-xs">
                                      No keywords meeting criteria: ACOS &lt; 20%, Sales &gt; $100, Impressions &gt; 1000
                                      (Total keywords: {adsKeywordsPerformanceData.length})
                                    </div>
                                  </div>
                                )}
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
                                  <td className="py-4 text-sm text-center font-medium text-green-600">
                                    ${keyword.sales.toFixed(2)}
                                  </td>
                                  <td className="py-4 text-sm text-center">
                                    ${keyword.spend.toFixed(2)}
                                  </td>
                                  <td className="py-4 text-sm text-center font-medium text-green-600">
                                    {keyword.acos.toFixed(2)}%
                                  </td>
                                  <td className="py-4 text-sm text-center">
                                    {keyword.impressions.toLocaleString()}
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
                      <OptimizationTip 
                        tip="This keyword performs well — consider raising bid by 15–20%."
                        icon="📈"
                      />
                    </>
                  )}
                  
                  {/* Search Terms Tab */}
                  {selectedTab === 4 && (
                    <>
                      <h2 className="text-xl font-semibold text-gray-900 mb-6">Search Terms with Zero Sales</h2>
                      <div className="mb-4 text-sm text-gray-600">
                        Search terms that generated clicks but no conversions for last 30 days
                      </div>
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
                      <OptimizationTip 
                        tip="Consider adding a negative keyword or revising listing content."
                        icon="📝"
                      />
                    </>
                  )}
                  
                  {/* Auto Campaign Insights Tab */}
                  {selectedTab === 5 && (
                    <>
                      <h2 className="text-xl font-semibold text-gray-900 mb-6">Auto Campaign Insights</h2>
                      <div className="mb-4 text-sm text-gray-600">
                        Performance insights from automatic targeting campaigns for last 30 days
                      </div>
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
                      <OptimizationTip 
                        tip="Promote high performing search terms to manual campaigns for better control."
                        icon="🎯"
                      />
                    </>
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        
          {/* Optimization Suggestions */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.7 }}
            className="bg-white rounded-xl border border-gray-200/80 hover:border-gray-300 transition-all duration-300 hover:shadow-lg overflow-hidden"
          >
            <div className="p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Optimization Suggestions</h3>
                  <p className="text-sm text-gray-600 mt-1">AI-powered recommendations to improve your campaign performance</p>
                </div>
              </div>
              {suggestions.length > 0 ? (
                <div>
                  {/* Priority Summary Cards */}
                  <div className="mb-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-red-900">High Priority</p>
                          <p className="text-2xl font-bold text-red-700">
                            {suggestions.filter(s => s.priority === 'high').length}
                          </p>
                        </div>
                        <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                          <span className="text-red-600 font-bold">!</span>
                        </div>
                      </div>
                      <p className="text-xs text-red-600 mt-1">Issues requiring immediate attention</p>
                    </div>
                    
                    <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-yellow-900">Medium Priority</p>
                          <p className="text-2xl font-bold text-yellow-700">
                            {suggestions.filter(s => s.priority === 'medium').length}
                          </p>
                        </div>
                        <div className="w-8 h-8 bg-yellow-100 rounded-full flex items-center justify-center">
                          <span className="text-yellow-600 font-bold">⚠</span>
                        </div>
                      </div>
                      <p className="text-xs text-yellow-700 mt-1">Optimization opportunities</p>
                    </div>
                    
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="text-sm font-medium text-gray-900">Low Priority</p>
                          <p className="text-2xl font-bold text-gray-600">
                            {suggestions.filter(s => s.priority === 'low').length}
                          </p>
                        </div>
                        <div className="w-8 h-8 bg-gray-100 rounded-full flex items-center justify-center">
                          <span className="text-gray-600 font-bold">i</span>
                        </div>
                      </div>
                      <p className="text-xs text-gray-700 mt-1">Minor improvements</p>
                    </div>
                  </div>

                  {/* Organized Suggestions Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full">
                      <thead>
                        <tr className="border-b border-gray-200">
                          <th className="text-left py-3 text-sm font-medium text-gray-700">Type</th>
                          <th className="text-left py-3 text-sm font-medium text-gray-700">Campaign/Keyword</th>
                          <th className="text-center py-3 text-sm font-medium text-gray-700">Priority</th>
                          <th className="text-center py-3 text-sm font-medium text-gray-700">Action</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(showAllSuggestions ? suggestions : suggestions.slice(0, 10)).map((suggestion, index) => (
                          <React.Fragment key={index}>
                            <tr className="border-b border-gray-200">
                              <td className="py-4 text-sm text-gray-900 capitalize">
                                {suggestion.type.replace('-', ' ')}
                              </td>
                              <td className="py-4 text-sm text-gray-900">
                                {suggestion.campaign || suggestion.keyword || suggestion.asin || 'N/A'}
                              </td>
                              <td className="py-4 text-center">
                                <span className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
                                  suggestion.priority === 'high' ? 'bg-red-100 text-red-800' : 
                                  suggestion.priority === 'medium' ? 'bg-yellow-100 text-yellow-800' : 
                                  'bg-gray-100 text-gray-800'
                                }`}>
                                  {suggestion.priority === 'high' ? '🚨 High' : 
                                   suggestion.priority === 'medium' ? '⚠️ Medium' : 
                                   '📊 Low'}
                                </span>
                              </td>
                              <td className="py-4 text-center">
                                <button
                                  onClick={() => toggleSuggestionExpansion(index)}
                                  className="inline-flex items-center px-3 py-1 bg-yellow-400 text-black text-xs font-medium rounded hover:bg-yellow-500 transition-colors"
                                >
                                  {expandedSuggestions.has(index) ? 'HIDE' : 'SHOW'}
                                </button>
                              </td>
                            </tr>
                            
                            {/* Expanded suggestion details */}
                            {expandedSuggestions.has(index) && (
                              <tr className="bg-blue-50 border-b border-gray-200">
                                <td colSpan={4} className="py-4 px-4">
                                  <div className="space-y-3">
                                    <div>
                                      <h4 className="text-sm font-medium text-gray-900 mb-2">Suggestion Details:</h4>
                                      <p className="text-sm text-gray-700">{suggestion.message}</p>
                                    </div>
                                    
                                    {/* Show metrics if available */}
                                    {suggestion.metrics && (
                                      <div>
                                        <h4 className="text-sm font-medium text-gray-900 mb-2">Performance Metrics:</h4>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                                          {suggestion.metrics.spend && (
                                            <div>
                                              <span className="text-gray-600">Spend:</span>
                                              <span className="font-medium ml-1">${suggestion.metrics.spend.toFixed(2)}</span>
                                            </div>
                                          )}
                                          {suggestion.metrics.sales && (
                                            <div>
                                              <span className="text-gray-600">Sales:</span>
                                              <span className="font-medium ml-1">${suggestion.metrics.sales.toFixed(2)}</span>
                                            </div>
                                          )}
                                          {suggestion.metrics.acos && (
                                            <div>
                                              <span className="text-gray-600">ACOS:</span>
                                              <span className="font-medium ml-1">{suggestion.metrics.acos.toFixed(2)}%</span>
                                            </div>
                                          )}
                                          {suggestion.metrics.bid && (
                                            <div>
                                              <span className="text-gray-600">Current Bid:</span>
                                              <span className="font-medium ml-1">${suggestion.metrics.bid.toFixed(2)}</span>
                                            </div>
                                          )}
                                        </div>
                                      </div>
                                    )}
                                    
                                    {/* Action buttons */}
                                    <div className="flex gap-2 pt-2">
                                      <button className="px-3 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 transition-colors">
                                        Apply Suggestion
                                      </button>
                                      <button className="px-3 py-1 bg-gray-200 text-gray-700 text-xs rounded hover:bg-gray-300 transition-colors">
                                        Ignore
                                      </button>
                                    </div>
                                  </div>
                                </td>
                              </tr>
                            )}
                          </React.Fragment>
                        ))}
                      </tbody>
                    </table>
                    
                    {/* Show More/Show Less Button */}
                    {suggestions.length > 10 && (
                      <div className="mt-4 text-center">
                        <button
                          onClick={() => setShowAllSuggestions(!showAllSuggestions)}
                          className="px-4 py-2 bg-gray-100 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-200 transition-colors"
                        >
                          {showAllSuggestions ? 
                            `Show Less` : 
                            `Show More (${suggestions.length - 10} more)`
                          }
                        </button>
                      </div>
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
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default PPCDashboard;