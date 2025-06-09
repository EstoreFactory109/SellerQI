import React, { useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';
import MetricCard from '../Components/ProfitibilityDashboard/MetricCard';
import ProfitTable from '../Components/ProfitibilityDashboard/ProfitTable';
import SuggestionList from '../Components/ProfitibilityDashboard/SuggestionList';
import calenderIcon from '../assets/Icons/Calender.png'
import { useSelector } from "react-redux";

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
  
  // Transform the data for the chart by aggregating across all ASINs
  const chartData = (() => {
    // Check if we have graph data
    const hasGraphData = Object.keys(productWiseSponsoredAdsGraphData).length > 0;
    
    if (!hasGraphData) {
      return mockChartData;
    }
    
    // Create a map to aggregate data by date
    const dateAggregateMap = new Map();
    
    // Create a map for total sales by date from TotalSales data
    const totalSalesByDateMap = new Map();
    if (Array.isArray(totalSalesData) && totalSalesData.length > 0) {
      totalSalesData.forEach(sale => {
        if (sale.interval) {
          // Extract date from interval (format: "2025-03-01T00:00:00Z--2025-03-01T23:59:59Z")
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
              totalSalesIn30Days: 0,
              totalSalesIn7Days: 0,
              totalSalesIn14Days: 0,
              ppcSales: 0  // Track PPC sales separately
            });
          }
          
          const aggregate = dateAggregateMap.get(dateKey);
          aggregate.totalSpend += parseFloat(dayData.spend) || 0;
          aggregate.totalSalesIn30Days += parseFloat(dayData.salesIn30Days) || 0;
          aggregate.totalSalesIn7Days += parseFloat(dayData.salesIn7Days) || 0;
          aggregate.totalSalesIn14Days += parseFloat(dayData.salesIn14Days) || 0;
          aggregate.ppcSales += parseFloat(dayData.salesIn30Days) || 0; // PPC sales are the sponsored ads sales
        });
      }
    });
    
    // Calculate total fees and other costs for the period
    const totalFees = (parseFloat(accountFinance.FBA_Fees) || 0) + (parseFloat(accountFinance.Storage) || 0) + (parseFloat(accountFinance.Amazon_Charges) || 0);
    const daysInPeriod = dateAggregateMap.size || 30;
    const avgFeesPerDay = totalFees / daysInPeriod;
    
    // Convert map to array and calculate net profit for each date
    const chartDataArray = Array.from(dateAggregateMap.values()).map(dayData => {
      // Get actual total sales for this date if available
      const actualDailySales = totalSalesByDateMap.get(dayData.date);
      
      let netProfit;
      if (actualDailySales !== undefined) {
        // We have actual sales data for this date
        // Net profit = Total Sales - Ad Spend - Fees
        netProfit = actualDailySales - dayData.totalSpend - avgFeesPerDay;
      } else {
        // Fallback: estimate based on PPC sales
        // Assume PPC sales are approximately 30% of total sales
        const estimatedTotalSales = dayData.ppcSales / 0.3;
        netProfit = estimatedTotalSales - dayData.totalSpend - avgFeesPerDay;
      }
      
      return {
        date: dayData.date,
        spend: parseFloat(dayData.totalSpend.toFixed(2)),
        netProfit: parseFloat(netProfit.toFixed(2))
      };
    });
    
    // Sort by date (chronological order)
    chartDataArray.sort((a, b) => {
      // Parse dates more reliably
      const parseDate = (dateStr) => {
        // Handle format like "25 Nov" or "Nov 25"
        const parts = dateStr.split(' ');
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        
        let month, day;
        if (months.includes(parts[0])) {
          month = months.indexOf(parts[0]);
          day = parseInt(parts[1]);
        } else if (months.includes(parts[1])) {
          day = parseInt(parts[0]);
          month = months.indexOf(parts[1]);
        } else {
          // Fallback to original parsing
          return new Date(dateStr + ' ' + new Date().getFullYear());
        }
        
        // Use current year for now
        const year = new Date().getFullYear();
        return new Date(year, month, day);
      };
      
      const dateA = parseDate(a.date);
      const dateB = parseDate(b.date);
      return dateA - dateB;
    });
    
    return chartDataArray;
  })();

  const metrics = [
    { label: 'Total Sales', value: `$${Number(info?.TotalWeeklySale || 0).toFixed(2)}`, icon: 'dollar-sign' },
    { label: 'Gross Profit', value: `$${Number(info.accountFinance?.Gross_Profit) || 0}`, icon: 'dollar-sign' },
    { label: 'Avg Profit Margin', value: `${((Number(info.accountFinance?.Gross_Profit || 0))/(Number(info?.TotalWeeklySale || 1).toFixed(2)) * 100).toFixed(2)} %`, icon: 'percent' },
    { label: 'Total Ad Spend', value: `$${info?.sponsoredAdsMetrics?.totalCost?.toFixed(2) || '0.00'}`, icon: 'dollar-sign' },
    { label: 'Total Amazon Fees', value: `$${(Number(info.accountFinance?.FBA_Fees || 0)+Number(info.accountFinance?.Storage || 0)).toFixed(2)}`, icon: 'list' },
  ];



  return (
    <div className="bg-[#eeeeee] h-screen overflow-y-auto">
      <div className="p-6">
        <div className="max-w-[1400px] mx-auto pb-6">
          <div className="flex items-center justify-between mb-6">
            <h1 className="text-sm text-gray-900">PROFITIBILITY</h1>
            <div className='flex bg-white gap-3 justify-between items-center px-3 py-1 border-2 border-gray-200  cursor-pointer' onClick={() => setOpenCalender(!openCalender)}>
              <p className='font-semi-bold text-xs'>Last 30 Days</p>
              <img src={calenderIcon} alt='' className='w-4 h-4' />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            {metrics.map((m) => (
              <MetricCard key={m.label} label={m.label} value={m.value} icon={m.icon} />
            ))}
          </div>

          {/* Line Chart for Spend and Net Profit */}
          <div className="bg-white rounded-lg border border-gray-200 p-6 mb-6">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Spend vs Net Profit Trend</h3>
            <ResponsiveContainer width="100%" height={250}>
              <LineChart
                data={chartData}
                margin={{ top: 10, right: 30, left: 10, bottom: 10 }}
              >
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
                <Line
                  type="monotone"
                  dataKey="spend"
                  stroke="#EF4444"
                  name="Ad Spend"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
                <Line
                  type="monotone"
                  dataKey="netProfit"
                  stroke="#10B981"
                  name="Net Profit"
                  strokeWidth={2}
                  dot={{ r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="mb-6">
            <ProfitTable setSuggestionsData={setSuggestionsData} />
          </div>

          <SuggestionList suggestionsData={suggestionsData} />
          <div className='w-full h-[3rem]'></div>
          <div className='w-full h-[3rem]'></div>
    
        </div>
      </div>
    </div>
  );
};

export default ProfitabilityDashboard;