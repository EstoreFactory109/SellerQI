import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import MetricCard from '../Components/ProfitibilityDashboard/MetricCard';
import ProfitTable from '../Components/ProfitibilityDashboard/ProfitTable';
import SuggestionList from '../Components/ProfitibilityDashboard/SuggestionList';
import calenderIcon from '../assets/Icons/Calender.png'
import { useSelector } from "react-redux";
import { AnimatePresence, motion } from 'framer-motion';
import { X, AlertCircle, TrendingUp, Download, Calendar, BarChart3, TrendingDown, DollarSign, Target, Zap, HelpCircle } from 'lucide-react';
import Calender from '../Components/Calender/Calender.jsx';
import DownloadReport from '../Components/DownloadReport/DownloadReport.jsx';
import { formatCurrencyWithLocale } from '../utils/currencyUtils.js';

// Create empty chart data with zero values when no data is available
const createEmptyProfitabilityData = () => {
  const today = new Date();
  const emptyData = [];
  
  // Generate last 7 days with zero values
  for (let i = 6; i >= 0; i--) {
    const date = new Date(today);
    date.setDate(today.getDate() - i);
    const formattedDate = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    
    emptyData.push({
      date: formattedDate,
      grossProfit: 0,
      totalSales: 0
    });
  }
  
  return emptyData;
};

const ProfitabilityDashboard = () => {
  const [suggestionsData, setSuggestionsData] = useState([]);
  const [openCalender, setOpenCalender] = useState(false);
  const [showCogsPopup, setShowCogsPopup] = useState(false);
  const CalenderRef = useRef(null);

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
  }, []);

  // Check if COGS popup should be shown (once per session)
  useEffect(() => {
    const hasShownCogsPopup = sessionStorage.getItem('profitability_cogs_popup_shown');
    if (!hasShownCogsPopup) {
      // Show popup after a short delay for better UX
      const timer = setTimeout(() => {
        setShowCogsPopup(true);
      }, 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleCloseCogsPopup = () => {
    setShowCogsPopup(false);
    sessionStorage.setItem('profitability_cogs_popup_shown', 'true');
  };

  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  
  // Get currency from Redux
  const currency = useSelector(state => state.currency?.currency) || '$';
  
  // Get ProductWiseSponsoredAdsGraphData from Redux store
  const productWiseSponsoredAdsGraphData = useSelector((state) => state.Dashboard.DashBoardInfo?.ProductWiseSponsoredAdsGraphData) || {};
  
  // Get profitability data to calculate net profit
  const profitibilityData = useSelector((state) => state.Dashboard.DashBoardInfo?.profitibilityData) || [];
  
  // Get total sales data
  const totalSalesData = useSelector((state) => state.Dashboard.DashBoardInfo?.TotalSales) || [];
  
  // Get account finance data for fees
  const accountFinance = useSelector((state) => state.Dashboard.DashBoardInfo?.accountFinance) || {};
  
  // Get sales by products for more accurate daily sales
  const salesByProducts = useSelector((state) => state.Dashboard.DashBoardInfo?.SalesByProducts) || [];
  
  // Get dateWiseTotalCosts from Redux store - same as PPC Dashboard
  const dateWiseTotalCosts = useSelector((state) => state.Dashboard.DashBoardInfo?.dateWiseTotalCosts) || [];
  
  // Get sponsoredAdsMetrics from Redux store - same as PPC Dashboard
  const sponsoredAdsMetrics = useSelector((state) => state.Dashboard.DashBoardInfo?.sponsoredAdsMetrics);
  
  // Filter dateWiseTotalCosts based on selected date range - same logic as PPC Dashboard
  const filteredDateWiseTotalCosts = useMemo(() => {
    if (!dateWiseTotalCosts.length) return [];
    
    const startDate = info?.startDate;
    const endDate = info?.endDate;
    
    // If no date range is selected, return empty array (use default calculation)
    if (!startDate || !endDate) {
      return [];
    }
    
    // Filter data based on selected date range
    const filtered = dateWiseTotalCosts.filter(item => {
      if (!item.date) return false;
      
      const itemDate = new Date(item.date);
      const start = new Date(startDate);
      const end = new Date(endDate);
      
      return itemDate >= start && itemDate <= end;
    });
    
    console.log('=== Profitability Dashboard: Filtered DateWise Total Costs ===');
    console.log('Selected Date Range:', { startDate, endDate });
    console.log('Original dateWiseTotalCosts length:', dateWiseTotalCosts.length);
    console.log('Filtered dateWiseTotalCosts length:', filtered.length);
    console.log('Total filtered cost:', filtered.reduce((sum, item) => sum + (item.totalCost || 0), 0));
    
    return filtered;
  }, [dateWiseTotalCosts, info?.startDate, info?.endDate]);
  
  // Transform the data for the chart using filtered TotalSales data
  const chartData = useMemo(() => {
    // Prioritize filtered TotalSales data from Redux (calendar selection)
    if (Array.isArray(totalSalesData) && totalSalesData.length > 0) {
      // Calculate total fees from account finance data
      const filteredAccountFinance = info?.accountFinance || accountFinance;
      const totalFees = (parseFloat(filteredAccountFinance.FBA_Fees) || 0) + 
                       (parseFloat(filteredAccountFinance.Storage) || 0) + 
                       (parseFloat(filteredAccountFinance.Amazon_Charges) || 0) +
                       (parseFloat(filteredAccountFinance.ProductAdsPayment) || 0) +
                       (parseFloat(filteredAccountFinance.Refunds) || 0);
      const avgFeesPerDay = totalFees / totalSalesData.length;
      
      // Transform filtered sales data for the chart
      return totalSalesData.map(sale => {
        if (sale.interval) {
          // Extract date from interval (format: "2025-03-01T00:00:00Z--2025-03-01T23:59:59Z")
          const startDate = new Date(sale.interval.split('--')[0]);
          const dateKey = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const totalSales = parseFloat(sale.TotalAmount) || 0;
          
          // Calculate gross profit: total sales - total spend (fees and ads)
          const totalSpend = avgFeesPerDay;
          const grossProfit = totalSales - totalSpend;
          
          return {
            date: dateKey,
            grossProfit: parseFloat(grossProfit.toFixed(2)),
            totalSales: parseFloat(totalSales.toFixed(2))
          };
        }
        return null;
      }).filter(item => item !== null);
    }
    
    // Fallback to original TotalSales data if available
    if (Array.isArray(info?.TotalSales) && info.TotalSales.length > 0) {
      // Calculate total fees from account finance data
      const totalFees = (parseFloat(accountFinance.FBA_Fees) || 0) + 
                       (parseFloat(accountFinance.Storage) || 0) + 
                       (parseFloat(accountFinance.Amazon_Charges) || 0) +
                       (parseFloat(accountFinance.ProductAdsPayment) || 0) +
                       (parseFloat(accountFinance.Refunds) || 0);
      const avgFeesPerDay = totalFees / info.TotalSales.length;
      
      return info.TotalSales.map(sale => {
        if (sale.interval) {
          const startDate = new Date(sale.interval.split('--')[0]);
          const dateKey = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const totalSales = parseFloat(sale.TotalAmount) || 0;
          
          // Calculate gross profit: total sales - total spend (fees and ads)
          const totalSpend = avgFeesPerDay;
          const grossProfit = totalSales - totalSpend;
          
          return {
            date: dateKey,
            grossProfit: parseFloat(grossProfit.toFixed(2)),
            totalSales: parseFloat(totalSales.toFixed(2))
          };
        }
        return null;
      }).filter(item => item !== null);
    }
    
    // Final fallback: Return empty data with zero values
    return createEmptyProfitabilityData();
  }, [totalSalesData, info?.accountFinance, productWiseSponsoredAdsGraphData, accountFinance]);

  // Get COGs values from Redux store
  const cogsValues = useSelector((state) => state.cogs.cogsValues);
  
  const metrics = useMemo(() => {
    // Use the same Total Sales value as the Dashboard Total Sales component
    const filteredAccountFinance = info?.accountFinance || accountFinance;
    let totalOverallSpend = 0;
    
    // Calculate total COGS from all products that have COGS entered
    let totalCOGS = 0;
    const profitibilityData = info?.profitibilityData || [];
    
    profitibilityData.forEach(product => {
      const cogsPerUnit = cogsValues[product.asin] || 0;
      const quantity = product.quantity || 0;
      totalCOGS += cogsPerUnit * quantity;
    });
    
    // Calculate ad spend using same logic as PPC Dashboard
    let adSpend = 0;
    const isDateRangeSelected = (info?.calendarMode === 'custom' || info?.calendarMode === 'last7') && info?.startDate && info?.endDate;
    
    if (isDateRangeSelected && filteredDateWiseTotalCosts.length > 0) {
      // Use filtered spend data when date range is selected (same as PPC Dashboard)
      adSpend = filteredDateWiseTotalCosts.reduce((sum, item) => sum + (item.totalCost || 0), 0);
      console.log('=== Profitability Dashboard: Using filtered spend data ===');
      console.log('Filtered ad spend:', adSpend);
    } else {
      // Use same logic as PPC Dashboard - prioritize ProductAdsPayment, fallback to sponsoredAds
      const actualPPCSpend = Number(filteredAccountFinance?.ProductAdsPayment || 0);
      adSpend = actualPPCSpend > 0 ? actualPPCSpend : (sponsoredAdsMetrics?.totalCost || 0);
      console.log('=== Profitability Dashboard: Using default spend data (matching PPC Dashboard) ===');
      console.log('ProductAdsPayment:', actualPPCSpend);
      console.log('sponsoredAdsMetrics?.totalCost:', sponsoredAdsMetrics?.totalCost || 0);
      console.log('Final ad spend used:', adSpend);
    }
    
    // Calculate total overall spend including all Amazon fees (using calculated adSpend)
    totalOverallSpend = (Number(filteredAccountFinance?.FBA_Fees || 0) + 
                        Number(filteredAccountFinance?.Storage || 0) + 
                        Number(filteredAccountFinance?.Amazon_Charges || 0) +
                        adSpend +
                        Number(filteredAccountFinance?.Refunds || 0));
    
    // Always use the same value as Dashboard Total Sales component (TotalWeeklySale)
    const totalSales = Number(info?.TotalWeeklySale || 0);
    const originalGrossProfit = Number(filteredAccountFinance?.Gross_Profit) || 0;
    
    // Adjust gross profit by subtracting total COGS (only for profitability page)
    const adjustedGrossProfit = originalGrossProfit - totalCOGS;
    const amazonFees = (Number(filteredAccountFinance?.FBA_Fees || 0) + Number(filteredAccountFinance?.Storage || 0) + Number(filteredAccountFinance?.Amazon_Charges || 0));
    
    // Calculate adjusted profit margin using COGS-adjusted gross profit
    const adjustedProfitMargin = totalSales > 0 ? ((adjustedGrossProfit / totalSales) * 100) : 0;
    
    return [
      { label: 'Total Sales', value: `${currency}${totalSales.toFixed(2)}`, icon: 'dollar-sign' },
      { label: 'Gross Profit', value: `${currency}${adjustedGrossProfit.toFixed(2)}`, icon: 'dollar-sign' },
      { label: 'Total Ad Spend', value: `${currency}${adSpend.toFixed(2)}`, icon: 'dollar-sign' },
      { label: 'Total Amazon Fees', value: `${currency}${amazonFees.toFixed(2)}`, icon: 'list' },
    ];
  }, [info?.accountFinance, info?.TotalWeeklySale, info?.sponsoredAdsMetrics, info?.profitibilityData, accountFinance, cogsValues, sponsoredAdsMetrics, filteredDateWiseTotalCosts, info?.calendarMode, info?.startDate, info?.endDate]);

  // Prepare data for CSV/Excel export
  const prepareProfitabilityData = () => {
    try {
      console.log('=== Starting profitability data preparation ===');
      console.log('Input data check:', {
        infoExists: !!info,
        metricsExists: !!metrics,
        chartDataExists: !!chartData,
        cogsValuesExists: !!cogsValues,
        metricsLength: Array.isArray(metrics) ? metrics.length : 'not array',
        chartDataLength: Array.isArray(chartData) ? chartData.length : 'not array'
      });
      
      const csvData = [];
      
      // Add header information
      csvData.push(['Profitability Dashboard Report - Complete Analysis']);
      csvData.push(['Generated on:', new Date().toLocaleDateString()]);
      csvData.push(['Date Range:', info?.startDate && info?.endDate ? `${info.startDate} to ${info.endDate}` : 'Last 30 Days']);
      csvData.push([]);
      
      // Add Executive Summary at the top
      csvData.push(['EXECUTIVE SUMMARY']);
      csvData.push(['='.repeat(50)]);
      
                    // Calculate key executive insights
       console.log('Step 1: Starting executive insights calculation');
       const executiveTotalRevenue = Array.isArray(chartData) ? chartData.reduce((sum, item) => sum + (item?.totalSales || 0), 0) : 0;
       const executiveTotalCosts = Array.isArray(chartData) ? chartData.reduce((sum, item) => sum + (item?.spend || 0), 0) : 0;
       const executiveOverallProfitMargin = executiveTotalRevenue > 0 ? ((executiveTotalRevenue - executiveTotalCosts) / executiveTotalRevenue) * 100 : 0;
       const executiveProfitabilityData = info?.profitibilityData || [];
       console.log('Step 1 completed: Revenue:', executiveTotalRevenue, 'Costs:', executiveTotalCosts);
                    console.log('Step 2: Starting product categorization');
       const criticalProducts = Array.isArray(executiveProfitabilityData) ? executiveProfitabilityData.filter(product => {
         if (!product || typeof product !== 'object') return false;
         const cogsPerUnit = (cogsValues && cogsValues[product.asin]) || 0;
         const totalCogs = cogsPerUnit * (product.quantity || 0);
         // Use totalFees from EconomicsMetrics if available
         const totalFees = product.totalFees !== undefined ? product.totalFees : 
                          ((product.amzFee || 0) * (product.quantity || 0));
         const grossProfit = product.grossProfit !== undefined ? product.grossProfit :
                            ((product.sales || 0) - (product.ads || 0) - totalFees);
         const netProfit = grossProfit - totalCogs;
         const profitMargin = product.sales > 0 ? (netProfit / product.sales) * 100 : 0;
         return profitMargin < 0;
       }).length : 0;
       
       const warningProducts = Array.isArray(executiveProfitabilityData) ? executiveProfitabilityData.filter(product => {
         if (!product || typeof product !== 'object') return false;
         const cogsPerUnit = (cogsValues && cogsValues[product.asin]) || 0;
         const totalCogs = cogsPerUnit * (product.quantity || 0);
         // Use totalFees from EconomicsMetrics if available
         const totalFees = product.totalFees !== undefined ? product.totalFees : 
                          ((product.amzFee || 0) * (product.quantity || 0));
         const grossProfit = product.grossProfit !== undefined ? product.grossProfit :
                            ((product.sales || 0) - (product.ads || 0) - totalFees);
         const netProfit = grossProfit - totalCogs;
         const profitMargin = product.sales > 0 ? (netProfit / product.sales) * 100 : 0;
         return profitMargin >= 0 && profitMargin < 10;
       }).length : 0;
       
       const healthyProducts = executiveProfitabilityData.length - criticalProducts - warningProducts;
       console.log('Step 2 completed: Critical:', criticalProducts, 'Warning:', warningProducts, 'Healthy:', healthyProducts);
       
       csvData.push(['Business Health Status:', executiveOverallProfitMargin > 15 ? 'HEALTHY' : executiveOverallProfitMargin > 5 ? 'CAUTION' : 'CRITICAL']);
       csvData.push(['Overall Profit Margin:', `${executiveOverallProfitMargin.toFixed(2)}%`]);
       csvData.push(['Total Products Analyzed:', executiveProfitabilityData.length.toString()]);
      csvData.push(['Products Losing Money (Critical):', criticalProducts.toString()]);
      csvData.push(['Products with Low Margins (Warning):', warningProducts.toString()]);
      csvData.push(['Healthy Products:', healthyProducts.toString()]);
      csvData.push([]);
      
      // Key insights
      csvData.push(['KEY INSIGHTS:']);
      if (criticalProducts > 0) {
        csvData.push(['• URGENT:', `${criticalProducts} products are losing money and need immediate attention`]);
      }
      if (warningProducts > 0) {
        csvData.push(['• WARNING:', `${warningProducts} products have margins below 10% and should be optimized`]);
      }
      if (healthyProducts > 0) {
        csvData.push(['• POSITIVE:', `${healthyProducts} products are performing well with healthy margins`]);
      }
      csvData.push([]);
      
      // Top action items
      csvData.push(['TOP ACTION ITEMS:']);
      csvData.push(['1. Review and fix critical profitability issues immediately']);
      csvData.push(['2. Optimize PPC spend for low-margin products']);
      csvData.push(['3. Negotiate better COGS with suppliers where possible']);
      csvData.push(['4. Consider price adjustments for underperforming products']);
      csvData.push(['5. Monitor Amazon fees and explore cost reduction opportunities']);
      csvData.push([]);
      csvData.push(['='.repeat(50)]);
      csvData.push([]);
    
    // Add metrics summary (with COGS adjustments)
    console.log('Step 3: Processing metrics');
    csvData.push(['Key Metrics (COGS-Adjusted)']);
    if (Array.isArray(metrics) && metrics.length > 0) {
      metrics.forEach((metric, index) => {
        if (metric && typeof metric === 'object' && metric.label && metric.value) {
          csvData.push([metric.label, metric.value]);
        } else {
          console.warn('Invalid metric at index', index, metric);
        }
      });
    } else {
      csvData.push(['No metrics data available']);
    }
    console.log('Step 3 completed: Metrics processed');
    
         // Add comprehensive COGS analysis
     console.log('Step 4: Processing COGS analysis');
     let totalCOGS = 0;
     let totalCOGSProducts = 0;
     let productsWithCOGS = 0;
     let productsWithoutCOGS = 0;
     const cogsProfitibilityData = info?.profitibilityData || [];
     
     const cogsAnalysis = [];
     if (Array.isArray(cogsProfitibilityData)) {
       cogsProfitibilityData.forEach((product, index) => {
         if (product && typeof product === 'object' && product.asin) {
           const cogsPerUnit = (cogsValues && cogsValues[product.asin]) || 0;
           const quantity = product.quantity || 0;
           const productCOGS = cogsPerUnit * quantity;
           totalCOGS += productCOGS;
           totalCOGSProducts++;
           
           if (cogsPerUnit > 0) {
             productsWithCOGS++;
             const cogsPercent = product.sales > 0 ? (productCOGS / product.sales) * 100 : 0;
             cogsAnalysis.push({
               asin: product.asin,
               cogsPerUnit,
               productCOGS,
               cogsPercent,
               sales: product.sales || 0
             });
           } else {
             productsWithoutCOGS++;
           }
         } else {
           console.warn('Invalid product in COGS analysis at index', index, product);
         }
       });
     }
     console.log('Step 4 completed: COGS analysis processed');
    
    csvData.push(['COGS Analysis Summary']);
    csvData.push(['Total COGS Deducted', `${currency}${totalCOGS.toFixed(2)}`]);
    csvData.push(['Products with COGS entered', productsWithCOGS.toString()]);
    csvData.push(['Products missing COGS', productsWithoutCOGS.toString()]);
    csvData.push(['COGS Data Completeness', `${((productsWithCOGS / totalCOGSProducts) * 100).toFixed(1)}%`]);
    
    if (cogsAnalysis.length > 0) {
      const avgCOGSPercent = cogsAnalysis.reduce((sum, item) => sum + item.cogsPercent, 0) / cogsAnalysis.length;
      const highCOGSProducts = cogsAnalysis.filter(item => item.cogsPercent > 60).length;
      csvData.push(['Average COGS %', `${avgCOGSPercent.toFixed(1)}%`]);
      csvData.push(['Products with high COGS (>60%)', highCOGSProducts.toString()]);
    }
    csvData.push([]);
    
    // Add chart data
    if (chartData && chartData.length > 0) {
      csvData.push(['Daily Spend vs Total Sales']);
      csvData.push(['Date', 'Spend', 'Total Sales']);
      chartData.forEach(day => {
        csvData.push([
          day.date || 'N/A',
          `${currency}${(day.spend || 0).toFixed(2)}`,
          `${currency}${(day.totalSales || 0).toFixed(2)}`
        ]);
      });
      csvData.push([]);
    } else {
      csvData.push(['Daily Spend vs Total Sales']);
      csvData.push(['No chart data available']);
      csvData.push([]);
    }
    
    // Add comprehensive profitability table data - ALL PRODUCTS (not paginated)
    const profitabilityTableData = info?.profitibilityData || [];
    if (profitabilityTableData.length > 0) {
      csvData.push([`Product Profitability Analysis - Total: ${profitabilityTableData.length} products`]);
      csvData.push(['ASIN', 'Product Name', 'Units Sold', 'Sales Revenue', 'Revenue per Unit', 'COGS/Unit', 'COGS %', 'Total COGS', 'Ad Spend', 'Ad Spend %', 'Amazon Fees', 'Fees %', 'Gross Profit', 'Net Profit (with COGS)', 'Profit Margin %', 'Status', 'Issues', 'Recommendations']);
      
      // Get product details and COGS values to match the table display exactly
      const totalProducts = info?.TotalProduct || [];
      const productDetailsMap = new Map();
      totalProducts.forEach(product => {
        productDetailsMap.set(product.asin, product);
      });
      
      // Generate individual product suggestions (same logic as ProfitTable)
      const generateProductSuggestions = (productData) => {
        const suggestions = [];
        const margin = productData.sales > 0 ? (productData.netProfit / productData.sales) * 100 : 0;
        const cogsPercentage = productData.sales > 0 ? (productData.totalCogs / productData.sales) * 100 : 0;
        
        // Generate suggestions for products with issues
        if (margin < 0) {
          suggestions.push('Losing money on each sale - immediate action required');
          suggestions.push('Consider increasing price or reducing PPC spend');
        } else if (margin < 10) {
          suggestions.push(`Low margin (${margin.toFixed(1)}%) - consider price increase`);
          if (cogsPercentage > 50) {
            suggestions.push(`High COGS (${cogsPercentage.toFixed(1)}%) - negotiate with supplier`);
          }
          if (productData.adSpendPercent > 20) {
            suggestions.push(`High ad spend (${productData.adSpendPercent.toFixed(1)}%) - optimize PPC`);
          }
        }
        
        if (productData.sales > 1000 && productData.netProfit < 100) {
          suggestions.push('High revenue but low profit - audit all fees');
        }
        
        return suggestions.join('; ');
      };
      
      profitabilityTableData.forEach(product => {
        const productDetails = productDetailsMap.get(product.asin) || {};
        const cogsPerUnit = cogsValues[product.asin] || 0;
        const totalCogs = cogsPerUnit * (product.quantity || 0);
        
        // Use totalFees from EconomicsMetrics if available, otherwise use amzFee
        const totalFees = product.totalFees !== undefined ? product.totalFees : 
                         ((product.amzFee || 0) * (product.quantity || 0));
        
        // Use grossProfit from EconomicsMetrics if available, otherwise calculate
        const grossProfit = product.grossProfit !== undefined ? product.grossProfit :
                           ((product.sales || 0) - (product.ads || 0) - totalFees);
        
        const netProfit = grossProfit - totalCogs;
        const profitMargin = product.sales > 0 ? (netProfit / product.sales) * 100 : 0;
        const revenuePerUnit = product.quantity > 0 ? (product.sales / product.quantity) : 0;
        const cogsPercent = product.sales > 0 ? (totalCogs / product.sales) * 100 : 0;
        const adSpendPercent = product.sales > 0 ? ((product.ads || 0) / product.sales) * 100 : 0;
        
        // Use totalFees for fees percentage calculation
        const feesPercent = product.sales > 0 ? (totalFees / product.sales) * 100 : 0;
        
        // Determine status and issues
        let status = 'Good';
        let issues = '';
        if (profitMargin < 0) {
          status = 'Critical';
          issues = 'Negative profit';
        } else if (profitMargin < 10) {
          status = 'Warning';
          issues = 'Low margin';
        }
        
        if (cogsPercent > 60) {
          issues += (issues ? ', ' : '') + 'High COGS';
        }
        if (adSpendPercent > 25) {
          issues += (issues ? ', ' : '') + 'High ad spend';
        }
        if (feesPercent > 20) {
          issues += (issues ? ', ' : '') + 'High fees';
        }
        
        const productData = {
          asin: product.asin,
          sales: product.sales || 0,
          quantity: product.quantity || 0,
          totalCogs,
          netProfit,
          adSpendPercent
        };
        
        const recommendations = generateProductSuggestions(productData);
        
        csvData.push([
          product.asin,
          productDetails.title || `Product ${product.asin}`,
          (product.quantity || 0).toString(),
          `${currency}${(product.sales || 0).toFixed(2)}`,
          `$${revenuePerUnit.toFixed(2)}`,
          `$${cogsPerUnit.toFixed(2)}`,
          `${cogsPercent.toFixed(1)}%`,
          `$${totalCogs.toFixed(2)}`,
          `${currency}${(product.ads || 0).toFixed(2)}`,
          `${adSpendPercent.toFixed(1)}%`,
          `${currency}${totalFees.toFixed(2)}`,
          `${feesPercent.toFixed(1)}%`,
          `${currency}${grossProfit.toFixed(2)}`,
          `${currency}${netProfit.toFixed(2)}`,
          `${profitMargin.toFixed(2)}%`,
          status,
          issues || 'None',
          recommendations || 'Continue monitoring'
        ]);
      });
      csvData.push([]);
    }
    
    // Add Sales by Products data - ALL PRODUCTS (not paginated)
    const salesByProducts = info?.SalesByProducts || [];
    if (salesByProducts.length > 0) {
      csvData.push([`Sales by Products - Total: ${salesByProducts.length} products`]);
      csvData.push(['ASIN', 'Product Name', 'Quantity Sold', 'Sales Amount']);
      
      const totalProducts = info?.TotalProduct || [];
      const productDetailsMap = new Map();
      totalProducts.forEach(product => {
        productDetailsMap.set(product.asin, product);
      });
      
      salesByProducts.forEach(product => {
        const productDetails = productDetailsMap.get(product.asin) || {};
        csvData.push([
          product.asin,
          productDetails.title || `Product ${product.asin}`,
          (product.quantity || 0).toString(),
          `$${(product.amount || 0).toFixed(2)}`
        ]);
      });
      csvData.push([]);
    }
    
    // Add Total Products data - ALL PRODUCTS
    const totalProducts = info?.TotalProduct || [];
    if (totalProducts.length > 0) {
      csvData.push([`All Products Catalog - Total: ${totalProducts.length} products`]);
      csvData.push(['ASIN', 'Product Title', 'Brand', 'Category', 'Price', 'FBA Fees']);
      
      totalProducts.forEach(product => {
        csvData.push([
          product.asin || 'N/A',
          product.title || 'N/A',
          product.brand || 'N/A',
          product.itemClassification || 'N/A',
          `$${(product.price || 0).toFixed(2)}`,
          `$${(product.fbaFees || 0).toFixed(2)}`
        ]);
      });
      csvData.push([]);
    }
    
    // Add financial summary
    if (info?.accountFinance) {
      // Calculate adjusted gross profit for summary
      const originalGrossProfit = Number(info.accountFinance.Gross_Profit || 0);
      let totalCOGSSummary = 0;
      const profitibilityDataSummary = info?.profitibilityData || [];
      profitibilityDataSummary.forEach(product => {
        const cogsPerUnit = cogsValues[product.asin] || 0;
        const quantity = product.quantity || 0;
        totalCOGSSummary += cogsPerUnit * quantity;
      });
      const adjustedGrossProfitSummary = originalGrossProfit - totalCOGSSummary;
      
      csvData.push(['Financial Summary (COGS-Adjusted for Profitability Dashboard)']);
      csvData.push(['Total Sales', `${currency}${info.TotalWeeklySale || 0}`]);
      csvData.push(['Original Gross Profit (from Amazon)', `${currency}${originalGrossProfit}`]);
      csvData.push(['Total COGS Entered', `${currency}${totalCOGSSummary.toFixed(2)}`]);
      csvData.push(['Adjusted Gross Profit (Original - COGS)', `${currency}${adjustedGrossProfitSummary.toFixed(2)}`]);
      csvData.push(['FBA Fees', `${currency}${info.accountFinance.FBA_Fees || 0}`]);
      csvData.push(['Storage Fees', `${currency}${info.accountFinance.Storage || 0}`]);
      csvData.push(['Amazon Charges', `${currency}${info.accountFinance.Amazon_Charges || 0}`]);
      csvData.push(['Product Ads Payment', `${currency}${info.accountFinance.ProductAdsPayment || 0}`]);
      csvData.push(['Refunds', `${currency}${info.accountFinance.Refunds || 0}`]);
      csvData.push([]);
    }
    
    // Add Comprehensive Profitability Improvement Suggestions
    csvData.push(['Profitability Improvement Suggestions - Complete Analysis']);
    csvData.push(['Priority', 'Category', 'Recommendation', 'Expected Impact', 'Timeframe']);
    const comprehensiveSuggestions = [
      ['High', 'Product Mix', 'Focus marketing budget on highest margin products (>20% profit margin)', 'High', '1-2 months'],
      ['High', 'Cost Management', 'Optimize overall spend by reducing unnecessary Amazon fees', 'High', '1 week'],
      ['High', 'COGS Management', 'Enter COGS values for accurate profitability and negotiate better supplier rates for products with high COGS', 'Medium-High', '1-3 months'],
      ['Medium', 'Inventory', 'Optimize inventory levels to reduce storage fees', 'Medium', '1-2 months'],
      ['Medium', 'Pricing', 'Review and adjust pricing strategy for low-margin products', 'Medium', '2-4 weeks'],
      ['Medium', 'Product Development', 'Consider discontinuing consistently unprofitable products', 'Medium', '3-6 months'],
      ['Medium', 'Fee Optimization', 'Review FBA fees and consider alternative fulfillment for low-margin items', 'Medium', '2-3 months'],
      ['Low', 'Market Research', 'Analyze competitor pricing and positioning', 'Low-Medium', '1 month'],
      ['Low', 'Customer Analysis', 'Focus on high-value customer segments', 'Low-Medium', '2-4 months'],
      ['Low', 'Operational', 'Review fulfillment options to reduce overall fees', 'Low', '3-6 months']
    ];
    
    comprehensiveSuggestions.forEach(([priority, category, recommendation, impact, timeframe]) => {
      csvData.push([priority, category, recommendation, impact, timeframe]);
    });
    csvData.push([]);
    
    // Add Performance Summary
    csvData.push(['Performance Summary']);
    csvData.push(['Metric', 'Value', 'Status']);
    const totalRevenue = chartData.reduce((sum, item) => sum + item.totalSales, 0);
    const totalCosts = chartData.reduce((sum, item) => sum + item.spend, 0);
    const overallProfitMargin = totalRevenue > 0 ? ((totalRevenue - totalCosts) / totalRevenue) * 100 : 0;
    
    csvData.push(['Total Revenue', `${currency}${totalRevenue.toFixed(2)}`, totalRevenue > 0 ? 'Good' : 'Poor']);
    csvData.push(['Total Costs', `${currency}${totalCosts.toFixed(2)}`, '']);
    csvData.push(['Overall Profit Margin', `${overallProfitMargin.toFixed(2)}%`, overallProfitMargin > 15 ? 'Good' : overallProfitMargin > 5 ? 'Warning' : 'Poor']);
    csvData.push(['Number of Products', profitabilityTableData.length.toString(), profitabilityTableData.length > 10 ? 'Good' : 'Limited']);
    csvData.push([]);
    
    // Add Category Breakdown (if available)
    const categoryBreakdown = {};
    totalProducts.forEach(product => {
      const category = product.itemClassification || 'Unknown';
      if (!categoryBreakdown[category]) {
        categoryBreakdown[category] = { count: 0, totalSales: 0 };
      }
      categoryBreakdown[category].count++;
      // Find sales data for this product
      const salesData = salesByProducts.find(sale => sale.asin === product.asin);
      if (salesData) {
        categoryBreakdown[category].totalSales += salesData.amount || 0;
      }
    });
    
    if (Object.keys(categoryBreakdown).length > 0) {
      csvData.push(['Category Performance Breakdown']);
      csvData.push(['Category', 'Product Count', 'Total Sales', 'Average Sales per Product']);
      Object.entries(categoryBreakdown).forEach(([category, data]) => {
        const avgSales = data.count > 0 ? data.totalSales / data.count : 0;
        csvData.push([
          category,
          data.count.toString(),
          `${currency}${data.totalSales.toFixed(2)}`,
          `${currency}${avgSales.toFixed(2)}`
        ]);
      });
      csvData.push([]);
    }
    
    // Add Dynamic Suggestions with Priority Analysis
    if (suggestionsData && suggestionsData.length > 0) {
      csvData.push(['Dynamic Suggestions Based on Current Data Analysis']);
      csvData.push(['Priority', 'Suggestion Type', 'Recommendation', 'Action Required']);
      
      // Convert string suggestions to objects with priority analysis
      const prioritizedSuggestions = suggestionsData.map((suggestion) => {
        let priority = 'Medium';
        let actionRequired = 'Monitor';
        let suggestionType = 'Optimization';
        
        if (typeof suggestion === 'string') {
          if (suggestion.toLowerCase().includes('negative profit') || 
              suggestion.toLowerCase().includes('losing money') ||
              suggestion.toLowerCase().includes('unprofitable')) {
            priority = 'Critical';
            actionRequired = 'Immediate';
            suggestionType = 'Profitability Crisis';
          } else if (suggestion.toLowerCase().includes('low margin') ||
                     suggestion.toLowerCase().includes('very low')) {
            priority = 'High';
            actionRequired = 'Within 1 week';
            suggestionType = 'Margin Improvement';
          } else if (suggestion.toLowerCase().includes('optimize') || 
                     suggestion.toLowerCase().includes('consider')) {
            priority = 'Medium';
            actionRequired = 'Within 1 month';
            suggestionType = 'General Optimization';
          }
        }
        
        return {
          priority,
          suggestionType,
          message: suggestion,
          actionRequired
        };
      });
      
      // Sort by priority (Critical first, then High, then Medium)
      const priorityOrder = { 'Critical': 1, 'High': 2, 'Medium': 3 };
      prioritizedSuggestions.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);
      
      prioritizedSuggestions.forEach((suggestion, index) => {
        csvData.push([
          suggestion.priority,
          suggestion.suggestionType,
          suggestion.message,
          suggestion.actionRequired
        ]);
      });
      
      csvData.push([]);
      
      // Add suggestions summary
      const criticalCount = prioritizedSuggestions.filter(s => s.priority === 'Critical').length;
      const highCount = prioritizedSuggestions.filter(s => s.priority === 'High').length;
      const mediumCount = prioritizedSuggestions.filter(s => s.priority === 'Medium').length;
      
      csvData.push(['Suggestions Summary']);
      csvData.push(['Critical Issues', criticalCount.toString()]);
      csvData.push(['High Priority', highCount.toString()]);
      csvData.push(['Medium Priority', mediumCount.toString()]);
      csvData.push(['Total Suggestions', prioritizedSuggestions.length.toString()]);
      csvData.push([]);
    }
    
    // Add ProductWise Sponsored Ads Data if available
    const productWiseSponsoredAdsGraphData = info?.ProductWiseSponsoredAdsGraphData || {};
    if (Object.keys(productWiseSponsoredAdsGraphData).length > 0) {
      csvData.push(['Product-wise Sponsored Ads Performance Data']);
      csvData.push(['ASIN', 'Product Name', 'Impressions', 'Clicks', 'CTR %', 'Spend', 'Sales', 'ACOS %', 'ROAS']);
      
      const totalProducts = info?.TotalProduct || [];
      const productDetailsMap = new Map();
      totalProducts.forEach(product => {
        productDetailsMap.set(product.asin, product);
      });
      
      Object.entries(productWiseSponsoredAdsGraphData).forEach(([asin, adsData]) => {
        const productDetails = productDetailsMap.get(asin) || {};
        const impressions = adsData.impressions || 0;
        const clicks = adsData.clicks || 0;
        const spend = adsData.spend || 0;
        const sales = adsData.attributedSales1d || 0;
        const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
        const acos = sales > 0 ? (spend / sales) * 100 : 0;
        const roas = spend > 0 ? sales / spend : 0;
        
        csvData.push([
          asin,
          productDetails.title || `Product ${asin}`,
          impressions.toString(),
          clicks.toString(),
          `${ctr.toFixed(2)}%`,
            `${currency}${spend.toFixed(2)}`,
            `${currency}${sales.toFixed(2)}`,
          `${acos.toFixed(2)}%`,
          `${roas.toFixed(2)}`
        ]);
      });
      csvData.push([]);
    }
    
      return csvData;
    } catch (error) {
      console.error('Error preparing profitability data:', error);
      console.error('Error stack:', error.stack);
      
      // Return a safe, basic version of the data
      try {
        const basicCsvData = [];
        
        // Basic header
        basicCsvData.push(['Profitability Dashboard Report - Basic Version']);
        basicCsvData.push(['Generated on:', new Date().toLocaleDateString()]);
        basicCsvData.push(['Note:', 'This is a simplified version due to data processing complexity']);
        basicCsvData.push([]);
        
        // Basic metrics if available
        if (Array.isArray(metrics) && metrics.length > 0) {
          basicCsvData.push(['Key Metrics']);
          metrics.forEach(metric => {
            if (metric && metric.label && metric.value) {
              basicCsvData.push([metric.label, metric.value]);
            }
          });
          basicCsvData.push([]);
        }
        
        // Basic chart data if available
        if (Array.isArray(chartData) && chartData.length > 0) {
          basicCsvData.push(['Daily Performance']);
          basicCsvData.push(['Date', 'Spend', 'Sales']);
          chartData.forEach(day => {
            if (day && day.date) {
              basicCsvData.push([
                day.date || 'N/A',
                `${currency}${(day.spend || 0).toFixed(2)}`,
                `${currency}${(day.totalSales || 0).toFixed(2)}`
              ]);
            }
          });
          basicCsvData.push([]);
        }
        
        // Basic product data if available
        const basicProfitabilityData = info?.profitibilityData || [];
        if (Array.isArray(basicProfitabilityData) && basicProfitabilityData.length > 0) {
          basicCsvData.push(['Product Analysis - Basic']);
          basicCsvData.push(['ASIN', 'Units Sold', 'Sales', 'Ad Spend', 'Fees']);
          basicProfitabilityData.forEach(product => {
            if (product && product.asin) {
              basicCsvData.push([
                product.asin,
                (product.quantity || 0).toString(),
                `${currency}${(product.sales || 0).toFixed(2)}`,
                `${currency}${(product.ads || 0).toFixed(2)}`,
                `$${(product.amzFee || 0).toFixed(2)}`
              ]);
            }
          });
          basicCsvData.push([]);
        }
        
        // Error information
        basicCsvData.push(['Error Information']);
        basicCsvData.push(['Error Type:', 'Data Processing Error']);
        basicCsvData.push(['Error Message:', error.message || 'Unknown error occurred']);
        basicCsvData.push(['Suggestion:', 'Please try refreshing the page or contact support if the issue persists']);
        
        return basicCsvData;
      } catch (fallbackError) {
        console.error('Even basic data preparation failed:', fallbackError);
        return [
          ['Profitability Dashboard Report'],
          ['Generated on:', new Date().toLocaleDateString()],
          ['Error:', 'Unable to generate report due to critical data processing error'],
          ['Message:', error.message || 'Unknown error occurred'],
          ['Fallback Error:', fallbackError.message || 'Unknown fallback error'],
          ['Suggestion:', 'Please refresh the page and try again']
        ];
      }
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-slate-100">
      {/* COGS Information Popup */}
      <AnimatePresence>
        {showCogsPopup && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4"
            onClick={handleCloseCogsPopup}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.3 }}
              className="bg-white rounded-2xl shadow-2xl max-w-md w-full mx-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-6">
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 bg-gradient-to-br from-blue-500 to-blue-600 rounded-xl flex items-center justify-center shadow-lg">
                      <TrendingUp className="w-6 h-6 text-white" />
                    </div>
                    <div>
                      <h3 className="text-lg font-bold text-gray-900">Improve Profit Accuracy</h3>
                      <p className="text-sm text-gray-600">Get precise profitability insights</p>
                    </div>
                  </div>
                  <button
                    onClick={handleCloseCogsPopup}
                    className="text-gray-400 hover:text-gray-600 transition-colors p-1"
                  >
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="mb-6">
                  <div className="flex items-start gap-3 p-4 bg-amber-50 border border-amber-200 rounded-lg mb-4">
                    <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <h4 className="font-semibold text-amber-900 mb-1">Important Notice</h4>
                      <p className="text-sm text-amber-800 leading-relaxed">
                        To get accurate gross profit calculations, please add <strong>COGS (Cost of Goods Sold) values per unit</strong> for your products.
                      </p>
                    </div>
                  </div>
                  
                  <div className="space-y-3">
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-blue-600 text-sm font-bold">1</span>
                      </div>
                      <p className="text-sm text-gray-700">
                        Navigate to the product table below
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-blue-600 text-sm font-bold">2</span>
                      </div>
                      <p className="text-sm text-gray-700">
                        Click the "Add COGS" button for each product
                      </p>
                    </div>
                    <div className="flex items-start gap-3">
                      <div className="w-6 h-6 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5">
                        <span className="text-blue-600 text-sm font-bold">3</span>
                      </div>
                      <p className="text-sm text-gray-700">
                        Enter your actual cost per unit for accurate profit margins
                      </p>
                    </div>
                  </div>
                </div>
                
                <div className="flex gap-3">
                  <button
                    onClick={handleCloseCogsPopup}
                    className="flex-1 px-4 py-2.5 bg-gradient-to-r from-blue-600 to-blue-700 text-white font-medium rounded-lg hover:from-blue-700 hover:to-blue-800 transition-all duration-200 shadow-md hover:shadow-lg"
                  >
                    Got it, thanks!
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main Dashboard Container */}
      <div className="h-[90vh] overflow-y-auto">
        <div className="p-6 lg:p-8">
          <div className="w-full">
                      
            {/* Modern Header Section */}
            <motion.div 
              initial={{ opacity: 0, y: -20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6 }}
              className="mb-8"
            >
              <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-6">
                {/* Header Title and Description */}
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-gradient-to-br from-green-500 to-emerald-600 rounded-xl flex items-center justify-center shadow-lg">
                      <TrendingUp className="w-5 h-5 text-white" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h1 className="text-2xl lg:text-3xl font-bold text-gray-900">
                          Profitability Dashboard
                        </h1>
                        <div className="relative group">
                          <HelpCircle className="w-5 h-5 text-gray-400 hover:text-gray-600 cursor-help transition-colors" />
                          <div className="absolute left-1/2 transform -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-50">
                            <div className="bg-gray-800 text-white text-xs rounded-lg py-2 px-3 shadow-lg max-w-xs text-left" style={{ width: '256px' }}>
                              Advanced profitability analysis dashboard that tracks gross and net profit margins by product. Add COGS (Cost of Goods Sold) values to get accurate net profit calculations and identify underperforming products that need optimization.
                            </div>
                            <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-800"></div>
                          </div>
                        </div>
                      </div>
                      <p className="text-sm text-gray-600 mt-1">
                        Monitor your profit margins and optimize your business performance
                      </p>
                    </div>
                  </div>
                </div>

                {/* Controls Section */}
                <div className="flex flex-wrap items-center gap-3">
                  {/* Date Picker */}
                  <div className='relative' ref={CalenderRef}>
                    <motion.button
                      whileHover={{ scale: 1.02 }}
                      whileTap={{ scale: 0.98 }}
                      className='flex items-center gap-3 px-4 py-2.5 bg-white border-2 border-gray-200 rounded-xl hover:border-blue-300 hover:shadow-md transition-all duration-200 min-w-[140px]'
                      onClick={() => setOpenCalender(!openCalender)}
                    >
                      <Calendar className="w-4 h-4 text-gray-600" />
                      <span className='text-sm font-medium text-gray-700'>
                        {(info?.calendarMode === 'custom' && info?.startDate && info?.endDate)
                          ? `${new Date(info.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })} - ${new Date(info.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                          : info?.calendarMode === 'last7'
                          ? 'Last 7 Days'
                          : 'Last 30 Days'
                        }
                      </span>
                    </motion.button>
                    <AnimatePresence>
                      {openCalender && (
                        <motion.div
                          initial={{ opacity: 0, scaleY: 0 }}
                          animate={{ opacity: 1, scaleY: 1 }}
                          exit={{ opacity: 0, scaleY: 0 }}
                          transition={{ duration: 0.3 }}
                          className="absolute top-full right-0 z-50 mt-2 bg-white shadow-xl rounded-xl border border-gray-200 origin-top"
                        >
                          <Calender setOpenCalender={setOpenCalender} />
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>

                  {/* Download Report Button */}
                  <DownloadReport
                    prepareDataFunc={prepareProfitabilityData}
                    filename="Profitability_Dashboard_Report"
                    buttonText="Export"
                    showIcon={true}
                  />
                </div>
              </div>
            </motion.div>

                      {/* Enhanced Metrics Cards */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.1 }}
              className="mb-8"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {metrics.map((metric, index) => (
                  <motion.div
                    key={metric.label}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.1 * index }}
                    whileHover={{ scale: 1.02, y: -2 }}
                    className="group"
                  >
                    <MetricCard label={metric.label} value={metric.value} icon={metric.icon} />
                  </motion.div>
                ))}
              </div>
            </motion.div>

                      {/* Enhanced Chart Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.2 }}
              className="mb-8"
            >
              <div className="bg-white rounded-2xl border border-gray-200 shadow-sm overflow-hidden">
                <div className="p-6 pb-0">
                  <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-gradient-to-br from-blue-500 to-blue-600 rounded-lg flex items-center justify-center">
                        <BarChart3 className="w-4 h-4 text-white" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-lg font-semibold text-gray-900">Gross Profit vs Total Sales Analysis</h3>
                          <div className="relative group">
                            <HelpCircle className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-help transition-colors" />
                            <div className="absolute left-1/2 transform -translate-x-1/2 bottom-full mb-2 hidden group-hover:block z-50">
                              <div className="bg-gray-800 text-white text-xs rounded-lg py-2 px-3 shadow-lg max-w-xs text-left" style={{ width: '256px' }}>
                                Visual comparison of your gross profit (sales minus Amazon fees and ad spend) versus total sales over time. The green area shows your gross profit, while the blue area represents total sales revenue. Use this to identify profitability trends and seasonal patterns.
                              </div>
                              <div className="absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-gray-800"></div>
                            </div>
                          </div>
                        </div>
                        <p className="text-sm text-gray-600">Track your daily gross profit performance against total sales</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-gradient-to-r from-green-400 to-green-500 rounded-full"></div>
                        <span className="text-gray-600">Gross Profit</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 bg-gradient-to-r from-blue-400 to-blue-500 rounded-full"></div>
                        <span className="text-gray-600">Total Sales</span>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="px-6 pb-6">
                  <ResponsiveContainer width="100%" height={320}>
                    <AreaChart
                      data={chartData}
                      margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
                    >
                      <defs>
                        <linearGradient id="grossProfitGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#10B981" stopOpacity={0.6}/>
                          <stop offset="95%" stopColor="#10B981" stopOpacity={0.1}/>
                        </linearGradient>
                        <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.2}/>
                          <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.02}/>
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                      <XAxis
                        dataKey="date"
                        tick={{ fontSize: 12, fill: '#64748b' }}
                        stroke="#e2e8f0"
                        tickLine={false}
                        axisLine={false}
                      />
                      <YAxis
                        tick={{ fontSize: 12, fill: '#64748b' }}
                        stroke="#e2e8f0"
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${currency}${value}`}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: 'rgba(255, 255, 255, 0.95)',
                          border: '1px solid #e2e8f0',
                          borderRadius: '12px',
                          padding: '12px',
                          boxShadow: '0 10px 25px rgba(0, 0, 0, 0.1)',
                          fontSize: '14px'
                        }}
                        formatter={(value, name) => [`${currency}${value}`, name === 'grossProfit' ? 'Gross Profit' : 'Total Sales']}
                        labelFormatter={(label) => `Date: ${label}`}
                      />
                      <Area
                        type="monotone"
                        dataKey="totalSales"
                        stroke="#3B82F6"
                        fill="url(#salesGradient)"
                        name="totalSales"
                        strokeWidth={3}
                        dot={false}
                      />
                      <Area
                        type="monotone"
                        dataKey="grossProfit"
                        stroke="#10B981"
                        fill="url(#grossProfitGradient)"
                        name="grossProfit"
                        strokeWidth={3}
                        dot={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </motion.div>

            {/* Enhanced Profit Table */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.3 }}
              className="mb-8"
            >
              <ProfitTable setSuggestionsData={setSuggestionsData} />
            </motion.div>

            {/* Enhanced Suggestions Section */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.6, delay: 0.4 }}
              className="mb-8"
            >
              <SuggestionList suggestionsData={suggestionsData} />
            </motion.div>

            {/* Bottom Spacer */}
            <div className='w-full h-8'></div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ProfitabilityDashboard;