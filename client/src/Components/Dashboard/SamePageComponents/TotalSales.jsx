import React, { useState } from "react";
import { AlertCircle, DollarSign, TrendingUp, PieChart } from 'lucide-react';
import Chart from "react-apexcharts";
import { useSelector } from "react-redux";
import { useNavigate } from "react-router-dom";
import TooltipBox from "../../ToolTipBox/ToolTipBoxBottom";
import ToolTipBoxLeft from '../../ToolTipBox/ToolTipBoxBottomLeft';
import { formatCurrencyWithLocale } from '../../../utils/currencyUtils.js';

// Function to format date with ordinal suffix (1st, 2nd, 3rd, etc.)
const formatDateWithOrdinal = (dateString) => {
  const date = new Date(dateString);
  const day = date.getDate();
  const month = date.toLocaleDateString('en-US', { month: 'long' });
  
  // Get ordinal suffix
  const getOrdinalSuffix = (day) => {
    if (day > 3 && day < 21) return 'th';
    switch (day % 10) {
      case 1: return 'st';
      case 2: return 'nd';
      case 3: return 'rd';
      default: return 'th';
    }
  };
  
  return `${day}${getOrdinalSuffix(day)} ${month}`;
};

const TotalSales = () => {
  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  const navigate = useNavigate();
  const [openToolTipGrossProfit, setOpenToolTipGrossProfit] = useState(false);
  const [openToolTipTopSales, setOpenToolTipTopSales] = useState(false);
  
  // Get currency from Redux
  const currency = useSelector(state => state.currency?.currency) || '$';
  
  // Get sponsoredAdsMetrics from Redux store - same as other dashboards
  const sponsoredAdsMetrics = useSelector((state) => state.Dashboard.DashBoardInfo?.sponsoredAdsMetrics);

  const labelData = [
    "Gross Profit",
    "PPC Spent",
    "FBA Fees",
    "Storage Fees",
    "Refunds",
  ];

  const grossProfitRaw = Number(info?.accountFinance?.Gross_Profit) || 0;
  const grossProfit = Math.abs(grossProfitRaw);
  const totalSales = Number(info?.TotalWeeklySale || 0);

  // Calculate PPC Spent using same logic as other dashboards - prioritize ProductAdsPayment, fallback to sponsoredAds
  const actualPPCSpend = Number(info?.accountFinance?.ProductAdsPayment || 0);
  const ppcSpent = actualPPCSpend > 0 ? actualPPCSpend : (sponsoredAdsMetrics?.totalCost || 0);

  const saleValues = [
    grossProfit,
    ppcSpent,
    Number(info?.accountFinance?.FBA_Fees || 0),
    Number(info?.accountFinance?.Storage || 0),
    Number(info?.accountFinance?.Refunds || 0),
  ];

  // Handle navigation to profitability dashboard
  const handleNavigateToProfitability = (itemName) => {
    console.log(`Navigating to profitability dashboard from: ${itemName}`);
    navigate('/seller-central-checker/profitibility-dashboard');
  };

  const chartData = {
    series: saleValues,
    options: {
      chart: { 
        type: "pie",
        fontFamily: "'Inter', sans-serif",
        events: {
          dataPointSelection: function(event, chartContext, config) {
            const selectedLabel = labelData[config.dataPointIndex];
            handleNavigateToProfitability(selectedLabel);
          }
        }
      },
      labels: labelData,
      colors: [
        grossProfitRaw < 0 ? "#64748b" : "#059669",
        "#f59e0b",
        "#ea580c",
        "#dc2626",
        "#9333ea",
      ],
      legend: { show: false },
      dataLabels: { 
        enabled: false
      },
      plotOptions: {
        pie: {
          donut: {
            size: '0%'
          }
        }
      },
      stroke: {
        width: 2,
        colors: ['#ffffff']
      },
      responsive: [{
        breakpoint: 768,
        options: {
          chart: {
            height: 200,
            width: 200
          }
        }
      }]
    },
  };

  return (
    <div className="p-6 h-full min-h-[400px] bg-white border-2 border-gray-200 rounded-md">
      {/* Header Section */}
      <div className="flex flex-wrap items-center justify-between mb-6 gap-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-5 h-5 text-blue-600" />
            <h2 className="text-lg font-semibold text-gray-900">Total Sales</h2>
          </div>
          <div className="relative">
            <AlertCircle 
              className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors" 
              onMouseEnter={() => setOpenToolTipTopSales(true)} 
              onMouseLeave={() => setOpenToolTipTopSales(false)} 
            />
            {openToolTipTopSales && <ToolTipBoxLeft Information="Total revenue generated during the selected date range."/>}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <PieChart className="w-5 h-5 text-emerald-600" />
            <h2 className="text-lg font-semibold text-gray-900">Gross Profit</h2>
          </div>
          <div className="relative">
            <AlertCircle 
              className="w-4 h-4 text-gray-400 hover:text-gray-600 cursor-pointer transition-colors" 
              onMouseEnter={() => setOpenToolTipGrossProfit(true)} 
              onMouseLeave={() => setOpenToolTipGrossProfit(false)} 
            />
            {openToolTipGrossProfit && <TooltipBox Information="Gross profit after deducting ad spend, storage fees, FBA fees, and product return refunds from sales revenue."/>}
          </div>
        </div>
      </div>

      {/* Sales Numbers */}
      <div className="flex flex-wrap items-center justify-between mb-6 gap-4">
        <div className="flex flex-col">
          <div className="flex items-center gap-3 mb-2">
            <h2 className="text-3xl font-bold text-gray-900">
              {formatCurrencyWithLocale(totalSales, currency)}
            </h2>
          </div>
          <p className="text-sm text-gray-500">
            {info?.startDate ? formatDateWithOrdinal(info.startDate) : '23rd May'} - {info?.endDate ? formatDateWithOrdinal(info.endDate) : '22nd June'}
          </p>
        </div>
        
        <div className="flex flex-col items-end">
          <h2 className={`text-2xl font-bold ${grossProfitRaw >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {formatCurrencyWithLocale(grossProfitRaw, currency)}
          </h2>
          <p className="text-sm text-gray-500 mt-1">
            {grossProfitRaw >= 0 ? 'Profit' : 'Loss'}
          </p>
        </div>
      </div>

      {/* Chart & Legend */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6 items-start">
        {/* Chart */}
        <div className="lg:col-span-2 flex justify-center">
          <Chart
            options={chartData.options}
            series={chartData.series}
            type="pie"
            width="240"
            height="240"
          />
        </div>

        {/* Legend */}
        <div className="lg:col-span-3 space-y-3">
          {labelData.map((label, index) => {
            const value = saleValues[index];
            const percentage = totalSales > 0 ? Math.round((value / totalSales) * 100) : 0;
            
            return (
              <div
                key={index}
                onClick={() => handleNavigateToProfitability(label)}
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-blue-50 hover:border-blue-200 border border-transparent transition-all cursor-pointer group"
                title={`Click to view ${label} details in Profitability Dashboard`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: chartData.options.colors[index] }}
                  ></div>
                  <p className="text-sm font-medium text-gray-700 group-hover:text-blue-700 transition-colors">{label}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-semibold text-gray-900 group-hover:text-blue-900 transition-colors">
                    {formatCurrencyWithLocale((index === 0 ? grossProfitRaw : value), currency)}
                  </p>
                  <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-full text-xs font-medium min-w-[2.5rem] text-center group-hover:bg-blue-100 transition-colors">
                    {percentage}%
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default TotalSales;
