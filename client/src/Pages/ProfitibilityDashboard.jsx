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
  }, [])

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
      // Calculate total fees and other costs for the period using filtered finance data
      const filteredAccountFinance = info?.accountFinance || accountFinance;
      const totalFees = (parseFloat(filteredAccountFinance.FBA_Fees) || 0) + 
                       (parseFloat(filteredAccountFinance.Storage) || 0) + 
                       (parseFloat(filteredAccountFinance.Amazon_Charges) || 0);
      const avgFeesPerDay = totalFees / totalSalesData.length;
      
      // Transform filtered sales data for the chart
      return totalSalesData.map(sale => {
        if (sale.interval) {
          // Extract date from interval (format: "2025-03-01T00:00:00Z--2025-03-01T23:59:59Z")
          const startDate = new Date(sale.interval.split('--')[0]);
          const dateKey = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          const totalSales = parseFloat(sale.TotalAmount) || 0;
          
          // Estimate ad spend as a percentage of sales (typically 10-30% for profitable campaigns)
          const estimatedSpend = totalSales * 0.15; // Assume 15% of sales as ad spend
          
          // Calculate net profit: Total Sales - Ad Spend - Fees
          const netProfit = totalSales - estimatedSpend - avgFeesPerDay;
          
          return {
            date: dateKey,
            spend: parseFloat(estimatedSpend.toFixed(2)),
            netProfit: parseFloat(netProfit.toFixed(2))
          };
        }
        return null;
      }).filter(item => item !== null);
    }
    
    // Fallback to original productWiseSponsoredAdsGraphData logic
    const hasGraphData = Object.keys(productWiseSponsoredAdsGraphData).length > 0;
    
    if (!hasGraphData) {
      return mockChartData;
    }
    
    // Create a map to aggregate data by date
    const dateAggregateMap = new Map();
    
    // Create a map for total sales by date from original TotalSales data
    const totalSalesByDateMap = new Map();
    if (Array.isArray(totalSalesData) && totalSalesData.length > 0) {
      totalSalesData.forEach(sale => {
        if (sale.interval) {
          const startDate = new Date(sale.interval.split('--')[0]);
          const dateKey = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          totalSalesByDateMap.set(dateKey, parseFloat(sale.TotalAmount) || 0);
        }
      });
    }
    
    // Iterate through each ASIN's data
    Object.values(productWiseSponsoredAdsGraphData).forEach(asinData => {
      if (asinData.data && Array.isArray(asinData.data)) {
        asinData.data.forEach(dayData => {
          const dateKey = dayData.formattedDate || new Date(dayData.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
          
          if (!dateAggregateMap.has(dateKey)) {
            dateAggregateMap.set(dateKey, {
              date: dateKey,
              totalSpend: 0,
              ppcSales: 0
            });
          }
          
          const aggregate = dateAggregateMap.get(dateKey);
          aggregate.totalSpend += parseFloat(dayData.spend) || 0;
          aggregate.ppcSales += parseFloat(dayData.salesIn30Days) || 0;
        });
      }
    });
    
    // Calculate total fees and other costs for the period
    const totalFees = (parseFloat(accountFinance.FBA_Fees) || 0) + (parseFloat(accountFinance.Storage) || 0) + (parseFloat(accountFinance.Amazon_Charges) || 0);
    const daysInPeriod = dateAggregateMap.size || 30;
    const avgFeesPerDay = totalFees / daysInPeriod;
    
    // Convert map to array and calculate net profit for each date
    const chartDataArray = Array.from(dateAggregateMap.values()).map(dayData => {
      const actualDailySales = totalSalesByDateMap.get(dayData.date);
      
      let netProfit;
      if (actualDailySales !== undefined) {
        netProfit = actualDailySales - dayData.totalSpend - avgFeesPerDay;
      } else {
        const estimatedTotalSales = dayData.ppcSales / 0.3;
        netProfit = estimatedTotalSales - dayData.totalSpend - avgFeesPerDay;
      }
      
      return {
        date: dayData.date,
        spend: parseFloat(dayData.totalSpend.toFixed(2)),
        netProfit: parseFloat(netProfit.toFixed(2))
      };
    });
    
    return chartDataArray.sort((a, b) => new Date(a.date) - new Date(b.date));
  }, [totalSalesData, info?.accountFinance, productWiseSponsoredAdsGraphData, accountFinance]);

  const metrics = useMemo(() => {
    // Calculate metrics from filtered data if available
    const totalSalesData = info?.TotalSales;
    const filteredAccountFinance = info?.accountFinance || accountFinance;
    let filteredTotalSales = 0;
    let estimatedSpend = 0;
    
    if (totalSalesData && Array.isArray(totalSalesData) && totalSalesData.length > 0) {
      // Calculate totals from filtered date range
      filteredTotalSales = totalSalesData.reduce((sum, item) => sum + (parseFloat(item.TotalAmount) || 0), 0);
      estimatedSpend = filteredTotalSales * 0.15; // Estimate 15% of sales as ad spend
    }
    
    // Use filtered data if available, otherwise fall back to original data
    const totalSales = filteredTotalSales > 0 ? filteredTotalSales : Number(info?.TotalWeeklySale || 0);
    const grossProfit = Number(filteredAccountFinance?.Gross_Profit) || 0;
    const adSpend = estimatedSpend > 0 ? estimatedSpend : (info?.sponsoredAdsMetrics?.totalCost || 0);
    const amazonFees = (Number(filteredAccountFinance?.FBA_Fees || 0) + Number(filteredAccountFinance?.Storage || 0));
    
    return [
      { label: 'Total Sales', value: `$${totalSales.toFixed(2)}`, icon: 'dollar-sign' },
      { label: 'Gross Profit', value: `$${grossProfit.toFixed(2)}`, icon: 'dollar-sign' },
      { label: 'Avg Profit Margin', value: `${totalSales > 0 ? ((grossProfit / totalSales) * 100).toFixed(2) : '0.00'}%`, icon: 'percent' },
      { label: 'Total Ad Spend', value: `$${adSpend.toFixed(2)}`, icon: 'dollar-sign' },
      { label: 'Total Amazon Fees', value: `$${amazonFees.toFixed(2)}`, icon: 'list' },
    ];
  }, [info?.TotalSales, info?.accountFinance, info?.TotalWeeklySale, info?.sponsoredAdsMetrics, accountFinance]);

  // Prepare data for CSV/Excel export
  const prepareProfitabilityData = () => {
    const csvData = [];
    
    // Add header information
    csvData.push(['Profitability Dashboard Report']);
    csvData.push(['Generated on:', new Date().toLocaleDateString()]);
    csvData.push(['Date Range:', info?.startDate && info?.endDate ? `${info.startDate} to ${info.endDate}` : 'Last 30 Days']);
    csvData.push([]);
    
    // Add metrics summary
    csvData.push(['Key Metrics']);
    metrics.forEach(metric => {
      csvData.push([metric.label, metric.value]);
    });
    csvData.push([]);
    
    // Add chart data
    if (chartData.length > 0) {
      csvData.push(['Daily Spend vs Net Profit']);
      csvData.push(['Date', 'Ad Spend', 'Net Profit']);
      chartData.forEach(day => {
        csvData.push([
          day.date,
          `$${day.spend.toFixed(2)}`,
          `$${day.netProfit.toFixed(2)}`
        ]);
      });
      csvData.push([]);
    }
    
    // Add profitability table data - ALL PRODUCTS (not paginated)
    const profitabilityTableData = info?.profitibilityData || [];
    if (profitabilityTableData.length > 0) {
      csvData.push([`Product Profitability Analysis - Total: ${profitabilityTableData.length} products`]);
      csvData.push(['ASIN', 'Product Name', 'Units Sold', 'Sales Revenue', 'COGS/Unit', 'Total COGS', 'Ad Spend', 'Amazon Fees', 'Gross Profit', 'Net Profit (with COGS)', 'Profit Margin %', 'Status']);
      
      // Get product details and COGS values to match the table display exactly
      const totalProducts = info?.TotalProduct || [];
      const productDetailsMap = new Map();
      totalProducts.forEach(product => {
        productDetailsMap.set(product.asin, product);
      });
      
      profitabilityTableData.forEach(product => {
        const productDetails = productDetailsMap.get(product.asin) || {};
        const cogsPerUnit = 0; // Default COGS since we don't have access to Redux COGS state here
        const totalCogs = cogsPerUnit * (product.quantity || 0);
        const grossProfit = (product.sales || 0) - (product.ads || 0) - (product.amzFee || 0);
        const netProfit = grossProfit - totalCogs;
        const profitMargin = product.sales > 0 ? (netProfit / product.sales) * 100 : 0;
        
        // Determine status
        let status = 'Good';
        if (profitMargin < 10 && profitMargin >= 0) status = 'Warning';
        if (profitMargin < 0) status = 'Poor';
        
        csvData.push([
          product.asin,
          productDetails.title || `Product ${product.asin}`,
          (product.quantity || 0).toString(),
          `$${(product.sales || 0).toFixed(2)}`,
          `$${cogsPerUnit.toFixed(2)}`,
          `$${totalCogs.toFixed(2)}`,
          `$${(product.ads || 0).toFixed(2)}`,
          `$${(product.amzFee || 0).toFixed(2)}`,
          `$${grossProfit.toFixed(2)}`,
          `$${netProfit.toFixed(2)}`,
          `${profitMargin.toFixed(2)}%`,
          status
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
      csvData.push(['Financial Summary']);
      csvData.push(['Total Sales', `$${info.TotalWeeklySale || 0}`]);
      csvData.push(['Gross Profit', `$${info.accountFinance.Gross_Profit || 0}`]);
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
      ['High', 'Advertising', 'Reduce ad spend on products with negative profit margins', 'High', '1 week'],
      ['High', 'COGS Management', 'Negotiate better rates with suppliers for top-selling products', 'Medium-High', '1-3 months'],
      ['Medium', 'Inventory', 'Optimize inventory levels to reduce storage fees', 'Medium', '1-2 months'],
      ['Medium', 'Pricing', 'Review and adjust pricing strategy for low-margin products', 'Medium', '2-4 weeks'],
      ['Medium', 'Product Development', 'Consider discontinuing consistently unprofitable products', 'Medium', '3-6 months'],
      ['Low', 'Automation', 'Implement automated bidding strategies for better ad efficiency', 'Medium', '2-3 months'],
      ['Low', 'Market Research', 'Analyze competitor pricing and positioning', 'Low-Medium', '1 month'],
      ['Low', 'Customer Analysis', 'Focus on high-value customer segments', 'Low-Medium', '2-4 months'],
      ['Low', 'Operational', 'Review fulfillment options to reduce fees', 'Low', '3-6 months']
    ];
    
    comprehensiveSuggestions.forEach(([priority, category, recommendation, impact, timeframe]) => {
      csvData.push([priority, category, recommendation, impact, timeframe]);
    });
    csvData.push([]);
    
    // Add Performance Summary
    csvData.push(['Performance Summary']);
    csvData.push(['Metric', 'Value', 'Status']);
    const totalRevenue = chartData.reduce((sum, item) => sum + item.netProfit + item.spend, 0);
    const totalCosts = chartData.reduce((sum, item) => sum + item.spend, 0);
    const overallProfitMargin = totalRevenue > 0 ? ((totalRevenue - totalCosts) / totalRevenue) * 100 : 0;
    
    csvData.push(['Total Revenue', `$${totalRevenue.toFixed(2)}`, totalRevenue > 0 ? 'Good' : 'Poor']);
    csvData.push(['Total Ad Costs', `$${totalCosts.toFixed(2)}`, '']);
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
    
    // Add additional suggestions from dynamic data if available
    if (suggestionsData && suggestionsData.length > 0) {
      csvData.push(['Dynamic Suggestions Based on Current Data']);
      suggestionsData.forEach((suggestion, index) => {
        csvData.push([`${index + 1}.`, suggestion]);
      });
      csvData.push([]);
    }
    
    return csvData;
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

          {/* Area Chart for Spend and Net Profit */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Spend vs Net Profit Trend</h3>
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
                  <linearGradient id="profitGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.35}/>
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0.05}/>
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
                  name="Ad Spend"
                  strokeWidth={2}
                  dot={false}
                />
                <Area
                  type="monotone"
                  dataKey="netProfit"
                  stroke="#10B981"
                  fill="url(#profitGradient)"
                  name="Net Profit"
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