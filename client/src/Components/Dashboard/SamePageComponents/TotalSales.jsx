import React, { useState } from "react";
import { AlertCircle, DollarSign, TrendingUp, PieChart } from 'lucide-react';
import Chart from "react-apexcharts";
import { useSelector } from "react-redux";
import TooltipBox from "../../ToolTipBox/ToolTipBoxBottom";
import ToolTipBoxLeft from '../../ToolTipBox/ToolTipBoxBottomLeft'

const TotalSales = () => {
  const info = useSelector((state) => state.Dashboard.DashBoardInfo);
  const [openToolTipGrossProfit, setOpenToolTipGrossProfit] = useState(false);
  const [openToolTipTopSales, setOpenToolTipTopSales] = useState(false);

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

  const saleValues = [
    grossProfit,
    Number(info?.accountFinance?.ProductAdsPayment || 0),
    Number(info?.accountFinance?.FBA_Fees || 0),
    Number(info?.accountFinance?.Storage || 0),
    Number(info?.accountFinance?.Refunds || 0),
  ];

  const chartData = {
    series: saleValues,
    options: {
      chart: { 
        type: "pie",
        fontFamily: "'Inter', sans-serif"
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
              ${totalSales.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </h2>
            <div className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 rounded-full">
              <TrendingUp className="w-3 h-3" />
              <span className="text-xs font-medium">12.5%</span>
            </div>
          </div>
          <p className="text-sm text-gray-500">
            {info?.startDate || '23 May'} - {info?.endDate || '22 Jun'}
          </p>
        </div>
        
        <div className="flex flex-col items-end">
          <h2 className={`text-2xl font-bold ${grossProfitRaw >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            ${grossProfitRaw.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
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
                className="flex items-center justify-between p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
              >
                <div className="flex items-center gap-3">
                  <div
                    className="w-3 h-3 rounded-full flex-shrink-0"
                    style={{ backgroundColor: chartData.options.colors[index] }}
                  ></div>
                  <p className="text-sm font-medium text-gray-700">{label}</p>
                </div>
                <div className="flex items-center gap-3">
                  <p className="text-sm font-semibold text-gray-900">
                    ${(index === 0 ? grossProfitRaw : value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </p>
                  <span className="bg-blue-50 text-blue-700 px-2 py-1 rounded-full text-xs font-medium min-w-[2.5rem] text-center">
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
