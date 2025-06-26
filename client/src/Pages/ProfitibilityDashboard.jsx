import React, { useState, useEffect, useRef, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import MetricCard from '../Components/ProfitibilityDashboard/MetricCard';
import ProfitTable from '../Components/ProfitibilityDashboard/ProfitTable';
import SuggestionList from '../Components/ProfitibilityDashboard/SuggestionList';
import calenderIcon from '../assets/Icons/Calender.png'
import { useSelector } from "react-redux";
import { AnimatePresence, motion } from 'framer-motion';
import Calender from '../Components/Calender/Calender.jsx';
import DownloadReport from '../Components/DownloadReport/DownloadReport.jsx';

const mockChartData = [
  { date: 'Apr 1', spend: 150, netProfit: 350 },
  { date: 'Apr 5', spend: 180, netProfit: 420 },
  { date: 'Apr 8', spend: 200, netProfit: 380 },
  { date: 'Apr 12', spend: 175, netProfit: 450 },
  { date: 'Apr 15', spend: 190, netProfit: 390 },
  { date: 'Apr 18', spend: 165, netProfit: 480 },
  { date: 'Apr 22', spend: 185, netProfit: 410 },
  { date: 'Apr 25', spend: 170, netProfit: 440 },
  { date: 'Apr 28', spend: 195, netProfit: 395 },
  { date: 'Apr 30', spend: 160, netProfit: 460 },
];

const ProfitabilityDashboard = () => {
  const [suggestionsData, setSuggestionsData] = useState([]);
  const [openCalender, setOpenCalender] = useState(false);
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

  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  
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
          
          // Calculate total spend including all Amazon fees and ad spend
          const totalSpend = avgFeesPerDay;
          
          return {
            date: dateKey,
            spend: parseFloat(totalSpend.toFixed(2)),
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
          
          // Calculate total spend including all Amazon fees
          const totalSpend = avgFeesPerDay;
          
          return {
            date: dateKey,
            spend: parseFloat(totalSpend.toFixed(2)),
            totalSales: parseFloat(totalSales.toFixed(2))
          };
        }
        return null;
      }).filter(item => item !== null);
    }
    
    // Final fallback to mock data (updated for spend)
    return [
      { date: 'Apr 1', spend: 250, totalSales: 1000 },
      { date: 'Apr 5', spend: 280, totalSales: 1200 },
      { date: 'Apr 8', spend: 300, totalSales: 1333 },
      { date: 'Apr 12', spend: 275, totalSales: 1167 },
      { date: 'Apr 15', spend: 290, totalSales: 1267 },
      { date: 'Apr 18', spend: 265, totalSales: 1100 },
      { date: 'Apr 22', spend: 285, totalSales: 1233 },
      { date: 'Apr 25', spend: 270, totalSales: 1133 },
      { date: 'Apr 28', spend: 295, totalSales: 1300 },
      { date: 'Apr 30', spend: 260, totalSales: 1067 },
    ];
  }, [totalSalesData, info?.accountFinance, productWiseSponsoredAdsGraphData, accountFinance]);

  // Get COGs values from Redux store
  const cogsValues = useSelector((state) => state.cogs.cogsValues);
  
  const metrics = useMemo(() => {
    // Calculate metrics from filtered data if available
    const totalSalesData = info?.TotalSales;
    const filteredAccountFinance = info?.accountFinance || accountFinance;
    let filteredTotalSales = 0;
    let totalOverallSpend = 0;
    
    if (totalSalesData && Array.isArray(totalSalesData) && totalSalesData.length > 0) {
      // Calculate totals from filtered date range
      filteredTotalSales = totalSalesData.reduce((sum, item) => sum + (parseFloat(item.TotalAmount) || 0), 0);
    }
    
    // Calculate total COGS from all products that have COGS entered
    let totalCOGS = 0;
    const profitibilityData = info?.profitibilityData || [];
    
    profitibilityData.forEach(product => {
      const cogsPerUnit = cogsValues[product.asin] || 0;
      const quantity = product.quantity || 0;
      totalCOGS += cogsPerUnit * quantity;
    });
    
    // Calculate total overall spend including all Amazon fees
    totalOverallSpend = (Number(filteredAccountFinance?.FBA_Fees || 0) + 
                        Number(filteredAccountFinance?.Storage || 0) + 
                        Number(filteredAccountFinance?.Amazon_Charges || 0) +
                        Number(filteredAccountFinance?.ProductAdsPayment || 0) +
                        Number(filteredAccountFinance?.Refunds || 0));
    
    // Use filtered data if available, otherwise fall back to original data
    const totalSales = filteredTotalSales > 0 ? filteredTotalSales : Number(info?.TotalWeeklySale || 0);
    const originalGrossProfit = Number(filteredAccountFinance?.Gross_Profit) || 0;
    
    // Adjust gross profit by subtracting total COGS (only for profitability page)
    const adjustedGrossProfit = originalGrossProfit - totalCOGS;
    
    const adSpend = Number(filteredAccountFinance?.ProductAdsPayment || 0);
    const amazonFees = (Number(filteredAccountFinance?.FBA_Fees || 0) + Number(filteredAccountFinance?.Storage || 0) + Number(filteredAccountFinance?.Amazon_Charges || 0));
    
    // Calculate adjusted profit margin using COGS-adjusted gross profit
    const adjustedProfitMargin = totalSales > 0 ? ((adjustedGrossProfit / totalSales) * 100) : 0;
    
    return [
      { label: 'Total Sales', value: `$${totalSales.toFixed(2)}`, icon: 'dollar-sign' },
      { label: 'Gross Profit', value: `$${adjustedGrossProfit.toFixed(2)}`, icon: 'dollar-sign' },
      { label: 'Avg Profit Margin', value: `${adjustedProfitMargin.toFixed(2)}%`, icon: 'percent' },
      { label: 'Total Ad Spend', value: `$${adSpend.toFixed(2)}`, icon: 'dollar-sign' },
      { label: 'Total Amazon Fees', value: `$${amazonFees.toFixed(2)}`, icon: 'list' },
    ];
  }, [info?.TotalSales, info?.accountFinance, info?.TotalWeeklySale, info?.sponsoredAdsMetrics, info?.profitibilityData, accountFinance, cogsValues]);

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
         const grossProfit = (product.sales || 0) - (product.ads || 0) - (product.amzFee || 0);
         const netProfit = grossProfit - totalCogs;
         const profitMargin = product.sales > 0 ? (netProfit / product.sales) * 100 : 0;
         return profitMargin < 0;
       }).length : 0;
       
       const warningProducts = Array.isArray(executiveProfitabilityData) ? executiveProfitabilityData.filter(product => {
         if (!product || typeof product !== 'object') return false;
         const cogsPerUnit = (cogsValues && cogsValues[product.asin]) || 0;
         const totalCogs = cogsPerUnit * (product.quantity || 0);
         const grossProfit = (product.sales || 0) - (product.ads || 0) - (product.amzFee || 0);
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
    csvData.push(['Total COGS Deducted', `$${totalCOGS.toFixed(2)}`]);
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
          `$${(day.spend || 0).toFixed(2)}`,
          `$${(day.totalSales || 0).toFixed(2)}`
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
        const grossProfit = (product.sales || 0) - (product.ads || 0) - (product.amzFee || 0);
        const netProfit = grossProfit - totalCogs;
        const profitMargin = product.sales > 0 ? (netProfit / product.sales) * 100 : 0;
        const revenuePerUnit = product.quantity > 0 ? (product.sales / product.quantity) : 0;
        const cogsPercent = product.sales > 0 ? (totalCogs / product.sales) * 100 : 0;
        const adSpendPercent = product.sales > 0 ? ((product.ads || 0) / product.sales) * 100 : 0;
        const feesPercent = product.sales > 0 ? ((product.amzFee || 0) / product.sales) * 100 : 0;
        
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
          `$${(product.sales || 0).toFixed(2)}`,
          `$${revenuePerUnit.toFixed(2)}`,
          `$${cogsPerUnit.toFixed(2)}`,
          `${cogsPercent.toFixed(1)}%`,
          `$${totalCogs.toFixed(2)}`,
          `$${(product.ads || 0).toFixed(2)}`,
          `${adSpendPercent.toFixed(1)}%`,
          `$${(product.amzFee || 0).toFixed(2)}`,
          `${feesPercent.toFixed(1)}%`,
          `$${grossProfit.toFixed(2)}`,
          `$${netProfit.toFixed(2)}`,
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
      csvData.push(['Total Sales', `$${info.TotalWeeklySale || 0}`]);
      csvData.push(['Original Gross Profit (from Amazon)', `$${originalGrossProfit}`]);
      csvData.push(['Total COGS Entered', `$${totalCOGSSummary.toFixed(2)}`]);
      csvData.push(['Adjusted Gross Profit (Original - COGS)', `$${adjustedGrossProfitSummary.toFixed(2)}`]);
      csvData.push(['FBA Fees', `$${info.accountFinance.FBA_Fees || 0}`]);
      csvData.push(['Storage Fees', `$${info.accountFinance.Storage || 0}`]);
      csvData.push(['Amazon Charges', `$${info.accountFinance.Amazon_Charges || 0}`]);
      csvData.push(['Product Ads Payment', `$${info.accountFinance.ProductAdsPayment || 0}`]);
      csvData.push(['Refunds', `$${info.accountFinance.Refunds || 0}`]);
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
    
    csvData.push(['Total Revenue', `$${totalRevenue.toFixed(2)}`, totalRevenue > 0 ? 'Good' : 'Poor']);
    csvData.push(['Total Costs', `$${totalCosts.toFixed(2)}`, '']);
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
          `$${data.totalSales.toFixed(2)}`,
          `$${avgSales.toFixed(2)}`
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
          `$${spend.toFixed(2)}`,
          `$${sales.toFixed(2)}`,
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
                `$${(day.spend || 0).toFixed(2)}`,
                `$${(day.totalSales || 0).toFixed(2)}`
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
                `$${(product.sales || 0).toFixed(2)}`,
                `$${(product.ads || 0).toFixed(2)}`,
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
    <div className="bg-[#eeeeee] h-[90vh] overflow-y-auto">
      <div className="p-6">
        <div className="max-w-[1400px] mx-auto pb-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-sm text-gray-900">PROFITIBILITY</h1>
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
                prepareDataFunc={prepareProfitabilityData}
                filename="Profitability_Dashboard_Report"
                buttonText="Download Report"
                buttonClass="text-sm text-white bg-[#333651] rounded px-3 py-1 flex items-center gap-2"
                showIcon={true}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            {metrics.map((m) => (
              <MetricCard key={m.label} label={m.label} value={m.value} icon={m.icon} />
            ))}
          </div>

          {/* Area Chart for Spend vs Total Sales */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Spend vs Total Sales</h3>
            <ResponsiveContainer width="100%" height={250}>
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
              >
                <defs>
                  <linearGradient id="spendGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#EF4444" stopOpacity={0.35}/>
                    <stop offset="95%" stopColor="#EF4444" stopOpacity={0.05}/>
                  </linearGradient>
                  <linearGradient id="salesGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.35}/>
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.05}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
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
                  tickFormatter={(value) => `$${value}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: 'white',
                    border: '1px solid #e5e7eb',
                    borderRadius: '8px',
                    padding: '8px'
                  }}
                  formatter={(value) => `$${value}`}
                />
                <Legend 
                  wrapperStyle={{
                    paddingTop: '20px',
                    fontSize: '12px'
                  }}
                />
                <Area
                  type="monotone"
                  dataKey="spend"
                  stroke="#EF4444"
                  fill="url(#spendGradient)"
                  name="Spend"
                  strokeWidth={2}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="totalSales"
                  stroke="#3B82F6"
                  fill="url(#salesGradient)"
                  name="Total Sales"
                  strokeWidth={2}
                  dot={false}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>

          <div className="mb-6">
            <ProfitTable setSuggestionsData={setSuggestionsData} />
          </div>

          <SuggestionList suggestionsData={suggestionsData} />
          <div className='w-full h-[3rem]'></div>
        </div>
      </div>
    </div>
  );
};

export default ProfitabilityDashboard;